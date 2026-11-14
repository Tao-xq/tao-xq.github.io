import {createClient} from '@supabase/supabase-js';import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../web/config.js',import.meta.url),'utf8'),context);const cfg=context.window.REST_BACKEND;
const users=[];
async function visitor(){const c=createClient(cfg.supabaseUrl,cfg.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await c.auth.signInAnonymously();if(error)throw error;users.push(c);return data.session.access_token;}
async function call(route,method='GET',body,token){const response=await fetch(cfg.apiEndpoint+route,{method,headers:{'Content-Type':'application/json',apikey:cfg.publishableKey,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
const unauthorized=await call('/notes','POST',{author:'test',body:'unauthorized'});check('writes require a verified visitor session',()=>assert.equal(unauthorized.status,401));
const a=await visitor(),b=await visitor();
const fixture=fs.readFileSync(new URL('../tests/fixtures/cover.png',import.meta.url));
const image=await call('/uploads','POST',{kind:'cover',data:'data:image/png;base64,'+fixture.toString('base64')},a);check('real A4 upload',()=>assert.equal(image.status,201,JSON.stringify(image.data)));
const input={title:'Rest Mode 接口验收',author:'连接测试',cover:image.data.url,body:'<p onclick="alert(1)">Rest Mode <strong>连接测试</strong></p><script>alert(1)</script><p><a href="https://example.com">link</a><img src="'+image.data.url+'"></p>',lang:'zh',author_id:'00000000-0000-0000-0000-000000000000',views:999999};
const created=await call('/posts','POST',input,a);check('publish canonical community post and ignore spoofed identity/views',()=>{assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.own,true);assert.equal(created.data.views,0);assert.equal(created.data.section,'community');assert(!/script|onclick/.test(created.data.body));});
const id=created.data.id;
const other=await call('/posts/'+id,'PATCH',{...input,version:1},b);check('another visitor cannot edit',()=>assert.equal(other.status,403));
const own=await call('/posts/'+id,'PATCH',{...input,title:'Rest Mode 接口验收已更新',version:1},a);check('owner edit increments version',()=>{assert.equal(own.status,200);assert.equal(own.data.version,2);});
const stale=await call('/posts/'+id,'PATCH',{...input,version:1},a);check('stale edit is rejected',()=>assert.equal(stale.status,409));
const publicPost=await call('/posts/'+id);check('another reader sees shared post without edit rights',()=>{assert.equal(publicPost.status,200);assert.equal(publicPost.data.own,false);assert.equal(publicPost.data.title,own.data.title);});
const view1=await call('/views','POST',{postId:id}),view2=await call('/views','POST',{postId:id});check('server deduplicates repeated views',()=>{assert.equal(view1.status,200);assert.equal(view1.data.views,view2.data.views);assert.equal(view1.data.views,1);});
const search=await call('/posts?q='+encodeURIComponent('连接测试'));check('server keyword and author search',()=>assert(search.data.posts.some(p=>p.id===id)));
const note=await call('/notes','POST',{author:'连接测试',body:'共享留言接口验收；正式上线前隐藏。'},a);check('public guestbook is shared',()=>assert.equal(note.status,201));
const notes=await call('/notes');check('signed-out reader sees note',()=>assert(notes.data.notes.some(n=>n.id===note.data.id)));
const badTranslation=await call('/translate','POST',{postId:id,revision:2,sourceVersion:'x',sourceLanguage:'zh',targetLanguage:'en',texts:['arbitrary proxy text']});check('translation cannot proxy arbitrary user text',()=>assert.equal(badTranslation.status,409));
const direct=await fetch(cfg.supabaseUrl+'/rest/v1/community_posts?select=*',{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+a}});check('direct authenticated table access is denied',()=>assert([401,403].includes(direct.status)));
const directWrite=await fetch(cfg.supabaseUrl+'/rest/v1/short_notes',{method:'POST',headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+b,'Content-Type':'application/json'},body:JSON.stringify({author:'forged',body:'blocked'})});check('direct authenticated table writes are denied',()=>assert([401,403].includes(directWrite.status)));
console.log(JSON.stringify({passed,hidePost:id,hideNote:note.data.id}));
for(const c of users)await c.auth.signOut({scope:'local'});
