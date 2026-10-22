import "./lib/isolated-env.mjs";
import {strict as a} from 'node:assert';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {ledgerKey} from '../src/runtime/checks';
import {installReadiness} from '../src/readiness';
import {WorkflowAdoption} from '../src/workflow-package-adoption';
import {WorkflowDrafts} from '../src/workflow-drafts';
import {WORKFLOW_DRAFT_EXAMPLE} from '../src/workflow-draft-contract';
import {WorkflowDefs} from '../src/runtime/defs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {snapshotPackage,verifyPackage,encodePackage,packageSha} from '../src/workflow-package';
import {adoptionProfile,READY_PACKAGE,READY_MANIFEST} from '../src/workflow-package-profile';
import {bundledBytes} from '../src/bundled';
const dir=mkdtempSync(join(tmpdir(),'crew-adopt-profile-'));let count=0;const check=(f:()=>void)=>{f();count++;};
const d:any={id:'original',name:'A normal saved draft',version:3,roles:[{id:'writer',label:'Writer',skill:'bundled:workflows/skills/v2/writer.md',provider:'codex'}],nodes:[{id:'write',kind:'agent',label:'Write',x:0,y:0,role:'writer',mode:'deliver',args:{format:'document'}},{id:'ready',kind:'check',label:'Ready',x:1,y:0,checks:[{use:'core/artifact-ready',proves:[0]}],args:{producer:'all'}},{id:'accept',kind:'card',label:'Accept',x:2,y:0,args:{mode:'deliver-accept',card_kind:'acceptance'}},{id:'end',kind:'hook',label:'End',x:3,y:0}],edges:[{from:'write',to:'ready'},{from:'ready',to:'accept',when:'pass'},{from:'ready',to:'accept',when:'fail'},{from:'accept',to:'end',when:'approved'}]};
function fixture(def=d,mutate?:(v:any)=>void){const v=verifyPackage(snapshotPackage(def,dir));v.files.delete('manifest.json');v.files.set(READY_PACKAGE,Buffer.from(bundledBytes(READY_MANIFEST)!));if(mutate)mutate(v);v.manifest.files=[...v.files].map(([path,b])=>({path,size:b.length,sha256:packageSha(b)}));return encodePackage(v.files,v.manifest);}
const caps={ready:true,accept:true};
try{
 check(()=>a.deepEqual(adoptionProfile(fixture(),caps).definition,d));
 check(()=>a.throws(()=>adoptionProfile(fixture(),{ready:false,accept:true}),/capability registration/));
 check(()=>a.throws(()=>adoptionProfile(fixture(d,v=>v.files.set(READY_PACKAGE,Buffer.from('changed'))),caps),/capability bytes/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,nodes:d.nodes.map((n:any)=>n.id==='ready'?{...n,checks:[{use:'core/artifact-ready',proves:[0],params:{custom:true}}]}:n)}),caps),/unsupported fields/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,nodes:d.nodes.map((n:any)=>n.id==='accept'?{...n,args:{...n.args,run:'evil'}}:n)}),caps),/unsupported fields/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,hooks:[]}),caps),/unsupported fields/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,edges:[{from:'write',to:'accept'}]}),caps),/predecessor/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,nodes:d.nodes.map((n:any)=>n.id==='write'?{...n,skills:[{id:'s',v:1,sha256:'a'.repeat(64)}]}:n)}),caps),/pin/));

 check(()=>a.throws(()=>adoptionProfile(fixture({...d,nodes:d.nodes.map((n:any)=>n.id==='write'?{...n,args:{format:'document',variant:['A']}}:n)}),caps),/deliver args/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,roles:d.roles.map((r:any)=>({...r,seat:'unknown'}))}),caps),/seat/));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,nodes:d.nodes.map((n:any)=>n.id==='write'?{...n,args:{format:'web'}}:n)}),caps),/mismatch/));
 const card={id:'decision',kind:'card',label:'Decide',x:4,y:0,card:{title:'Approve?',options:[{id:'revise',label:'Revise',note:true}]}};
 check(()=>a.equal(adoptionProfile(fixture({...d,nodes:[...d.nodes,card]}),caps).definition.nodes.at(-1).card.options[0].note,true));
 check(()=>a.throws(()=>adoptionProfile(fixture({...d,nodes:d.nodes.map((n:any)=>n.id==='write'?{...n,skill:'bundled:workflows/skills/v2/designer.md',args:{format:'web'}}:n)},v=>{for(const [p,b]of v.files)if(p.startsWith('roles/')&&b.equals(Buffer.from(bundledBytes('workflows/skills/v2/designer.md')!)))v.files.delete(p);}),caps),/node skill bytes/));
 const destination=join(dir,'destination'),defs=new WorkflowDefs(destination,()=>[]),service=new WorkflowAdoption(destination),out=service.adopt(fixture(),'pkg-'+ 'a'.repeat(24),defs,caps),saved=defs.versions(out.workflow)[0];
 check(()=>a.equal(saved.origin?.source,'package-import'));
 check(()=>a.deepEqual(saved.nodes,d.nodes));
 check(()=>a.deepEqual(saved.edges,d.edges));
 check(()=>a.equal(new WorkflowAdoption(destination).data,destination));
 const failed=join(dir,'interrupted'),broken=new WorkflowAdoption(failed,p=>{if(p.startsWith('reserve:'))throw Error('injected crash');});
 check(()=>a.throws(()=>broken.adopt(fixture(),'pkg-'+'a'.repeat(24),new WorkflowDefs(failed,()=>[]),caps),/injected/));
 new WorkflowAdoption(failed);check(()=>a.equal(new WorkflowDefs(failed,()=>[]).ids().length,0));

 const sourceDefs=new WorkflowDefs(join(dir,'real-source'),()=>[]),drafts=new WorkflowDrafts(join(dir,'real-source'),sourceDefs),draft=drafts.draft(structuredClone(WORKFLOW_DRAFT_EXAMPLE),'test-turn',[]);
 const persisted=drafts.save(draft.id,'captain',draft.revision),source=sourceDefs.versions(persisted.workflow)[0];
 const real=adoptionProfile(snapshotPackage(source,join(dir,'real-source')),caps);
 check(()=>a.deepEqual(real.definition.nodes,source.nodes));
 check(()=>a.deepEqual(real.definition.edges,source.edges));
 const script=Buffer.from('touch SHOULD_NEVER_RUN'),skill=Buffer.from('---\nname: source-name\ndescription: Source-only package\n---\nUse only when explicitly asked.\n'),support='scripts/sentinel.sh',filesHash=packageSha(support+'\0'+packageSha(script)),pinned={...d,nodes:d.nodes.map((n:any)=>n.id==='write'?{...n,skills:[{id:'original-skill',v:2,sha256:packageSha(skill),filesSha256:filesHash}]}:n)};
 const withSkill=fixture(pinned,v=>{v.files.set('skills/original-skill/v2/SKILL.md',skill);v.files.set('skills/original-skill/v2/files/'+support,script);});
 const skillDest=join(dir,'skill-destination'),skillDefs=new WorkflowDefs(skillDest,()=>[]),skillOut=new WorkflowAdoption(skillDest).adopt(withSkill,'pkg-'+'b'.repeat(24),skillDefs,caps),newPin=skillDefs.versions(skillOut.workflow)[0].nodes[0].skills![0];
 check(()=>a.notEqual(newPin.id,'original-skill'));
 check(()=>a.equal(newPin.v,1));
 check(()=>a(readFileSync(join(skillDest,'skills','_library',newPin.id,'v1','SKILL.md')).equals(skill)));
 check(()=>a(!existsSync(join(skillDest,'SHOULD_NEVER_RUN'))));
 const cache=fixture(pinned,v=>{v.files.set('skills/original-skill/v2/SKILL.md',skill);v.files.set('skills/original-skill/v2/files/'+support,script);v.files.set('skills/original-skill/v2/files/cache.pyc',Buffer.from('cache'));});
 check(()=>a.throws(()=>new WorkflowAdoption(join(dir,'cache')).adopt(cache,'pkg-'+'b'.repeat(24),new WorkflowDefs(join(dir,'cache'),()=>[]),caps),/P1 admission/));

 const points:string[]=[],capture=join(dir,'capture'),captured=new WorkflowAdoption(capture,p=>points.push(p));captured.adopt(withSkill,'pkg-'+'c'.repeat(24),new WorkflowDefs(capture,()=>[]),caps);
 for(const [i,point]of points.entries()){
  let visited=0;const at=join(dir,'crash-'+i),crash=new WorkflowAdoption(at,p=>{if(visited++===i)throw Error('crash-boundary');});
  a.throws(()=>crash.adopt(withSkill,'pkg-'+'c'.repeat(24),new WorkflowDefs(at,()=>[]),caps),/crash-boundary/);
  new WorkflowAdoption(at);const remaining=new WorkflowDefs(at,()=>[]).ids();
  check(()=>a(remaining.length===0||remaining.length===1&&remaining[0].startsWith('imp-')));
  new WorkflowAdoption(at);check(()=>a.deepEqual(new WorkflowDefs(at,()=>[]).ids(),remaining));
 }

 let gateCalls=0;const gate=installReadiness({dataDir:destination,defs,drafts:new WorkflowDrafts(destination,defs),engine:{policies:{get:()=>({value:6})}} as any,protectedRoots:[],createRuntime:()=>{throw Error('must not run');},send(){},smokePollMs:100000});
 try{(gate.gate as any).run=async()=>{gateCalls++;return null;};
  gate.versionSaved(saved);gate.wfView(saved.id);gate.tools.view({workflow:saved.id});
  check(()=>a.equal(gateCalls,0));
  await gate.route(`/api/wf/${saved.id}/gate`,new URL(`http://fixture/api/wf/${saved.id}/gate`),'GET',false,{},'captain',{kind:'desktop'});
  check(()=>a.equal(gateCalls,0));
  await gate.route(`/api/wf/${saved.id}/gate`,new URL(`http://fixture/api/wf/${saved.id}/gate`),'POST',true,{},'captain',{kind:'desktop'});
  check(()=>a.equal(gateCalls,1));
 }finally{gate.stop();}

 const archivePath=join(dir,'kill-fixture.zip');writeFileSync(archivePath,withSkill);
 const childCode=`import {readFileSync} from 'node:fs';import {WorkflowAdoption} from ${JSON.stringify(join(import.meta.dir,'../src/workflow-package-adoption.ts'))};import {WorkflowDefs} from ${JSON.stringify(join(import.meta.dir,'../src/runtime/defs.ts'))};let step=0;const data=process.argv[1],bytes=readFileSync(process.argv[2]),stop=Number(process.argv[3]);new WorkflowAdoption(data,()=>{if(step++===stop)process.exit(73);}).adopt(bytes,'pkg-'+'d'.repeat(24),new WorkflowDefs(data,()=>[]),{ready:true,accept:true});process.exit(74);`;
 for(let i=0;i<points.length;i++){
  const at=join(dir,'killed-'+i),child=Bun.spawnSync(['bun','--no-env-file','-e',childCode,at,archivePath,String(i)],{stdout:'pipe',stderr:'pipe'});
  check(()=>a.equal(child.exitCode,73,child.stderr.toString()));new WorkflowAdoption(at);const first=new WorkflowDefs(at,()=>[]).ids();new WorkflowAdoption(at);check(()=>a.deepEqual(new WorkflowDefs(at,()=>[]).ids(),first));
 }

 const partial=(name:string)=>{const at=join(dir,name),stop=points.findIndex(p=>p.startsWith('file:')),child=Bun.spawnSync(['bun','--no-env-file','-e',childCode,at,archivePath,String(stop)],{stdout:'pipe',stderr:'pipe'});a.equal(child.exitCode,73,child.stderr.toString());const txn=readdirSync(join(at,'workflow-adoptions'))[0],journal=join(at,'workflow-adoptions',txn,'journal.json'),plan=JSON.parse(readFileSync(journal,'utf8')).plan;return {at,txn,journal,plan,skillRoot:join(at,plan.roots[0])};};
 const clean=partial('clean-partial');check(()=>a(existsSync(join(clean.skillRoot,'v1','SKILL.md'))));new WorkflowAdoption(clean.at);
 check(()=>a(!existsSync(clean.skillRoot)));check(()=>a(existsSync(join(clean.at,'workflow-adoptions',clean.txn,'rolled-back'))));

 const hostile=partial('hostile-journal'),victim=join(hostile.at,'workflows','victim');mkdirSync(victim,{recursive:true});writeFileSync(join(victim,'v1.json'),'{"keep":true}');
 const tampered=JSON.parse(readFileSync(hostile.journal,'utf8'));tampered.plan.roots.push('workflows/victim');writeFileSync(hostile.journal,JSON.stringify(tampered));
 const hostileRecovery=new WorkflowAdoption(hostile.at);
 check(()=>a.equal(readFileSync(join(victim,'v1.json'),'utf8'),'{"keep":true}'));
 check(()=>a(existsSync(join(hostile.skillRoot,'v1','SKILL.md'))));
 check(()=>a.match(hostileRecovery.holds()[0]?.reason??'',/signature/));
 check(()=>a.equal(new WorkflowAdoption(hostile.at).holds().length,1));

 const sourceTxn=saved.origin!.transaction!,forgedTxn='import-'+'f'.repeat(24),forgedPlan={schema:1,txn:forgedTxn,workflow:saved.id,archiveSha256:'0'.repeat(64),files:[{path:`workflows/${saved.id}/v1.json`,sha256:'0'.repeat(64)}],roots:[`workflows/${saved.id}`]};
 mkdirSync(join(destination,'workflow-adoptions',forgedTxn));writeFileSync(join(destination,'workflow-adoptions',forgedTxn,'journal.json'),JSON.stringify({plan:forgedPlan,sig:createHmac('sha256',ledgerKey(destination)).update(JSON.stringify(forgedPlan)).digest('hex')}));
 const forged=new WorkflowAdoption(destination);
 check(()=>a.deepEqual(new WorkflowDefs(destination,()=>[]).versions(saved.id)[0].nodes,d.nodes));
 check(()=>a.match(forged.holds().find(x=>x.txn===forgedTxn)?.reason??'',/Unowned adoption target/));
 check(()=>a(existsSync(join(destination,'workflow-adoptions',sourceTxn,'complete'))));

 const changed=partial('changed-target'),changedFile=join(changed.skillRoot,'v1','SKILL.md');writeFileSync(changedFile,readFileSync(changedFile,'utf8')+'\nlocal edit\n');
 const changedRecovery=new WorkflowAdoption(changed.at);
 check(()=>a.match(readFileSync(changedFile,'utf8'),/local edit/));
 check(()=>a.match(changedRecovery.holds()[0]?.reason??'',/Changed adoption bytes/));

 const foreign=partial('foreign-file');writeFileSync(join(foreign.skillRoot,'foreign.txt'),'not owned');
 const foreignRecovery=new WorkflowAdoption(foreign.at);
 check(()=>a.equal(readFileSync(join(foreign.skillRoot,'foreign.txt'),'utf8'),'not owned'));
 check(()=>a(existsSync(join(foreign.skillRoot,'package-owner.json'))));
 check(()=>a.match(foreignRecovery.holds()[0]?.reason??'',/Changed adoption bytes/));

 const imported=skillDefs.versions(skillOut.workflow)[0];
 check(()=>a(readFileSync(join(skillDest,'workflow-adoptions',imported.origin!.transaction!,'source.zip')).equals(withSkill)));
 const importedCopy=skillDefs.copyTemplate(skillOut.workflow,1,'imported-copy','Imported copy',false,'captain');
 check(()=>a.equal(importedCopy.origin?.source,'package-import'));
 check(()=>a.deepEqual(importedCopy.origin?.package,imported.origin!.package));
 check(()=>a.equal(importedCopy.origin?.transaction,imported.origin!.transaction));
 const draftCopy=sourceDefs.copyTemplate(persisted.workflow,1,'draft-copy','Draft copy',false,'captain');
 check(()=>a.equal(draftCopy.origin?.source,'firstmate-draft'));
 check(()=>a.equal(draftCopy.origin?.draft,undefined));
 console.log(`${count} profile assertions passed`);
}finally{rmSync(dir,{recursive:true,force:true});}
