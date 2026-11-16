import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {imageSize} from 'image-size';
import {parseHTML} from 'linkedom';
import {cleanDailyHtml,DAILY_ID} from '../../lib/daily-format.mjs';

export const ASSET=/^[a-f0-9]{64}\.(jpg|png|webp|gif)$/;
export const DRAFT=/^note-[a-f0-9-]{36}$/;
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const readJson=async(file,fallback=null)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,typeof value==='string'?value:JSON.stringify(value,null,2));await fs.rename(temp,file);}
export function assetNames(draft){return [...new Set(JSON.stringify(draft).match(/[a-f0-9]{64}\.(?:jpg|png|webp|gif)/g)||[])];}
export function validateDelta(delta){
 if(!delta||!Array.isArray(delta.ops)||delta.ops.length>100000)throw fail('正文格式不正确，请先导出备份。');
 const layout=value=>{const width=Number(value.width??100);if(!Number.isFinite(width)||width<1||width>100||Math.abs(width*10-Math.round(width*10))>1e-7||!['left','center','right'].includes(value.align||'center'))throw fail('图片宽度需要在 1–100% 之间，最多一位小数。');};
 const photo=value=>{if(!value||typeof value.src!=='string'||!/^\/api\/assets\/[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(value.src))throw fail('正文图片需要先上传到写作台。');layout(value);};
 for(const op of delta.ops){if(typeof op.insert==='string')continue;if(op.insert?.photo)photo(op.insert.photo);else if(op.insert?.gallery){const row=op.insert.gallery;layout(row);if(!Array.isArray(row.photos)||row.photos.length!==2||!Number.isInteger(Number(row.split??50))||Number(row.split??50)<10||Number(row.split??50)>90)throw fail('并排图片需要两张照片，左右比例在 10–90% 之间。');row.photos.forEach(photo);}else if(op.insert?.divider!==true)throw fail('正文包含不支持的内容。');}
 return delta;
}
export class NoteStore{
 constructor(repo,data=path.join(repo,'.local/daily-studio')){this.repo=repo;this.data=data;}
 async init(){for(const dir of ['drafts','assets','versions','jobs'])await fs.mkdir(path.join(this.data,dir),{recursive:true});}
 file(id){if(!DRAFT.test(id))throw fail('找不到这份草稿。',404);return path.join(this.data,'drafts',id+'.json');}
 async get(id){const value=await readJson(this.file(id));if(!value)throw fail('找不到这份草稿。',404);return value;}
 async list(){const names=await fs.readdir(path.join(this.data,'drafts'));const notes=await Promise.all(names.filter(n=>DRAFT.test(n.slice(0,-5))).map(n=>readJson(path.join(this.data,'drafts',n))));return notes.filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(d=>({id:d.id,title:d.locales[d.lang]?.title||'还没起名字',lang:d.lang,updatedAt:d.updatedAt,archivedAt:d.archivedAt||null,publishedAt:d.publishedAt||null,dailyId:d.dailyId,revision:d.revision}));}
 async create(input={}){const id='note-'+crypto.randomUUID(),now=new Date().toISOString();const draft={id,dailyId:'daily-'+now.slice(0,10)+'-'+id.slice(-8),lang:'zh',cover:'',locales:{zh:{title:'',html:'',delta:{ops:[{insert:'\n'}]}}},revision:1,createdAt:now,updatedAt:now,...input};draft.id=id;draft.revision=1;await atomic(this.file(id),draft);return draft;}
 async snapshot(draft){await atomic(path.join(this.data,'versions',draft.id,String(draft.revision)+'.json'),draft);}
 async save(id,input,{manual=false}={}){
  const old=await this.get(id);if(input.revision!==old.revision)throw fail('这份草稿已在另一个窗口更新。请先导出当前内容，再重新打开草稿。',409);
  if(!['zh','en','ja'].includes(input.lang)||!DAILY_ID.test(old.dailyId)||typeof input.cover!=='string'||input.cover&&!/^\/api\/assets\/[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(input.cover))throw fail('草稿资料不正确。');
  const locales={};for(const [lang,copy]of Object.entries(input.locales||{})){if(!['zh','en','ja'].includes(lang)||typeof copy.title!=='string'||Array.from(copy.title).length>100||typeof copy.html!=='string')throw fail('标题或语言格式不正确。');locales[lang]={title:copy.title,html:cleanDailyHtml(copy.html),delta:validateDelta(copy.delta)};}
  if(!locales[input.lang])throw fail('请保留原文内容。');if(manual)await this.snapshot(old);
  const draft={...old,lang:input.lang,cover:input.cover,locales,revision:old.revision+1,updatedAt:new Date().toISOString()};await atomic(this.file(id),draft);return draft;
 }
 async archive(id,revision,archived){const old=await this.get(id);if(revision!==old.revision)throw fail('草稿已更新，请重新打开。',409);await this.snapshot(old);const value={...old,archivedAt:archived?new Date().toISOString():null,revision:old.revision+1,updatedAt:new Date().toISOString()};await atomic(this.file(id),value);return value;}
 async versions(id){await this.get(id);const dir=path.join(this.data,'versions',id);let names;try{names=await fs.readdir(dir);}catch{return [];}return Promise.all(names.filter(n=>/^\d+\.json$/.test(n)).sort((a,b)=>parseInt(b)-parseInt(a)).slice(0,30).map(async n=>{const d=await readJson(path.join(dir,n));return {revision:d.revision,updatedAt:d.updatedAt,title:d.locales[d.lang]?.title||'未命名'};}));}
 async restore(id,revision,current){const old=await this.get(id);if(old.revision!==current)throw fail('草稿已更新，请重新打开。',409);if(!Number.isSafeInteger(revision)||revision<1)throw fail('版本不正确。');const value=await readJson(path.join(this.data,'versions',id,revision+'.json'));if(!value)throw fail('找不到这个历史版本。',404);await this.snapshot(old);const draft={...value,dailyId:old.dailyId,publishedAt:old.publishedAt,publishedHash:old.publishedHash,lastCommit:old.lastCommit,lastPublishedRevision:old.lastPublishedRevision,revision:old.revision+1,updatedAt:new Date().toISOString()};await atomic(this.file(id),draft);return draft;}
 async putAsset(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>12*1024*1024)throw fail('单张图片最多 12MB。');let info;try{info=imageSize(bytes);}catch{throw fail('图片无法识别，请选择 JPG、PNG、WebP 或 GIF。');}
  const extension={jpg:'jpg',jpeg:'jpg',png:'png',webp:'webp',gif:'gif'}[info.type];if(!extension||!info.width||!info.height||info.width*info.height>40000000||Math.max(info.width,info.height)>12000)throw fail('图片格式或尺寸不支持。');
  const name=crypto.createHash('sha256').update(bytes).digest('hex')+'.'+extension;await fs.writeFile(path.join(this.data,'assets',name),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});return {name,src:'/api/assets/'+name,width:info.width,height:info.height};
 }
 async asset(name){if(!ASSET.test(name))throw fail('图片不存在。',404);try{return await fs.readFile(path.join(this.data,'assets',name));}catch(e){if(e.code==='ENOENT')throw fail('图片不存在。',404);throw e;}}
 async importLegacy(source,loadImage){
  if(!source||typeof source.title!=='string'||!Array.isArray(source.sections)||source.sections.length>100)throw fail('这不是可导入的图文草稿。');
  const ops=[],html=[];for(const section of source.sections){ops.push({insert:String(section.title||'')},{insert:'\n',attributes:{header:2}});html.push('<h2>'+escape(section.title)+'</h2>');for(const block of section.blocks||[]){if(block.type==='text'){const text=String(block.text||'');ops.push({insert:text+'\n'});html.push('<p>'+escape(text).replace(/\n/g,'<br>')+'</p>');}else if(block.type==='photos')for(const photo of block.images||[]){const bytes=await loadImage(photo.file);const asset=await this.putAsset(bytes),value={src:asset.src,alt:String(photo.alt||''),caption:'',width:100,align:'center'};ops.push({insert:{photo:value}},{insert:'\n'});html.push('<figure class="note-photo"><img src="'+asset.src+'" alt="'+escape(value.alt)+'"></figure>');}}}
  return this.create({locales:{zh:{title:source.title,delta:{ops},html:html.join('')}},importedFrom:'legacy-drinks'});
 }
 async seedLegacy(){const list=await this.list();if(list.length)return;const dir=path.resolve(this.repo,'../drafts/drinks-2025');const source=await readJson(path.join(dir,'draft.json'));if(!source)return;await this.importLegacy(source,filename=>{if(typeof filename!=='string'||filename!==path.basename(filename))throw fail('图片名称不正确。');return fs.readFile(path.join(dir,'photos',filename));});}
 async importFile(payload){
  if(payload.kind==='legacy-html'){
   const {document}=parseHTML(String(payload.html||'')),raw=document.querySelector('#draft-data')?.textContent;let source;try{source=JSON.parse(raw);}catch{throw fail('没有找到旧图文稿的数据，请选择「保存一份」导出的文件。');}
   return this.importLegacy(source,async name=>{const match=source.images?.[name]?.match(/^data:image\/(jpeg|png|webp|gif);base64,([a-zA-Z0-9+/=\s]+)$/);if(!match)throw fail('旧图文稿的照片不完整。');return Buffer.from(match[2],'base64');});
  }
  const backup=payload.backup;if(backup?.format!=='rest-mode-daily-backup-v1'||!backup.draft||!backup.assets||Object.keys(backup.assets).length>100)throw fail('请选择写作台导出的草稿备份。');
  for(const [name,data]of Object.entries(backup.assets)){if(!ASSET.test(name)||typeof data!=='string')throw fail('备份中的图片不正确。');const asset=await this.putAsset(Buffer.from(data,'base64'));if(asset.name!==name)throw fail('备份图片校验失败。');}
  const created=await this.create();try{return await this.save(created.id,{...backup.draft,revision:created.revision},{manual:true});}catch(e){await this.archive(created.id,created.revision,true);throw e;}
 }
 async backup(id){const draft=await this.get(id),assets={};for(const name of assetNames(draft))assets[name]=(await this.asset(name)).toString('base64');return {format:'rest-mode-daily-backup-v1',draft,assets};}
}
