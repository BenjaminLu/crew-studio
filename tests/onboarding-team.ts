import "./lib/isolated-env.mjs";
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {suite} from './rt-harness';import {CrewStore,emptyTeam} from '../src/domain/crew';
import {OnboardingTeam} from '../src/onboarding-team';
const {ok,end}=suite('onboarding-team');let now=Date.now(),calls=0;
const store=new CrewStore(mkdtempSync(join(tmpdir(),'crew-onboarding-team-')));
let caps:any[]=[{provider:'codex',support:'supported',auth:'verified',quota:'available',expires:now+30000,models:[{id:'actual-default',efforts:['low','medium']}],default:{model:'actual-default',effort:'low'}}];
let receipt=true,context='fixture-context';const setup=new OnboardingTeam({store,facts:async()=>caps,preferred:()=> 'codex',context:()=> context,now:()=>now,verify:async(p:any)=>{calls++;return{id:'probe-'+calls,requested:p,toolVerified:receipt,executionMode:'sandboxed',context};}});
const before=await setup.view();ok(!before.complete&&calls===0&&!store.current(),'GET inventory neither executes nor writes settings');
const plan=await setup.verify({expected:null,confirm:true});ok(calls===1&&!store.current()&&plan.roles.length===5,'verify prepares complete source-owned plan without saving or starting Task');
const written=await setup.save({plan:plan.id,expected:null});ok(written.team.version===1&&Object.keys(written.team.members).length===5,'one inline save writes one signed complete team version');
ok(Object.values(written.team.members).every((m:any)=>m.model==='actual-default'&&m.effort==='medium'),'all default seats use the exact verified pair, no invented reviewer model');
let rejected=false;try{await setup.save({plan:plan.id,expected:null});}catch{rejected=true;}ok(rejected,'consumed or stale plan cannot be replayed');
const old=store.current()!;const changed=emptyTeam();changed.members=old.members;changed.members.maker={...old.members.maker,model:'explicit-unavailable'};store.write(changed,old.hash,{by:'captain',via:'page'});
const kept=await setup.verify({expected:store.current()!.hash,confirm:true});ok(kept.roles.find((r:any)=>r.seat==='maker').model==='explicit-unavailable','explicit unavailable choice is preserved, not silently replaced');
const priorHash=store.current()!.hash;now+=130000;rejected=false;try{await setup.save({plan:kept.id,expected:priorHash});}catch{rejected=true;}ok(rejected&&store.current()!.hash===priorHash,'expired verification cannot change settings');
now=Date.now();caps[0].expires=now+30000;receipt=false;rejected=false;try{await setup.verify({expected:priorHash,confirm:true});}catch{rejected=true;}ok(rejected&&store.current()!.hash===priorHash,'inventory plus failed execution does not authorize defaults');
receipt=true;const fresh=await setup.verify({expected:priorHash,confirm:true});context='changed-binary';rejected=false;try{await setup.save({plan:fresh.id,expected:priorHash});}catch{rejected=true;}ok(rejected&&store.current()!.hash===priorHash,'changed executable/config context invalidates checked plan');context='fixture-context';
const cancelPlan=await setup.verify({expected:priorHash,confirm:true});setup.cancel();rejected=false;try{await setup.save({plan:cancelPlan.id,expected:priorHash});}catch{rejected=true;}ok(rejected,'cancelled plan cannot later save settings');
const aborted=new AbortController();aborted.abort();const beforeAbort=calls;rejected=false;try{await setup.verify({expected:priorHash,confirm:true},aborted.signal);}catch{rejected=true;}ok(rejected&&calls===beforeAbort,'cancel before verification never launches a provider job');
rejected=false;try{await setup.save({plan:'invented',expected:priorHash});}catch{rejected=true;}ok(rejected,'caller cannot invent a source-owned plan');
receipt=true;caps[0].quota='exhausted';const count=calls;rejected=false;try{await setup.verify({expected:priorHash,confirm:true});}catch{rejected=true;}ok(rejected&&calls===count,'exhausted chosen provider holds without paid probe or provider fallback');

const cs=new CrewStore(mkdtempSync(join(tmpdir(),'crew-onboarding-claude-')));let claudeCalls=0;
const cf:any={provider:'claude',support:'supported',auth:'verified',quota:'unknown',expires:now+30000,models:[{id:'configured-sonnet',efforts:[]}],default:{model:'configured-sonnet',effort:null}};
const claude=new OnboardingTeam({store:cs,facts:async()=>[cf],preferred:()=> 'claude',admission:()=>true,now:()=>now,context:()=>context,verify:async(p:any)=>{claudeCalls++;return{id:'claude-real-check',requested:p,toolVerified:true,executionMode:'sandboxed',context};}});
const cv=await claude.view();ok(cv.capabilities[0].setupReady&&cv.capabilities[0].setupPick?.effort===null,'Claude verified admission keeps unknown quota truthful and uses configured native default');
const cp=await claude.verify({expected:null,confirm:true});await claude.save({plan:cp.id,expected:null});ok(claudeCalls===1&&Object.values(cs.current()!.members).every(m=>m.provider==='claude'&&m.model==='configured-sonnet'&&m.effort===null),'Claude native default completes inline settings without vendor fallback');
const held=new OnboardingTeam({store:cs,facts:async()=>[cf],preferred:()=> 'claude',admission:()=>false,now:()=>now,context:()=>context,verify:async()=>{throw new Error('must not run');}});rejected=false;try{await held.verify({expected:cs.current()!.hash,confirm:true});}catch{rejected=true;}ok(rejected,'unknown Claude quota without exact native admission never runs a probe');

for(const step of ['facts','probe','save']){
 let preferred='codex',release:any,waiting:any;const ready=new Promise(r=>waiting=r);const gate=new Promise<void>(r=>release=r);let defer=false,ran=0;const rs=new CrewStore(mkdtempSync(join(tmpdir(),'crew-onboarding-race-')));caps[0].quota='available';caps[0].expires=now+30000;
 const race=new OnboardingTeam({store:rs,preferred:()=>preferred,context:()=>context,now:()=>now,facts:async()=>{if(defer&&step!=='probe'){waiting();await gate;}return caps;},verify:async(p:any)=>{ran++;if(defer&&step==='probe'){waiting();await gate;}return{id:'race-check',requested:p,toolVerified:true,executionMode:'sandboxed',context};}});
 let rp:any;if(step==='save')rp=await race.verify({expected:null,confirm:true});defer=true;const result=(step==='save'?race.save({plan:rp.id,expected:null}):race.verify({expected:null,confirm:true})).then(()=>false,()=>true);await ready;preferred='claude';release();ok(await result&&!rs.current()&&(step!=='facts'||ran===0),'provider switch during '+step+' rejects without saving or launching stale preflight');
}
end();
