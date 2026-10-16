// Host-owned source bindings. Never enqueue these receipts as captain/model input.
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readdirSync,existsSync,openSync,closeSync,fstatSync,readSync,constants,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import type {Engine} from '../runtime/engine';
export type NativeOrigin={host:string;thread:string;turn:string};
type Binding=NativeOrigin&{schema:1;proposal:string;source:string};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const sourceOf=(o:NativeOrigin)=>sha(JSON.stringify({schema:1,source:`${o.thread}:${o.turn}`}));
const validOrigin=(o:any)=>o&&['claude','codex'].includes(o.host)&&[o.thread,o.turn].every(v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f]/.test(v));
const validBinding=(b:any,id:string)=>validOrigin(b)&&b.schema===1&&b.proposal===id&&/^R-\d+$/.test(id)&&Object.keys(b).sort().join(',')==='host,proposal,schema,source,thread,turn'&&b.source===sourceOf(b);
function readOwned(file:string){const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.size>32768)throw Error('Invalid outcome file');const bytes=Buffer.alloc(32769);let total=0,n=0;while(total<bytes.length&&(n=readSync(fd,bytes,total,bytes.length-total,null))>0)total+=n;if(total>32768)throw Error('Oversized outcome file');return bytes.subarray(0,total).toString('utf8');}finally{closeSync(fd);}}
function createOwned(file:string,value:unknown){const text=JSON.stringify(value);if(Buffer.byteLength(text)>32768)throw Error('Oversized outcome record');const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,text);}finally{closeSync(fd);}}
export class NativeOutcomes {
 private dir:string;
 constructor(data:string,private engine:()=>Engine,private proof:(id:string)=>{complete:boolean;artifact?:string;version?:number;preview?:string}){this.dir=join(realpathSync(data),'native-outcomes');mkdirSync(this.dir,{recursive:true,mode:0o700});this.assertDirectory();}
 private assertDirectory(){if(!lstatSync(this.dir).isDirectory()||lstatSync(this.dir).isSymbolicLink()||realpathSync(this.dir)!==this.dir)throw Error('Invalid outcome directory');}
 bind(origin:NativeOrigin,result:any){
  this.assertDirectory();
  if(!validOrigin(origin)||!/^R-\d+$/.test(result?.proposal))return;
  const e=this.engine(),r=e.get(result.proposal),source=sourceOf(origin);
  if(!r||r.workflow!=='firstmate-proposal'||r.params.source!==source)throw new Error('Proposal origin mismatch');
  const b:Binding={schema:1,...origin,proposal:r.id,source},file=join(this.dir,`${r.id}.json`);
  if(existsSync(file)){if(readOwned(file)!==JSON.stringify(b))throw new Error('Proposal origin already bound');return;}
  createOwned(file,b);
 }
 list(host:string|null,thread:string|null){
  this.assertDirectory();
  if(!host||!thread)return[];
  const e=this.engine(),out:any[]=[];
  for(const file of readdirSync(this.dir).filter(f=>/^R-\d+\.json$/.test(f))){try{
   const b:Binding=JSON.parse(readOwned(join(this.dir,file)));
   if(!validBinding(b,file.slice(0,-5))||b.host!==host||b.thread!==thread)continue;
   const proposal=e.get(b.proposal),trust=proposal&&e.trusted(proposal.id);
   if(!proposal||proposal.workflow!=='firstmate-proposal'||proposal.params.source!==b.source||!trust?.ok)continue;
   const dispatch=trust.entries.filter(v=>v.record==='native-dispatch').at(-1)?.data;
   if(!dispatch&&['failed','cancelled'].includes(proposal.status)&&proposal.endedAt){
    // No claimed child/artifact: a launch error is a proposal outcome, not success.
    const receipt={id:`native-outcome:${proposal.id}:proposal`,at:Date.parse(proposal.endedAt),kind:'system' as const,source:'studio:native-outcome',text:`${proposal.id}: ${proposal.status==='failed'?'派工提案失敗，請查看任務診斷；未確認已派出子任務':'派工提案已取消'}。`,links:[{label:`Proposal ${proposal.id}`,href:`#/run/${proposal.id}`}]};
    const receiptFile=join(this.dir,`${proposal.id}-proposal.receipt.json`);
    if(!existsSync(receiptFile))createOwned(receiptFile,{schema:1,binding:b,status:proposal.status,endedAt:proposal.endedAt,receipt});
    const saved=JSON.parse(readOwned(receiptFile));if(saved.schema!==1||!validBinding(saved.binding,proposal.id)||JSON.stringify(saved.binding)!==JSON.stringify(b)||saved.status!==proposal.status||saved.endedAt!==proposal.endedAt)continue;
    out.push(receipt);continue;
   }
   if(!dispatch||dispatch.schema!==1||dispatch.proposal!==proposal.id||dispatch.definition!==proposal.params.definition)continue;
   const card=e.cards.get(dispatch.card),child=e.get(dispatch.child);
   if(!card||card.run!==proposal.id||card.node!=='dispatch'||!card.captainOnly||card.status!=='answered'||card.answer?.choice!=='approve'||!trust.entries.some(v=>v.record==='card-answer'&&v.data?.card===card.id&&v.data?.choice==='approve'))continue;
   if(!child||child.params._firstmateProposal!==proposal.id||child.params._firstmateDefinition!==dispatch.definition||child.workflow!==dispatch.workflow||child.version!==dispatch.version||!['coffee-kit','image'].includes(child.def.kind))continue;
   if(!['succeeded','failed','cancelled'].includes(child.status)||!child.endedAt)continue;
   const childTrust=e.trusted(child.id);if(!childTrust.ok)continue;
   const proof=this.proof(child.id),approved=child.status==='succeeded'&&proof.complete;
   const state=approved?'approved':child.status==='succeeded'?'ended-unapproved':child.status;
   const links=[{label:`Task ${child.id}`,href:`#/run/${child.id}`}];
   if(approved&&proof.artifact&&Number.isSafeInteger(proof.version)&&proof.version!>0)links.push({label:`Approved ${child.def.kind==='image'?'image':'website'} v${proof.version}`,href:`#/review/${encodeURIComponent(proof.artifact)}/${proof.version}`});
   const receipt={id:`native-outcome:${proposal.id}:${child.id}`,at:Date.parse(child.endedAt),kind:'system' as const,source:'studio:native-outcome',text:`${child.id}: ${state==='approved'?(child.def.kind==='image'?'圖片已完成並通過船長驗收':'網站已完成並通過船長驗收'):state==='failed'?'任務失敗':state==='cancelled'?'任務已取消':'流程已結束，未確認作品通過驗收'}。`,links};
   // Stable identity + persisted terminal evidence: replay/restart projects one entry.
   const receiptFile=join(this.dir,`${proposal.id}-${child.id}.receipt.json`);
   if(!existsSync(receiptFile))createOwned(receiptFile,{schema:1,binding:b,child:child.id,status:child.status,result:child.result,endedAt:child.endedAt,receipt});
   const saved=JSON.parse(readOwned(receiptFile));if(saved.schema!==1||!validBinding(saved.binding,proposal.id)||JSON.stringify(saved.binding)!==JSON.stringify(b)||saved.child!==child.id||saved.endedAt!==child.endedAt||saved.status!==child.status)continue;
   out.push(receipt);
  }catch{/* Missing/corrupt authority is never guessed or delivered to another session. */}}
  return out.sort((a,b)=>a.at-b.at);
 }
}
