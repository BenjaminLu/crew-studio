// Claude CLI capability: passive auth metadata is separate from actual execution.
// No metadata read makes a model request. Only explicit desktop Verify can do so.
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,realpathSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';import{tmpdir,homedir}from'node:os';
import {probeProcess} from './probe-process';import{claudeLogin,claudeBilling,CLAUDE_OAUTH_SHAPE,CLAUDE_API_KEY_SHAPE,type Login}from'./login';
import{claudeProvider}from'./claude';import{claudeSettings}from'./needs';
import type{ProviderCapability}from'./policy';
export type ClaudePair={model:string;effort:string|null};
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
 private active:{abort:AbortController;done:Promise<ClaudeCapability>}|null=null;private unknownProcess:ReturnType<typeof probeProcess>|null=null;
 constructor(private options:{bin?:string;login?:()=>Login;authEnv?:()=>Record<string,string>}={}){}
 currentBinary(){return resolveBin(this.options.bin??process.env.CREW_CLAUDE_BIN??'claude')??'';}
 private base(p:ClaudePair,patch:Partial<ClaudeCapability>={}):ClaudeCapability{const at=Date.now();return{provider:'claude',available:!!this.currentBinary(),auth:'unverified',quota:this.denial?.code==='quotaExhausted'?'exhausted':'unknown',models:[],at,expires:at+30000,refusal:'unverified',loginState:'unknown',resetAt:this.denial?.resetAt??null,admission:'none',guidance:this.denial?.code==='quotaExhausted'?'Claude quota is exhausted. Wait for reset; do not sign in again. Reset time is unknown unless the CLI reports it. / Claude 額度已耗盡；請等待重設，不需重新登入。只有 CLI 回報時才有確切重設時間。':'Verify the selected Claude CLI/config context. Existing sessions may use another context. / 請確認選定的 Claude CLI 與設定環境；既有對話可能使用不同環境。',context:{executable:this.currentBinary()||null,configDirectory:null,version:null},...patch};}
 invalidate(code='cliError',event?:any){for(const cap of this.admitted.values()){const e=receipts.get(cap);if(e)e.valid=false;}this.admitted.clear();if(code==='cleanupUnverified')this.cleanupBlocked=true;if(code==='quotaExhausted'){const raw=event?.rate_limit_info?.resetsAt;const resetAt=typeof raw==='number'&&Number.isFinite(raw)&&raw>0?raw*1000:null;this.denial={code,resetAt,at:Date.now()};}else if(code==='notLoggedIn')this.authDenied=true;}
 /** A fresh official sign-in replaces the login an earlier status/runtime refusal described; quota denial is kept. */
 signedIn(){this.authDenied=false;}
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
   const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME||homedir(),LANG:'en_US.UTF-8',...loginUser(),...(process.env.CLAUDE_CODE_OAUTH_TOKEN?{CLAUDE_CODE_OAUTH_TOKEN:process.env.CLAUDE_CODE_OAUTH_TOKEN}:{}),...(claudeBilling()==='api-key'&&process.env.ANTHROPIC_API_KEY?{ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY}:{}),...this.options.authEnv?.(),...process.env.CLAUDE_CONFIG_DIR?{CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR}:{}};
   proc=probeProcess(argv(binary,['auth','status','--json']),root,env,undefined,{timeoutMs:8000,bytes:32768});const abort=()=>proc?.kill();signal?.addEventListener('abort',abort,{once:true});let code;try{code=await proc.exited;await proc.stop();}finally{signal?.removeEventListener('abort',abort);}
   if(signal?.aborted||proc.output().failure)return this.base(p,{reason:'Claude auth metadata is unavailable in this context'});
   let j:any;try{j=JSON.parse(proc.output().out);}catch{return this.base(p,{reason:'Claude auth metadata schema is unsupported'});}
   const context={executable:binary,configDirectory:typeof j.configDirectory==='string'&&j.configDirectory.length<=1000?j.configDirectory:null,version:null};
   if(j.loggedIn===false&&j.authMethod==='none'&&code===1){if(this.denial?.code!=='quotaExhausted')this.invalidate('notLoggedIn');return this.base(p,{auth:'missing',loginState:'not-logged-in',context,reason:'This CLI/config context reports no login; this does not describe unrelated existing Claude sessions',refusal:this.denial?.code==='quotaExhausted'?'exhausted':'missing-login'});}
   if(code!==0||j.loggedIn!==true||!['claude.ai','oauth_token','api_key'].includes(j.authMethod)||j.apiProvider!=='firstParty')return this.base(p,{context,reason:'Claude account/provider metadata is unsupported'});
   if(this.denial?.code==='quotaExhausted')return this.base(p,{auth:this.authDenied?'unverified':'verified',loginState:'logged-in',context,refusal:'exhausted',reason:'Claude is signed in but quota is exhausted; wait for reset, not login'});
   if(this.authDenied)return this.base(p,{loginState:'logged-in',context,reason:'This CLI stores a login, but runtime authentication was refused; selected-context authentication is unverified'});
   const cached=this.admitted.get(pairKey(p));if(cached&&isClaudeExecutionAdmission(cached,p))return cached;
   return this.base(p,{auth:'verified',loginState:'logged-in',context,reason:'Signed in; remaining quota and actual selected model execution are unverified. Explicit Verify is required.'});
  }catch{return this.base(p,{reason:'Claude auth metadata is unavailable in this context'});}finally{if(proc)try{await proc.stop();}catch{clean=false;this.unknownProcess=proc;}if(clean)rmSync(root,{recursive:true,force:true});}
 }
 async verify(p:ClaudePair,o:{confirm:boolean;signal?:AbortSignal;timeoutMs?:number;}):Promise<ClaudeCapability>{
  if(o.confirm!==true||!validClaudePair(p))return this.base(p,{reason:'Explicit confirmation of the exact configured Claude model/effort is required'});
  if(this.active)return this.base(p,{reason:'A Claude verification is already running'});
  if(this.denial?.code==='quotaExhausted'&&(!this.denial.resetAt||this.denial.resetAt>Date.now()))return this.base(p,{reason:'Quota is exhausted; do not retry before reset'});
  const abort=new AbortController(),onAbort=()=>abort.abort();o.signal?.addEventListener('abort',onAbort,{once:true});if(o.signal?.aborted)abort.abort();
  const done=this.runVerify(p,abort.signal,o.timeoutMs??120000);this.active={abort,done};try{return await done;}finally{o.signal?.removeEventListener('abort',onAbort);this.active=null;}
 }
 private async runVerify(p:ClaudePair,signal:AbortSignal,timeoutMs:number):Promise<ClaudeCapability>{
  if(!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>120000)return this.base(p,{reason:'Claude verification deadline is invalid'});
  const auth=await this.status(p,signal);if(auth.loginState!=='logged-in'||signal.aborted)return auth;
  const login=(this.options.login??(()=>claudeLogin({record:false})))();if(!login.ok)return this.base(p,{auth:'verified',loginState:'logged-in',reason:'Selected CLI is signed in but its credential cannot be safely isolated for a native worker'});
  const keys=Object.keys(login.env);if(keys.length!==1||!(keys[0]==='CLAUDE_CODE_OAUTH_TOKEN'&&CLAUDE_OAUTH_SHAPE.test(login.env[keys[0]])||keys[0]==='ANTHROPIC_API_KEY'&&CLAUDE_API_KEY_SHAPE.test(login.env[keys[0]])))return this.base(p,{reason:'Claude isolated credential snapshot is unsupported'});
  const root=mkdtempSync(join(tmpdir(),'crew-claude-verify-')),home=join(root,'home'),config=join(home,'.claude'),work=join(root,'work'),temp=join(root,'tmp');for(const d of[config,work,temp])mkdirSync(d,{recursive:true});
  let proc:ReturnType<typeof probeProcess>|null=null,clean=true;const deadline=Date.now()+timeoutMs;const abort=()=>proc?.kill();signal.addEventListener('abort',abort,{once:true});
  try{
   if(signal.aborted)throw 0;const binary=this.currentBinary();if(!binary)throw 0;
   const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:home,...loginUser(),CLAUDE_CONFIG_DIR:config,TMPDIR:temp,CLAUDE_CODE_TMPDIR:temp,LANG:'en_US.UTF-8',DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',...login.env,...p.effort?{CLAUDE_CODE_EFFORT_LEVEL:p.effort}:{}};
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
   receipts.set(cap,{valid:true,pair:{...p},expires:cap.expires,login:{...login,env:{...login.env}},owner:this,binary});this.admitted.set(pairKey(p),cap);return cap;
  }catch{return this.base(p,{auth:auth.auth,loginState:auth.loginState,reason:'Claude bounded verification did not establish readiness; no work or fallback was started'});}finally{signal.removeEventListener('abort',abort);if(proc)try{await proc.stop();}catch{clean=false;this.unknownProcess=proc;this.invalidate();}if(clean)rmSync(root,{recursive:true,force:true});}
 }
 async cancel(){this.active?.abort.abort();if(this.active)await this.active.done;}
}
export const nativeClaude=new ClaudeNative();
export const probeClaudeNative=(p:ClaudePair,signal?:AbortSignal)=>nativeClaude.status(p,signal);
export function makeNativeClaudeProvider(cap:ProviderCapability,p:ClaudePair){const entry=receipts.get(cap);if(!entry||!isClaudeExecutionAdmission(cap,p))throw new Error('Claude native execution receipt is unavailable');return claudeProvider(p.model,entry.binary,{...p,live:()=>isClaudeExecutionAdmission(cap,p),invalidate:(code,event)=>entry.owner.invalidate(code,event),login:()=>({...entry.login,env:{...entry.login.env}})});}
