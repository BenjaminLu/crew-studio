import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {StaffingStore,nativeStaffingSkillRef,coffeeStaffingProject,staffingHash} from '../src/domain/staffing';
if(process.env.COFFEE_STAFFING_CONTROL_MODULE){
 const {harness,Y}=await import('./rt-harness');const {installStaffingGuard}=await import(process.env.COFFEE_STAFFING_CONTROL_MODULE);
 const h=await harness([Y({id:'coffee-kit',name:'Historical admission control',kind:'coffee-kit',version:1,roles:[],nodes:[{id:'direction',kind:'card',label:'Captain direction',x:1,y:1,card:{options:[{id:'confirm',label:'Confirm'}]}}],edges:[]})]);
 let refused=false;try{installStaffingGuard(h.engine,new StaffingStore(h.data),()=>({namespace:'artifact',id:'control',identity:'control'}));try{h.engine.start({workflow:'coffee-kit',params:{project:'control'}});}catch{refused=true;}console.log(`Actual missing-staffing boundary: refused=${refused}, allocated=${h.engine.list().length}`);if(!refused||h.engine.list().length)process.exitCode=1;}finally{for(const r of h.engine.list())await h.engine.cancel(r.id,'historical control cleanup');h.stop();rmSync(h.data,{recursive:true,force:true});}process.exit(process.exitCode??0);
}
let count=0;const ok=(name:string,f:()=>void)=>{f();count++;console.log('PASS '+name)};
const data=mkdtempSync(join(tmpdir(),'coffee-staffing-'));
try {
 const store=new StaffingStore(data),project=coffeeStaffingProject('captain-coffee');
 ok('explicit artifact project has separate stable identity',()=>{assert.equal(project.namespace,'artifact');assert.deepEqual(project,coffeeStaffingProject(project.id));assert.notEqual(staffingHash(project),staffingHash({...project,namespace:'git'}));assert.notDeepEqual(project,coffeeStaffingProject('other'));});
 ok('missing or filesystem-shaped project names refuse',()=>{for(const value of ['',undefined,'../repo','a/b'])assert.throws(()=>coffeeStaffingProject(value as any));});
 const roles:any={};
 for(const role of ['worker','image-worker','reviewer','designer']) {
  const ref=nativeStaffingSkillRef(role,'coffee-kit'),body=readFileSync(join(import.meta.dir,'..','packs',ref.slice(5)),'utf8'),skill=store.remember({ref,version:1,text:body});
  roles[role]={provider:'codex',model:'fixture-model',effort:'low',skill};
  ok(`${role} pins actual specialized source body`,()=>{assert.equal(skill.sha256,createHash('sha256').update(body).digest('hex'));assert(body.length>1000);assert.equal(store.skill(skill),body);assert(ref.startsWith('pack:coffee-kit/skills/'));});
 }
 const config=store.approve({schema:1,algorithm:'sha256-canonical-v1',project,workflow:{id:'coffee-kit',version:1,sha256:staffingHash({fixture:true})},roles,review:{freshContexts:3,distinctProviders:false}},null,{run:'fixture',card:'fixture-card',answerSeq:1});
 ok('all role skill snapshots survive a fresh store read',()=>{const reload=new StaffingStore(data),current=reload.current(project);assert.equal(current.hash,config.hash);for(const role of Object.keys(roles))assert.equal(reload.skill(current.roles[role].skill,project),store.skill(roles[role].skill));});
 ok('historical code role sources remain unchanged',()=>assert.equal(nativeStaffingSkillRef('worker'),'pack:firstmate/skills/worker.md'));
 ok('unknown workflow/role never invents skill policy',()=>{assert.throws(()=>nativeStaffingSkillRef('worker','unknown'));assert.throws(()=>nativeStaffingSkillRef('video-renderer','coffee-kit'));});
 console.log(`${count}/0; source profiles/storage only; runtime coffee admission integration pending`);
} finally {rmSync(data,{recursive:true,force:true});}
// Real Engine.start, including callers that bypass HTTP, must enforce the same source guard.
{
 const {harness,Y}=await import('./rt-harness');
 const {installStaffingGuard}=await import('../src/domain/staffing');
 const def={id:'coffee-kit',name:'Coffee admission fixture',kind:'coffee-kit',version:1,roles:[{id:'worker',label:'Website',skill:nativeStaffingSkillRef('worker','coffee-kit')}],nodes:[{id:'direction',kind:'card',label:'Captain direction',x:1,y:1,card:{options:[{id:'confirm',label:'Confirm'}]}}],edges:[]};
 const h=await harness([Y(def)]),engine=h.engine,store=new StaffingStore(h.data),project=coffeeStaffingProject('explicit-project');
 try {
  installStaffingGuard(engine,store,()=>{throw new Error('Coffee must not borrow Git identity');});
  ok('actual direct Engine start refuses missing staffing before allocation',()=>{assert.throws(()=>engine.start({workflow:def.id,params:{project:project.id}}));assert.equal(engine.list().length,0);});
  const skill=store.remember({ref:def.roles[0].skill,version:1,text:engine.deps.skillText(def.roles[0].skill)}),installed=h.defs.get(def.id)!;
  const config=store.approve({schema:1,algorithm:'sha256-canonical-v1',project,workflow:{id:def.id,version:installed.version,sha256:staffingHash(installed)},roles:{worker:{provider:'codex',model:'fixture-model',effort:'low',skill}},review:{freshContexts:3,distinctProviders:false}},null,{run:'fixture',card:'fixture-card',answerSeq:1});
  const run=engine.start({workflow:def.id,params:{project:project.id,_staffing:config.hash}});
  ok('actual start binds captain config before first node',()=>{const trust=engine.trusted(run.id);assert(trust.ok);assert(trust.entries.some(e=>e.record==='staffing-start'&&e.data?.config===config.hash));assert.deepEqual(engine.deps.approvedPick!(run,installed.nodes[0],'worker'),{provider:'codex',model:'fixture-model',effort:'low'});});
  ok('actual source snapshot is delivered by approvedSkill',()=>assert.equal(engine.deps.approvedSkill!(run,'worker'),store.skill(skill,project)));
  ok('wrong config digest cannot allocate another Task',()=>{assert.throws(()=>engine.start({workflow:def.id,params:{project:project.id,_staffing:'a'.repeat(64)}}));assert.equal(engine.list().length,1);});
  await engine.cancel(run.id,'fixture cleanup');
 } finally {h.stop();rmSync(h.data,{recursive:true,force:true});}
 console.log(`${count}/0 coffee source-profile and actual admission assertions`);
}
// Coffee-specific native discussion uses the real persisted interview and captain card.
{
 const {harness,until}=await import('./rt-harness');const {bundledText}=await import('../src/bundled');
 const {installFirstmateStaffing}=await import('../src/firstmate-staffing');const {skillTextFor}=await import('../src/runtime');
 const h=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!,bundledText('workflows/v2/firstmate-staffing.wf.yaml')!]);
 try {
  h.engine.deps.skillText=skillTextFor(join(h.data,'protected'));const store=new StaffingStore(h.data),def=h.defs.get('coffee-kit')!,project=coffeeStaffingProject('discussed-coffee');
  const tools=installFirstmateStaffing(h.engine,store,()=>{throw new Error('Artifact staffing must not infer a Git project');},async()=>[{provider:'codex',support:'supported',auth:'verified',quota:'available',expires:Date.now()+60000,models:[{id:'fixture-model',efforts:['low']}]}]);
  const owner=(key:string)=>({key,captain:true,text:'Explicit offline captain answer '+key,live:()=>true,signal:new AbortController().signal});
  const target={project:project.id,workflow:def.id,version:def.version};let interview:any=await tools.call('studio_staffing_interview',target,owner('read'));
  ok('coffee interview exposes four actual specialized profiles before choices',()=>{assert.equal(interview.skills.length,4);for(const role of def.roles){const skill=interview.skills.find((s:any)=>s.role===role.id);assert.equal(skill.ref,role.skill);assert.equal(skill.sha256,createHash('sha256').update(skill.text).digest('hex'));}assert(interview.frontier.every((q:any)=>q.field==='provider'));});
  const picks=Object.fromEntries(def.roles.map(r=>[r.id,{provider:'codex',model:'fixture-model',effort:'low'}]));
  await assert.rejects(tools.call('studio_propose_staffing',{...target,roles:picks},owner('premature')));
  ok('coffee role recommendations cannot substitute for explicit answers',()=>assert.equal(h.engine.list().length,0));
  for(const [field,value]of [['provider','codex'],['model','fixture-model'],['effort','low']])interview=await tools.call('studio_staffing_interview',{...target,answers:Object.fromEntries(def.roles.map(r=>[r.id,{[field]:value}]))},owner(field));
  ok('dependent coffee role rounds persist without starting paid work',()=>{assert(interview.complete);assert.equal(h.engine.list().length,0);});
  const proposal:any=await tools.call('studio_propose_staffing',{...target,roles:picks},owner('propose'));
  assert(await until(()=>h.engine.cards.list({run:proposal.proposal,open:true}).length===1));const card=h.engine.cards.list({run:proposal.proposal,open:true})[0];
  ok('actual captain card displays each coffee role model and skill digest',()=>{assert(card.captainOnly);for(const role of def.roles)assert(card.body.includes(role.skill));assert(card.body.includes('fixture-model'));assert.throws(()=>store.current(project));});
  await h.engine.answer(card.id,{choice:'approve',by:'offline captain'});assert(await until(()=>h.engine.get(proposal.proposal)?.status==='succeeded'));
  ok('only real card answer writes versioned coffee project config without dispatch',()=>{const config=store.current(project);assert.equal(config.approval.card,card.id);assert.equal(config.workflow.sha256,staffingHash(def));assert.equal(Object.keys(config.roles).length,4);assert.equal(h.engine.list().length,1);assert.equal(h.engine.list()[0].workflow,'firstmate-staffing');});
 }finally{for(const r of h.engine.list())if(!['succeeded','failed','cancelled'].includes(r.status))await h.engine.cancel(r.id,'fixture cleanup');h.stop();rmSync(h.data,{recursive:true,force:true});}
 console.log(`${count}/0 coffee profile/admission/native interview assertions`);
}
