// Read-only declaration export. This artifact is not an import/start authority.
import {createHash} from 'node:crypto';
import type {WDef} from './runtime/defs';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
export const EXPORT_OMITTED=['parent','createdAt','by','note','diff','seed','origin','templateSource'] as const;
const KNOWN=new Set(['id','name','version','description','kind','intent','intents','sample','params','roles','nodes','edges','seats','compare','isTemplate','policies','card_checks','hooks',...EXPORT_OMITTED]);
type Dependency={kind:string;ref:string;sha256:string|null;status:'unresolved'|'pinned-reference';locations:string[]};
/** Input must be the exact stored version, not get()'s mutable layout projection.
 * No dependency files are opened: stored pins are references, never verification.
 */
export function workflowDefinitionExport(stored:WDef){
 const definition=structuredClone(stored) as any;
 for(const key of EXPORT_OMITTED)delete definition[key];
 const dependencies:Dependency[]=[];
 const add=(kind:string,ref:unknown,location:string,pin?:unknown)=>{if(typeof ref!=='string'||!ref)return;const sha256=typeof pin==='string'&&/^[a-f0-9]{64}$/.test(pin)?pin:null;let found=dependencies.find(d=>d.kind===kind&&d.ref===ref&&d.sha256===sha256);if(!found){found={kind,ref,sha256,status:sha256?'pinned-reference':'unresolved',locations:[]};dependencies.push(found);}if(!found.locations.includes(location))found.locations.push(location);};
 const skills=(pins:any,location:string)=>{for(const p of Array.isArray(pins)?pins:[]){add('library-skill',`${p?.id}@v${p?.v}`,location,p?.sha256);if(p?.filesSha256)add('skill-files',`${p.id}@v${p.v}`,location,p.filesSha256);}};
 const checks=(refs:any,location:string)=>{for(const c of Array.isArray(refs)?refs:[]){add('check',c?.use,location);skills(c?.skills,location);add('provider',c?.provider,location);add('model',c?.model,location);}};
 for(const r of stored.roles??[]){for(const ref of (r.skill??'').split('+'))add('role-skill',ref,`roles.${r.id}`);add('provider',r.provider,`roles.${r.id}`);add('model',r.model,`roles.${r.id}`);}
 for(const n of stored.nodes??[]){const location=`nodes.${n.id}`;add('action',n.do,location);add('agent-mode',n.mode,location);add('card-mode',n.kind==='card'&&(n.args as any)?.mode,location);add('role-skill',n.skill,location);add('provider',n.provider,location);add('model',n.model,location);skills(n.skills,location);checks(n.checks,location);for(const g of n.gates??[]){add('gate',g.builtin??g.id,location);if(g.run?.length)add('command',JSON.stringify(g.run),location);}}
 for(const [i,e] of (stored.edges??[]).entries())checks(e.checks,`edges.${i}`);
 for(const c of stored.card_checks??[])add('check',c,'card_checks');
 for(const h of stored.hooks??[])add('lifecycle-check',h.use,`hooks.${h.at}`);
 const unsupportedFields=Object.keys(stored).filter(k=>!KNOWN.has(k));
 return {format:'crew-workflow-definition',schema:1,hashAlgorithm:'sha256(JSON.stringify(value), UTF-8)',source:{workflow:stored.id,version:stored.version,sha256:digest(stored)},definitionSha256:digest(definition),definition,omittedContextFields:[...EXPORT_OMITTED],dependencies,compatibility:{status:'specification-only',verified:false,unsupportedFields},limitations:[
 'This is a non-executable definition artifact. Import and execution compatibility are not implemented or verified.',
 'Version-record metadata and origin/template context are omitted, including captain interviews. Origin also affects runtime admission/readiness; future imports must establish fresh local provenance and approvals.',
 'Only declaration fields and stored dependency pins are included. No auth, environment, project files, grants or task history are read. No referenced skill, script or asset files are read or included.',
 'Definition text can contain private or sensitive content pasted by its author. Review the JSON before sharing; this is not a complete secret scanner and no declaration text is silently redacted.',
 'Bundled/fm skill refs, native actions, modes and checks depend on the target Studio. Stored dependency hashes are unverified references, not proof those files exist or match.',
 'Unknown top-level declaration fields are preserved and reported as unsupported. Dependency inventory is not complete runtime closure for custom or nested configuration. This export does not transfer verified readiness, staffing, script approval or execution authority.'
 ]};
}
