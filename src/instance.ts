// Local launch authority. HTTP never supplies a session credential. The opener
// accepts only private owned files plus a live server challenge proof.
import {mkdirSync,lstatSync,readFileSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';import {join,resolve} from 'node:path';import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
type RecordV1={schema:1;boot:string;pid:number;origin:string;data:string};
export type RunningInstance=RecordV1&{token:string};
export const runtimeDir=()=>resolve(process.env.CREW_RUNTIME_DIR||join(homedir(),'.crew-studio','runtime'));
function privatePath(path:string,dir=false){const s=lstatSync(path);if(s.isSymbolicLink()||(dir?!s.isDirectory():!s.isFile())||(s.mode&0o077)!==0||s.uid!==process.getuid?.())throw new Error('Studio launch file is not private and owned');if(!dir&&s.size>8192)throw new Error('Studio launch record too large');}
function directory(create=false){const d=runtimeDir();if(create)mkdirSync(d,{recursive:true,mode:0o700});privatePath(d,true);return d;}
function proof(token:string,boot:string,challenge:string){return createHmac('sha256',token).update(`crew-launch-v1\0${boot}\0${challenge}`).digest('hex');}
export function registerInstance(port:number,data:string,token:string){const d=directory(true),boot=randomBytes(24).toString('hex');const record:RecordV1={schema:1,boot,pid:process.pid,origin:`http://127.0.0.1:${port}`,data:resolve(data)};
 const key=join(d,boot+'.key'),file=join(d,boot+'.json');writeFileSync(key,token,{mode:0o600,flag:'wx'});try{writeFileSync(file,JSON.stringify(record),{mode:0o600,flag:'wx'})}catch(e){unlinkSync(key);throw e;}
 const cleanup=()=>{for(const p of [file,key])try{unlinkSync(p)}catch{}};process.once('exit',cleanup);
 return{record,cleanup,respond(challenge:string|null){return{pid:record.pid,boot,...(challenge&&/^[a-f0-9]{48}$/.test(challenge)?{proof:proof(token,boot,challenge)}:{})}}};
}
export async function discoverInstance():Promise<RunningInstance|null>{let d:string,names:string[];try{d=directory();names=readdirSync(d)}catch(e:any){if(e.code==='ENOENT')return null;throw e;}
 const matches:RunningInstance[]=[];if(names.length>256)throw new Error('Too many Studio launch records; inspect the private runtime directory');
 for(const name of names.filter(n=>/^[a-f0-9]{48}\.json$/.test(n))){let r:RecordV1,token:string;try{const file=join(d,name),key=join(d,name.replace(/\.json$/,'.key'));privatePath(file);privatePath(key);r=JSON.parse(readFileSync(file,'utf8'));token=readFileSync(key,'utf8');if(r.schema!==1||r.boot!==name.slice(0,-5)||!Number.isSafeInteger(r.pid)||r.pid<=1||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(r.origin)||new URL(r.origin).port==='0'||typeof r.data!=='string'||resolve(r.data)!==r.data||!token||token.length>4096)continue;if(process.env.CREW_DATA&&resolve(process.env.CREW_DATA)!==r.data||process.env.CREW_PORT&&new URL(r.origin).port!==process.env.CREW_PORT)continue;process.kill(r.pid,0);}catch{continue;}
  const challenge=randomBytes(24).toString('hex');try{const response=await fetch(`${r.origin}/api/instance?challenge=${challenge}`,{signal:AbortSignal.timeout(1000),redirect:'error'});if(!response.ok)continue;const reader=response.body?.getReader();if(!reader)continue;let body='',bytes=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>2048)throw new Error('Oversized instance proof');body+=new TextDecoder().decode(chunk.value);}}finally{await reader.cancel().catch(()=>{});}const v=JSON.parse(body),expected=proof(token,r.boot,challenge);if(v.pid!==r.pid||v.boot!==r.boot||typeof v.proof!=='string'||v.proof.length!==expected.length||!timingSafeEqual(Buffer.from(v.proof),Buffer.from(expected)))continue;matches.push({...r,token});}catch{}
 }
 if(matches.length>1)throw new Error('Several Studio instances are running. Select the intended CREW_DATA or CREW_PORT explicitly.');return matches[0]??null;
}
