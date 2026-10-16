import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A failed official `check` keeps a typed, path-free diagnostic, and identical inputs are
// refused before the CLI runs again. The fake CLI replays the real R-017 check report
// (contrast 3.01:1, coral text on cream) captured from HyperFrames 0.8.159; no browser.
//   bun tests/hyperframes-check-diagnostic.ts
import {strict as assert} from 'node:assert';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {renderHyperframes,hyperframesDiagnostic,HyperframesFailure} from '../src/render/hyperframes';
let n=0;const ok=(name:string,f:()=>void)=>{f();n++;console.log('  ok   ',name);};
const report=readFileSync(join(import.meta.dir,'fixture/hyperframes-check-contrast.json'),'utf8');
const root=mkdtempSync('/private/tmp/hf-check-diagnostic-'),project=join(root,'project'),pkg=join(root,'package'),calls=join(pkg,'calls');
for(const d of[project,join(pkg,'bin')])mkdirSync(d,{recursive:true});
writeFileSync(join(project,'index.html'),'<main>Owned fixture</main>');writeFileSync(join(pkg,'package.json'),JSON.stringify({version:'0.8.159'}));
const cli=join(pkg,'bin/hyperframes.mjs');writeFileSync(join(pkg,'report.json'),report);
writeFileSync(cli,`import{appendFileSync,readFileSync}from'node:fs';appendFileSync(${JSON.stringify(calls)},process.argv[2]+'\\n');process.stdout.write(readFileSync(${JSON.stringify(join(pkg,'report.json'))},'utf8'));console.error('[INFO] cached to ${root}/cache/fonts');process.exit(1);`);
const tools={node:Bun.which('node')!,cli,browser:'/usr/bin/true',ffmpeg:'/usr/bin/true',ffprobe:'/usr/bin/true'};
const attempt=async(failedInputDigest?:string|null)=>{try{await renderHyperframes({project,tools,authorize(){},timeoutMs:10000,failedInputDigest});}catch(e){return e as HyperframesFailure;}throw new Error('fixture check unexpectedly passed');};
const count=()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').length:0;
try{
 const first=await attempt();const d=first.diagnostic!;
 ok('check failure carries a typed diagnostic',()=>{assert(first instanceof HyperframesFailure&&first.cleanupSafe&&first.stage==='check'&&first.code==='command-failed');assert(d&&d.schema===1&&d.stage==='check'&&d.deterministic===true&&/^[a-f0-9]{64}$/.test(d.inputDigest!));});
 ok('only the contrast gate failed, with its real counts',()=>{assert.deepEqual(d.gates.filter(g=>!g.ok).map(g=>[g.gate,g.errors]),[['contrast',5]]);assert(d.gates.find(g=>g.gate==='lint')?.ok&&d.gates.find(g=>g.gate==='layout')?.ok);});
 ok('the finding names the ratio, colors and text',()=>{const f=d.findings[0];assert.equal(f.code,'contrast_aa_failure');assert.equal(f.severity,'error');assert.equal(f.ratio,3.01);assert.equal(f.requiredRatio,4.5);assert.equal(f.fg,'rgb(240,100,69)');assert.equal(f.bg,'rgb(255,248,235)');assert.equal(f.suggestedColor,'rgb(190,79,55)');assert(f.text&&f.message.includes('3.01:1'));});
 ok('no host path, temp folder or stderr text leaves the renderer',()=>{const text=JSON.stringify(d)+first.message;for(const bad of[root,'/private/var/folders','crew-hyperframes-','.hyperframes/artifacts','cached to'])assert(!text.includes(bad),bad);});
 const second=await attempt(d.inputDigest);
 ok('identical inputs are refused before the CLI runs again',()=>{assert.equal(second.code,'unchanged-inputs');assert.equal(second.diagnostic?.inputDigest,d.inputDigest);assert.equal(count(),1);});
 writeFileSync(join(project,'index.html'),'<main>Owned fixture, readable text</main>');
 const third=await attempt(d.inputDigest);
 ok('changed inputs run the official check again',()=>{assert.equal(third.code,'command-failed');assert.notEqual(third.diagnostic?.inputDigest,d.inputDigest);assert.equal(count(),2);});
 ok('a runtime (browser) gate failure stays retryable',()=>{const r=JSON.parse(report);r.runtime={ok:false,errorCount:1,warningCount:0,findings:[{code:'page_error',severity:'error',message:'Uncaught error'}]};const d=hyperframesDiagnostic('check','command-failed',{out:JSON.stringify(r),err:''},'x');assert(!d.deterministic&&d.gates.some(g=>g.gate==='runtime'&&!g.ok));});
 ok('a render failure keeps a bounded, path-free stderr tail',()=>{const r=hyperframesDiagnostic('render','command-failed',{out:'',err:`Error: frame capture failed at ${root}/project/index.html\nsecond line`},'x');assert(!r.deterministic&&r.detail&&!r.detail.includes(root)&&r.detail.includes('<path>')&&r.detail.length<=500);});
}finally{rmSync(root,{recursive:true,force:true});}
console.log(`hyperframes-check-diagnostic: ${n} passed, 0 failed; real report replayed, no browser`);
