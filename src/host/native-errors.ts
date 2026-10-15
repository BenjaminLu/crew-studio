import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,lstatSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {NativeToolFailure,type NativeFailure} from './types';
export type NativeDiagnostic={schema:1;correlationId:string;at:string;tool:string;category:string;fingerprint:string;frames:string[]};
// No raw message, arguments, captain text, account identity or filesystem paths leave this boundary.
export function nativeToolError(error:unknown,tool:string,diagnose?:(d:NativeDiagnostic)=>boolean,correlationId=randomUUID()):NativeFailure{
 if(error instanceof NativeToolFailure)return error.publicFailure;
 if(error instanceof Error&&error.name==='AbortError')return new NativeToolFailure('cancelled','The operation was cancelled. Read the current state before deciding whether to try again.','操作已取消；請先讀取目前狀態，再決定是否重試。','read_current_state',false).publicFailure;
 if(error instanceof Error&&error.name==='TimeoutError')return new NativeToolFailure('timeout','The operation timed out. Read the current state; do not duplicate work that may have completed.','操作逾時；請先讀取目前狀態，不要重複可能已完成的工作。','read_current_state',false).publicFailure;
 const name=error instanceof Error&&['Error','TypeError','SyntaxError','RangeError'].includes(error.name)?error.name:'UnknownError';
 const text=error instanceof Error?error.name+'\n'+error.message:String(typeof error);
 const frames=error instanceof Error?(error.stack??'').split('\n').slice(1).flatMap(line=>{const m=/\/(firstmate(?:-staffing|-projects)?|codex|main|native-errors)\.ts:(\d+):(\d+)/.exec(line);return m?[m[1]+'.ts:'+m[2]+':'+m[3]]:[]}).slice(0,5):[];
 const diagnostic:NativeDiagnostic={schema:1,correlationId,at:new Date().toISOString(),tool:/^studio_[a-z_]{1,60}$/.test(tool)?tool:'unknown',category:name,fingerprint:createHash('sha256').update(text).digest('hex'),frames};
 let recorded=false;try{recorded=diagnose?.(diagnostic)===true;}catch{}
 return {...new NativeToolFailure('internal_error','Studio encountered an unexpected tool error. Keep your current work and report this reference; do not approve or retry automatically.','Studio 工具發生非預期錯誤；請保留目前工作並回報此追蹤編號，不要自動核准或重試。','report_reference',false).publicFailure,correlationId,diagnosticRecorded:recorded};
}
export function writeNativeDiagnostic(dataDir:string,d:NativeDiagnostic):boolean{
 const dir=join(dataDir,'diagnostics'),file=join(dir,'native-tools.jsonl');if(existsSync(dir)&&lstatSync(dir).isSymbolicLink()||existsSync(file)&&(lstatSync(file).isSymbolicLink()||lstatSync(file).size>1048576))return false;
 mkdirSync(dir,{recursive:true,mode:0o700});appendFileSync(file,JSON.stringify(d)+'\n',{mode:0o600});return true;
}
