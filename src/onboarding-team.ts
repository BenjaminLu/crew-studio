// Desktop-owned inline team settings. Inventory is never execution evidence.
import {randomBytes} from 'node:crypto';
import {CrewStore,BUILTIN_SEATS,emptyTeam,teamBody,type Team} from './domain/crew';
import {staffingHash} from './domain/staffing';
import {staffingQuotaReady,judgeEffort,type StaffingFacts,type StaffingAdmission} from './firstmate-staffing';
export type TeamPick={provider:'codex'|'claude'|'cursor';model:string;effort:string|null};
export type TeamProbe={id:string;requested:TeamPick;toolVerified:boolean;executionMode:string;context:string};
type Plan={id:string;expected:string|null;team:Team;hash:string;pick:TeamPick;receipt:TeamProbe;expires:number};
export class OnboardingTeam{
 private plans=new Map<string,Plan>();private flight=false;private controller:AbortController|null=null;
 constructor(private d:{store:CrewStore;admission?:StaffingAdmission;facts:(fresh?:boolean)=>Promise<StaffingFacts[]>;preferred:()=>string|null;verify:(pick:TeamPick,signal?:AbortSignal)=>Promise<TeamProbe>;context:(pick:TeamPick)=>string;now?:()=>number}){}
 private now(){return this.d.now?.()??Date.now();}
 private current(){const c=this.d.store.current();return{expected:c?.hash??null,team:c?teamBody(c):emptyTeam()};}
 private rows(team:Team){return BUILTIN_SEATS.map(seat=>({seat,...team.members[seat],assigned:!!team.members[seat]}));}
 async view(){const c=this.current(),facts=await this.d.facts();return{expected:c.expected,complete:BUILTIN_SEATS.every(s=>!!c.team.members[s]),roles:this.rows(c.team),provider:this.d.preferred(),capabilities:facts.map(f=>({provider:f.provider,support:f.support,auth:f.auth,quota:f.quota,expires:f.expires,reason:f.reason,models:f.models,default:f.default,setupPick:this.pick(f),setupReady:this.available(f,this.pick(f)??undefined)&&!!this.pick(f)})),review:'same-model-fresh-context',specialists:'Separate capabilities remain unverified until their adapters check them.'};}
 private pick(f:StaffingFacts){const model=f.models.find(m=>m.id===f.default?.model);if(!model)return null;const reviewed=judgeEffort('low',model.efforts);const effort=reviewed!==null&&['medium','high','xhigh'].includes(reviewed)&&model.efforts.includes(reviewed)?reviewed:(f.provider==='claude'||f.provider==='cursor')&&f.default?.effort===null&&!model.efforts.length?null:undefined;return effort===undefined?null:{provider:f.provider as TeamPick['provider'],model:model.id,effort};}
 private available(f:StaffingFacts|undefined,pick?:TeamPick){return !!f&&f.support==='supported'&&f.auth==='verified'&&(f.quota==='available'||!!pick&&staffingQuotaReady(pick,f,this.d.admission))&&Number.isFinite(f.expires)&&f.expires>this.now()&&f.expires<=this.now()+300000&&(!pick||f.models.some(m=>m.id===pick.model&&(pick.effort===null?f.provider==='claude'||f.provider==='cursor':m.efforts.includes(pick.effort))));}
 async verify(body:any,signal?:AbortSignal){
  if(!body||Object.keys(body).some(k=>!['expected','confirm'].includes(k))||body.confirm!==true)throw new Error('Confirm the bounded team check first');
  if(this.flight)throw new Error('A team check is already running');this.flight=true;
  const controller=new AbortController();this.controller=controller;const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
  try{
   if(controller.signal.aborted)throw new Error("Team check cancelled");
   const current=this.current();if((body.expected??null)!==current.expected)throw new Error('Team changed; reload settings');
   const provider=this.d.preferred(),facts=await this.d.facts(true),cap=facts.find(f=>f.provider===provider);
   if(this.d.preferred()!==provider)throw new Error('Selected provider changed; check again');
   const pick=cap?this.pick(cap):null;
   if(!pick||!this.available(cap,pick))throw new Error('The chosen provider is not available. Sign in or wait for quota; no provider was changed.');
   if(!['codex','claude','cursor'].includes(pick.provider))throw new Error('Unsupported selected provider');
   const receipt=await this.d.verify(pick,controller.signal);
   if(this.d.preferred()!==provider||controller.signal.aborted||!receipt?.id||!receipt.toolVerified||receipt.executionMode!=='sandboxed'||receipt.context!==this.d.context(pick)||staffingHash(receipt.requested)!==staffingHash(pick))throw new Error('Native tool execution was not verified; settings were not changed.');
   if(this.current().expected!==current.expected)throw new Error('Team changed during verification; reload settings');
   const team=structuredClone(current.team);for(const seat of BUILTIN_SEATS)if(!team.members[seat])team.members[seat]={...pick,skills:[]};
   const id=randomBytes(24).toString('hex'),plan:Plan={id,expected:current.expected,team,hash:staffingHash(team),pick,receipt,expires:this.now()+120000};
   for(const[k,p]of this.plans)if(p.expires<=this.now())this.plans.delete(k);if(this.plans.size>=8)this.plans.delete(this.plans.keys().next().value!);this.plans.set(id,plan);
   return{id,expected:plan.expected,expires:plan.expires,roles:this.rows(team),requested:pick,execution:{job:receipt.id,toolVerified:true,modelIdentity:'requested-isolated-profile'},review:'same-model-fresh-context',specialists:'Not checked by this native text-tool test.'};
  }finally{signal?.removeEventListener("abort",abort);if(this.controller===controller)this.controller=null;this.flight=false;}
 }
 async save(body:any){
  if(!body||Object.keys(body).some(k=>!['plan','expected'].includes(k)))throw new Error('Save only the reviewed team plan');
  const plan=this.plans.get(body.plan);if(!plan||plan.expires<=this.now()||(body.expected??null)!==plan.expected||this.current().expected!==plan.expected)throw new Error('Team check expired or settings changed; check again');
  if(this.d.preferred()!==plan.pick.provider||this.d.context(plan.pick)!==plan.receipt.context)throw new Error('Selected provider context changed; check again');
  const caps=await this.d.facts(true);if(!this.available(caps.find(c=>c.provider===plan.pick.provider),plan.pick))throw new Error('The checked provider is no longer available; check again');
  if(this.d.preferred()!==plan.pick.provider||this.plans.get(body.plan)!==plan||plan.expires<=this.now()||this.current().expected!==plan.expected||staffingHash(plan.team)!==plan.hash||this.d.context(plan.pick)!==plan.receipt.context)throw new Error('Team check changed; check again');
  const team=this.d.store.write(plan.team,plan.expected,{by:`captain onboarding verified ${plan.receipt.id}`,via:'page'});this.plans.delete(body.plan);return{team,complete:true};
 }
 cancel(){this.controller?.abort();this.plans.clear();return{cancelled:true};}
}
