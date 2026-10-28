// How independent a second agent is from the first (docs/architecture.md, "Adaptive staffing"). Studio asks for a different
// vendor or model where the machine has one; where it has only one vendor, or one model, it never forces an opposite agent:
// the work runs on what is usable, and the weaker independence is said on the card and recorded in the ledger.
// "Usable" is what the provider facts say now (signed in, not out of quota, the model verified or verifiable), never config alone.
import type {StaffingFacts} from '../firstmate-staffing';

export type Member={provider:string;model:string|null};
/** A model on this machine: verified (or verifiable by Studio itself), runnable now or held with its reason. A held model
 *  still counts for every independence rule: a vendor out of quota or with stale facts is waited for, never worked around. */
export type Usable={provider:string;model:string;efforts:string[];verified:boolean;runnable:boolean;held?:string;isDefault?:boolean};
export type Level='vendor'|'model'|'same';
const RANK:Record<Level,number>={same:0,model:1,vendor:2};
/** a model left to the vendor's default is unknown: on the same vendor it may be the other one's, so it counts as the same */
export const levelOf=(a:Member,b:Member):Level=>a.provider!==b.provider?'vendor':!a.model||!b.model||a.model===b.model?'same':'model';
/** the weakest level against every member of a group (a tutor against every node that wrote the change) */
export const levelAgainst=(c:Member,group:Member[]):Level=>group.reduce<Level>((l,m)=>{const n=levelOf(c,m);return RANK[n]<RANK[l]?n:l;},'vendor');
export const atLeast=(l:Level,need:Level)=>RANK[l]>=RANK[need];
/** The models on this machine, from the provider facts: every vendor that is installed and signed in (out of quota still counts
 *  as signed in), each model it verified or offers for a verification Studio runs itself (a signed-in Claude's candidates).
 *  runnable: fresh facts and quota available (Claude: unknown quota is its normal state, admitted by its execution receipt);
 *  otherwise held, with why. Only a vendor that is not here at all (not installed, not signed in) lets a rule relax. */
export function usableModels(facts:StaffingFacts[],now=Date.now()):Usable[]{
 const out:Usable[]=[];
 for(const f of facts){if(f.support!=='supported')continue;
  const signedIn=f.auth==='verified'||f.login==='logged-in';if(!signedIn)continue;
  const held=f.quota==='exhausted'?`${f.provider} is out of quota`:f.quota!=='available'&&!(f.provider==='claude'&&f.quota==='unknown')?`${f.provider}'s quota could not be read`:f.expires<=now?`${f.provider}'s facts expired`:undefined;
  const add=(m:{id:string;efforts?:string[]},verified:boolean)=>{if(m?.id&&!out.some(u=>u.provider===f.provider&&u.model===m.id))out.push({provider:f.provider,model:m.id,efforts:m.efforts??[],verified,runnable:!held,...held?{held}:{},...f.default?.model===m.id?{isDefault:true}:{}});};
  for(const m of f.models??[])add(m,true);
  if(f.provider==='claude'||f.provider==='cursor')for(const m of f.candidates??[])add(m,false);}
 return out;}
/** The best independence the machine can give: two usable vendors, else two models of the one vendor, else the same model. */
export function reachable(usable:Usable[]):Level{const vendors=new Set(usable.map(u=>u.provider));if(vendors.size>=2)return'vendor';return new Set(usable.map(u=>`${u.provider}/${u.model}`)).size>=2?'model':'same';}
/** The level a rule asks for, relaxed to what the machine can reach. Unknown usable models (no facts): never relaxed. */
export const required=(need:Level,usable:Usable[]|null):Level=>!usable?need:RANK[reachable(usable)]<RANK[need]?reachable(usable):need;
/** The candidate with the best level against the group; the earliest wins a tie (the approved member first). */
export function bestOf<T extends Member>(candidates:T[],group:Member[]):{pick:T;level:Level}|null{
 let best:{pick:T;level:Level}|null=null;for(const c of candidates){const level=levelAgainst(c,group);if(!best||RANK[level]>RANK[best.level])best={pick:c,level};}return best;}
export const LEVEL_TEXT:Record<Level,{en:string;zh:string}>={
 vendor:{en:'Different vendor from the author',zh:'和作者不同供應商'},
 model:{en:'Same vendor as the author, different model',zh:'和作者同一個供應商、不同模型'},
 same:{en:'Same model as the author: a fresh context, not an independent opinion',zh:'和作者同一個模型：是新的脈絡，不是獨立意見'}};
/** why a degraded level was allowed: what the machine has */
export function degradedWhy(usable:Usable[]|null):{en:string;zh:string}{
 if(!usable)return{en:'',zh:''};const vendors=[...new Set(usable.map(u=>u.provider))];
 return reachable(usable)==='same'?{en:` Only one model is usable on this machine (${usable[0]?`${usable[0].provider} ${usable[0].model}`:'none'}).`,zh:`這台機器只有一個可用的模型（${usable[0]?`${usable[0].provider} ${usable[0].model}`:'無'}）。`}
  :vendors.length===1?{en:` Only one vendor is usable on this machine (${vendors[0]}).`,zh:`這台機器只有一個可用的供應商（${vendors[0]}）。`}:{en:'',zh:''};}
/** the effort a model runs at when Studio picks it itself: the vendor's default where it has one, else medium (a judge's floor) */
export function defaultEffort(u:Pick<Usable,'provider'|'efforts'>):string|null{if(u.provider==='claude'||u.provider==='cursor'||!u.efforts.length)return null;return u.efforts.includes('medium')?'medium':u.efforts.includes('high')?'high':u.efforts[0];}
/** A card body with an independence note added (the merge card of a Task whose reviewer ran on the worker's own model): the
 *  note goes into both languages' why and the plain body, and the level is kept for the card's view. */
export function withNote<B extends Record<string,any>>(body:B,note:{level?:string;en:string;zh:string}):B{
 const b:any=body;return{...b,...b.en?{en:{...b.en,why:`${b.en.why??''} ${note.en}`.trim()}}:{},...b.zh?{zh:{...b.zh,why:`${b.zh.why??''}${note.zh}`}}:{},body:[b.body??'','',`${note.en} / ${note.zh}`].join('\n').trim(),independence:{level:note.level??'same',en:note.en,zh:note.zh}};}
