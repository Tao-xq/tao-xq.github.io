"use strict";
(()=>{
 const languages=new Set(['zh','en','ja']);
 async function fingerprint(value){const bytes=new TextEncoder().encode(value);if(!crypto.subtle)throw new Error('当前浏览器无法生成原文版本，请使用现代浏览器或本地HTTP预览。');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 function collect(body){const doc=new DOMParser().parseFromString(body,'text/html'),nodes=[],walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.textContent.trim()&&!node.parentElement.closest('pre,code'))nodes.push(node);return {doc,nodes};}
 async function translate({postId,sourceVersion,sourceLanguage,targetLanguage,title,body,readCache=async()=>null,writeCache=async()=>{},signal}){
  if(!languages.has(sourceLanguage)||!languages.has(targetLanguage))throw new Error('暂时支持中文、英文和日文。');
  if(sourceLanguage===targetLanguage)throw new Error('这就是原文语言。');
  const hash=await fingerprint(JSON.stringify({postId,sourceVersion,sourceLanguage,title,body})),cacheKey=`translation:${postId}:${hash}:${targetLanguage}`;
  const parsed=collect(body),texts=[title,...parsed.nodes.map(n=>n.textContent)];
  function apply(data,fromCache){if(data.sourceVersion!==hash||data.targetLanguage!==targetLanguage||!Array.isArray(data.texts)||data.texts.length!==texts.length||data.texts.some(t=>typeof t!=='string'))throw new Error('翻译结果与当前原文不匹配，请重试。');data.texts.slice(1).forEach((text,i)=>{parsed.nodes[i].textContent=text;});return {title:data.texts[0],body:parsed.doc.body.innerHTML,language:targetLanguage,machine:true,fromCache,sourceVersion:hash};}
  const cached=await readCache(cacheKey);if(cached)try{return apply(cached,true);}catch{}
  const endpoint=window.REST_BACKEND?.translationEndpoint;
  if(!endpoint)throw new Error('自动翻译后台尚未连接。接入后，点击这里即可自动生成译文，不需要作者提前填写。');
  const url=new URL(endpoint,location.href);if(!['http:','https:'].includes(url.protocol))throw new Error('翻译后台地址无效。');
  const response=await fetch(url.href,{method:'POST',headers:await window.REST_API.headers(false),credentials:'omit',signal,body:JSON.stringify({postId,sourceVersion:hash,revision:sourceVersion,sourceLanguage,targetLanguage,texts})});
  let data;try{data=await response.json();}catch{throw new Error('翻译服务暂时不可用，请稍后重试。');}
  if(!response.ok)throw window.REST_API.error(data.error);
  const result=apply(data,false);try{await writeCache(cacheKey,data);}catch{/* A full browser cache must not hide a valid translation. */}return result;
 }
 window.REST_TRANSLATION={translate};
})();
