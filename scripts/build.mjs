import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import sanitize from 'sanitize-html';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});fs.cpSync(path.join(root,'web'),out,{recursive:true});
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const write=(file,text)=>fs.writeFileSync(path.join(out,file),text);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(s){return escape(s).replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img alt="$1" src="$2">').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');}
function markdown(md){let lines=md.trim().split(/\r?\n/),out=[],para=[],list=false,code=null;const flush=()=>{if(para.length){out.push('<p>'+inline(para.join(' '))+'</p>');para=[];}if(list){out.push('</ul>');list=false;}};for(const line of lines){if(line.startsWith('```')){flush();if(code){out.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');code=null;}else code=[];continue;}if(code){code.push(line);continue;}if(!line.trim()){flush();continue;}if(/^#{1,3} /.test(line)){flush();const level=Math.max(2,line.match(/^#+/)[0].length);out.push(`<h${level}>${inline(line.replace(/^#+ /,''))}</h${level}>`);}else if(/^> /.test(line)){flush();out.push('<blockquote>'+inline(line.slice(2))+'</blockquote>');}else if(/^[-*] /.test(line)){if(para.length)flush();if(!list){list=true;out.push('<ul>');}out.push('<li>'+inline(line.slice(2))+'</li>');}else if(/^---+$/.test(line)){flush();out.push('<hr>');}else para.push(line.trim());}flush();return sanitize(out.join('\n'),{allowedTags:sanitize.defaults.allowedTags.concat(['img']),allowedAttributes:{a:['href','target','rel'],img:['src','alt']},allowedSchemes:['https','http'],allowProtocolRelative:false});}
const owner=JSON.parse(read('content/owner.json')),daily=[];
for(const name of fs.readdirSync(path.join(root,'content/daily')).filter(n=>n.endsWith('.md')&&!/\.(zh|en|ja)\.md$/.test(n)).sort()){
 const raw=read('content/daily/'+name),match=raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);if(!match)throw Error('Missing frontmatter: '+name);
 const meta=Object.fromEntries(match[1].split(/\r?\n/).map(line=>{const pos=line.indexOf(':');return [line.slice(0,pos).trim(),line.slice(pos+1).trim()];}));if(meta.draft==='true'||meta.demo==='true')continue;
 for(const key of ['id','title','cover','publishedAt'])if(!meta[key])throw Error('Missing '+key+' in '+name);
 if(!/^daily-[\w-]+$/.test(meta.id)||Array.from(meta.title).length>28||isNaN(Date.parse(meta.publishedAt)))throw Error('Invalid metadata: '+name);
 const body=markdown(match[2]),version=crypto.createHash('sha256').update(meta.title+'\n'+body).digest('hex');
 const translations={};for(const language of ['zh','en','ja']){const translatedName=name.replace(/\.md$/,'.'+language+'.md'),translatedPath=path.join(root,'content/daily',translatedName);if(!fs.existsSync(translatedPath))continue;const translated=fs.readFileSync(translatedPath,'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);if(!translated)throw Error('Missing translation frontmatter: '+translatedName);const title=translated[1].match(/^title:\s*(.+)$/m)?.[1]?.trim();if(!title)throw Error('Missing translated title: '+translatedName);translations[language]={title,body:markdown(translated[2])};}
 daily.push({...meta,section:'daily',author:owner.nickname,avatar:owner.avatar,lang:['en','ja'].includes(meta.lang)?meta.lang:'zh',body,version,demo:false,translations});
}
if(new Set(daily.map(p=>p.id)).size!==daily.length)throw Error('Duplicate daily post id');
write('content/generated.js','window.REST_CONTENT='+json({owner,daily,community:[],notes:[]})+';\n');
write('content/posts.json',JSON.stringify(daily));
write('content/ui-languages.js','window.REST_UI_STRINGS='+json(JSON.parse(read('content/ui-languages.json')))+';\n');
const base=JSON.parse(read('content/home-manifest.json'));
for(const map of ['source','background','glass','hoverLayers'])for(const [key,value] of Object.entries(base[map]))base[map][key]='art/'+value;
for(const seq of Object.values(base.sequences))seq.frames=seq.frames.map(p=>'art/'+p);
write('home-manifest.js','window.RM_MANIFEST='+json(base)+';\n');
fs.copyFileSync(path.join(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),path.join(out,'vendor/supabase.js'));
fs.copyFileSync(path.join(root,'node_modules/@supabase/supabase-js/LICENSE'),path.join(out,'vendor/SUPABASE-LICENSE.txt'));
write('.nojekyll','');write('404.html',read('web/index.html'));
console.log(JSON.stringify({daily:daily.length,frames:base.frameCount,output:'dist'}));
