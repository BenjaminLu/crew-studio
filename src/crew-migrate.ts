// One-time seeding of the Studio team from the staffing the captain already approved (docs/design/crew-seats.md):
// the most recent approved code-firstmate staffing gives the members; another workflow's approved picks that differ from
// what that team would give become that workflow's overrides. Idempotent: a Studio that has a team is never touched.
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {CrewStore,resolveCrew,slotsOf,declaredSeats,type Team,type Member,type NodeOverride} from './domain/crew';
import {StaffingStore,type StaffingConfig} from './domain/staffing';

/** Which seat each staffed role seeds (code-firstmate and coffee-kit role ids). */
const ROLE_SEAT:Record<string,string>={coordinator:'coordinator',worker:'maker',reviewer:'reviewer',designer:'design-reviewer'};
const pickOf=(r:{provider:'codex'|'claude';model:string;effort:string|null}):Member=>({provider:r.provider,model:r.model,effort:r.provider==='codex'&&r.effort===null?'medium':r.effort,skills:[]});
/** Every approved staffing that still verifies, newest first (by the time its pointer was written, then its approval's Task number). */
export function approvedStaffings(dataDir:string):{config:StaffingConfig;at:number}[]{
 const root=join(dataDir,'projects'),store=new StaffingStore(dataDir),out:{config:StaffingConfig;at:number}[]=[];if(!existsSync(root))return out;
 for(const dir of readdirSync(root)){const s=join(root,dir,'staffing'),ptr=join(s,'current.json');if(!existsSync(ptr))continue;
  try{const p=JSON.parse(readFileSync(ptr,'utf8'));const raw=JSON.parse(readFileSync(join(s,`v${p.version}.json`),'utf8'));const c=store.current(raw.project);if(c.crew)continue;out.push({config:c,at:statSync(ptr).mtimeMs});}catch{/* an approval that does not verify seeds nothing */}}
 const runNo=(c:StaffingConfig)=>Number(/^R-(\d+)$/.exec(c.approval.run)?.[1]??0);
 return out.sort((a,b)=>b.at-a.at||runNo(b.config)-runNo(a.config));
}
export type CrewMigration={status:'exists'|'nothing'|'seeded';version?:number;from?:{project:string;workflow:string;version:number};overrides?:string[]};
export function migrateCrew(dataDir:string,defs:{get(id:string,v?:number):any}):CrewMigration{
 const crew=new CrewStore(dataDir);if(crew.exists())return{status:'exists'};
 const all=approvedStaffings(dataDir),seed=all.find(a=>a.config.workflow.id==='code-firstmate')??all[0];if(!seed)return{status:'nothing'};
 const c=seed.config,members:Record<string,Member>={};
 for(const[role,r]of Object.entries(c.roles)){const seat=ROLE_SEAT[role];if(seat&&!members[seat])members[seat]=pickOf(r);}
 // the second maker: the first approved pick on another model than the maker's (A and B differ), else the maker's own
 if(members.maker&&!members['alt-maker']){const other=Object.values(c.roles).find(r=>r.model!==members.maker.model);members['alt-maker']=other?{...pickOf(other),effort:members.maker.effort}:{...members.maker};}
 const team:Team={schema:1,members,seats:{},workflows:{}},overrides:string[]=[];
 // a specialist seat an approved workflow declares (coffee's image-maker): filled by the newest approved pick of the role on it
 for(const{config}of all){const def=defs.get(config.workflow.id,config.workflow.version);if(!def)continue;
  for(const role of def.roles??[]){const seat=role.seat,decl=declaredSeats(def).find(s=>s.id===seat),pick=config.roles[role.id];if(!seat||!decl||!pick||team.members[seat])continue;
   team.seats[seat]=structuredClone(decl);team.members[seat]=pickOf(pick);}}
 // other approved workflows (newest first; one per workflow): a role pick the team would not give becomes an override on that role's nodes
 const seen=new Set<string>([`${c.workflow.id}`]);
 for(const{config}of all){if(seen.has(config.workflow.id))continue;seen.add(config.workflow.id);const def=defs.get(config.workflow.id,config.workflow.version);if(!def)continue;
  const res=resolveCrew(team,def),nodes:Record<string,NodeOverride>={};
  for(const slot of slotsOf(def)){const pick=config.roles[slot.role??''];const row=res.nodes.find(n=>n.node===slot.node);if(!pick||!row)continue;
   const o:NodeOverride={at:{role:slot.role,kind:slot.kind}};if(row.provider!==pick.provider)o.provider=pick.provider;if(row.model!==pick.model)o.model=pick.model;if(row.effort!==pick.effort)o.effort=pick.effort;
   if(Object.keys(o).length>1){nodes[slot.node]=o;overrides.push(`${def.id}/${slot.node}`);}}
  if(Object.keys(nodes).length)team.workflows[def.id]={nodes};}
 const written=crew.write(team,null,{by:'migration',via:'migration',run:c.approval.run,card:c.approval.card});
 return{status:'seeded',version:written.version,from:{project:c.project.id,workflow:c.workflow.id,version:c.workflow.version},overrides};
}
