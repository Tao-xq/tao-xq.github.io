"use strict";
(()=>{
 const cfg=window.REST_BACKEND;
 const messages={
  SERVICE_UNAVAILABLE:'服务暂时无法连接，请稍后重试。',SESSION_REQUIRED:'无法建立访客会话，请刷新后重试。',SESSION_EXPIRED:'访客会话已过期，请刷新后重试。',
  RATE_LIMIT:'操作有些频繁，请稍后再试。',INVALID_INPUT:'请检查昵称、标题和正文长度。',INVALID_IMAGE:'图片无法上传，请使用不超过 2MB 的 JPG 或 PNG。',COVER_RATIO:'请重新裁剪 A4 封面。',
  IMAGE_OWNERSHIP:'这张图片不属于当前访客会话，请重新上传。',FORBIDDEN:'只能编辑当前访客会话发布的帖子。',SOURCE_CHANGED:'原文已更新，请重新打开帖子后再试。',NOT_FOUND:'这张便签还没来到沙滩上。',
  TRANSLATION_NOT_CONFIGURED:'自动翻译服务正在准备中，原文仍可正常阅读。',TRANSLATION_PENDING:'这篇译文正在生成，请稍后再点一次。',TRANSLATION_QUOTA:'本期免费翻译额度已用完，原文仍可正常阅读。',TRANSLATION_FAILED:'翻译服务暂时不可用，请稍后重试。',TRANSLATION_TOO_LONG:'这一段过长，暂时无法翻译。',TOO_MANY_IMAGES:'正文最多放 12 张图片。'
 };
 const fail=code=>new Error(window.REST_I18N?.t(messages[code]||messages.SERVICE_UNAVAILABLE)||messages[code]||messages.SERVICE_UNAVAILABLE);
 let client,sessionPromise;
 function sdk(){if(!cfg.publishableKey)throw fail('SERVICE_UNAVAILABLE');return client??=window.supabase.createClient(cfg.supabaseUrl,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'rest-mode-visitor'}});}
 async function session(write=false){const c=sdk();let {data,error}=await c.auth.getSession();if(error)throw fail('SESSION_EXPIRED');if(data.session)return data.session;if(!write)return null;
  if(!sessionPromise)sessionPromise=c.auth.signInAnonymously().then(({data,error})=>{if(error||!data.session)throw fail('SESSION_REQUIRED');return data.session;}).finally(()=>sessionPromise=null);return sessionPromise;
 }
 async function headers(write=false){const s=await session(write);return {'Content-Type':'application/json',apikey:cfg.publishableKey,...(s?{Authorization:'Bearer '+s.access_token}:{})};}
 async function request(path,{method='GET',body,signal}={}){
  let response;try{response=await fetch(cfg.apiEndpoint+path,{method,headers:await headers(method!=='GET'&&path!=='/views'&&path!=='/translate'),credentials:'omit',signal,body:body===undefined?undefined:JSON.stringify(body)});}catch(e){if(e.name==='AbortError')throw e;throw fail('SERVICE_UNAVAILABLE');}
  let data;try{data=await response.json();}catch{throw fail('SERVICE_UNAVAILABLE');}if(!response.ok)throw fail(data.error);return data;
 }
 async function upload(data,kind){if(!data.startsWith('data:'))return data;return (await request('/uploads',{method:'POST',body:{data,kind}})).url;}
 async function prepare(post){const doc=new DOMParser().parseFromString(post.body,'text/html');for(const img of doc.querySelectorAll('img'))img.src=await upload(img.getAttribute('src'),'body');return {...post,cover:await upload(post.cover,'cover'),body:doc.body.innerHTML};}
 window.REST_API={request,headers,session,upload,prepare,error:fail,owns:p=>p.own===true};
})();
