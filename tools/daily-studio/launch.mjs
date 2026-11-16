import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..'),url='http://127.0.0.1:4186/';
async function ready(){try{const response=await fetch(url+'health',{signal:AbortSignal.timeout(1000)});if(!response.ok)return false;const result=await response.json();return result.app==='rest-mode-daily-studio';}catch{return false;}}
if(!await ready()){
 const logs=path.join(repo,'.local/daily-studio');fs.mkdirSync(logs,{recursive:true});const out=fs.openSync(path.join(logs,'server.log'),'a'),error=fs.openSync(path.join(logs,'server-error.log'),'a');
 const env={...process.env},pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';
 if(process.platform==='win32')for(const folder of [path.join(process.env.ProgramFiles||'C:/Program Files','Git/cmd'),path.join(process.env.LOCALAPPDATA||'','Programs/Git/cmd')])if(fs.existsSync(path.join(folder,'git.exe'))&&!String(env[pathKey]).toLowerCase().includes(folder.toLowerCase()))env[pathKey]=folder+';'+(env[pathKey]||'');
 const child=spawn(process.execPath,[path.join(here,'server.mjs')],{cwd:repo,env,detached:true,windowsHide:true,stdio:['ignore',out,error]});child.unref();fs.closeSync(out);fs.closeSync(error);
 let started=false;for(let attempt=0;attempt<60;attempt++){if(await ready()){started=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}if(!started)throw Error('Daily Notes 没有启动，请查看 .local/daily-studio/server-error.log。');
}
if(!process.argv.includes('--no-browser')){
 if(process.platform==='win32'){const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();}
 else console.log('Open '+url);
}
console.log('Daily Notes is ready: '+url);
