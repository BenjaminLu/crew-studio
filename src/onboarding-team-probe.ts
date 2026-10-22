// One bounded native worker tool check. No target repository or settings are writable.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';import {homedir} from 'node:os';import {staffingHash} from './domain/staffing';import {randomBytes} from 'node:crypto';
import type {Agents} from './agent';import type {Provider} from './providers';
import type {TeamPick,TeamProbe} from './onboarding-team';import {localUnrestricted} from './local-execution';
export function teamProbeContext(pick:TeamPick){const bin=pick.provider==='codex'?process.env.CREW_CODEX_BIN||'codex':pick.provider==='cursor'?process.env.CREW_CURSOR_BIN||'cursor-agent':process.env.CREW_CLAUDE_BIN||'claude';const found=bin.includes('/')?bin:Bun.which(bin);if(!found)throw new Error('Native provider executable is missing');const binary=realpathSync(found),s=statSync(binary);return staffingHash({provider:pick.provider,binary,size:s.size,mtime:s.mtimeMs,inode:s.ino,config:pick.provider==='codex'?process.env.CODEX_HOME||join(homedir(),'.codex'):pick.provider==='cursor'?join(homedir(),'.config','crew-studio','cursor-api-key'):process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')});}
export function teamVerifier(d:{dataDir:string;agents:Agents;select:(p:TeamPick)=>Promise<Provider>}){
 return async(pick:TeamPick,signal?:AbortSignal):Promise<TeamProbe>=>{
  if(localUnrestricted())throw new Error('Team verification requires the OS sandbox; unrestricted mode was not used.');
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const deadline=setTimeout(abort,60000);let work:string|null=null;
  try{
   const context=teamProbeContext(pick);const provider=await d.select(pick);if(controller.signal.aborted)throw new Error('Team check cancelled');
   if(provider.id!==pick.provider||provider.model!==pick.model||provider.reasoningEffort!==pick.effort||provider.sandboxFree)throw new Error('Requested native provider configuration differs');
   const root=join(d.dataDir,'work');mkdirSync(root,{recursive:true});work=mkdtempSync(join(root,'onboarding-probe-'));
   const nonce=randomBytes(20).toString('hex'),challenge=randomBytes(20).toString('hex'),file=join(work,'challenge.txt');writeFileSync(file,challenge,{mode:0o600});
   let observed=0;const record=join(d.dataDir,'onboarding-team','probes',randomBytes(16).toString('hex'));
   const job=await d.agents.run({kind:'onboarding-team-check',title:'Check native team tools',provider,signal:controller.signal,owns:()=>!controller.signal.aborted,timeoutMs:60000,maxTools:1,
    system:'Use only the supplied Studio tool once. Read its result and reply with the exact challenge string only. Do not invent a result.',
    text:`Call onboarding_read with nonce ${nonce}. Reply with the returned challenge, with no other text.`,
    tools:[{name:'onboarding_read',description:'Read the private harmless onboarding challenge.',schema:{type:'object',properties:{nonce:{type:'string'}},required:['nonce'],additionalProperties:false},run:(args:any)=>{if(controller.signal.aborted||observed||Object.keys(args??{}).join(',')!=='nonce'||args.nonce!==nonce)throw new Error('Invalid onboarding probe call');observed++;return{challenge:readFileSync(file,'utf8')};}}],
    sandbox:{cwd:work,writes:[work],reads:[work]},record:{dir:record,header:{kind:'onboarding-team-check',requested:pick}}});
   if(controller.signal.aborted||job.status!=='done'||job.provider!==pick.provider||job.model!==pick.model||job.reasoningEffort!==pick.effort||job.executionMode!=='default'||job.tools!==1||observed!==1||job.said.trim()!==challenge||teamProbeContext(pick)!==context)throw new Error('Native tool check failed; no team settings were changed.');
   return{id:job.id,requested:{...pick},toolVerified:true,executionMode:'sandboxed',context};
  }finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);if(work)rmSync(work,{recursive:true,force:true});}
 };
}
