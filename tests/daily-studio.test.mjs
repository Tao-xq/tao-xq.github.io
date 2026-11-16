import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {NoteStore,readJson} from '../tools/daily-studio/store.mjs';
import {NotePublisher} from '../tools/daily-studio/publisher.mjs';
import {createStudio} from '../tools/daily-studio/server.mjs';
import {cleanDailyHtml,dailyPost} from '../lib/daily-format.mjs';
const execute=promisify(execFile),cover=await fs.readFile(new URL('fixtures/cover.png',import.meta.url));
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rest-notes-test-'));t.after(async()=>{const target=path.resolve(dir);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});});return dir;}
async function fixture(root){await fs.mkdir(path.join(root,'content/daily'),{recursive:true});await fs.writeFile(path.join(root,'content/owner.json'),JSON.stringify({nickname:'Test owner',avatar:'assets/test.png'}));}
async function fill(store,draft){
 const asset=await store.putAsset(cover);
 const copy={title:'一篇未发布的测试',html:'<p>只在临时仓库里验证。</p><figure class="note-photo" style="width:50%;margin-left:auto;margin-right:auto"><img src="'+asset.src+'" alt="测试封面"><figcaption>照片说明</figcaption></figure>',delta:{ops:[{insert:'只在临时仓库里验证。\n'},{insert:{photo:{src:asset.src,width:50,align:'center',caption:'照片说明',alt:'测试封面'}}},{insert:'\n'}]}};
 return store.save(draft.id,{...draft,cover:asset.src,locales:{zh:copy}});
}

test('daily rich content keeps captions and limited styling while stripping executable markup',()=>{
 const body=cleanDailyHtml('<h1>标题</h1><figure class="note-photo evil" style="width:50%;position:fixed;margin-left:auto"><img src="assets/daily/a.jpg" onerror="alert(1)"><figcaption>说明</figcaption></figure><p style="color:#b65349;background-image:url(x)"><strong>粗体</strong></p><a href="javascript:alert(1)">链接</a><script>bad()</script>');
 assert(body.includes('<h2>标题</h2>'));assert(body.includes('<figcaption>说明</figcaption>'));assert(body.includes('width:50%'));assert(body.includes('color:#b65349'));assert(!/onerror|javascript:|script|evil|position|background-image/.test(body));
 const post=dailyPost({id:'daily-example',title:'示例',cover:'assets/daily/a.jpg',body,lang:'zh',publishedAt:'2026-11-16T12:00:00Z',translations:{en:{title:'Example',body:'<p>Hello</p>'}}},{nickname:'Owner',avatar:'assets/avatar.jpg'});assert.equal(post.section,'daily');assert.equal(post.translations.en.body,'<p>Hello</p>');
 assert.throws(()=>dailyPost({...post,body:'<img src="/api/assets/a.jpg">'},{nickname:'Owner'}));assert.throws(()=>dailyPost({...post,id:'../../private'},{nickname:'Owner'}));
});

test('site build publishes rich JSON articles without exposing studio files or private image URLs',async t=>{
 const root=await temporary(t);await fixture(root);
 const rich={schema:1,id:'daily-build-example',title:'构建检查',cover:'assets/cover.png',lang:'zh',publishedAt:'2026-11-16T12:00:00Z',body:'<h2>一段标题</h2><figure class="note-photo" style="width:50%;margin-left:auto;margin-right:auto"><img src="assets/cover.png" alt="封面"><figcaption>图片说明</figcaption></figure>',translations:{en:{title:'Build check',body:'<p>English text</p>'}}};
 await fs.writeFile(path.join(root,'content/daily/daily-build-example.json'),JSON.stringify(rich));await fs.writeFile(path.join(root,'content/ui-languages.json'),'[]');await fs.writeFile(path.join(root,'content/home-manifest.json'),JSON.stringify({source:{},background:{},glass:{},hoverLayers:{},sequences:{},frameCount:0}));
 await fs.mkdir(path.join(root,'web/assets'),{recursive:true});await fs.mkdir(path.join(root,'web/vendor'),{recursive:true});await fs.writeFile(path.join(root,'web/index.html'),'<!doctype html><script src="app.js"></script>');await fs.writeFile(path.join(root,'web/app.js'),'window.example=true;');await fs.writeFile(path.join(root,'web/assets/cover.png'),cover);
 const sdk=path.join(root,'node_modules/@supabase/supabase-js');await fs.mkdir(path.join(sdk,'dist/umd'),{recursive:true});await fs.writeFile(path.join(sdk,'dist/umd/supabase.js'),'// build fixture');await fs.writeFile(path.join(sdk,'LICENSE'),'Fixture');
 await fs.mkdir(path.join(root,'scripts'),{recursive:true});let source=await fs.readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');source=source.replace("from 'sanitize-html'","from '"+import.meta.resolve('sanitize-html')+"'").replace("from '../lib/daily-format.mjs'","from '"+new URL('../lib/daily-format.mjs',import.meta.url).href+"'");await fs.writeFile(path.join(root,'scripts/build.mjs'),source);
 await execute(process.execPath,['scripts/build.mjs'],{cwd:root});const posts=await readJson(path.join(root,'dist/content/posts.json'));assert.equal(posts.length,1);assert(posts[0].body.includes('<figcaption>图片说明</figcaption>'));assert(posts[0].body.includes('width:50%'));assert.equal(posts[0].translations.en.title,'Build check');assert(!posts[0].body.includes('/api/assets/'));assert.equal(await fs.stat(path.join(root,'dist/tools')).catch(()=>null),null);
});

test('drafts enforce revisions, keep history, archive reversibly and validate uploaded images',async t=>{
 const root=await temporary(t);await fixture(root);const store=new NoteStore(root);await store.init();const draft=await store.create(),saved=await fill(store,draft);assert.equal(saved.revision,2);await assert.rejects(store.save(draft.id,draft),e=>e.status===409);
 const updated=await store.save(saved.id,{...saved,locales:{...saved.locales,zh:{...saved.locales.zh,title:'修改后的标题'}}},{manual:true});assert.equal((await store.versions(saved.id))[0].revision,2);
 const restored=await store.restore(saved.id,2,updated.revision);assert.equal(restored.locales.zh.title,'一篇未发布的测试');const archived=await store.archive(saved.id,restored.revision,true);assert(archived.archivedAt);const recovered=await store.archive(saved.id,archived.revision,false);assert.equal(recovered.archivedAt,null);
 await assert.rejects(store.asset('../drafts/private.json'),e=>e.status===404);await assert.rejects(store.putAsset(Buffer.from('<svg></svg>')));await assert.rejects(store.putAsset(Buffer.alloc(12*1024*1024+1)));
 const backup=await store.backup(saved.id),imported=await store.importFile({backup});assert.notEqual(imported.id,saved.id);assert.equal(imported.locales.zh.title,recovered.locales.zh.title);assert.equal(Object.keys((await store.backup(imported.id)).assets).length,1);
});

test('local API rejects cross-site, unauthenticated and unverified writes and serializes conflicting saves',async t=>{
 const root=await temporary(t);await fixture(root);const app=await createStudio({repo:root,port:0,seed:false});t.after(()=>new Promise(resolve=>app.server.close(resolve)));const origin=app.url.slice(0,-1);
 assert.equal((await fetch(app.url+'api/drafts')).status,401);
 assert.equal((await fetch(app.url,{headers:{origin:'https://evil.invalid'}})).status,403);
 const rebound=await new Promise((resolve,reject)=>{const request=http.get(app.url,{headers:{host:'evil.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});assert.equal(rebound,403);
 const htmlResponse=await fetch(app.url),cookie=htmlResponse.headers.get('set-cookie').split(';')[0],html=await htmlResponse.text(),csrf=html.match(/name="daily-csrf" content="([a-f0-9]+)"/)[1];
 const headers={cookie,origin,'Content-Type':'application/json','X-Daily-CSRF':csrf};
 assert.equal((await fetch(app.url+'api/drafts',{method:'POST',headers:{cookie,origin,'Content-Type':'application/json'},body:'{}'})).status,403);
 const draft=await (await fetch(app.url+'api/drafts',{method:'POST',headers,body:'{}'})).json();
 const saves=await Promise.all([1,2].map(()=>fetch(app.url+'api/drafts/'+draft.id,{method:'PUT',headers,body:JSON.stringify(draft)})));assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
 assert.equal((await fetch(app.url+'api/assets/../../content/owner.json',{headers:{cookie}})).status,404);
});

test('GitHub publication is explicit, limits committed files and safely retries a failed push',async t=>{
 const root=await temporary(t),bare=path.join(root,'remote.git'),repo=path.join(root,'checkout');
 const git=async(cwd,...args)=>(await execute('git',args,{cwd,maxBuffer:1024*1024})).stdout.trim();
 await git(root,'init','--bare',bare);await git(root,'clone',bare,repo);await git(repo,'checkout','-b','main');await git(repo,'config','user.name','Studio test');await git(repo,'config','user.email','test@example.invalid');await fixture(repo);await fs.writeFile(path.join(repo,'.gitignore'),'.local/\n');await git(repo,'add','.');await git(repo,'commit','-m','Fixture');await git(repo,'push','-u','origin','main');
 const store=new NoteStore(repo);await store.init();const draft=await fill(store,await store.create()),publisher=new NotePublisher(store,{remote:bare,checkBuild:false}),plan=await publisher.plan(draft.id);
 assert.equal(await fs.stat(path.join(repo,plan.files[0])).catch(()=>null),null);assert.equal((await store.get(draft.id)).publishedAt,undefined);
 await fs.writeFile(path.join(repo,'unrelated.txt'),'Do not publish');await assert.rejects(publisher.confirm(plan.id),e=>e.status===409);assert.equal(await git(repo,'rev-list','--count','HEAD'),'1');await fs.unlink(path.join(repo,'unrelated.txt'));
 const retryPlan=await publisher.plan(draft.id);await git(repo,'config','remote.origin.pushurl',path.join(root,'missing.git'));await assert.rejects(publisher.confirm(retryPlan.id),e=>e.status===502);const failed=await publisher.job(retryPlan.id);assert.equal(failed.state,'committed');assert.equal(await git(repo,'rev-list','--count','HEAD'),'2');
 await git(repo,'config','--unset','remote.origin.pushurl');const result=await publisher.confirm(retryPlan.id);assert.equal(result.state,'submitted');assert.equal(await git(repo,'rev-list','--count','HEAD'),'2');
 const files=await git(repo,'ls-tree','-r','--name-only','HEAD');assert(!files.includes('.local/'));assert(!files.includes('unrelated.txt'));assert(files.includes('content/daily/'+draft.dailyId+'.json'));
 const publishedPost=JSON.parse(await git(root,'--git-dir='+bare,'show','main:content/daily/'+draft.dailyId+'.json'));assert(publishedPost.body.includes('<figcaption>照片说明</figcaption>'));assert(!publishedPost.body.includes('/api/assets/'));assert.equal((await store.get(draft.id)).lastCommit,result.commit);
 const stored=await readJson(store.file(draft.id));assert(stored.publishedHash);const restored=await store.restore(draft.id,draft.revision,stored.revision);assert.equal(restored.publishedHash,stored.publishedHash);assert.equal(restored.publishedAt,stored.publishedAt);
});
