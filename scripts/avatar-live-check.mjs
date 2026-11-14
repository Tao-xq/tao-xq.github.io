import {createClient} from '@supabase/supabase-js';import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import zlib from 'node:zlib';
const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../web/config.js',import.meta.url),'utf8'),context);const cfg=context.window.REST_BACKEND;
async function visitor(){const sdk=createClient(cfg.supabaseUrl,cfg.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}}),{data,error}=await sdk.auth.signInAnonymously();if(error)throw error;return {token:data.session.access_token,id:data.user.id,sdk};}
async function call(path,method='GET',body,user){const r=await fetch(cfg.apiEndpoint+path,{method,headers:{'Content-Type':'application/json',apikey:cfg.publishableKey,...(user?{Authorization:'Bearer '+user.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const header=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([header,data])));return Buffer.concat([length,header,data,crc]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(256,0);ihdr.writeUInt32BE(256,4);ihdr[8]=8;ihdr[9]=2;const pixels=Buffer.alloc((256*3+1)*256);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const n=y*769+1+x*3;pixels[n]=185;pixels[n+1]=211;pixels[n+2]=198;}
const avatarPng=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(new URL('../tests/fixtures/avatar.png',import.meta.url),avatarPng);
const coverPng=fs.readFileSync(new URL('../tests/fixtures/cover.png',import.meta.url));
const a=await visitor(),b=await visitor();
const denied=await call('/profile');check('profile requires a visitor session',()=>assert.equal(denied.status,401));
const pa=await call('/profile','GET',undefined,a),pb=await call('/profile','GET',undefined,b);check('new visitors get a valid default instead of the owner avatar',()=>{for(const p of [pa,pb]){assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.avatar,null);assert(Number.isInteger(p.data.avatarPreset)&&p.data.avatarPreset>=0&&p.data.avatarPreset<8);}});
const repeat=await call('/profile','GET',undefined,a);check('default assignment survives repeat reads',()=>assert.equal(repeat.data.avatarPreset,pa.data.avatarPreset));
const forged=await call('/profile','PATCH',{avatar:'https://evil.invalid/avatar.png'},a);check('external avatar URLs are rejected',()=>assert.equal(forged.status,400));
const badShape=await call('/uploads','POST',{kind:'avatar',data:'data:image/png;base64,'+coverPng.toString('base64')},a);check('avatar uploads must be square and correctly sized',()=>assert.equal(badShape.data.error,'AVATAR_RATIO'));
const uploaded=await call('/uploads','POST',{kind:'avatar',data:'data:image/png;base64,'+avatarPng.toString('base64')},a);check('valid custom avatar upload',()=>assert.equal(uploaded.status,201,JSON.stringify(uploaded.data)));
const other=await call('/profile','PATCH',{avatar:uploaded.data.url,author_id:a.id},b);check('another visitor cannot adopt someone else’s uploaded avatar',()=>assert.equal(other.status,403));
const covers=[];for(const user of [a,b]){const r=await call('/uploads','POST',{kind:'cover',data:'data:image/png;base64,'+coverPng.toString('base64')},user);assert.equal(r.status,201);covers.push(r.data.url);}
const posts=[];for(const [i,user] of [a,b].entries()){const r=await call('/posts','POST',{title:'头像隔离验收 '+(i+1),author:'头像测试 '+(i+1),cover:covers[i],body:'<p>头像功能验收，上线前隐藏。</p>',lang:'zh'},user);assert.equal(r.status,201,JSON.stringify(r.data));posts.push(r.data);}
const set=await call('/profile','PATCH',{avatar:uploaded.data.url,author_id:b.id},a);check('profile update uses verified identity rather than a supplied author ID',()=>{assert.equal(set.status,200);assert.equal(set.data.avatar,uploaded.data.url);});
const oldA=await call('/posts/'+posts[0].id),oldB=await call('/posts/'+posts[1].id);check('old posts follow the correct author profile without changing their text version',()=>{assert.equal(oldA.data.avatar,uploaded.data.url);assert.equal(oldA.data.version,1);assert.equal(oldB.data.avatar,null);assert.equal(oldB.data.avatarPreset,pb.data.avatarPreset);assert(!('author_id' in oldA.data));});
const note=await call('/notes','POST',{author:'头像测试',body:'头像和留言关联验收，上线前隐藏。'},a);check('guestbook notes use the same visitor avatar',()=>{assert.equal(note.status,201);assert.equal(note.data.avatar,uploaded.data.url);assert(!('author_id' in note.data));});
const reset=await call('/profile','PATCH',{avatar:null},a);check('reset restores the original assigned preset',()=>{assert.equal(reset.data.avatar,null);assert.equal(reset.data.avatarPreset,pa.data.avatarPreset);});
const resetPost=await call('/posts/'+posts[0].id);check('existing posts follow a reset avatar',()=>{assert.equal(resetPost.data.avatar,null);assert.equal(resetPost.data.avatarPreset,pa.data.avatarPreset);});
await call('/profile','PATCH',{avatar:uploaded.data.url},a);
const currentB=await call('/profile','GET',undefined,b);check('one visitor’s changes leave another profile alone',()=>assert.deepEqual(currentB.data,pb.data));
const direct=await fetch(cfg.supabaseUrl+'/rest/v1/visitor_profiles?select=*',{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+a.token}});check('direct profile table access remains denied',()=>assert([401,403].includes(direct.status)));
const listing=await call('/posts');check('listing returns profile-specific avatars',()=>{assert.equal(listing.data.posts.find(p=>p.id===posts[0].id).avatar,uploaded.data.url);assert.equal(listing.data.posts.find(p=>p.id===posts[1].id).avatarPreset,pb.data.avatarPreset);});
console.log(JSON.stringify({passed,hidePosts:posts.map(p=>p.id),hideNote:note.data.id}));for(const user of [a,b])await user.sdk.auth.signOut({scope:'local'});
