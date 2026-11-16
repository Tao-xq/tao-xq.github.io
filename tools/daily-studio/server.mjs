import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NoteStore,readJson,fail,escape} from './store.mjs';
import {NotePublisher,digest} from './publisher.mjs';
import {DAILY_ID,cleanDailyHtml} from '../../lib/daily-format.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const types={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
async function readBody(req){let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>64*1024*1024)throw fail('这份文件太大，请分批导入照片。',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('请求内容格式不正确。');}}
export async function createStudio({repo=path.resolve(here,'../..'),data,port=4186,seed=true,publisherOptions={}}={}){
 repo=path.resolve(repo);const store=new NoteStore(repo,data),publisher=new NotePublisher(store,publisherOptions);await store.init();if(seed)await store.seedLegacy();
 const csrf=crypto.randomBytes(32).toString('hex'),session=crypto.randomBytes(32).toString('hex');let mutations=Promise.resolve();
 const mutate=operation=>{const result=mutations.then(operation);mutations=result.catch(()=>{});return result;};
 const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 async function published(){const dir=path.join(repo,'content/daily'),names=await fs.readdir(dir),list=[];for(const name of names){if(name.endsWith('.json')){const post=await readJson(path.join(dir,name));if(post&&!post.draft)list.push({id:post.id,title:post.title,publishedAt:post.publishedAt,editable:true});}else if(name.endsWith('.md')&&!/\.(zh|en|ja)\.md$/.test(name)){const raw=await fs.readFile(path.join(dir,name),'utf8');if(/^draft:\s*true\s*$/m.test(raw))continue;const get=key=>raw.match(new RegExp('^'+key+':\\s*(.+)$','m'))?.[1]?.trim();if(get('id'))list.push({id:get('id'),title:get('title'),publishedAt:get('publishedAt'),editable:false});}}return list.sort((a,b)=>String(b.publishedAt).localeCompare(String(a.publishedAt)));}
 async function editPublished(id){
  if(!DAILY_ID.test(id))throw fail('文章不存在。',404);const existing=(await store.list()).find(d=>d.dailyId===id&&!d.archivedAt);if(existing)return store.get(existing.id);
  const filename=path.join(repo,'content/daily',id+'.json'),raw=await fs.readFile(filename).catch(()=>null);if(!raw)throw fail('请先通过 GitHub 编辑这篇 Markdown 文章，或把正文复制到新草稿。',404);const post=JSON.parse(raw),mapping=new Map();
  async function localize(value){for(const match of value.matchAll(/assets\/[a-zA-Z0-9_./-]+\.(?:jpg|png|webp|gif)/g)){const source=match[0];if(source.includes('..'))throw fail('文章图片路径不正确。');if(!mapping.has(source)){const image=await fs.readFile(path.join(repo,'web',source)),asset=await store.putAsset(image);mapping.set(source,asset.src);}}for(const [source,target]of mapping)value=value.replaceAll(source,target);return value;}
  const locales={};locales[post.lang]={title:post.title,html:await localize(cleanDailyHtml(post.body)),delta:null};for(const [lang,copy]of Object.entries(post.translations||{}))locales[lang]={title:copy.title,html:await localize(cleanDailyHtml(copy.body)),delta:null};
  return store.create({dailyId:post.id,lang:post.lang,locales,cover:await localize(post.cover),publishedAt:post.publishedAt,publishedHash:digest(raw)});
 }
 const server=http.createServer(async(req,res)=>{
  try{
   const address=server.address(),origin='http://127.0.0.1:'+address.port;
   const url=new URL(req.url,origin),pathname=decodeURIComponent(url.pathname);
   const openingDocument=req.method==='GET'&&pathname==='/'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
   if(req.headers.host!=='127.0.0.1:'+address.port||!openingDocument&&(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'))throw fail('这个写作台只接受本机页面的请求。',403);
   if(pathname==='/health'&&req.method==='GET')return json(res,{app:'rest-mode-daily-studio',version:1});
   if(pathname==='/'&&req.method==='GET'){
    const html=(await fs.readFile(path.join(here,'app.html'),'utf8')).replace('__CSRF__',csrf);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Set-Cookie':'daily_studio='+session+'; HttpOnly; SameSite=Strict; Path=/','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});return res.end(html);
   }
   const staticFiles={'/app.js':path.join(here,'app.js'),'/app.css':path.join(here,'app.css'),'/vendor/quill.js':path.join(repo,'web/vendor/quill.js'),'/vendor/quill.snow.css':path.join(repo,'web/vendor/quill.snow.css')};
   if(req.method==='GET'&&staticFiles[pathname]){res.writeHead(200,{'Content-Type':types[path.extname(pathname)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(await fs.readFile(staticFiles[pathname]));}
   if(!pathname.startsWith('/api/'))throw fail('页面不存在。',404);
   if(!(req.headers.cookie||'').split(/;\s*/).includes('daily_studio='+session))throw fail('请从写作台入口重新打开页面。',401);
   if(req.method!=='GET'&&(req.headers.origin!==origin||req.headers['x-daily-csrf']!==csrf||!String(req.headers['content-type']).startsWith('application/json')))throw fail('写作台会话校验失败，请刷新页面后重试。',403);
   if(pathname==='/api/bootstrap'&&req.method==='GET')return json(res,{owner:await readJson(path.join(repo,'content/owner.json')),drafts:await store.list(),published:await published()});
   if(pathname.startsWith('/api/assets/')&&req.method==='GET'){const name=pathname.slice(12),bytes=await store.asset(name);res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'private,max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(bytes);}
   if(pathname==='/api/drafts'&&req.method==='GET')return json(res,await store.list());
   if(pathname.startsWith('/api/export/')&&req.method==='GET'){const id=pathname.slice(12),draft=await store.get(id),format=url.searchParams.get('format'),html=format==='html',body=html?await publisher.exportHtml(id):JSON.stringify(await store.backup(id));const title=draft.locales[draft.lang].title||'个人随笔';res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(title+(html?'.html':'.restnotes.json')),'Cache-Control':'no-store'});return res.end(body);}
   const draftMatch=pathname.match(/^\/api\/drafts\/(note-[a-f0-9-]{36})(?:\/(versions|archive|restore))?$/);
   if(draftMatch&&req.method==='GET')return json(res,draftMatch[2]==='versions'?await store.versions(draftMatch[1]):await store.get(draftMatch[1]));
   const jobMatch=pathname.match(/^\/api\/publish\/jobs\/(publish-[a-f0-9-]{36})$/);if(jobMatch&&req.method==='GET'){const job=await publisher.job(jobMatch[1]);return json(res,{id:job.id,state:job.state,error:job.error||null,...(job.state==='submitted'?publisher.result(job):{})});}
   if(!['POST','PUT'].includes(req.method))throw fail('请求方式不支持。',405);const body=await readBody(req);
   return await mutate(async()=>{
    let result;
    if(pathname==='/api/drafts'&&req.method==='POST')result=await store.create();
    else if(draftMatch&&req.method==='PUT'&&!draftMatch[2])result=await store.save(draftMatch[1],body,{manual:body.manual===true});
    else if(draftMatch?.[2]==='archive')result=await store.archive(draftMatch[1],body.revision,body.archived===true);
    else if(draftMatch?.[2]==='restore')result=await store.restore(draftMatch[1],body.version,body.revision);
    else if(pathname==='/api/assets'&&typeof body.data==='string'&&body.data.length<18*1024*1024)result=await store.putAsset(Buffer.from(body.data,'base64'));
    else if(pathname==='/api/import')result=await store.importFile(body);
    else if(pathname==='/api/published/edit')result=await editPublished(body.id);
    else if(pathname==='/api/publish/prepare')result=await publisher.plan(body.id);
    else if(pathname==='/api/publish/confirm'&&body.confirm===true)result=await publisher.confirm(body.id);
    else if(pathname==='/api/shutdown'){json(res,{ok:true});server.close();return;}
    else throw fail('找不到这个操作。',404);
    json(res,result);
   });
  }catch(error){if(!res.headersSent)json(res,{error:error.status?error.message:'操作未完成，原有草稿已保留。'},error.status||500);else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return {server,store,publisher,url:'http://127.0.0.1:'+server.address().port+'/'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const app=await createStudio();console.log('Daily Notes: '+app.url);}
