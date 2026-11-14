// One-time migration of the approved prototype. Kept for provenance, not run by builds.
import fs from 'node:fs';
const root=new URL('../web/',import.meta.url);let js=fs.readFileSync(new URL('community.js',root),'utf8').replace(/\r\n/g,'\n');
function replace(from,to){if(!js.includes(from))throw Error('Missing migration anchor: '+from.slice(0,80));js=js.replace(from,to);}
replace("const views=post=>Math.max(0,Number(post.views)||0)+Math.max(0,Number(viewCounts[post.id])||0);","const views=post=>Math.max(0,Number(post.views)||0);");
replace('title="此浏览器中的阅读次数"','title="浏览量"');
js=js.replace(/ async function recordView\(post\)\{[^\n]+\}/,` async function recordView(post){try{const result=await window.REST_API.request('/views',{method:'POST',body:{postId:post.id}});post.views=result.views;}catch{/* A view-service failure must not prevent reading. */}}`);
replace('Rest Mode · 本地预览','Rest Mode');
replace("post.local&&post.authorId===deviceId","window.REST_API.owns(post)");
replace("const existing=id?localPosts.find(p=>p.id===id&&p.authorId===deviceId):storedDraft?.id?localPosts.find(p=>p.id===storedDraft.id&&p.authorId===deviceId):null;",`let existing=null;const requested=id||storedDraft?.id;if(requested)try{existing=await window.REST_API.request('/posts/'+encodeURIComponent(requested));if(!window.REST_API.owns(existing))existing=null;}catch{}if(version!==routeVersion)return;`);
replace('只能编辑自己在本地发布的帖子。','只能编辑当前访客会话发布的帖子。');
js=js.replaceAll('本地预览：发布后只保存在当前浏览器。','发布后所有访客都能看到。清除浏览器数据会失去匿名帖的编辑权限。');
const start=js.indexOf('  try{await draftQueue.catch(()=>{});const old=localPosts.find'),end=js.indexOf('\n }\n async function imageFromFile',start);
if(start<0||end<0)throw Error('Publish anchors missing');
js=js.slice(0,start)+`  try{await draftQueue.catch(()=>{});const old=editingId?await window.REST_API.request('/posts/'+encodeURIComponent(editingId)):null;const input=await window.REST_API.prepare({title,author,cover,body:d.html,lang:d.lang,version:old?.version});const post=await window.REST_API.request(old?'/posts/'+old.id:'/posts',{method:old?'PATCH':'POST',body:input});await storage.set('draft',null);await storage.set('nickname',author);localPosts=[post,...localPosts.filter(p=>p.id!==post.id)];quill=null;editingId=null;toast(old?'修改已发布。':'已发布到次元闲谈。');navigate('post/'+encodeURIComponent(post.id));}catch(e){toast(e.message);$$('.publish-post').forEach(b=>b.disabled=false);}`+js.slice(end);
const ns=js.indexOf("try{const note={id:'note-'+uid()"),ne=js.indexOf('finally{button.disabled=false;}});',ns);
if(ns<0||ne<0)throw Error('Note anchors missing');
js=js.slice(0,ns)+`try{const note=await window.REST_API.request('/notes',{method:'POST',body:{author,body}});await storage.set('nickname',author);localNotes=[note,...localNotes];$('#note-dialog').close();renderNotes();window.REST_I18N.apply();toast('留言已发布。');}catch(e){toast(e.message);}`+js.slice(ne);
replace("const post=allPosts().find(p=>p.id===id);if(post)","let post;try{post=await window.REST_API.request('/posts/'+encodeURIComponent(id));if(post.section==='community')localPosts=[post,...localPosts.filter(p=>p.id!==post.id)];}catch{post=allPosts().find(p=>p.id===id);}if(post)");
replace("else if(name==='notes'){renderNotes();", "else if(name==='notes'){try{const result=await window.REST_API.request('/notes');localNotes=result.notes;notesTotal=result.total;}catch(e){toast(e.message);}if(version!==routeVersion)return;renderNotes();");
replace("let seenViews=new Set();", "let notesTotal=0,cardRequest=0;let seenViews=new Set();");
replace("$('#note-add').addEventListener('click',async()=>",`if(localNotes.length<notesTotal){const more=document.createElement('button');more.className='paper-button';more.textContent=tx('再看一些留言');$('#notes-stream').after(more);more.addEventListener('click',async()=>{more.disabled=true;try{const result=await window.REST_API.request('/notes?offset='+localNotes.length);localNotes.push(...result.notes);notesTotal=result.total;renderNotes();window.REST_I18N.apply();}catch(e){toast(e.message);more.disabled=false;}});}
  $('#note-add').addEventListener('click',async()=>`);
replace(' function renderCards(section){',' async function renderCards(section){\n  const request=++cardRequest,version=routeVersion;');
replace("const list=allPosts().filter", "let remoteTotal=null;if(section==='community'){try{const result=await window.REST_API.request('/posts?offset=0&q='+encodeURIComponent(queries[section]));if(request!==cardRequest||version!==routeVersion)return;localPosts=result.posts;remoteTotal=result.total;while(localPosts.length<visibleLimit&&localPosts.length<remoteTotal){const next=await window.REST_API.request('/posts?offset='+localPosts.length+'&q='+encodeURIComponent(queries[section]));if(request!==cardRequest||version!==routeVersion)return;if(!next.posts.length)break;localPosts.push(...next.posts);}}catch(e){if(request!==cardRequest||version!==routeVersion)return;$('#post-grid').innerHTML='<div class=\"empty-state\"></div>';$('#post-grid .empty-state').textContent=e.message;$('#board-end').innerHTML='';return;}}\n  const list=allPosts().filter");
replace("$('#result-count').textContent=list.length+' 篇';", "$('#result-count').textContent=(remoteTotal??list.length)+' 篇';");
replace("$('#board-end').innerHTML=list.length>visibleLimit?", "$('#board-end').innerHTML=(remoteTotal??list.length)>visibleLimit?");
replace("storage.init().then(async()=>{[localPosts,localNotes,viewCounts]=await Promise.all([storage.get('posts',[]),storage.get('notes',[]),storage.get('viewCounts',{})]);render();}).catch(()=>{toast('本地存储暂不可用，仍可查看示例界面。');render();});", "storage.init().then(()=>render()).catch(()=>{toast('草稿存储暂不可用。');render();});");
fs.writeFileSync(new URL('community.js',root),js);
let html=fs.readFileSync(new URL('index.html',root),'utf8');
html=html.replace('<script defer src="community.js">','<script defer src="vendor/supabase.js"></script><script defer src="api-client.js"></script><script defer src="community.js">');
html=html.replace('本地界面预览 · 内容与发布仅在当前浏览器中','ACGN Notes · Daily Notes');
html=html.replaceAll('本地预览：发布后只保存在当前浏览器。','发布后所有访客都能看到。清除浏览器数据会失去匿名帖的编辑权限。');
fs.writeFileSync(new URL('index.html',root),html);
let tr=fs.readFileSync(new URL('translation-client.js',root),'utf8');
tr=tr.replace("headers:{'Content-Type':'application/json'}","headers:await window.REST_API.headers(false)").replace('postId,sourceVersion:hash,sourceLanguage,targetLanguage,texts','postId,sourceVersion:hash,revision:sourceVersion,sourceLanguage,targetLanguage,texts');
tr=tr.replace("throw new Error(data.error||'翻译失败，请稍后重试。')","throw window.REST_API.error(data.error)");
fs.writeFileSync(new URL('translation-client.js',root),tr);
