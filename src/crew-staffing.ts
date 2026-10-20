// Staffed workflows (code, coffee-kit) on the Studio team: when the team fills every seat a workflow needs, the project's
// signed staffing version is derived from the team instead of asked for on a per-project card. The staffing guard keeps
// every check it had (role skill pins, node skill pins, definition hash, capability, CAS) and re-derives a crew-derived
// version from its own signed team version, refusing any difference (docs/design/crew-seats.md).
import {CrewStore,resolveCrew,teamBody,type TeamConfig,type Resolution} from './domain/crew';
import {StaffingStore,installStaffingGuard,staffingHash,skillPartPins,staffingSkillRef,type StaffingDraft,type StaffingProject,type StaffingConfig,type StaffingNode,type StaffingRole} from './domain/staffing';
import type {Engine} from './runtime/engine';

const ROLE_NODE='role--';
/** The definition with one virtual agent node per role: a role's own pick is what the team gives its seat (rules applied),
 *  whether or not an agent node of that role exists (coffee-kit's reviewer and designer judge from hooks). */
export function withRoleNodes(def:any){return{...def,nodes:[...def.nodes,...def.roles.map((r:any)=>({id:ROLE_NODE+r.id,kind:'agent',label:r.label,role:r.id,mode:'role'}))]};}
export type CrewDraft={draft:StaffingDraft;resolution:Resolution;sources:Record<string,string>}|{missing:string[];resolution:Resolution};
/** The staffing a team gives a staffed workflow for one project (its project layer included). pins: a role's skill pins and source text (the live role text). */
export function crewStaffingDraft(def:any,team:TeamConfig,project:StaffingProject,pins:(role:any)=>{pin:Pick<StaffingRole,'skill'|'skills'>;text:string}):CrewDraft{
 const res=resolveCrew(teamBody(team),withRoleNodes(def),{},team.hash,project.id);
 const real={...res,nodes:res.nodes.filter(n=>!n.node.startsWith(ROLE_NODE))};
 if(res.missing.length)return{missing:res.missing,resolution:real};
 const roles:StaffingDraft['roles']={},sources:Record<string,string>={};
 for(const r of def.roles){const row=res.nodes.find(n=>n.node===ROLE_NODE+r.id)!;const p=pins(r);roles[r.id]={provider:row.provider!,model:row.model!,effort:row.effort,...p.pin};sources[p.pin.skill.ref]=p.text;}
 const nodes:Record<string,StaffingNode>={};
 for(const row of real.nodes){const role=roles[row.role??''];if(!role)continue;const o:StaffingNode={};
  if(row.provider!==role.provider)o.provider=row.provider!;if(row.model!==role.model)o.model=row.model!;if(row.effort!==role.effort)o.effort=row.effort;
  const own=(def.nodes.find((n:any)=>n.id===row.node)?.skills??[]).map((p:any)=>`${p.id}@${p.v}@${p.sha256}`).join('|'),final=row.skills.map(p=>`${p.id}@${p.v}@${p.sha256}`).join('|');
  if(final!==own||row.skills.length)o.skills=row.skills.map(p=>({ref:`skill:${p.id}`,version:p.v,sha256:p.sha256,snapshotSha256:p.sha256}));
  if(Object.keys(o).length)nodes[row.node]=o;}
 const draft:StaffingDraft={schema:1,algorithm:'sha256-canonical-v1',project,workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles,review:{freshContexts:3,distinctProviders:false},...(Object.keys(nodes).length?{nodes}:{}),crew:{team:team.hash}};
 return{draft,resolution:real,sources};
}
/** What a crew-derived configuration must match: everything but the role skill pins (those are checked against the live text). */
const shape=(c:Pick<StaffingDraft,'project'|'workflow'|'roles'|'review'|'nodes'|'crew'>)=>({project:c.project,workflow:c.workflow,review:c.review,nodes:c.nodes??null,crew:c.crew??null,roles:Object.fromEntries(Object.entries(c.roles).map(([id,r])=>[id,{provider:r.provider,model:r.model,effort:r.effort,ref:r.skill.ref}]))});
/** The approval a crew-derived staffing version cites: the team version's own approval. A team change approved on a crew card cites that
 *  card and its run; one made on the Crew page or seeded from approved staffing cites the team version itself, never another project's card. */
export function crewApproval(team:TeamConfig):{run:string;card:string;answerSeq:number}{
 if(team.approval.via==='card'&&team.approval.card&&team.approval.run)return{run:team.approval.run,card:team.approval.card,answerSeq:team.approval.answerSeq??team.version};
 return{run:`crew-${team.approval.via}`,card:`crew-team-v${team.version}-${team.hash.slice(0,12)}`,answerSeq:team.version};
}
/** The staffing guard as the runtime installs it: crew-derived versions are re-derived from their signed team (src/runtime/index.ts). */
export function installTeamStaffingGuard(engine:Engine,store:StaffingStore,crew:CrewStore,resolveProject:(id:string)=>StaffingProject,verifyCapability?:(config:StaffingConfig)=>void){
 const crewStaffing=installCrewStaffing(engine,store,crew);
 const guard=installStaffingGuard(engine,store,resolveProject,verifyCapability,(def,config)=>crewStaffing.verify(def,config));
 return{crewStaffing,guard};
}
export function installCrewStaffing(engine:Engine,store:StaffingStore,crew:CrewStore){
 const live=(def:any,role:any)=>{const t=engine.roleSkillText(def,role.id);const text=t?.text??engine.deps.skillText(role.skill),version=t?.version??1;const parts=skillPartPins(role.skill,engine.deps.skillText);return{pin:{skill:store.remember({ref:role.skill,version,text}),...(parts?{skills:parts}:{})},text};};
 /** The project's staffing derived from the current team: written (a new signed version) only when it differs from the current one.
  *  null: no team, or a seat this workflow needs is not filled (the per-project staffing flow then applies, unchanged). */
 function ensure(def:any,project:StaffingProject):StaffingConfig|null{
  const team=crew.current();if(!team)return null;
  if(def.roles.some((r:any)=>{try{return r.skill!==staffingSkillRef(def,r.id);}catch{return true;}}))return null;
  const d=crewStaffingDraft(def,team,project,r=>live(def,r));if('missing' in d)return null;
  let current:StaffingConfig|null=null;try{current=store.current(project);}catch(e:any){if(e?.code!=='ENOENT')throw e;}
  // a team only seeded from approved staffing (the captain has not changed it yet) keeps a project's own still-valid approval:
  // migration and onboarding defaults never restaff an explicitly configured project behind the captain's back
  if(current&&!current.crew&&(team.approval.via==='migration'||team.approval.via==='page'&&team.approval.by.startsWith('captain onboarding verified '))&&current.workflow.id===def.id&&current.workflow.version===def.version&&current.workflow.sha256===staffingHash(def))return current;
  if(current?.crew&&staffingHash(shape(current))===staffingHash(shape(d.draft))&&Object.entries(current.roles).every(([id,r])=>r.skill.sha256===d.draft.roles[id]?.skill.sha256&&staffingHash(r.skills??null)===staffingHash(d.draft.roles[id]?.skills??null)))return current;
  return store.approve(d.draft,current?.hash??null,crewApproval(team),d.sources);
 }
 /** The guard's check of a crew-derived version: its team version verifies and derives exactly this configuration. */
 function verify(def:any,config:StaffingConfig){
  const team=crew.byHash(config.crew!.team);if(!team)throw new Error('The Studio team version this staffing was derived from is missing or does not verify');
  const d=crewStaffingDraft(def,team,config.project,r=>({pin:{skill:config.roles[r.id]?.skill??{ref:r.skill,version:1,sha256:'0'.repeat(64),snapshotSha256:'0'.repeat(64)}},text:''}));
  if('missing' in d||staffingHash(shape(d.draft))!==staffingHash(shape(config)))throw new Error('Staffing derived from the Studio team differs from what that team gives this workflow; it is refused');
 }
 /** Whether the team covers this workflow (for the interview and the board): the seats it lacks, else none. */
 function coverage(def:any,project?:string|null):{team:boolean;missing:string[]}{const team=crew.current();if(!team)return{team:false,missing:[]};const res=resolveCrew(teamBody(team),withRoleNodes(def),{},team.hash,project||null);return{team:true,missing:res.missing};}
 return{ensure,verify,coverage};
}
