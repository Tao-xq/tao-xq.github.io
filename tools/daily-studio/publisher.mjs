import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {imageSize} from 'image-size';
import {parseHTML} from 'linkedom';
import {dailyPost,cleanDailyHtml} from '../../lib/daily-format.mjs';
import {atomic,readJson,assetNames,fail,escape} from './store.mjs';
const exec=promisify(execFile),JOB=/^publish-[a-f0-9-]{36}$/;
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export class NotePublisher{
 constructor(store,{remote='https://github.com/Tao-xq/tao-xq.github.io.git',checkBuild=true}={}){this.store=store;this.repo=store.repo;this.remote=remote;this.checkBuild=checkBuild;this.busy=false;}
 jobFile(id){if(!JOB.test(id))throw fail('找不到这次发布。',404);return path.join(this.store.data,'jobs',id+'.json');}
 async job(id){const value=await readJson(this.jobFile(id));if(!value)throw fail('找不到这次发布。',404);return value;}
 async git(...args){return (await exec('git',['-c','credential.interactive=never',...args],{cwd:this.repo,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},maxBuffer:1024*1024,timeout:120000})).stdout.trim();}
 async plan(id){
  const draft=await this.store.get(id),copy=draft.locales[draft.lang];if(draft.archivedAt)throw fail('请先从回收站恢复草稿。');
  if(!copy?.title?.trim()||Array.from(copy.title.trim()).length>28)throw fail('发布标题需要 1–28 个字。');
  if(!draft.cover)throw fail('请先裁剪一张 A4 封面。');const coverBytes=await this.store.asset(draft.cover.split('/').pop()),size=imageSize(coverBytes);if(size.width!==420||size.height!==594)throw fail('请先把封面裁成 A4 竖版。');
  const {document}=parseHTML('<html><body>'+cleanDailyHtml(copy.html)+'</body></html>');if(!document.body.textContent.trim()&&!document.querySelector('img'))throw fail('正文还是空的。');
  const names=assetNames({cover:draft.cover,html:Object.values(draft.locales).map(c=>c.html)});if(names.length>100)throw fail('一篇文章最多使用 100 张图片。');
  const remap=html=>cleanDailyHtml(html).replace(/\/api\/assets\/([a-f0-9]{64}\.(?:jpg|png|webp|gif))/g,(_match,name)=>'assets/daily/'+draft.dailyId+'/'+name);
  const translations={};for(const [lang,value]of Object.entries(draft.locales)){if(lang===draft.lang||!value.title.trim()&&!value.html.replace(/<[^>]+>/g,'').trim())continue;if(!value.title.trim()||!value.html.trim())throw fail('校对译文需要标题和正文；暂不发布的译文可以先留空。');translations[lang]={title:value.title.trim(),body:remap(value.html)};}
  const owner=await readJson(path.join(this.repo,'content/owner.json'));
  const input={schema:1,id:draft.dailyId,title:copy.title.trim(),cover:remap('<img src="'+draft.cover+'">').match(/src="([^"]+)"/)?.[1],lang:draft.lang,publishedAt:draft.publishedAt||new Date().toISOString(),body:remap(copy.html),translations};dailyPost(input,owner);
  const files=[{path:'content/daily/'+draft.dailyId+'.json',data:Buffer.from(JSON.stringify(input,null,2)+'\n').toString('base64')}];for(const name of names)files.push({path:'web/assets/daily/'+draft.dailyId+'/'+name,data:(await this.store.asset(name)).toString('base64')});
  const job={id:'publish-'+crypto.randomUUID(),draftId:id,revision:draft.revision,createdAt:new Date().toISOString(),state:'prepared',post:input,files,baseHash:draft.publishedHash||null};await atomic(this.jobFile(job.id),job);
  return {id:job.id,title:input.title,images:names.length,files:files.map(f=>f.path),preview:input.body,cover:input.cover};
 }
 async confirm(id){
  if(this.busy)throw fail('已有文章正在发布，请稍等。',409);this.busy=true;let job,changed=[],committed=false;
  try{
   job=await this.job(id);if(job.state==='submitted')return this.result(job);const draft=await this.store.get(job.draftId);
   if(job.state!=='committed'&&(draft.revision!==job.revision||Date.now()-Date.parse(job.createdAt)>15*60*1000))throw fail('草稿已更新或确认已过期，请重新预览发布。',409);
   const origin=await this.git('remote','get-url','origin');if(origin!==this.remote)throw fail('GitHub 仓库地址与写作台配置不一致，已停止发布。',409);
   if(await this.git('branch','--show-current')!=='main')throw fail('请先把项目切回 main 分支。',409);
   if(await this.git('status','--porcelain'))throw fail('仓库中还有未处理的文件改动。请先处理这些改动，再发布个人文章。',409);
   if(job.state==='committed'){
    if(await this.git('rev-parse','HEAD')!==job.commit)throw fail('本地提交已经改变，请先检查 GitHub 发布记录。',409);committed=true;
   }else{
    job.state='syncing';await atomic(this.jobFile(id),job);
    await this.git('fetch','origin','main');const head=await this.git('rev-parse','HEAD'),remote=await this.git('rev-parse','origin/main');if(head!==remote)await this.git('merge','--ff-only','origin/main');
    const articlePath=path.join(this.repo,job.files[0].path);let current=null;try{current=await fs.readFile(articlePath);}catch(e){if(e.code!=='ENOENT')throw e;}
    if((current?digest(current):null)!==job.baseHash)throw fail('GitHub 上的这篇文章已有其他修改，请重新载入已发布版本后再编辑。',409);
    await this.store.snapshot(draft);
    for(const file of job.files){const absolute=path.resolve(this.repo,file.path);if(!absolute.startsWith(this.repo+path.sep)||!/^content\/daily\/daily-[a-z0-9-]+\.json$|^web\/assets\/daily\/daily-[a-z0-9-]+\/[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(file.path))throw fail('发布文件路径不正确。');let previous=null;try{previous=await fs.readFile(absolute);}catch(e){if(e.code!=='ENOENT')throw e;}const bytes=Buffer.from(file.data,'base64');changed.push({absolute,previous,bytes,path:file.path});await fs.mkdir(path.dirname(absolute),{recursive:true});await fs.writeFile(absolute,bytes);}
    job.state='checking';await atomic(this.jobFile(id),job);
    if(this.checkBuild)await exec(process.execPath,['scripts/build.mjs'],{cwd:this.repo,maxBuffer:1024*1024,timeout:120000});
    const paths=job.files.map(f=>f.path);await this.git('add','--',...paths);
    const staged=(await this.git('diff','--cached','--name-only')).split('\n').filter(Boolean);if(staged.some(file=>!paths.includes(file)))throw fail('暂存区出现了其他文件，已停止发布。',409);
    if(staged.length){await this.git('-c','user.name=Tao-xq','-c','user.email=Tao-xq@users.noreply.github.com','commit','--only','-m','Publish Daily Notes: '+job.post.title,'--',...paths);job.commit=await this.git('rev-parse','HEAD');}
    else job.commit=await this.git('rev-parse','HEAD');committed=true;job.state='committed';await atomic(this.jobFile(id),job);
   }
   await this.git('push','origin','HEAD:refs/heads/main');job.state='submitted';job.submittedAt=new Date().toISOString();job.error=null;await atomic(this.jobFile(id),job);
   const latest=await this.store.get(job.draftId);const article=await fs.readFile(path.join(this.repo,job.files[0].path));await atomic(this.store.file(latest.id),{...latest,publishedAt:job.post.publishedAt,publishedHash:digest(article),lastCommit:job.commit,lastPublishedRevision:job.revision});return this.result(job);
  }catch(error){
   if(!committed&&changed.length){for(const file of changed){const current=await fs.readFile(file.absolute).catch(()=>null);if(!current?.equals(file.bytes))continue;if(file.previous)await fs.writeFile(file.absolute,file.previous);else await fs.unlink(file.absolute);}await this.git('restore','--staged','--',...changed.map(f=>f.path)).catch(()=>{});}
   if(job){job.state=committed?'committed':'failed';job.error=error.status?error.message:committed?'文章已保存在本地提交中，但尚未成功推送。可以重试推送。':'GitHub 同步或构建未完成，草稿已保留，请检查网络及 Git 登录。';await atomic(this.jobFile(id),job);}
   throw error.status?error:fail(job?.error||'发布未完成，草稿已保留。',502);
  }finally{this.busy=false;}
 }
 result(job){return {id:job.id,state:job.state,commit:job.commit,title:job.post.title,url:'https://tao-xq.github.io/#/post/'+job.post.id,actions:'https://github.com/Tao-xq/tao-xq.github.io/actions',message:'文章已提交到 GitHub，网站正在更新。'};}
 async exportHtml(id){const draft=await this.store.get(id),copy=draft.locales[draft.lang];let body=cleanDailyHtml(copy.html),cover=draft.cover;for(const name of assetNames({body,cover})){const mime={jpg:'jpeg',png:'png',webp:'webp',gif:'gif'}[name.split('.').pop()],url='data:image/'+mime+';base64,'+(await this.store.asset(name)).toString('base64');body=body.replaceAll('/api/assets/'+name,url);cover=cover.replaceAll('/api/assets/'+name,url);}return '<!doctype html><html lang="'+draft.lang+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(copy.title)+'</title><style>body{margin:40px auto;padding:0 25px;max-width:760px;background:#fff8e9;color:#51483f;font:16px/2 sans-serif}h1{font:34px/1.5 KaiTi,serif}img{max-width:100%;height:auto}figure{margin:30px auto}figcaption{text-align:center;font-size:12px;color:#8a7865}blockquote{border-left:3px solid #bba583;padding-left:20px}pre{white-space:pre-wrap;background:#eee1c9;padding:15px}.ql-align-center{text-align:center}.ql-align-right{text-align:right}</style><article>'+(cover?'<img style="max-height:240px;display:block;margin:20px auto" src="'+cover+'" alt="封面">':'')+'<h1>'+escape(copy.title)+'</h1>'+body+'</article></html>';}
}
