import "./lib/isolated-env.mjs";
import {strict as a} from 'node:assert';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync,readdirSync,mkdirSync,statSync,chmodSync,symlinkSync,utimesSync,unlinkSync} from 'node:fs';
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
// a killed process leaves its adoption lock; its owner pid is gone, and aging it also covers a lock left without an owner record
const expireLock=(at:string)=>{try{utimesSync(join(at,'workflow-adoptions','.lock-adopt'),0,0);}catch{}};
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
 const failed=join(dir,'interrupted'),broken=new WorkflowAdoption(failed,p=>{if(p.startsWith('stage:'))throw Error('injected crash');});
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
 const lastPublish=points.findLastIndex(p=>p.startsWith('publish:'));check(()=>a(lastPublish>0&&points.at(-1)==='published'));
 for(const [i,point]of points.entries()){
  let visited=0;const at=join(dir,'crash-'+i),crash=new WorkflowAdoption(at,p=>{if(visited++===i)throw Error('crash-boundary');});
  let done:any=null;try{done=crash.adopt(withSkill,'pkg-'+'c'.repeat(24),new WorkflowDefs(at,()=>[]),caps);}catch(e:any){a.match(e.message,/crash-boundary/);}
  // once the last folder is published, a late failure still reports the created workflow instead of inviting a duplicate retry
  check(()=>a.equal(!!done,i>=lastPublish,point));if(done)check(()=>a.deepEqual(new WorkflowDefs(at,()=>[]).ids(),[done.workflow]));
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
 const filesUnder=(p:string)=>(readdirSync(p,{recursive:true}) as string[]).filter(f=>statSync(join(p,f)).isFile());
 const wholeOrAbsent=(at:string)=>{const txn=readdirSync(join(at,'workflow-adoptions')).find(x=>x.startsWith('import-'))!,plan=JSON.parse(readFileSync(join(at,'workflow-adoptions',txn,'journal.json'),'utf8')).plan;return plan.roots.every((root:string)=>{if(!existsSync(join(at,root)))return true;const want=plan.files.filter((f:any)=>f.path.startsWith(root+'/'));return filesUnder(join(at,root)).length===want.length&&want.every((f:any)=>existsSync(join(at,f.path))&&packageSha(readFileSync(join(at,f.path)))===f.sha256);});};
 for(let i=0;i<points.length;i++){
  const at=join(dir,'killed-'+i),child=Bun.spawnSync(['bun','--no-env-file','-e',childCode,at,archivePath,String(i)],{stdout:'pipe',stderr:'pipe'});expireLock(at);
  check(()=>a.equal(child.exitCode,73,child.stderr.toString()));
  // before any recovery: every target folder is absent or whole, and the catalog still lists
  check(()=>a(wholeOrAbsent(at),points[i]));check(()=>a.doesNotThrow(()=>new WorkflowDefs(at,()=>[]).list()));
  new WorkflowAdoption(at);const first=new WorkflowDefs(at,()=>[]).ids();new WorkflowAdoption(at);check(()=>a.deepEqual(new WorkflowDefs(at,()=>[]).ids(),first));
 }

 const partial=(name:string)=>{const at=join(dir,name),stop=points.findIndex(p=>p.startsWith('publish:')),child=Bun.spawnSync(['bun','--no-env-file','-e',childCode,at,archivePath,String(stop)],{stdout:'pipe',stderr:'pipe'});a.equal(child.exitCode,73,child.stderr.toString());expireLock(at);const txn=readdirSync(join(at,'workflow-adoptions')).filter(n=>n.startsWith('import-'))[0],journal=join(at,'workflow-adoptions',txn,'journal.json'),plan=JSON.parse(readFileSync(journal,'utf8')).plan;return {at,txn,journal,plan,skillRoot:join(at,plan.roots[0])};};
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
 mkdirSync(join(destination,'workflow-adoptions',forgedTxn));writeFileSync(join(destination,'workflow-adoptions',forgedTxn,'journal.json'),JSON.stringify({plan:forgedPlan,sig:createHmac('sha256',ledgerKey(destination)).update('crew-workflow-adoption-v1\0'+JSON.stringify(forgedPlan)).digest('hex')}));
 const forged=new WorkflowAdoption(destination);
 check(()=>a.deepEqual(new WorkflowDefs(destination,()=>[]).versions(saved.id)[0].nodes,d.nodes));
 check(()=>a.match(forged.holds().find(x=>x.txn===forgedTxn)?.reason??'',/Unowned adoption target/));
 check(()=>a(existsSync(join(destination,'workflow-adoptions',sourceTxn,'complete'))));
 const bareTxn='import-'+'e'.repeat(24),barePlan={...forgedPlan,txn:bareTxn};mkdirSync(join(destination,'workflow-adoptions',bareTxn));writeFileSync(join(destination,'workflow-adoptions',bareTxn,'journal.json'),JSON.stringify({plan:barePlan,sig:createHmac('sha256',ledgerKey(destination)).update(JSON.stringify(barePlan)).digest('hex')}));
 check(()=>a.match(new WorkflowAdoption(destination).holds().find(x=>x.txn===bareTxn)?.reason??'',/signature/)); // a ledger-key HMAC without the adoption purpose prefix is not a journal signature

 const brokenEmpty=join(destination,'workflows','imp-'+'a'.repeat(24)),brokenCut=join(destination,'workflows','imp-'+'b'.repeat(24));mkdirSync(brokenEmpty);mkdirSync(brokenCut);writeFileSync(join(brokenCut,'v1.json'),'{"id":');
 const listed=new WorkflowDefs(destination,()=>[]).list().map(w=>w.id);
 check(()=>a(listed.includes(saved.id)&&!listed.some(x=>x.endsWith('a'.repeat(24))||x.endsWith('b'.repeat(24)))));
 rmSync(brokenEmpty,{recursive:true});rmSync(brokenCut,{recursive:true});

 const ro=partial('readonly-txn'),roDir=join(ro.at,'workflow-adoptions',ro.txn),roJournal=JSON.parse(readFileSync(ro.journal,'utf8'));roJournal.sig='0'.repeat(64);writeFileSync(ro.journal,JSON.stringify(roJournal));chmodSync(roDir,0o500);
 try{check(()=>a.doesNotThrow(()=>new WorkflowAdoption(ro.at)));check(()=>a.deepEqual(new WorkflowAdoption(ro.at).holds(),[]));}finally{chmodSync(roDir,0o700);}
 check(()=>a(existsSync(join(ro.skillRoot,'v1','SKILL.md'))));
 symlinkSync(join(ro.at,'absent-hold-target'),join(roDir,'recovery-hold.json'));check(()=>a.doesNotThrow(()=>new WorkflowAdoption(ro.at))); // stale hold entry: the marker write hits EEXIST
 const unlisted=join(ro.at,'workflow-adoptions');chmodSync(unlisted,0o000);try{check(()=>a.doesNotThrow(()=>new WorkflowAdoption(ro.at)));check(()=>a.deepEqual(new WorkflowAdoption(ro.at).holds(),[]));}finally{chmodSync(unlisted,0o700);}
 writeFileSync(join(hostile.at,'workflow-adoptions',hostile.txn,'recovery-hold.json'),'not json');check(()=>a.deepEqual(new WorkflowAdoption(hostile.at).holds().map(x=>x.reason),['Unreadable recovery hold record']));

 const extra=partial('extra-dir');mkdirSync(join(extra.skillRoot,'v1','extra-empty'));const extraRecovery=new WorkflowAdoption(extra.at);
 check(()=>a(existsSync(join(extra.skillRoot,'v1','extra-empty'))));check(()=>a.equal(extraRecovery.holds().length,1)); // only verified files are unlinked; rmdir refuses what remains

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
 // published, but the complete marker and staging cleanup cannot be written: adoption reports success, nothing is held, a later recovery finishes the marker
 const markAt=join(dir,'marker-fail'),markDefs=new WorkflowDefs(markAt,()=>[]);let markStage='',marked:any=null;
 try{marked=new WorkflowAdoption(markAt,p=>{if(p==='published'){markStage=join(markAt,'workflow-adoptions',readdirSync(join(markAt,'workflow-adoptions')).filter(n=>n.startsWith('import-'))[0]);chmodSync(markStage,0o500);}}).adopt(fixture(),'pkg-'+'e'.repeat(24),markDefs,caps);check(()=>a.deepEqual(new WorkflowAdoption(markAt).holds(),[]));}finally{if(markStage)chmodSync(markStage,0o700);}
 check(()=>a.equal(markDefs.versions(marked.workflow).length,1));new WorkflowAdoption(markAt);check(()=>a.deepEqual(readdirSync(markStage).sort(),['complete','journal.json','source.zip']));
 const skillStage=join(skillDest,'workflow-adoptions',readdirSync(join(skillDest,'workflow-adoptions')).filter(n=>n.startsWith('import-'))[0]);check(()=>a.deepEqual(readdirSync(skillStage).sort(),['complete','journal.json','source.zip'])); // skill-* and out staging removed after completion
 const stale=join(markAt,'workflow-adoptions','import-'+'f'.repeat(24));mkdirSync(join(stale,'skill-0'),{recursive:true});writeFileSync(join(stale,'skill-0','SKILL.md'),'x');new WorkflowAdoption(markAt);check(()=>a(!existsSync(stale))); // journal-less staging is cleaned
 const xd=join(dir,'exdev');check(()=>a.throws(()=>new WorkflowAdoption(xd,p=>{if(p.startsWith('rename:'))throw Object.assign(Error('cross-device link not permitted'),{code:'EXDEV'});}).adopt(fixture(),'pkg-'+'f'.repeat(24),new WorkflowDefs(xd,()=>[]),caps),/same filesystem as the data folder/));check(()=>a.deepEqual(new WorkflowDefs(xd,()=>[]).ids(),[]));
 check(()=>a.deepEqual(new WorkflowAdoption(ro.at).holds().map(x=>[x.txn,x.reason]),[[ro.txn,'Unreadable recovery hold record']])); // a dangling hold symlink is still a hold
 const locked=partial('locked-target'),lockedDir=join(locked.skillRoot,'v1');chmodSync(lockedDir,0o000);try{new WorkflowAdoption(locked.at);}finally{chmodSync(lockedDir,0o700);}
 const lockedReason=new WorkflowAdoption(locked.at).holds()[0]?.reason??'';check(()=>a(/EACCES/.test(lockedReason)&&!lockedReason.includes(locked.at),lockedReason)); // hold text names the cause without the absolute data path
 const dc=join(dir,'draft-corrupt'),dcDefs=new WorkflowDefs(dc,()=>[]),dcDrafts=new WorkflowDrafts(dc,dcDefs),bad=join(dc,'workflows','imp-'+'9'.repeat(24));mkdirSync(bad,{recursive:true});writeFileSync(join(bad,'v1.json'),'{"id":');
 const dcDraft=dcDrafts.draft(structuredClone(WORKFLOW_DRAFT_EXAMPLE),'test-turn',[]);check(()=>a.equal(dcDefs.versions(dcDrafts.save(dcDraft.id,'captain',dcDraft.revision).workflow).length,1)); // one unreadable imp-* folder does not block saving a draft
 // the complete marker could not be written; later recoveries must never delete a finished adoption or hold it over local edits
 const finished=(name:string)=>{const at=join(dir,name),fdefs=new WorkflowDefs(at,()=>[]);let stage='';const out=new WorkflowAdoption(at,p=>{if(p==='published'){stage=join(at,'workflow-adoptions',readdirSync(join(at,'workflow-adoptions')).filter(n=>n.startsWith('import-'))[0]);chmodSync(stage,0o500);}}).adopt(withSkill,'pkg-'+'e'.repeat(24),fdefs,caps);chmodSync(stage,0o700);check(()=>a(!existsSync(join(stage,'complete'))));return {at,stage,out,skill:join(at,JSON.parse(readFileSync(join(stage,'journal.json'),'utf8')).plan.roots[0]),workflow:join(at,'workflows',out.workflow,'v1.json')};};
 const edited=finished('finished-edited');writeFileSync(join(edited.skill,'index.json'),'[]');new WorkflowAdoption(edited.at);
 check(()=>a.deepEqual(new WorkflowAdoption(edited.at).holds(),[]));check(()=>a(existsSync(join(edited.skill,'v1','SKILL.md'))&&existsSync(edited.workflow)));check(()=>a(existsSync(join(edited.stage,'complete'))));
 const handRemoved=finished('finished-hand-removed');rmSync(handRemoved.skill,{recursive:true});new WorkflowAdoption(handRemoved.at);
 check(()=>a(existsSync(handRemoved.workflow)));check(()=>a.deepEqual(new WorkflowAdoption(handRemoved.at).holds(),[]));check(()=>a(!existsSync(join(handRemoved.stage,'rolled-back'))));
 const trashed=join(dc,'workflows',dcDefs.ids().find(w=>!w.startsWith('imp-'))!);writeFileSync(join(trashed,'trash.json'),'{"schema":9}');
 const dcDraft2=dcDrafts.draft(structuredClone(WORKFLOW_DRAFT_EXAMPLE),'test-turn-2',[]);check(()=>a.equal(dcDefs.versions(dcDrafts.save(dcDraft2.id,'captain',dcDraft2.revision).workflow).length,1)); // an invalid trash.json in an unrelated workflow does not block saving a draft
 const lockAt=join(dir,'lock-held'),lockDir=join(lockAt,'workflow-adoptions','.lock-adopt');let lockedDuring=false;new WorkflowAdoption(lockAt,p=>{if(p==='journal')lockedDuring=existsSync(lockDir);}).adopt(fixture(),'pkg-'+'e'.repeat(24),new WorkflowDefs(lockAt,()=>[]),caps);
 check(()=>a(lockedDuring&&!existsSync(lockDir))); // adoption runs under the per-data-folder adoption lock and releases it
 const draftCopy=sourceDefs.copyTemplate(persisted.workflow,1,'draft-copy','Draft copy',false,'captain');
 check(()=>a.equal(draftCopy.origin?.source,'firstmate-draft'));
 check(()=>a.equal(draftCopy.origin?.draft,undefined));

 // a second process on the same data folder: the adoption lock belongs to a live process, not to whoever finds it older than 10 s
 const until=async(f:()=>boolean,what:string)=>{const t=Date.now();while(!f()){if(Date.now()-t>30_000)throw Error('timed out waiting for '+what);await Bun.sleep(20);}};
 const holdCode=`import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {WorkflowAdoption} from ${JSON.stringify(join(import.meta.dir,'../src/workflow-package-adoption.ts'))};import {WorkflowDefs} from ${JSON.stringify(join(import.meta.dir,'../src/runtime/defs.ts'))};const [data,archive,ready,go]=process.argv.slice(1);let paused=false;const out=new WorkflowAdoption(data,p=>{if(!paused&&p.startsWith('publish:skills/')){paused=true;writeFileSync(ready,'');while(!existsSync(go))Bun.sleepSync(20);}}).adopt(readFileSync(archive),'pkg-'+'1'.repeat(24),new WorkflowDefs(data,()=>[]),{ready:true,accept:true});console.log(JSON.stringify(out));`;
 const hold=async(name:string)=>{const at=join(dir,name),ready=join(dir,name+'.ready'),go=join(dir,name+'.go'),child=Bun.spawn(['bun','--no-env-file','-e',holdCode,at,archivePath,ready,go],{stdout:'pipe',stderr:'pipe'});await until(()=>existsSync(ready),name+' to pause after publishing its skill');const adoptions=join(at,'workflow-adoptions'),txn=readdirSync(adoptions).find(n=>n.startsWith('import-'))!;return {at,go,child,lock:join(adoptions,'.lock-adopt'),stage:join(adoptions,txn),skill:join(at,JSON.parse(readFileSync(join(adoptions,txn,'journal.json'),'utf8')).plan.roots[0],'v1','SKILL.md')};};
 const finish=async(h:{go:string,child:any})=>{writeFileSync(h.go,'');const code=await h.child.exited;return {code,stdout:await new Response(h.child.stdout).text(),stderr:await new Response(h.child.stderr).text()};};
 const pinsPresent=(at:string)=>new WorkflowDefs(at,()=>[]).ids().filter(w=>w.startsWith('imp-')).every(w=>new WorkflowDefs(at,()=>[]).versions(w)[0].nodes.flatMap(n=>n.skills??[]).every(s=>existsSync(join(at,'skills','_library',s.id,'v1','SKILL.md'))));
 const minuteAgo=()=>new Date(Date.now()-60_000);
 const live=await hold('live-recover');utimesSync(live.lock,minuteAgo(),minuteAgo());
 const bootAt=Date.now();new WorkflowAdoption(live.at);const bootMs=Date.now()-bootAt;
 check(()=>a(existsSync(live.skill)&&existsSync(live.lock)&&!existsSync(join(live.stage,'rolled-back')))); // recovery in another process leaves the live transaction alone
 check(()=>a(bootMs<2000,`boot waited ${bootMs} ms`));
 const liveDone=await finish(live);check(()=>a.equal(liveDone.code,0,liveDone.stderr));check(()=>a(new WorkflowDefs(live.at,()=>[]).ids().length===1&&pinsPresent(live.at)));check(()=>a(!existsSync(live.lock)));

 const busy=await hold('boot-busy'),leftover=join(busy.at,'workflow-adoptions','import-'+'0'.repeat(24));mkdirSync(leftover);
 const busyAt=Date.now();new WorkflowAdoption(busy.at);const busyMs=Date.now()-busyAt;
 check(()=>a(busyMs<2000,`boot waited ${busyMs} ms for a live lock`));check(()=>a(existsSync(leftover))); // boot tries the lock once and leaves recovery for later
 const busyDone=await finish(busy);check(()=>a.equal(busyDone.code,0,busyDone.stderr));
 const busyDefs=new WorkflowDefs(busy.at,()=>[]);new WorkflowAdoption(busy.at).adopt(fixture(),'pkg-'+'2'.repeat(24),busyDefs,caps);check(()=>a(!existsSync(leftover))); // the next adoption runs the deferred recovery

 const contended=await hold('contender-adopt'),plainPath=join(dir,'plain-fixture.zip');writeFileSync(plainPath,fixture());utimesSync(contended.lock,minuteAgo(),minuteAgo());
 const contenderCode=`import {readFileSync} from 'node:fs';import {WorkflowAdoption} from ${JSON.stringify(join(import.meta.dir,'../src/workflow-package-adoption.ts'))};import {WorkflowDefs} from ${JSON.stringify(join(import.meta.dir,'../src/runtime/defs.ts'))};const [data,archive]=process.argv.slice(1);console.log(JSON.stringify(new WorkflowAdoption(data).adopt(readFileSync(archive),'pkg-'+'3'.repeat(24),new WorkflowDefs(data,()=>[]),{ready:true,accept:true})));`;
 const contender=Bun.spawn(['bun','--no-env-file','-e',contenderCode,contended.at,plainPath],{stdout:'pipe',stderr:'pipe'});await Bun.sleep(1500);
 check(()=>a(existsSync(contended.skill)&&!existsSync(join(contended.stage,'rolled-back'))));check(()=>a.equal(JSON.parse(readFileSync(join(contended.lock,'owner.json'),'utf8')).pid,contended.child.pid));
 const heldDone=await finish(contended),contenderCodeExit=await contender.exited,contenderErr=await new Response(contender.stderr).text();
 check(()=>a.equal(heldDone.code,0,heldDone.stderr));check(()=>a.equal(contenderCodeExit,0,contenderErr));
 check(()=>a(new WorkflowDefs(contended.at,()=>[]).ids().length===2&&pinsPresent(contended.at))); // the contender waited, then adopted its own package

 const stolen=await hold('stolen-lock');unlinkSync(join(stolen.lock,'owner.json'));writeFileSync(join(stolen.lock,'owner.json'),JSON.stringify({pid:process.pid,boot:'another-boot',token:'another-owner'}));
 const stolenDone=await finish(stolen);check(()=>a(stolenDone.code!==0&&/lost the lock/.test(stolenDone.stderr),stolenDone.stderr));
 check(()=>a.equal(JSON.parse(readFileSync(join(stolen.lock,'owner.json'),'utf8')).token,'another-owner')); // the old owner's finally leaves a lock it no longer owns
 check(()=>a.deepEqual(new WorkflowDefs(stolen.at,()=>[]).ids(),[])); // and it stops before publishing the workflow
 check(()=>a(existsSync(stolen.skill)&&!existsSync(join(stolen.stage,'rolled-back')))); // without the lock it does not settle its own transaction either
 new WorkflowAdoption(stolen.at);check(()=>a(!existsSync(stolen.lock)&&existsSync(join(stolen.stage,'rolled-back'))&&!existsSync(stolen.skill))); // same pid, another boot: that owner is gone

 const abandonedLock=await hold('stale-owner');utimesSync(abandonedLock.lock,0,0);new WorkflowAdoption(abandonedLock.at); // a live owner silent far past the refresh window is broken as a last resort
 const abandonedDone=await finish(abandonedLock);check(()=>a(abandonedDone.code!==0&&/lost the lock/.test(abandonedDone.stderr),abandonedDone.stderr));
 check(()=>a.deepEqual(new WorkflowDefs(abandonedLock.at,()=>[]).ids(),[]));check(()=>a(existsSync(join(abandonedLock.stage,'rolled-back'))));

 const deadAt=join(dir,'dead-owner'),dead=Bun.spawnSync(['bun','--no-env-file','-e',childCode,deadAt,archivePath,String(points.findIndex(p=>p.startsWith('publish:')))],{stdout:'pipe',stderr:'pipe'});check(()=>a.equal(dead.exitCode,73));
 const deadTxn=readdirSync(join(deadAt,'workflow-adoptions')).find(n=>n.startsWith('import-'))!;new WorkflowAdoption(deadAt);check(()=>a(existsSync(join(deadAt,'workflow-adoptions',deadTxn,'rolled-back')))); // a fresh lock whose owner process exited is taken at once

 const v1Changed=finished('finished-v1-changed');writeFileSync(v1Changed.workflow,'{"tampered":true}');const v1Recovery=new WorkflowAdoption(v1Changed.at);
 check(()=>a(!existsSync(join(v1Changed.stage,'complete'))));check(()=>a.match(v1Recovery.holds()[0]?.reason??'',/Changed adoption bytes/));check(()=>a(existsSync(join(v1Changed.skill,'v1','SKILL.md')))); // the owner file alone does not prove publication

 const copied=finished('finished-copied');new WorkflowDefs(copied.at,()=>[]).copyTemplate(copied.out.workflow,1,'copied-import','Copied import',false,'captain');rmSync(join(copied.at,'workflows',copied.out.workflow),{recursive:true});new WorkflowAdoption(copied.at);
 check(()=>a(existsSync(join(copied.skill,'v1','SKILL.md'))&&!existsSync(join(copied.stage,'rolled-back'))));check(()=>a.deepEqual(new WorkflowAdoption(copied.at).holds(),[])); // a template copy still pins the imported skills
 console.log(`${count} profile assertions passed`);
}finally{rmSync(dir,{recursive:true,force:true});}
