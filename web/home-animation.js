"use strict";
(()=>{
 const m=window.RM_MANIFEST,W=m.canvas.width,H=m.canvas.height;
 const canvas=document.getElementById("scene"),ctx=canvas.getContext("2d"),stage=document.getElementById("stage");
 const cache=new Map();let weather="sunny",playing=!matchMedia("(prefers-reduced-motion: reduce)").matches,compare=false,t=0,last=0,ready=false;
 let pageAt=-Infinity,yawnAt=-Infinity,inspectOpen=false,manual=null,manualIndex=0,focused=null,pointer=null;
 let nextPage=48,nextLeft=4,nextRight=7,leftAt=-Infinity,rightAt=-Infinity,leftMode="peck",rightMode="flap";
 const status=document.getElementById("live-status");
 try{const value=localStorage.getItem("rest-mode-weather");if(value==="rainy")weather="rainy";}catch{}
 const regions=[
  {id:"sunny",label:"切换晴天",rect:[80,60,165,150],zoom:[80,60,165,150],action:()=>setWeather("sunny")},
  {id:"rainy",label:"切换阴雨",rect:[80,210,165,140],zoom:[80,210,165,140],action:()=>setWeather("rainy")},
  {id:"write",label:"进入次元闲谈发帖写作区",rect:[80,342,165,140],zoom:[80,342,165,140],action:()=>entrance("次元闲谈 · 发帖写作区","这个入口将进入用户发帖区。当前先验收动画；登录与发帖功能在内容阶段接入。")},
  {id:"books",label:"打开次元闲谈和日常随笔",rect:[33,738,257,181],zoom:[33,738,257,181],maxScale:1.03,action:()=>entrance("次元闲谈 / 日常随笔","书柜共用一个内容入口：次元闲谈允许登录用户发帖，日常随笔仅由主人编辑发布。当前为动画预览。")},
  ...[[625,191,142,132],[778,207,134,136],[921,215,133,132],[1062,201,138,141],[1200,177,132,145]].map((rect,i)=>({id:"note-"+i,label:"打开简短留言区 · 便签"+(i+1),rect,zoom:rect,maxScale:1.045,action:()=>entrance("Leave a note (=^･ω･^=)","悬挂便签只用于简短留言，与次元闲谈的帖子分开。这里将在内容阶段接入留言列表与短留言输入。") })),
  {id:"cat",label:"点击小猫打一次哈欠",rect:[901,710,240,239],action:triggerYawn}
 ];
 function transformRect(r){if(weather==="sunny")return r;return[r[0]*.982-2,r[1]*.982-3,r[2]*.982,r[3]*.982];}
 function updateHotspots(){regions.forEach(r=>{const a=transformRect(r.rect),b=document.getElementById("hit-"+r.id);b.style.left=a[0]/W*100+"%";b.style.top=a[1]/H*100+"%";b.style.width=a[2]/W*100+"%";b.style.height=a[3]/H*100+"%";});}
 regions.forEach(r=>{const b=document.createElement("button");b.type="button";b.className="hotspot";b.id="hit-"+r.id;b.setAttribute("aria-label",r.label);b.title=r.label;b.addEventListener("click",r.action);b.addEventListener("focus",()=>focused=r.id);b.addEventListener("blur",()=>focused=null);document.getElementById("hotspots").append(b);});updateHotspots();regions.forEach(r=>{const button=document.getElementById('hit-'+r.id);const hint=document.getElementById('home-hint');const show=()=>{hint.textContent=r.label;};const hide=()=>{hint.textContent='点开书柜，翻翻大家留下的故事。';};button.addEventListener('pointerenter',show);button.addEventListener('focus',show);button.addEventListener('pointerleave',hide);button.addEventListener('blur',hide);});
 function setWeather(value){weather=value;try{localStorage.setItem("rest-mode-weather",value);}catch{}updateHotspots();status.textContent=value==="sunny"?"晴天 · 选择仅保存在当前浏览器。":"阴雨 · 玻璃水痕与灯串固定在前景，不跟随海浪。";}
 function entrance(title,copy){if(title.includes("发帖写作区")){window.REST_COMMUNITY.open("write");return;}if(title.includes("次元闲谈 / 日常随笔")){window.REST_COMMUNITY.open("community");return;}if(title.startsWith("Leave a note")){window.REST_COMMUNITY.open("notes");return;}document.getElementById("entrance-title").textContent=title;document.getElementById("entrance-copy").textContent=copy;document.getElementById("entrance-dialog").showModal();}
 function triggerYawn(){if(t-yawnAt<2.6)return;yawnAt=t;compare=false;manual=null;playing=true;updatePlay();status.textContent="小猫打一次哈欠，结束后会继续睡觉。";}
 function triggerPage(){if(t-pageAt<2.1)return;pageAt=t;compare=false;status.textContent="正在播放9张人物与书一起绘制的翻页帧；结束后回到小点嘴的静止阅读。";}
 stage.addEventListener("pointermove",e=>{const r=canvas.getBoundingClientRect();pointer={x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H,radius:32*W/r.width};});stage.addEventListener("pointerleave",()=>pointer=null);
 function softenSunnyWindow(im){const surface=document.createElement('canvas');surface.width=im.width;surface.height=im.height;const paint=surface.getContext('2d');paint.drawImage(im,0,0);paint.save();paint.beginPath();paint.moveTo(386,144);paint.lineTo(1335,143);paint.lineTo(1338,820);paint.lineTo(385,820);paint.closePath();paint.clip();paint.filter='saturate(80%)';paint.drawImage(im,0,0);paint.restore();return surface;}
 function load(path){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{cache.set(path,path===m.background.sunny?softenSunnyWindow(im):im);resolve(im);};im.onerror=()=>reject(new Error("无法装入贴图："+path));im.src=path;});}
 const paths=new Set([...Object.values(m.source),...Object.values(m.background),...Object.values(m.glass),...Object.values(m.hoverLayers||{}),...Object.values(m.sequences).flatMap(s=>s.frames)]);
 Promise.all([...paths].map(load)).then(()=>{ready=true;document.getElementById("loading").hidden=true;initInspector();}).catch(e=>{document.getElementById("loading").textContent=e.message;});
 function drawSprite(name,index,x,y,scale=1){const s=m.sequences[name],im=cache.get(s.frames[Math.max(0,Math.min(index,s.frames.length-1))]);if(!im)return;ctx.drawImage(im,x,y,im.width*scale,im.height*scale);}
 function actor(name,index){const kind=m.sequences[name].kind,p=m.positions[kind==="hero"||kind==="cat"?kind:name];drawSprite(name,index,p[0],p[1]);}
 function held(sequence,age,seconds){return sequence[Math.min(sequence.length-1,Math.floor(age/seconds*sequence.length))];}
 function draw(){if(!ready||document.documentElement.dataset.panel!=="home")return;ctx.clearRect(0,0,W,H);ctx.globalAlpha=1;ctx.filter="none";
  if(compare){ctx.drawImage(cache.get(m.source[weather]),0,0,W,H);drawZooms();return;}
  ctx.drawImage(cache.get(m.background[weather]),0,0,W,H);ctx.save();ctx.setTransform(...m.weatherTransform[weather]);
  let wi=Math.floor(t/1.2)%6;drawSprite("waves",manual==="waves"?manualIndex:wi,...m.positions.waves);
  const gSeq=mode=>mode==="peck"?[0,1,2,1,0]:[0,3,4,5,3,0];
  if(t>=nextLeft){leftAt=t;leftMode=leftMode==="peck"?"flap":"peck";nextLeft=t+10;}
  if(t>=nextRight){rightAt=t;rightMode=rightMode==="peck"?"flap":"peck";nextRight=t+13;}
  let li=t-leftAt<1.7?held(gSeq(leftMode),t-leftAt,1.7):0,ri=t-rightAt<1.9?held(gSeq(rightMode),t-rightAt,1.9):0;
  actor("gull-left",manual==="gull-left"?manualIndex:li);actor("gull-right",manual==="gull-right"?manualIndex:ri);
  const fly=t%48; if(fly<32||manual==="sky-bird"){const q=manual==="sky-bird"?0:fly/32,scale=1-q*.78,x=m.positions["sky-bird"][0]-q*180,y=m.positions["sky-bird"][1]-q*75;drawSprite("sky-bird",manual==="sky-bird"?manualIndex:Math.floor(t/.5)%6,x,y,scale);}
  if(t>=nextPage){pageAt=t;nextPage=t+58;}
  let heroName=t-pageAt<2.1?"hero-page-turn":"hero-reading",heroFrame=heroName==="hero-page-turn"?Math.min(8,Math.floor((t-pageAt)/2.1*9)):0;
  if(manual&&manual.startsWith("hero-")){heroName=manual;heroFrame=manualIndex;}actor(heroName,heroFrame);
  let catName=t-yawnAt<2.6?"cat-yawn":"cat-tail",catFrame;
  if(catName==="cat-yawn")catFrame=Math.min(8,Math.floor((t-yawnAt)/2.6*9));else{const phase=t%8;catFrame=phase<3.6?Math.min(8,Math.floor(phase/3.6*9)):0;}
  if(manual&&manual.startsWith("cat-")){catName=manual;catFrame=manualIndex;}actor(catName,catFrame);ctx.restore();
  ctx.drawImage(cache.get(m.glass[weather]),0,0,W,H);drawZooms();
  canvas.dataset.heroFrame=heroName+":"+heroFrame;canvas.dataset.catFrame=catName+":"+catFrame;canvas.dataset.waveFrame=String(wi);canvas.dataset.elapsed=t.toFixed(2);
 }
 const zooms=new Map();function drawZooms(){const source=cache.get(m.source[weather]);regions.forEach(r=>{if(!r.zoom)return;const a=transformRect(r.rect),z=transformRect(r.zoom);let near=focused===r.id?1:0;if(pointer){const dx=Math.max(a[0]-pointer.x,0,pointer.x-a[0]-a[2]),dy=Math.max(a[1]-pointer.y,0,pointer.y-a[1]-a[3]);near=Math.max(near,Math.max(0,1-Math.hypot(dx,dy)/pointer.radius));}const target=1+((r.maxScale||1.06)-1)*near;let scale=(zooms.get(r.id)||1)+(target-(zooms.get(r.id)||1))*.18;if(Math.abs(scale-1)<.0005)scale=1;zooms.set(r.id,scale);document.getElementById("hit-"+r.id).dataset.scale=scale.toFixed(4);if(scale>1){const dw=z[2]*scale,dh=z[3]*scale;if(r.id==="books"){const layer=cache.get(m.hoverLayers[weather]);ctx.save();ctx.translate(z[0]+z[2]/2,z[1]+z[3]/2);ctx.scale(scale,scale);ctx.translate(-z[0]-z[2]/2,-z[1]-z[3]/2);ctx.drawImage(layer,0,0);ctx.restore();}else{ctx.save();if(weather==='sunny'&&r.id.startsWith('note-'))ctx.filter='saturate(80%)';ctx.drawImage(source,z[0],z[1],z[2],z[3],z[0]-(dw-z[2])/2,z[1]-(dh-z[3])/2,dw,dh);ctx.restore();}}});}
 function tick(now){const dt=last?Math.min((now-last)/1000,.1):0;last=now;if(playing&&!document.hidden&&document.documentElement.dataset.panel==="home")t+=dt;draw();requestAnimationFrame(tick);}requestAnimationFrame(tick);
 const play=document.getElementById("play-toggle");function updatePlay(){play.textContent=playing?"暂停":"播放";play.setAttribute("aria-pressed",String(playing));}updatePlay();play.addEventListener("click",()=>{playing=!playing;updatePlay();});document.getElementById("page-turn").addEventListener("click",()=>{triggerPage();playing=true;manual=null;updatePlay();});document.getElementById("cat-yawn").addEventListener("click",()=>{triggerYawn();playing=true;manual=null;updatePlay();});
 document.getElementById("compare-toggle").addEventListener("click",e=>{compare=!compare;e.currentTarget.setAttribute("aria-pressed",String(compare));e.currentTarget.textContent=compare?"回到动画":"对照原图";});
 document.getElementById("inspect-toggle").addEventListener("click",e=>{inspectOpen=!inspectOpen;document.getElementById("inspector").hidden=!inspectOpen;e.currentTarget.setAttribute("aria-expanded",String(inspectOpen));if(inspectOpen){playing=false;updatePlay();updateInspector();}else manual=null;});
 function initInspector(){updateInspector();}
 function updateInspector(){const key=document.getElementById("sequence").value,s=m.sequences[key];manual=inspectOpen?key:null;manualIndex=Math.min(manualIndex,s.frames.length-1);document.getElementById("frame-image").src=s.frames[manualIndex];document.getElementById("frame-download").href=s.frames[manualIndex];document.getElementById("frame-slider").max=s.frames.length-1;document.getElementById("frame-slider").value=manualIndex;document.getElementById("frame-label").value=(manualIndex+1)+" / "+s.frames.length;const thumbnails=document.getElementById("frame-thumbnails");thumbnails.replaceChildren();s.frames.forEach((path,i)=>{const b=document.createElement("button");b.type="button";b.setAttribute("aria-label","查看第"+(i+1)+"帧");b.setAttribute("aria-pressed",String(i===manualIndex));const im=document.createElement("img");im.src=path;im.alt="第"+(i+1)+"帧";b.append(im);b.addEventListener("click",()=>{manualIndex=i;updateInspector();});thumbnails.append(b);});}
 document.getElementById("sequence").addEventListener("change",()=>{manualIndex=0;compare=false;updateInspector();});document.getElementById("frame-slider").addEventListener("input",e=>{manualIndex=Number(e.target.value);updateInspector();});document.getElementById("prev-frame").addEventListener("click",()=>{const n=m.sequences[document.getElementById("sequence").value].frames.length;manualIndex=(manualIndex+n-1)%n;updateInspector();});document.getElementById("next-frame").addEventListener("click",()=>{const n=m.sequences[document.getElementById("sequence").value].frames.length;manualIndex=(manualIndex+1)%n;updateInspector();});
 window.RM_PREVIEW={get state(){return{ready,weather,playing,compare,time:t,manual,manualIndex,pageActive:t-pageAt<2.1,yawnActive:t-yawnAt<2.6,frameCount:m.frameCount,zooms:Object.fromEntries(zooms)};}};
})();
