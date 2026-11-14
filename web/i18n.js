"use strict";
(()=>{
 const rows=window.REST_UI_STRINGS,dict=new Map(rows.map(([zh,en,ja])=>[zh,{zh,en,ja}]));
 let language='zh';try{const saved=localStorage.getItem('rest-mode-ui-language');if(['zh','en','ja'].includes(saved))language=saved;}catch{}
 const locale=()=>({zh:'zh-CN',en:'en-GB',ja:'ja-JP'}[language]);
 const patterns=[
  [/^(\d+) 篇$/,n=>language==='en'?`${n} posts`:`${n} 件`],
  [/^(\d+) 条留言$/,n=>language==='en'?`${n} notes`:`${n} 件のメッセージ`],
  [/^(\d+) \/ (\d+) 字$/,(n,m)=>language==='en'?`${n} / ${m} characters`:`${n} / ${m} 文字`],
  [/^标题需要 1–(\d+) 字。$/,n=>language==='en'?`Use 1–${n} characters for the title.`:`タイトルは1〜${n}文字で入力してください。`],
  [/^正文需要 1–(\d+) 字。$/,n=>language==='en'?`Use 1–${n} characters for the body.`:`本文は1〜${n}文字で入力してください。`],
  [/^留言需要 1–(\d+) 字。$/,n=>language==='en'?`Write a note of 1–${n} characters.`:`メッセージは1〜${n}文字で入力してください。`],
  [/^草稿已保存 · (.+)$/,time=>language==='en'?`Draft saved · ${time}`:`下書き保存済み · ${time}`],
  [/^阅读：(.*)，作者 (.*)$/,(title,author)=>language==='en'?`Read: ${title}, by ${author}`:`記事：${title}、投稿者 ${author}`],
  [/^(.*)的封面$/,title=>language==='en'?`Cover for ${title}`:`${title}の表紙`],
  [/^(.*)的头像$/,name=>language==='en'?`${name}'s avatar`:`${name}のアバター`],
  [/^打开简短留言区 · 便签(\d+)$/,n=>language==='en'?`Open guestbook · note ${n}`:`ひとこと帳を開く · メモ${n}`],
  [/^浏览量：(\d+)$/,n=>language==='en'?`${n} ${Number(n)===1?'view':'views'}`:`閲覧数：${n}`],
  [/^原文 · (中文|English|日本語)$/,name=>language==='en'?`Original · ${name}`:`原文 · ${name}`],
  [/^机器译文 · (中文|English|日本語)$/,name=>language==='en'?`Machine translation · ${name}`:`機械翻訳 · ${name}`],
  [/^机器译文，仅供参考 · 图片、链接与正文结构保留；不改动原帖。( · 已读取缓存)?$/,cached=>language==='en'?`Machine translation · Images, links and layout are preserved. The original is unchanged.${cached?' · Cached':''}`:`機械翻訳 · 画像・リンク・構成を保持しています。原文は変更されません。${cached?' · キャッシュから表示':''}`],
  [/^Rest Mode · (.+)$/,label=>`Rest Mode · ${t(label)}`]
 ];
 function t(value){const text=String(value??''),trim=text.trim();if(language==='zh'||!trim)return text;let result=dict.get(trim)?.[language];if(!result)for(const [regex,formatter] of patterns){const match=trim.match(regex);if(match){result=formatter(...match.slice(1));break;}}return result?text.slice(0,text.indexOf(trim))+result+text.slice(text.indexOf(trim)+trim.length):text;}
 const textSources=new WeakMap(),attributeSources=new WeakMap();
 const skip='script,style,textarea,.ql-editor,.article-content,.article-title,.post-card h2,.post-card .card-meta,.about-copy,.friend-card strong,.friend-card small,.note-author,.note-body,.note-time,.post-byline time,.note-preview-content';
 const attributes=['aria-label','title','placeholder','alt','data-placeholder','data-label'];
 function apply(root=document.body){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!node.parentElement||node.parentElement.closest(skip))continue;const old=textSources.get(node),current=node.nodeValue,source=old&&old.translated===current?old.source:current,next=t(source);textSources.set(node,{source,translated:next});if(current!==next)node.nodeValue=next;}
  for(const el of [root,...root.querySelectorAll?.('[aria-label],[title],[placeholder],[alt],[data-placeholder],[data-label]')||[]]){
   if(!el.getAttribute)continue;const record=attributeSources.get(el)||{};
   for(const name of attributes){const value=el.getAttribute(name);if(value===null)continue;if(el.closest('.article-content')&&name!=='aria-label')continue;const prior=record[name],source=prior&&prior.translated===value?prior.source:value,next=t(source);record[name]={source,translated:next};if(next!==value)el.setAttribute(name,next);}
   attributeSources.set(el,record);
  }
  document.querySelectorAll('.ui-language').forEach(s=>s.value=language);
 }
 function picker(){return `<label class="language-picker"><svg class="language-globe" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M2 10H18M10 2Q3 10 10 18 17 10 10 2Z"/></svg><span>语言</span><select class="ui-language" aria-label="选择界面语言"><option value="zh" ${language==='zh'?'selected':''}>中文</option><option value="ja" ${language==='ja'?'selected':''}>日本語</option><option value="en" ${language==='en'?'selected':''}>English</option></select></label>`;}
 function setLanguage(value){if(!['zh','en','ja'].includes(value)||value===language)return;language=value;try{localStorage.setItem('rest-mode-ui-language',value);}catch{}document.documentElement.lang=value==='zh'?'zh-CN':value;apply();window.dispatchEvent(new CustomEvent('rest-language-change',{detail:{language:value}}));}
 window.REST_I18N={t,apply,picker,setLanguage,get language(){return language;},get locale(){return locale();}};
 document.documentElement.lang=language==='zh'?'zh-CN':language;
 document.querySelectorAll('[data-language-picker]').forEach(el=>el.innerHTML=picker());
 document.addEventListener('change',event=>{if(event.target.matches('.ui-language'))setLanguage(event.target.value);});
 let queued=false;new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;apply();});}}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
 apply();
})();
