// A verbatim copy of Projects.staffingIdentity as it was before the read-only assessment was extracted (pure refactor).
// tests/staffing-assess.ts runs it beside the refactored method over the same registrations and compares the outcomes.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { builtInSandboxRoot } from "../../src/doors";
export function referenceStaffingIdentity(this: any, id: string, protectedRoots: string[] = []): { namespace: 'git'; id: string; identity: string } {
    if(typeof id!=='string'||!id||id.length>200)throw new Error("Choose an exact registered project");
    const snapshot=this.nativeSnapshot(),project=snapshot.records.find(p=>p.id===id);
    if(!project?.path||(project.enabled!==undefined&&project.enabled!==true))throw new Error("Registered project is missing or disabled");
    const inside=(a:string,b:string)=>{const r=relative(a,b);return !r||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};
    const privateRoots=[this.dataDir,...protectedRoots,process.env.CODEX_HOME||join(homedir(),'.codex'),join(homedir(),'.claude'),process.env.CREW_RUNTIME_DIR||join(homedir(),'.crew-studio/runtime')].map(p=>{try{return realpathSync(p)}catch{return resolve(p)}});
    // The built-in sandbox is the only repository allowed below the data root; other protected roots still apply to it.
    // Index 0 is the data root itself: an explicit protected root that equals it still refuses.
    const sandbox=builtInSandboxRoot(this.dataDir,id,project.path);
    const allowed=(path:string)=>{if(privateRoots.some((root,i)=>!(sandbox&&i===0&&inside(sandbox,path))&&(inside(root,path)||inside(path,root))))throw new Error("Registered repository overlaps private or protected data");};
    const small=(path:string,max:number,container:string,checkPrivate=true)=>{const actual=realpathSync(path);if(!inside(container,actual))throw new Error("Repository identity file escaped its container");if(checkPrivate)allowed(actual);const st=statSync(actual);if(!st.isFile()||st.size>max)throw new Error("Repository identity file is unavailable or oversized");return readFileSync(actual,'utf8').trim();};
    const gitIdentity=(path:string,checkPrivate=true)=>{
      const root=realpathSync(path);if(!statSync(root).isDirectory())throw new Error("Repository root missing");if(checkPrivate)allowed(root);
      let git=join(root,'.git');if(statSync(git).isFile()){const text=small(git,4096,root,checkPrivate);if(!text.startsWith('gitdir: ')||text.includes('\n'))throw new Error("Malformed Git directory reference");git=resolve(root,text.slice(8));}
      git=realpathSync(git);if(!statSync(git).isDirectory())throw new Error("Git directory missing");if(checkPrivate)allowed(git);
      const commonFile=join(git,'commondir'),common=realpathSync(existsSync(commonFile)?resolve(git,small(commonFile,4096,git,checkPrivate)):git);if(!statSync(common).isDirectory())throw new Error("Git common directory missing");if(checkPrivate)allowed(common);
      return{root,git,common};
    };
    const repository=gitIdentity(project.path);let matches=0;
    for(const other of snapshot.records){if(!other.path)continue;const identity=gitIdentity(other.path,false);if(identity.common===repository.common)matches++;}
    if(matches!==1)throw new Error("Repository has ambiguous registered aliases");
    if(typeof project.base!=='string'||!project.base||project.base.length>200||project.base.startsWith('-')||project.base.includes('..')||project.base.includes('@{')||/[\s~^:?*\[\]\\]/.test(project.base)||project.base.startsWith('/')||project.base.endsWith('/')||project.base.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.')||p.endsWith('.lock')))throw new Error("Registered base is invalid");
    const ref='refs/heads/'+project.base,loose=join(repository.common,ref);let found=false;
    if(existsSync(loose)){const actual=realpathSync(loose);if(!inside(repository.common,actual))throw new Error("Base reference escaped Git authority");found=/^[a-f0-9]{40,64}$/.test(small(actual,256,repository.common));}
    if(!found&&existsSync(join(repository.common,'packed-refs'))){const lines=small(join(repository.common,'packed-refs'),1024*1024,repository.common).split('\n');found=lines.some(line=>{const parts=line.split(' ');return parts.length===2&&/^[a-f0-9]{40,64}$/.test(parts[0])&&parts[1]===ref;});}
    if(!found)throw new Error("Confirmed base reference is unavailable");
    if(project.github){const assert=(this as any).assertExecutable;if(typeof assert!=='function')throw new Error("External project grant verification is unavailable");assert.call(this,{project:id,base:project.base},{});}
    const canonical=(v:any):string=>v===null||typeof v==='string'||typeof v==='boolean'?JSON.stringify(v):typeof v==='number'&&Number.isFinite(v)?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&Object.getPrototypeOf(v)===Object.prototype?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':(()=>{throw new Error("Unsupported project authority value")})();
    return{namespace:'git',id,identity:createHash('sha256').update(canonical({schema:1,id,root:repository.root,common:repository.common,base:project.base,enabled:project.enabled??true,grant:project.github??null})).digest('hex')};
  }
