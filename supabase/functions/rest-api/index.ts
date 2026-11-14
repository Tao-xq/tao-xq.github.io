import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import sanitizeHtml from 'npm:sanitize-html@2.18.2';
import { parseHTML } from 'npm:linkedom@0.18.12';
import { imageSize } from 'npm:image-size@2.1.0';

const env = name => Deno.env.get(name) || '';
const SITE = env('SITE_ORIGIN') || 'https://tao-xq.github.io';
const URL_BASE = env('SUPABASE_URL');
const SERVER_KEY=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default||env('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(URL_BASE,SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const IMAGE_BASE = URL_BASE+'/storage/v1/object/public/post-images/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG=new Set(['zh','en','ja']);
const size = s=>Array.from(s||'').length;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function cleanText(value,max){if(typeof value!=='string')throw error('INVALID_INPUT');const s=value.trim();if(!size(s)||size(s)>max)throw error('INVALID_INPUT');return s;}
function safeImage(src){try {const u=new URL(src);return u.href.startsWith(IMAGE_BASE)&&!u.search&&!u.hash&&/^https:$/.test(u.protocol);}catch{return false;}}
function cleanBody(html){
 if(typeof html!=='string'||html.length>400000)throw error('INVALID_INPUT');
 return sanitizeHtml(html,{
  allowedTags:['p','br','strong','b','em','i','u','s','blockquote','ol','ul','li','a','img','pre','code','h2','h3','hr','div','span'],
  allowedAttributes:{a:['href','target','rel'],img:['src','alt','loading'],'*':['class'],li:['data-list']},
  allowedClasses:{'*':['ql-align-center','ql-align-right','ql-align-justify']},allowedSchemes:['https','http'],allowProtocolRelative:false,
  transformTags:{a:(_t,a)=>({tagName:'a',attribs:{href:a.href||'',target:'_blank',rel:'noopener noreferrer'}}),img:(_t,a)=>({tagName:'img',attribs:{src:safeImage(a.src)?a.src:'',alt:(a.alt||'').slice(0,200),loading:'lazy'}})},
  exclusiveFilter:f=>f.tag==='img'&&!f.attribs.src,
 });
}
function parseBody(body){const {document}=parseHTML('<html><body>'+body+'</body></html>');return document;}
function textNodes(doc){const found=[];function walk(n,skip=false){const no=skip||['PRE','CODE'].includes(n.nodeName);if(n.nodeType===3&&n.textContent.trim()&&!no)found.push(n);for(const child of n.childNodes||[])walk(child,no);}walk(doc.body);return found;}
function publicPost(p,viewer,views=0){return {id:p.id,section:'community',title:p.title,author:p.author,body:p.body,cover:p.cover,lang:p.lang,publishedAt:p.published_at,updatedAt:p.updated_at,version:p.version,own:viewer===p.author_id,views};}
function check(result){if(result.error)throw error('SERVICE_UNAVAILABLE',503);return result.data;}
async function identity(req,required=false){const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!jwt){if(required)throw error('SESSION_REQUIRED',401);return null;}const {data,error:e}=await db.auth.getUser(jwt);if(e||!data.user){if(required)throw error('SESSION_EXPIRED',401);return null;}return data.user.id;}
async function limited(key,max,seconds){if(!check(await db.rpc('take_limit',{p_bucket:key,p_max:max,p_seconds:seconds})))throw error('RATE_LIMIT',429);}
async function canonical(id){
 if(UUID.test(id)){const p=check(await db.from('community_posts').select('*').eq('id',id).eq('status','published').maybeSingle());if(!p)throw error('NOT_FOUND',404);return publicPost(p,null);}
 const response=await fetch(SITE+'/content/posts.json',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw error('NOT_FOUND',404);
 const posts=await response.json();const p=posts.find(p=>p.id===id);if(!p)throw error('NOT_FOUND',404);return p;
}
async function upload(user,input){
 if(!['body','cover'].includes(input.kind)||typeof input.data!=='string'||input.data.length>2800000)throw error('INVALID_IMAGE');
 const match=input.data.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw error('INVALID_IMAGE');
 let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{throw error('INVALID_IMAGE');}
 if(bytes.length>2097152||bytes.length<32)throw error('INVALID_IMAGE');
 let info;try{info=imageSize(bytes);}catch{throw error('INVALID_IMAGE');}
 if(!['jpg','png'].includes(info.type)||info.width<20||info.height<20||info.width>4096||info.height>4096||info.width*info.height>6000000)throw error('INVALID_IMAGE');
 if(input.kind==='cover'&&(info.width!==420||info.height!==594))throw error('COVER_RATIO');
 await limited('upload:'+user,40,3600);await limited('upload:global',200,86400);
 const path=user+'/'+crypto.randomUUID()+'.'+(info.type==='jpg'?'jpg':'png');
 check(await db.storage.from('post-images').upload(path,bytes,{contentType:info.type==='jpg'?'image/jpeg':'image/png',upsert:false,cacheControl:'31536000'}));
 const recorded=await db.from('uploads').insert({path,author_id:user,kind:input.kind,bytes:bytes.length});
 if(recorded.error){await db.storage.from('post-images').remove([path]);throw error('SERVICE_UNAVAILABLE',503);}
 return {url:IMAGE_BASE+path};
}
async function validatePost(input,user){
 const title=cleanText(input.title,28),author=cleanText(input.author,24),body=cleanBody(input.body),doc=parseBody(body),plain=cleanText(doc.body.textContent,50000);
 if(!LANG.has(input.lang)||!safeImage(input.cover))throw error('INVALID_INPUT');
 const images=[input.cover,...[...doc.querySelectorAll('img')].map(i=>i.getAttribute('src'))];if(images.length>13)throw error('TOO_MANY_IMAGES');
 const owned=check(await db.from('uploads').select('path,kind').eq('author_id',user).in('path',images.map(u=>u.slice(IMAGE_BASE.length))));
 if(images.some(u=>!owned.some(o=>IMAGE_BASE+o.path===u))||!owned.some(o=>IMAGE_BASE+o.path===input.cover&&o.kind==='cover'))throw error('IMAGE_OWNERSHIP',403);
 return {title,author,body,plain_body:plain,cover:input.cover,lang:input.lang};
}
async function translation(input,ip){
 if(!LANG.has(input.targetLanguage)||!LANG.has(input.sourceLanguage)||typeof input.postId!=='string'||input.postId.length>120)throw error('INVALID_INPUT');
 const p=await canonical(input.postId);if(p.lang!==input.sourceLanguage||String(p.version)!==String(input.revision))throw error('SOURCE_CHANGED',409);
 const texts=[p.title,...textNodes(parseBody(p.body)).map(n=>n.textContent)];
 if(!Array.isArray(input.texts)||JSON.stringify(texts)!==JSON.stringify(input.texts))throw error('SOURCE_CHANGED',409);
 const version=await hash(JSON.stringify({version:p.version,lang:p.lang,texts})),target=input.targetLanguage;
 const cached=check(await db.from('post_translations').select('*').eq('post_id',p.id).eq('version',version).eq('target',target).maybeSingle());
 if(cached?.state==='ready')return {texts:cached.texts,targetLanguage:target,sourceVersion:input.sourceVersion,machine:true};
 if(!env('DEEPL_API_KEY'))throw error('TRANSLATION_NOT_CONFIGURED',503);
 await limited('translate:ip:'+ip,20,3600);await limited('translate:global',100,86400);
 if(cached&&Date.now()-new Date(cached.created_at).getTime()<120000)throw error('TRANSLATION_PENDING',409);
 if(cached)check(await db.from('post_translations').delete().eq('post_id',p.id).eq('version',version).eq('target',target).neq('state','ready'));
 const lock=await db.from('post_translations').insert({post_id:p.id,version,target});if(lock.error)throw error('TRANSLATION_PENDING',409);
 try{
  const chars=texts.reduce((n,t)=>n+size(t),0);if(!check(await db.rpc('reserve_translation',{p_chars:chars})))throw error('TRANSLATION_QUOTA',429);
  // Fixed account-lifetime budget, including failed attempts. No automatic paid fallback.
  const groups=texts.map(text=>{const points=Array.from(text),parts=[];for(let i=0;i<points.length;i+=4000)parts.push(points.slice(i,i+4000).join(''));return parts;}),segments=groups.flat(),translated=[];
  for(let i=0;i<segments.length;){const batch=[];let bytes=0;while(i<segments.length&&batch.length<40){const t=segments[i],length=new TextEncoder().encode(JSON.stringify(t)).length;if(batch.length&&bytes+length>100000)break;batch.push(t);bytes+=length;i++;}
   const endpoint=env('DEEPL_API_KEY').endsWith(':fx')?'https://api-free.deepl.com/v2/translate':'https://api.deepl.com/v2/translate';
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'DeepL-Auth-Key '+env('DEEPL_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({text:batch,source_lang:{zh:'ZH',en:'EN',ja:'JA'}[p.lang],target_lang:{zh:'ZH-HANS',en:'EN-GB',ja:'JA'}[target]}),signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw error(response.status===456?'TRANSLATION_QUOTA':'TRANSLATION_FAILED',503);
   const result=await response.json();if(result.translations?.length!==batch.length||result.translations.some(t=>typeof t.text!=='string'))throw error('TRANSLATION_FAILED',503);translated.push(...result.translations.map(t=>t.text));
  }
  let cursor=0;const output=groups.map(group=>{const value=translated.slice(cursor,cursor+group.length).join('');cursor+=group.length;return value;});
  check(await db.from('post_translations').update({state:'ready',texts:output}).eq('post_id',p.id).eq('version',version).eq('target',target));
  return {texts:output,targetLanguage:target,sourceVersion:input.sourceVersion,machine:true};
 }catch(e){await db.from('post_translations').delete().eq('post_id',p.id).eq('version',version).eq('target',target).eq('state','pending');throw e;}
}
async function handler(req){
 const origin=req.headers.get('origin');const allowed=[SITE,'http://localhost:4173','http://127.0.0.1:4173'];
 const cors={'Access-Control-Allow-Origin':origin&&allowed.includes(origin)?origin:SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-visitor-token','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
 if(origin&&!allowed.includes(origin))return reply({error:'ORIGIN_DENIED'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 try{
  const url=new URL(req.url),parts=url.pathname.split('/').filter(Boolean),offset=parts.indexOf('rest-api');const path='/'+parts.slice(offset+1).join('/');
  if(req.method==='GET'&&path==='/health')return reply({ok:true,translationConfigured:!!env('DEEPL_API_KEY')});
  const ip=await hash((req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown')+SERVER_KEY);
  if(req.method==='GET'&&path==='/posts'){
   const start=Math.max(0,Math.min(100000,Math.floor(Number(url.searchParams.get('offset'))||0))),q=(url.searchParams.get('q')||'').slice(0,100).replace(/[^\p{L}\p{N}\s-]/gu,' ');
   let query=db.from('community_posts').select('*',{count:'exact'}).eq('status','published').order('published_at',{ascending:false}).order('id',{ascending:false}).range(start,start+23);
   if(q.trim())query=query.or(`title.ilike.%${q}%,author.ilike.%${q}%,plain_body.ilike.%${q}%`);
   const result=await query,posts=check(result),viewer=await identity(req);const counts=check(await db.from('post_view_counts').select('*').in('post_id',posts.map(p=>p.id)));
   return reply({posts:posts.map(p=>publicPost(p,viewer,counts.find(c=>c.post_id===p.id)?.views||0)),total:result.count});
  }
  if(req.method==='GET'&&path.startsWith('/posts/')){const id=path.slice(7),p=await canonical(id),viewer=await identity(req);if(UUID.test(id)){const row=check(await db.from('community_posts').select('author_id').eq('id',id).single());p.own=row.author_id===viewer;}const c=check(await db.from('post_view_counts').select('views').eq('post_id',id).maybeSingle());p.views=c?.views||0;return reply(p);}
  if(req.method==='GET'&&path==='/notes'){const start=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));const result=await db.from('short_notes').select('id,author,body,published_at',{count:'exact'}).eq('status','published').order('published_at',{ascending:false}).order('id',{ascending:false}).range(start,start+49);return reply({notes:check(result).map(n=>({...n,publishedAt:n.published_at})),total:result.count});}
  if(!['POST','PATCH'].includes(req.method))throw error('NOT_FOUND',404);
  if(Number(req.headers.get('content-length')||0)>3000000)throw error('PAYLOAD_TOO_LARGE',413);
  const raw=await req.text();if(raw.length>3000000)throw error('PAYLOAD_TOO_LARGE',413);let input;try{input=JSON.parse(raw);}catch{throw error('INVALID_INPUT');}if(!input||typeof input!=='object'||Array.isArray(input))throw error('INVALID_INPUT');
  if(path==='/translate')return reply(await translation(input,ip));
  if(path==='/views'){await canonical(input.postId);await limited('views:'+ip,300,3600);const views=check(await db.rpc('record_view',{p_post:input.postId,p_visitor:ip}));return reply({views});}
  const user=await identity(req,true);await limited('write:ip:'+ip,100,3600);
  if(path==='/uploads')return reply(await upload(user,input),201);
  if(path==='/notes'&&req.method==='POST'){await limited('note:'+user,10,3600);await limited('notes:ip:'+ip,20,3600);const note=check(await db.from('short_notes').insert({author_id:user,author:cleanText(input.author,24),body:cleanText(input.body,280)}).select('id,author,body,published_at').single());return reply({...note,publishedAt:note.published_at},201);}
  if(path==='/posts'&&req.method==='POST'){await limited('post:'+user,5,3600);await limited('posts:ip:'+ip,10,3600);const data=await validatePost(input,user),p=check(await db.from('community_posts').insert({...data,author_id:user}).select('*').single());return reply(publicPost(p,user),201);}
  if(path.startsWith('/posts/')&&req.method==='PATCH'){const id=path.slice(7);if(!UUID.test(id))throw error('FORBIDDEN',403);const old=check(await db.from('community_posts').select('*').eq('id',id).eq('author_id',user).eq('status','published').maybeSingle());if(!old)throw error('FORBIDDEN',403);if(Number(input.version)!==old.version)throw error('SOURCE_CHANGED',409);const data=await validatePost(input,user);const p=check(await db.from('community_posts').update({...data,version:old.version+1,updated_at:new Date().toISOString()}).eq('id',id).eq('author_id',user).eq('version',old.version).select('*').maybeSingle());if(!p)throw error('SOURCE_CHANGED',409);return reply(publicPost(p,user));}
  throw error('NOT_FOUND',404);
 }catch(e){const status=e.status||500;return reply({error:status===500?'SERVICE_UNAVAILABLE':e.message},status);}
}
Deno.serve(handler);
