// Claude CLI capability: passive auth metadata is separate from actual execution.
// No metadata read makes a model request. A desktop Verify or signed bounded Task grant authorizes it.
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,realpathSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';import{tmpdir,homedir}from'node:os';
import {probeProcess} from './probe-process';import{claudeLogin,claudeBilling,CLAUDE_API_KEY_SHAPE,type Login}from'./login';
import{claudeProvider}from'./claude';import{claudeSettings}from'./needs';
import type{ProviderCapability}from'./policy';
export type ClaudePair={model:string;effort:string|null};
/** The models Studio can choose for Claude: read from the installed CLI, or (only when that is impossible) a fixed list marked unverified with the reason. */
export type ClaudeModelInventory={source:'cli'|'unverified-fallback';models:{id:string;efforts:string[];label:string|null}[];at:number;version:string|null;reason?:string};
/** Last resort only: shown as unverified, never as detected. */
export const CLAUDE_FALLBACK_MODELS=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'];
export type ClaudeCapability=ProviderCapability&{loginState:'logged-in'|'not-logged-in'|'unknown';resetAt:number|null;admission:'verified-execution'|'none';guidance:string;context:{executable:string|null;configDirectory:string|null;version:string|null}};
type Entry={valid:boolean;pair:ClaudePair;expires:number;login:Extract<Login,{ok:true}>;owner:ClaudeNative;binary:string};
const receipts=new WeakMap<object,Entry>();
const pairKey=(p:ClaudePair)=>JSON.stringify([p.model,p.effort]);
/** Read only the approved nonsecret effort fields; never copy user settings. */
export function configuredClaudeEffort(model:string):string|null{
 if(process.env.CLAUDE_CODE_EFFORT_LEVEL!==undefined)return process.env.CLAUDE_CODE_EFFORT_LEVEL;
 const file=join(process.env.CLAUDE_CONFIG_DIR||join(process.env.HOME||homedir(),'.claude'),'settings.json');if(!existsSync(file))return null;
 if(statSync(file).size>1024*1024)throw new Error('Claude settings are too large to verify');let settings:any;try{settings=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('Claude configured effort is unavailable');}
 const effort=settings?.modelSettings?.[model]?.effortLevel??settings?.effortLevel??null;if(effort!==null&&typeof effort!=='string')throw new Error('Claude configured effort is invalid');return effort;
}
export function claudeEfforts(model:string):string[]{
 if(/^claude-(?:fable-5(?:-1)?|(?:opus|sonnet|haiku)-5-5|opus-5|sonnet-5|opus-4-[78])(?:-\d{8})?$/.test(model))return['low','medium','high','xhigh','max'];
 if(/^claude-(?:opus|sonnet)-4-6(?:-\d{8})?$/.test(model))return['low','medium','high','max'];return[];
}
export function validClaudePair(p:ClaudePair){return typeof p.model==='string'&&/^claude-[a-z0-9][a-z0-9.-]{1,100}$/.test(p.model)&&(p.effort===null||claudeEfforts(p.model).includes(p.effort));}
export function isClaudeExecutionAdmission(cap:ProviderCapability,p:ClaudePair):boolean{const e=receipts.get(cap);return !!e&&e.valid&&e.expires>Date.now()&&pairKey(e.pair)===pairKey(p)&&e.owner.currentBinary()===e.binary&&cap.provider==='claude'&&cap.quota==='unknown'&&cap.auth==='verified';}
const DENIAL=/rate.?limit|usage.?limit|quota|insufficient_quota|credits.?required|credit balance|spend.?limit|billing|payment|required.*credit|429/i;
export function claudeFailureCode(m:any):'quotaExhausted'|'notLoggedIn'|'modelMismatch'|'cliError'|null{
 if(m?.type==='rate_limit_event'&&m.rate_limit_info?.status==='rejected')return'quotaExhausted';
 const status=m?.api_error_status??m?.error?.status;
 const text=[m?.error?.type,m?.error?.message,m?.error,m?.result,...Array.isArray(m?.errors)?m.errors:[]].filter(x=>typeof x==='string').join(' ');
 const errorContext=!!m?.error||m?.is_error===true||Array.isArray(m?.errors)&&m.errors.length>0||m?.type==='result'&&m.subtype!=='success';
 if(status===429||status===402||errorContext&&DENIAL.test(text))return'quotaExhausted';
 if(status===401||status===403||errorContext&&/not logged in|authentication|invalid.*(?:token|key)|unauthori[sz]ed|oauth|credential/i.test(text))return'notLoggedIn';
 if(status!==undefined&&status!==null||m?.error||Array.isArray(m?.errors)&&m.errors.length||m?.is_error||m?.type==='result'&&m.subtype!=='success')return'cliError';return null;
}
const resolveBin=(bin:string)=>{for(const p of bin.includes('/')?[bin]:(process.env.PATH||'/usr/bin:/bin').split(':').map(d=>join(d,bin)))try{if(statSync(p).isFile())return realpathSync(p);}catch{}return null;};
// macOS: the CLI finds its login-Keychain credential by the login user; without USER/LOGNAME it reports no login.
const loginUser=()=>{const e:Record<string,string>={};for(const k of['USER','LOGNAME'])if(process.env[k])e[k]=process.env[k]!;return e;};
/** The ordinary account/config context the official `claude auth` commands run in: no copied secrets, only where the login lives. */
export const claudeAccountEnv=():Record<string,string>=>({PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME||homedir(),LANG:'en_US.UTF-8',...loginUser(),...process.env.CLAUDE_CONFIG_DIR?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR}:{}});
const argv=(bin:string,args:string[])=>/\.(?:mjs|js|ts)$/.test(bin)?[process.execPath,bin,...args]:[bin,...args];
export class ClaudeNative{
 private admitted=new Map<string,ClaudeCapability>();private authDenied=false;private cleanupBlocked=false;private denial:{code:string;resetAt:number|null;at:number}|null=null;
 /** One paid verification runs at a time. A request for the exact pair already running or queued shares that
  * flight's result; a different pair waits its turn. At most MAX_FLIGHTS pairs are in flight or queued. */
 private flights=new Map<string,{abort:AbortController;done:Promise<ClaudeCapability>;waiters:number}>();private tail:Promise<unknown>=Promise.resolve();static readonly MAX_FLIGHTS=4;private unknownProcess:ReturnType<typeof probeProcess>|null=null;
 constructor(private options:{bin?:string;login?:()=>Login;authEnv?:()=>Record<string,string>}={}){}
 verifiedCapabilities(){return [...this.admitted.values()].filter(cap=>{const entry=receipts.get(cap);return !!entry&&isClaudeExecutionAdmission(cap,entry.pair);});}
 currentBinary(){return resolveBin(this.options.bin??process.env.CREW_CLAUDE_BIN??'claude')??'';}
 private base(p:ClaudePair,patch:Partial<ClaudeCapability>={}):ClaudeCapability{const at=Date.now();return{provider:'claude',available:!!this.currentBinary(),auth:'unverified',quota:this.denial?.code==='quotaExhausted'?'exhausted':'unknown',models:[],at,expires:at+30000,refusal:'unverified',loginState:'unknown',resetAt:this.denial?.resetAt??null,admission:'none',guidance:this.denial?.code==='quotaExhausted'?'Claude quota is exhausted. Wait for reset; do not sign in again. Reset time is unknown unless the CLI reports it. / Claude 額度已耗盡；請等待重設，不需重新登入。只有 CLI 回報時才有確切重設時間。':'Verify the selected Claude CLI/config context. Existing sessions may use another context. / 請確認選定的 Claude CLI 與設定環境；既有對話可能使用不同環境。',context:{executable:this.currentBinary()||null,configDirectory:null,version:null},...patch};}
 invalidate(code='cliError',event?:any){for(const cap of this.admitted.values()){const e=receipts.get(cap);if(e)e.valid=false;}this.admitted.clear();if(code==='cleanupUnverified')this.cleanupBlocked=true;if(code==='quotaExhausted'){const raw=event?.rate_limit_info?.resetsAt;const resetAt=typeof raw==='number'&&Number.isFinite(raw)&&raw>0?raw*1000:null;this.denial={code,resetAt,at:Date.now()};}else if(code==='notLoggedIn')this.authDenied=true;}
 /** A fresh official sign-in (maybe another account) replaces the login: earlier refusals and verified admissions no longer apply; quota denial is kept. */
 signedIn(){this.invalidate('signedIn');this.authDenied=false;}
 observe(event:any){const code=claudeFailureCode(event);if(code)this.invalidate(code,event);}
 async status(p:ClaudePair,signal?:AbortSignal):Promise<ClaudeCapability>{
  if(!validClaudePair(p))return this.base(p,{reason:'Exact configured Claude model/effort is unsupported; no substitute is selected'});
  if(this.unknownProcess||this.cleanupBlocked)return this.base(p,{available:false,reason:'Owned Claude process cleanup is unverified; restart Studio',refusal:'unverified'});
  const binary=this.currentBinary();if(!binary)return this.base(p,{available:false,reason:'Selected Claude CLI is unavailable',refusal:'unavailable'});
  const root=mkdtempSync(join(tmpdir(),'crew-claude-auth-status-'));let proc:ReturnType<typeof probeProcess>|null=null,clean=true;
  try{
   if(signal?.aborted)return this.base(p,{reason:'Claude status owner ended'});
   // Official read-only command in the selected ordinary account/config context.
   // Output is parsed privately; email/account details never leave this method.
   const env=this.accountEnv();
   proc=probeProcess(argv(binary,['auth','status','--json']),root,env,undefined,{timeoutMs:8000,bytes:32768});const abort=()=>proc?.kill();signal?.addEventListener('abort',abort,{once:true});let code;try{code=await proc.exited;await proc.stop();}finally{signal?.removeEventListener('abort',abort);}
   if(signal?.aborted||proc.output().failure)return this.base(p,{reason:'Claude auth metadata is unavailable in this context'});
   let j:any;try{j=JSON.parse(proc.output().out);}catch{return this.base(p,{reason:'Claude auth metadata schema is unsupported'});}
   const context={executable:binary,configDirectory:typeof j.configDirectory==='string'&&j.configDirectory.length<=1000?j.configDirectory:null,version:null};
   if(j.loggedIn===false&&j.authMethod==='none'&&code===1){if(this.denial?.code!=='quotaExhausted')this.invalidate('notLoggedIn');return this.base(p,{auth:'missing',loginState:'not-logged-in',context,reason:'This CLI/config context reports no login; this does not describe unrelated existing Claude sessions',refusal:this.denial?.code==='quotaExhausted'?'exhausted':'missing-login'});}
   if(code!==0||j.loggedIn!==true||!['claude.ai','oauth_token','api_key'].includes(j.authMethod)||j.apiProvider!=='firstParty')return this.base(p,{context,reason:'Claude account/provider metadata is unsupported'});
   if(this.denial?.code==='quotaExhausted')return this.base(p,{auth:this.authDenied?'unverified':'verified',loginState:'logged-in',context,refusal:'exhausted',reason:'Claude is signed in but quota is exhausted; wait for reset, not login'});
   if(this.authDenied)return this.base(p,{loginState:'logged-in',context,reason:'This CLI stores a login, but runtime authentication was refused; selected-context authentication is unverified'});
   const cached=this.admitted.get(pairKey(p));
   if(cached&&isClaudeExecutionAdmission(cached,p)){if(cached.expires>Date.now())return cached;
    // the capability went stale but its receipt still holds: a fresh 30-second capability carries the same receipt
    const at=Date.now(),fresh={...cached,at,expires:at+30000};receipts.set(fresh,receipts.get(cached)!);this.admitted.set(pairKey(p),fresh);return fresh;}
   return this.base(p,{auth:'verified',loginState:'logged-in',context,reason:'Signed in; remaining quota and actual selected model execution are unverified. Studio verifies the exact model with one bounded request before its first round.'});
  }catch{return this.base(p,{reason:'Claude auth metadata is unavailable in this context'});}finally{if(proc)try{await proc.stop();}catch{clean=false;this.unknownProcess=proc;}if(clean)rmSync(root,{recursive:true,force:true});}
 }
 private accountEnv():Record<string,string>{return{PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME||homedir(),LANG:'en_US.UTF-8',...loginUser(),...(claudeBilling()==='api-key'&&process.env.ANTHROPIC_API_KEY?{ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY}:{}),...this.options.authEnv?.(),...process.env.CLAUDE_CONFIG_DIR?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR}:{}};}
 private inventory:{at:number;done:Promise<ClaudeModelInventory>}|null=null;
 /** The models the installed CLI offers this account: the stream-json `initialize` control request (the Agent SDK's
  * supportedModels()). Only that request is written and the process is stopped on its reply, so no user turn and no model
  * request exists; like `auth status`, it reads the ordinary account context. Shared while running, reused for 60 seconds. */
 models(o:{signal?:AbortSignal;fresh?:boolean}={}):Promise<ClaudeModelInventory>{
  if(this.inventory&&!o.fresh&&Date.now()-this.inventory.at<60000)return this.inventory.done;
  const entry={at:Date.now(),done:this.readModels(o.signal)};this.inventory=entry;
  entry.done.then(r=>{if(r.source!=='cli'&&this.inventory===entry)this.inventory=null;});return entry.done;
 }
 private async readModels(signal?:AbortSignal):Promise<ClaudeModelInventory>{
  const at=Date.now(),failed=(reason:string):ClaudeModelInventory=>({source:'unverified-fallback',models:CLAUDE_FALLBACK_MODELS.map(id=>({id,efforts:claudeEfforts(id),label:null})),at,version:null,reason});
  const binary=this.currentBinary();if(!binary)return failed('The Claude CLI is not installed or not on PATH, so its model list cannot be read');
  if(this.unknownProcess||this.cleanupBlocked)return failed('Owned Claude process cleanup is unverified; restart Studio');
  const root=mkdtempSync(join(tmpdir(),'crew-claude-models-'));let proc:ReturnType<typeof probeProcess>|null=null,clean=true,reply:any=null;
  try{
   if(signal?.aborted)return failed('Claude model discovery was cancelled');
   const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--permission-mode','dontAsk','--permission-prompts','none','--disable-slash-commands','--no-chrome','--safe-mode','--restricted'];
   // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is left unset here on purpose: with it the CLI skips its own free
   // account model listing and reports only its built-in aliases (2.1.302: 4 models instead of 12)
   proc=probeProcess(argv(binary,args),root,{...this.accountEnv(),DISABLE_AUTOUPDATER:'1'},m=>{if(m?.type==='control_response'&&m.response?.request_id==='models'&&!reply){reply=m.response;proc?.kill();}},{timeoutMs:15000,bytes:512*1024,lineBytes:256*1024});
   const abort=()=>proc?.kill();signal?.addEventListener('abort',abort,{once:true});
   try{proc.write({type:'control_request',request_id:'models',request:{subtype:'initialize'}});await proc.exited;await proc.stop();}finally{signal?.removeEventListener('abort',abort);}
   if(signal?.aborted)return failed('Claude model discovery was cancelled');
   if(!reply)return failed(proc.output().failure==='probe deadline expired'?'The Claude CLI did not answer the model list request in time':'This Claude CLI version does not answer the model list request');
   const list=reply.subtype==='success'?reply.response?.models:null;if(!Array.isArray(list))return failed('This Claude CLI version does not report its models');
   const models:ClaudeModelInventory['models']=[];
   for(const m of list){const id=typeof m?.resolvedModel==='string'?m.resolvedModel:m?.value;if(typeof id!=='string'||!validClaudePair({model:id,effort:null})||models.some(x=>x.id===id))continue;
    // Studio's own effort table decides what it can run; the CLI can only narrow it (a model without effort support has none)
    const cli=m.supportsEffort===true&&Array.isArray(m.supportedEffortLevels)?m.supportedEffortLevels:[];models.push({id,efforts:claudeEfforts(id).filter(e=>cli.includes(e)),label:typeof m.displayName==='string'?m.displayName.slice(0,80):null});}
   if(!models.length)return failed('The Claude CLI reported no models Studio can run');
   return{source:'cli',models,at,version:typeof reply.response?.claude_code_version==='string'?reply.response.claude_code_version.slice(0,40):null};
  }catch{return failed('Claude model discovery failed');}finally{if(proc)try{await proc.stop();}catch{clean=false;this.unknownProcess=proc;}if(clean)rmSync(root,{recursive:true,force:true});}
 }
 async verify(p:ClaudePair,o:{confirm:boolean;signal?:AbortSignal;timeoutMs?:number;ttlMs?:number}):Promise<ClaudeCapability>{
  if(o.confirm!==true||!validClaudePair(p))return this.base(p,{reason:'Explicit confirmation of the exact configured Claude model/effort is required'});
  if(this.quotaHeld())return this.base(p,{reason:'Quota is exhausted; do not retry before reset'});
  const key=pairKey(p);let flight=this.flights.get(key);if(flight?.abort.signal.aborted)flight=undefined; // every earlier waiter left: never join a cancelled request
  if(!flight){
   if([...this.flights.values()].filter(f=>!f.abort.signal.aborted).length>=ClaudeNative.MAX_FLIGHTS)return this.base(p,{reason:'Too many Claude verifications are waiting; try again when they finish'});
   const abort=new AbortController(),previous=this.tail,timeoutMs=o.timeoutMs??120000;
   // Queued behind the running pair: the deadline starts when this pair's own request starts.
   const done=previous.then(()=>abort.signal.aborted?this.base(p,{reason:'Claude verification ended before it started'}):this.quotaHeld()?this.base(p,{reason:'Quota is exhausted; do not retry before reset'}):this.runVerify(p,abort.signal,timeoutMs,o.ttlMs));
   const created={abort,done,waiters:0};flight=created;this.flights.set(key,created);
   const leave=()=>{if(this.flights.get(key)===created)this.flights.delete(key);};this.tail=done.then(leave,leave);
  }
  const shared=flight;shared.waiters++;
  let release=()=>{};const ended=new Promise<ClaudeCapability>(resolve=>{const stop=()=>resolve(this.base(p,{reason:'Claude verification owner ended'}));if(o.signal?.aborted)stop();else{o.signal?.addEventListener('abort',stop,{once:true});release=()=>o.signal?.removeEventListener('abort',stop);}});
  try{return await Promise.race([shared.done,ended]);}
  finally{release();shared.waiters--;if(shared.waiters<=0)shared.abort.abort();}
 }
 private quotaHeld(){return this.denial?.code==='quotaExhausted'&&(!this.denial.resetAt||this.denial.resetAt>Date.now());}
 /** a receipt lasts 30 seconds (Doctor's Verify) or, for Studio's own verification before rounds, up to an hour */
 private async runVerify(p:ClaudePair,signal:AbortSignal,timeoutMs:number,ttlMs=30000):Promise<ClaudeCapability>{
  ttlMs=Math.max(30000,Math.min(Number(ttlMs)||30000,3600000));
  if(!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>120000)return this.base(p,{reason:'Claude verification deadline is invalid'});
  const auth=await this.status(p,signal);if(auth.loginState!=='logged-in'||signal.aborted)return auth;
  const login=(this.options.login??(()=>claudeLogin({record:false})))();if(!login.ok)return this.base(p,{auth:'verified',loginState:'logged-in',reason:'Selected CLI is signed in but its credential cannot be safely isolated for a native worker'});
  // an API key Studio keeps, or the captain's own account (no value at all: the CLI reads its own sign-in); never a token Studio read
  const keys=Object.keys(login.env),account=login.kind==='account'&&keys.length===0;if(!account&&(keys.length!==1||keys[0]!=='ANTHROPIC_API_KEY'||!CLAUDE_API_KEY_SHAPE.test(login.env[keys[0]])))return this.base(p,{reason:'Claude credential snapshot is unsupported'});
  const root=mkdtempSync(join(tmpdir(),'crew-claude-verify-')),home=join(root,'home'),config=join(home,'.claude'),work=join(root,'work'),temp=join(root,'tmp');for(const d of[config,work,temp])mkdirSync(d,{recursive:true});
  let proc:ReturnType<typeof probeProcess>|null=null,clean=true;const deadline=Date.now()+timeoutMs;const abort=()=>proc?.kill();signal.addEventListener('abort',abort,{once:true});
  try{
   if(signal.aborted)throw 0;const binary=this.currentBinary();if(!binary)throw 0;
   // on the captain's own sign-in the verification runs like a round: a private home, the CLI reading its own keychain item (named
   // for the login user, and the captain's CLAUDE_CONFIG_DIR only when set), none of the captain's files
   const own=process.env.CLAUDE_CONFIG_DIR?.trim();
   const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:home,...(account?(own?{CLAUDE_CONFIG_DIR:own}:{}):{CLAUDE_CONFIG_DIR:config}),...loginUser(),TMPDIR:temp,CLAUDE_CODE_TMPDIR:temp,LANG:'en_US.UTF-8',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',...login.env,...p.effort?{CLAUDE_CODE_EFFORT_LEVEL:p.effort}:{}};
   let init=false,result=false,assistant=false,invalid=false;
   const args=['-p','Reply with OK only. Do not use any tools.','--output-format','stream-json','--verbose','--include-partial-messages','--model',p.model,...p.effort?['--effort',p.effort]:[],'--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','dontAsk','--permission-prompts','none','--setting-sources','','--settings',JSON.stringify(claudeSettings(p)),'--safe-mode','--no-chrome','--disable-slash-commands','--no-session-persistence','--restricted','--max-turns','1','--max-budget-usd','0.05'];
   proc=probeProcess(argv(binary,args),work,env,m=>{
    const code=claudeFailureCode(m);if(code){invalid=true;this.invalidate(code,m);}
    if(m.type==='system'&&m.subtype==='init'){if(init||m.model!==p.model||!Array.isArray(m.tools)||m.tools.length)invalid=true;init=true;}
    if(m.type==='assistant'){if(m.message?.model!==p.model)invalid=true;if(m.message?.content?.some((c:any)=>c.type==='tool_use'))invalid=true;assistant=true;}
    if(m.type==='result'){if(result||!init||!assistant||m.is_error!==false||m.subtype!=='success'||typeof m.result!=='string'||!m.result.trim()||!m.modelUsage||Object.keys(m.modelUsage).length!==1||!Object.hasOwn(m.modelUsage,p.model))invalid=true;result=true;}
   },{timeoutMs:Math.max(1,deadline-Date.now()),bytes:262144,lineBytes:65536});
   const code=await proc.exited;await proc.stop();if(signal.aborted||code!==0||proc.output().failure||!result||invalid||Date.now()>=deadline)throw 0;
   this.denial=null;this.authDenied=false;const at=Date.now(),cap=this.base(p,{auth:'verified',loginState:'logged-in',quota:'unknown',refusal:undefined,admission:'verified-execution',models:[{id:p.model,efforts:claudeEfforts(p.model)}],at,expires:at+30000,reason:'Exact model completed a bounded request; remaining quota is unknown',guidance:'Verified bounded execution; remaining quota is unknown. Runtime quota or auth denial stops readiness. / 已驗證有限執行；剩餘額度仍未知。執行時的額度或登入拒絕會停止就緒狀態。',context:auth.context});
   const superseded=this.admitted.get(pairKey(p));if(superseded){const previous=receipts.get(superseded);if(previous)previous.valid=false;}
   // the receipt lasts ttlMs; the capability the policy reads stays a 30-second fact (status() mints a fresh one from it)
   receipts.set(cap,{valid:true,pair:{...p},expires:at+ttlMs,login:{...login,env:{...login.env}},owner:this,binary});this.admitted.set(pairKey(p),cap);return cap;
  }catch{return this.base(p,{auth:auth.auth,loginState:auth.loginState,reason:'Claude bounded verification did not establish readiness; no work or fallback was started'});}finally{signal.removeEventListener('abort',abort);if(proc)try{await proc.stop();}catch{clean=false;this.unknownProcess=proc;this.invalidate();}if(clean)rmSync(root,{recursive:true,force:true});}
 }
 async cancel(){const flights=[...this.flights.values()];for(const f of flights)f.abort.abort();await Promise.all(flights.map(f=>f.done.catch(()=>null)));}
}
export const nativeClaude=new ClaudeNative();
export const probeClaudeNative=(p:ClaudePair,signal?:AbortSignal)=>nativeClaude.status(p,signal);
/** Before a round: a signed-in Claude with no execution receipt for this exact pair is verified by Studio itself (one
 *  bounded request), so the captain never has to press Verify first. Nothing else is verified: not a Claude that is not
 *  signed in, not one whose quota is exhausted or that is unavailable, not one already admitted, not an unsupported pair. */
export const AUTO_VERIFY_TTL_MS=30*60_000;
export async function admitSignedInClaude(cap:ProviderCapability,p:ClaudePair,d:{verify:(p:ClaudePair,o:{confirm:boolean;signal?:AbortSignal;ttlMs?:number})=>Promise<ProviderCapability>;admitted:(cap:ProviderCapability,p:ClaudePair)=>boolean}={verify:(p,o)=>nativeClaude.verify(p,o),admitted:isClaudeExecutionAdmission},signal?:AbortSignal,live:()=>boolean=()=>true):Promise<ProviderCapability>{
 if(cap.provider!=='claude'||!cap.available||cap.auth!=='verified'||cap.quota!=='unknown'||!validClaudePair(p)||d.admitted(cap,p))return cap;
 // nothing is spent for a round whose owner ended; one verification serves the pair's rounds for half an hour (a queue
 // wait or the next round reuses it instead of paying again)
 if(signal?.aborted||!live())return cap;
 return d.verify(p,{confirm:true,signal,ttlMs:AUTO_VERIFY_TTL_MS});
}
export function makeNativeClaudeProvider(cap:ProviderCapability,p:ClaudePair){const entry=receipts.get(cap);if(!entry||!isClaudeExecutionAdmission(cap,p))throw new Error('Claude native execution receipt is unavailable');return claudeProvider(p.model,entry.binary,{...p,live:()=>isClaudeExecutionAdmission(cap,p),invalidate:(code,event)=>entry.owner.invalidate(code,event),login:()=>({...entry.login,env:{...entry.login.env}})});}
