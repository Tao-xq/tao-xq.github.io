import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-key'}[n])}};
let source=fs.readFileSync(new URL('../supabase/functions/rest-api/index.ts',import.meta.url),'utf8');
for(const [spec,pkg] of [['npm:@supabase/supabase-js@2.119.0','@supabase/supabase-js'],['npm:sanitize-html@2.18.2','sanitize-html'],['npm:linkedom@0.18.12','linkedom'],['npm:image-size@2.1.0','image-size']])source=source.replace(spec,import.meta.resolve(pkg));
source=source.replace('Deno.serve(handler);','export {cleanBody,parseBody,textNodes,cleanText,safeImage,handler};');
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('server removes executable HTML and outside tracking images while retaining formatting',()=>{
 const body=api.cleanBody('<p onclick="x()" style="color:red">Hello <strong>世界</strong></p><script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">link</a><img src="https://tracker.invalid/i"><img src="https://test.supabase.co/storage/v1/object/public/post-images/u/a.jpg" onerror="x()">');
 assert(!/onclick|onerror|javascript:|script|iframe|tracker|style=/.test(body));assert(body.includes('<strong>世界</strong>'));assert(body.includes('post-images/u/a.jpg'));assert(body.includes('noopener noreferrer'));
});
test('translation extracts exactly text nodes and skips code, preserving images and links',()=>{
 const doc=api.parseBody('<p>text <a href="https://example.com">link</a></p><pre><code>skip me</code></pre><img src="https://x.invalid/a.jpg"><p>日本語</p>');
 assert.deepEqual(api.textNodes(doc).map(n=>n.textContent),['text ','link','日本語']);assert.equal(doc.querySelectorAll('img').length,1);
});
test('input limits count Unicode code points and reject blank values',()=>{assert.equal(api.cleanText('猫😀',2),'猫😀');assert.throws(()=>api.cleanText('😀😀😀',2));assert.throws(()=>api.cleanText('  ',24));assert.throws(()=>api.cleanText({},24));});
test('images cannot escape the project public bucket',()=>{for(const url of ['javascript:x','https://test.supabase.co.evil.test/storage/v1/object/public/post-images/a','https://test.supabase.co/storage/v1/object/public/post-images/a?x=1','data:image/png;base64,AAAA'])assert.equal(api.safeImage(url),false);});
test('cross-origin requests are rejected and health needs no visitor identity',async()=>{const denied=await api.handler(new Request('https://test.supabase.co/functions/v1/rest-api/health',{headers:{origin:'https://evil.test'}}));assert.equal(denied.status,403);const health=await api.handler(new Request('https://test.supabase.co/functions/v1/rest-api/health'));assert.deepEqual(await health.json(),{ok:true,translationConfigured:false});});
test('RLS and service-only RPC grants cover every table',()=>{const sql=fs.readFileSync(new URL('../supabase/migrations/202611140001_rest_mode.sql',import.meta.url),'utf8');for(const table of ['community_posts','short_notes','post_view_counts','post_view_receipts','api_limits','post_translations','translation_budget','uploads'])assert(sql.includes('alter table public.'+table+' enable row level security'));assert(sql.includes('from anon, authenticated'));assert(sql.includes('from public,anon,authenticated'));});
