// Desktop-owned official Claude sign-in: runs `claude auth login` in the ordinary account context.
// The CLI opens the browser OAuth itself and stores the credential where it always does (the login
// Keychain on macOS). Studio never reads, prints or keeps its output, and never writes credentials
// or config. Signing in makes no model request; the paid Verify stays a separate explicit action.
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {probeProcess} from '../providers/probe-process';
import {claudeAccountEnv} from '../providers/claude-native';
type State='idle'|'pending'|'done'|'failed'|'cancelled'|'timeout';
export type ClaudeLoginView={state:State;reason:string;reasonZh:string};
const argv=(bin:string)=>/\.(?:mjs|js|ts)$/.test(bin)?[process.execPath,bin,'auth','login']:[bin,'auth','login'];
export class ClaudeLogin{
 private state:ClaudeLoginView={state:'idle',reason:'Sign in to Claude with your account in the browser.',reasonZh:'在瀏覽器使用你的帳號登入 Claude。'};
 private owner:{proc:ReturnType<typeof probeProcess>;root:string;cancelled:boolean}|null=null;
 constructor(private readonly o:{bin?:()=>string;loginMs?:number;changed?:()=>void;signedIn?:()=>void}={}){}
 view():ClaudeLoginView{return{...this.state};}
 private set(state:State,reason:string,reasonZh:string){this.state={state,reason,reasonZh};this.o.changed?.();}
 /** Start the official browser sign-in; returns at once while the CLI waits for the browser. */
 start():ClaudeLoginView{
  if(this.owner)throw new Error('A Claude sign-in is already running / Claude 登入正在進行');
  const bin=this.o.bin?.()??process.env.CREW_CLAUDE_BIN??'claude',root=mkdtempSync(join(tmpdir(),'crew-claude-login-'));
  // Output stays private and bounded: it may hold the sign-in URL or code, which only the CLI/browser shows.
  const proc=probeProcess(argv(bin),root,claudeAccountEnv(),undefined,{timeoutMs:this.o.loginMs??300000,bytes:64*1024});
  const a={proc,root,cancelled:false};this.owner=a;
  this.set('pending','Continue in the browser window Claude opened. Cancel to stop.','請在 Claude 開啟的瀏覽器視窗繼續；可按取消停止。');
  void proc.exited.then(code=>this.finish(a,code),()=>this.finish(a,null,true));
  return this.view();
 }
 private finish(a:NonNullable<ClaudeLogin['owner']>,code:number|null,unclean=false){
  if(this.owner!==a)return;this.owner=null;if(!unclean)rmSync(a.root,{recursive:true,force:true});
  if(unclean)return this.set('failed','Claude sign-in cleanup is unverified. Restart Studio before retrying.','Claude 登入程序的清理尚未確認；請重新啟動 Studio 後再試。');
  if(a.cancelled)return this.set('cancelled','Sign-in cancelled.','已取消登入。');
  if(a.proc.output().failure==='probe deadline expired')return this.set('timeout','Sign-in timed out. Try again.','登入逾時；請再試一次。');
  if(code===0){this.o.signedIn?.();return this.set('done','Sign-in finished.','登入完成。');}
  this.set('failed','Claude sign-in did not complete. Try again.','Claude 登入未完成；請再試一次。');
 }
 async cancel():Promise<ClaudeLoginView>{const a=this.owner;if(!a)return this.view();a.cancelled=true;try{await a.proc.stop();}catch{}await a.proc.exited.catch(()=>{});this.finish(a,null);return this.view();}
 async shutdown(){await this.cancel();}
}
