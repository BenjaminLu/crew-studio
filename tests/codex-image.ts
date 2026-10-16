import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Strict actual image subprocess tests. No actual account or vendor request.
import{mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{generateCodexImage,verifyImagePng,CodexImageFailure}from'../src/providers/codex-image';
import type{ProviderCapability}from'../src/providers/policy';
import{rulesSection}from'../src/operating-rules';
let passed=0,failed=0;function ok(v:unknown,n:string){console.log(`${v?'ok':'FAIL'} ${n}`);v?passed++:failed++;}
const root=mkdtempSync(join(tmpdir(),'crew-image-fixture-')),source=join(root,'source');mkdirSync(source);writeFileSync(join(source,'auth.json'),JSON.stringify({auth_mode:'chatgpt',last_refresh:'2026-10-15T00:00:00Z',tokens:{access_token:'abcdefgh.abcdefgh.abcdefgh',id_token:'fixture',account_id:'fixture',refresh_token:'ORIGINAL-NEVER-COPY'}}),{mode:0o600});
const old=process.env.CODEX_HOME,oldKey=process.env.CODEX_API_KEY;process.env.CODEX_HOME=source;delete process.env.CODEX_API_KEY;
const cap=():ProviderCapability=>({provider:'codex',available:true,auth:'verified',quota:'available',at:Date.now(),expires:Date.now()+30000,models:[{id:'fixture-model',efforts:['low']}]});
const planted=join(root,'planted-outside.txt');writeFileSync(planted,'PLANTED_ONLY');
const base={rules:rulesSection('IMAGE-RULE-7: never start a sign-in flow','',null),approved:{model:'fixture-model',effort:'low'},bin:join(import.meta.dir,'codex-image-fixture.mjs'),authorize(){},probe:async()=>cap(),timeoutMs:3000};
async function refuses(mode:string,extra:Record<string,unknown>={}){let error='';try{await generateCodexImage({...base,prompt:`coffee MODE:${mode} PLANTED:${planted}`,...extra});}catch(e){error=(e as Error).message;ok(e instanceof CodexImageFailure && e.cleanupSafe===true,`${mode} rejection carries verified process cleanup receipt`);}ok(!!error,`${mode} refuses without image success`);return error;}
try{
 let image=await generateCodexImage({...base,prompt:'coffee MODE:success'});
 {const ruled=await generateCodexImage({...base,prompt:'coffee MODE:success RULES_MUST:IMAGE-RULE-7'});ok(ruled.operatingRules===base.rules.hash,'the image job sends the operating rules in its base instructions and returns their hash');}
 await refuses('success',{prompt:'coffee MODE:success RULES_MUST:NOT-IN-THE-RULES'});
 await refuses('success',{rules:undefined});await refuses('success',{rules:{...base.rules,text:'forged'}});ok(image.mime==='image/png'&&image.width===1&&image.height===1&&image.sha256.length===64&&image.provider==='codex'&&image.model==='fixture-model','actual sandboxed image completion validates PNG and exact provider/model');
 const longPrompt='coffee MODE:success '+ 'preserved context '.repeat(1200);
 await refuses('success',{prompt:longPrompt});
 const longImage=await generateCodexImage({...base,prompt:longPrompt,contextProfile:'coffee-kit'});ok(longImage.sha256===image.sha256,'host coffee profile accepts complete evidence beyond generic 16KB cap');
 await refuses('success',{prompt:'x'.repeat(262145),contextProfile:'coffee-kit'});
 const refined=await generateCodexImage({...base,prompt:`Keep black fur; change only head tilt. MODE:reference REFERENCE_SHA:${image.sha256}`,reference:{bytes:image.bytes,sha256:image.sha256}});ok(refined.sha256===image.sha256,'actual sandboxed turn transports exact reference PNG as image input');
 await refuses('reference',{reference:{bytes:image.bytes,sha256:'0'.repeat(64)}});
 const saved=await generateCodexImage({...base,prompt:'coffee MODE:saved'});ok(saved.sha256===image.sha256,'actual owned saved PNG imported before credential cleanup');
 for(const mode of['text-only','malformed','fake-png','failed','partial','outside','symlink','unexpected-tool','wrong-thread','wrong-turn','duplicate','permission','turn-failed','post-completion-duplicate'])await refuses(mode);
 const start=Date.now();await refuses('timeout',{timeoutMs:150});ok(Date.now()-start<2500,'actual timeout bounded');
 const controller=new AbortController();setTimeout(()=>controller.abort(),100);await refuses('timeout',{signal:controller.signal});
 let launched=0;await refuses('success',{authorize(){if(++launched>1)throw new Error('revoked');}});ok(launched===2,'revocation after asynchronous admission checked before process launch');
 await refuses('success',{probe:async()=>({...cap(),auth:'unverified'})});await refuses('success',{probe:async()=>({...cap(),quota:'unknown'})});await refuses('success',{approved:{model:'unknown-model',effort:'low'}});
 const aborted=new AbortController();aborted.abort();let probes=0;await refuses('success',{signal:aborted.signal,probe:async()=>{probes++;return cap();}});ok(probes===0,'already cancelled owner cannot probe or launch');
 for(const [name,bytes]of[['truncated',image.bytes.subarray(0,-1)],['trailing',Buffer.concat([image.bytes,Buffer.from('junk')])],['badCRC',Buffer.from(image.bytes)]]as const){if(name==='badCRC')bytes[bytes.length-1]^=1;let bad=false;try{verifyImagePng(bytes);}catch{bad=true;}ok(bad,`PNG ${name} rejected`);}
}finally{if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;if(oldKey===undefined)delete process.env.CODEX_API_KEY;else process.env.CODEX_API_KEY=oldKey;rmSync(root,{recursive:true,force:true});}
console.log(`codex-image: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
