import sanitizeHtml from 'sanitize-html';
import crypto from 'node:crypto';
import {parseHTML} from 'linkedom';

export const DAILY_ID=/^daily-[a-z0-9][a-z0-9-]{0,90}$/;
export const photoSource=value=>typeof value==='string'&&(/^(?:assets\/|\/api\/assets\/)[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..')||/^https:\/\//.test(value));
export function cleanDailyHtml(value){
 if(typeof value!=='string'||value.length>2000000)throw Error('正文过长或格式不正确。');
 return sanitizeHtml(value,{
  allowedTags:['p','br','strong','b','em','i','u','s','blockquote','ol','ul','li','a','img','figure','figcaption','pre','code','h2','h3','h4','hr','div','span','sub','sup'],
  allowedAttributes:{a:['href','target','rel'],img:['src','alt','loading'],figure:['class','style'],li:['data-list'],'*':['class','style']},
  allowedClasses:{'*':[/^ql-align-(center|right|justify)$/,/^ql-indent-[1-8]$/,/^ql-size-(small|large|huge)$/,/^ql-font-(serif|monospace)$/,/^ql-code-block(?:-container)?$/,/^note-photo(?:-row)?$/]},
  allowedStyles:{'*':{'text-align':[/^(left|center|right|justify)$/],color:[/^#[a-fA-F0-9]{3,8}$/,/^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/],'background-color':[/^#[a-fA-F0-9]{3,8}$/,/^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/]},figure:{width:[/^(?:100(?:\.0)?|[1-9]\d?(?:\.\d)?)%$/],'margin-left':[/^(auto|0(?:px)?)$/],'margin-right':[/^(auto|0(?:px)?)$/]},div:{width:[/^(?:100(?:\.0)?|[1-9]\d?(?:\.\d)?)%$/],'margin-left':[/^(auto|0(?:px)?)$/],'margin-right':[/^(auto|0(?:px)?)$/],'grid-template-columns':[/^(?:[1-8]\d|90)fr (?:[1-8]\d|90)fr$/]}},
  allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,
  transformTags:{h1:'h2',a:(_tag,a)=>({tagName:'a',attribs:{href:a.href||'',target:'_blank',rel:'noopener noreferrer'}}),img:(_tag,a)=>({tagName:'img',attribs:{src:photoSource(a.src)?a.src:'',alt:String(a.alt||'').slice(0,300),loading:'lazy'}})},
  exclusiveFilter:frame=>frame.tag==='img'&&!frame.attribs.src,
 });
}
export function dailyPost(input,owner){
 if(!input||!DAILY_ID.test(input.id)||typeof input.title!=='string'||!input.title.trim()||Array.from(input.title.trim()).length>28||!photoSource(input.cover)||!['zh','en','ja'].includes(input.lang)||!Number.isFinite(Date.parse(input.publishedAt)))throw Error('个人文章的标题、封面或发布时间不正确。');
 const body=cleanDailyHtml(input.body),translations={};
 const hasPrivateImage=html=>[...parseHTML('<html><body>'+html+'</body></html>').document.querySelectorAll('img')].some(img=>img.getAttribute('src')?.startsWith('/api/'));
 if(hasPrivateImage(body)||input.cover.startsWith('/api/'))throw Error('文章包含尚未准备好的本地图片。');
 for(const [lang,copy] of Object.entries(input.translations||{})){
  if(!['zh','en','ja'].includes(lang)||lang===input.lang)continue;
  if(typeof copy?.title!=='string'||!copy.title.trim()||!copy.body?.trim())throw Error('校对译文需要同时填写标题和正文。');
  const translatedBody=cleanDailyHtml(copy.body);if(hasPrivateImage(translatedBody))throw Error('译文包含尚未准备好的本地图片。');
  translations[lang]={title:copy.title.trim(),body:translatedBody};
 }
 return {id:input.id,title:input.title.trim(),cover:input.cover,lang:input.lang,publishedAt:new Date(input.publishedAt).toISOString(),body,translations,section:'daily',author:owner.nickname,avatar:owner.avatar,demo:false,version:crypto.createHash('sha256').update(input.title.trim()+'\n'+body).digest('hex')};
}
