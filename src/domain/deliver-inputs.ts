// Read-only, exact-version text inputs from related producers in this Task.
// No caller-supplied artifact IDs, paths, URLs or other Tasks become read authority.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {insideDir,type AgentTool} from '../agent';
import type {ArtifactStore} from '../artifacts';
import type {X} from '../runtime/engine';
const SOURCES:Record<string,string>={document:'doc.md',web:'index.html',video:'film.html'};
export const DELIVER_INPUT_MAX_BYTES=256*1024;
export type DeliverInput={task:string;producer:string;label:string;id:string;n:number;sha256:string;format:string;source:string;bytes:number};
function sourceBytes(store:ArtifactStore,task:string,pin:DeliverInput){
 if(pin.task!==task||typeof pin.id!=='string'||!Number.isSafeInteger(pin.n)||pin.n<1||typeof pin.sha256!=='string'||!/^[a-f0-9]{64}$/.test(pin.sha256)||!Object.hasOwn(SOURCES,pin.format)||pin.source!==SOURCES[pin.format])throw Error('Input is not an allowed Task text source');
 const version=store.version(pin.id,pin.n),file=version?.files.find(f=>f.path===pin.source);
 if(!version||version.source?.run!==task||version.primary!==pin.source||version.sha256!==pin.sha256||file?.sha256!==pin.sha256)throw Error('Input version does not match its Task pin');
 const path=insideDir(store.root,relative(store.root,store.filesDir(pin.id,pin.n))+'/'+pin.source,false),stat=lstatSync(path);
 if(!stat.isFile()||stat.size>DELIVER_INPUT_MAX_BYTES||stat.size!==file.size)throw Error('Input source exceeds its bounded text contract');
 const bytes=readFileSync(path);if(bytes.length>DELIVER_INPUT_MAX_BYTES||createHash('sha256').update(bytes).digest('hex')!==pin.sha256||bytes.includes(0))throw Error('Input source integrity changed or is not text');
 return bytes;
}
export function captureDeliverInputs(x:X,store:ArtifactStore):DeliverInput[]{
 // Reverse reachability also includes feedback producers when a revision edge returns to this node.
 const related=new Set<string>(),pending=[x.node.id];while(pending.length){const to=pending.pop()!;for(const edge of x.run.def.edges)if(edge.to===to&&!related.has(edge.from)){related.add(edge.from);pending.push(edge.from);}}
 const pins:DeliverInput[]=[];
 for(const ref of Object.values(x.ctx.deliver??{}) as any[]){
  if(ref.producer===x.node.id||!related.has(ref.producer)||!Object.hasOwn(SOURCES,ref.format))continue;
  const producer=x.run.def.nodes.find(n=>n.id===ref.producer&&n.kind==='agent'&&n.mode==='deliver');if(!producer)continue;
  const pin:DeliverInput={task:x.run.id,producer:ref.producer,label:producer.label,id:ref.id,n:ref.n,sha256:ref.sha256,format:ref.format,source:SOURCES[ref.format],bytes:0};
  const bytes=sourceBytes(store,x.run.id,pin);pin.bytes=bytes.length;pins.push(pin);
 }
 if(pins.length>24)throw Error('Too many related text inputs');
 return pins.sort((a,b)=>a.producer.localeCompare(b.producer));
}
export function deliverInputTools(store:ArtifactStore,task:string,inputs:DeliverInput[],owns:()=>boolean):AgentTool[]{
 const pins=structuredClone(inputs).map(p=>Object.freeze(p));
 const active=()=>{if(!owns())throw Error('input read owner ended');};
 return[
  {name:'input_list',description:'List fixed-version text inputs from related producers in this Task. These sources are read-only and are not files in the writable work folder.',schema:{type:'object',properties:{},additionalProperties:false},run(args){active();if(!args||Object.keys(args).length)throw Error('input_list takes no arguments');for(const pin of pins)sourceBytes(store,task,pin);return{inputs:structuredClone(pins)};}},
  {name:'input_read',description:'Read one pinned producer source by line range (default 200, max 200 lines and 24000 characters). Follow nextOffset to finish long/minified lines. Use a producer from input_list; paths and arbitrary artifact IDs are not accepted.',schema:{type:'object',properties:{producer:{type:'string'},start:{type:'integer',minimum:1},lines:{type:'integer',minimum:1,maximum:200},offset:{type:'integer',minimum:0}},required:['producer'],additionalProperties:false},run(args){
   active();if(!args||Object.keys(args).some(k=>!['producer','start','lines','offset'].includes(k))||typeof args.producer!=='string')throw Error('Only producer and optional line range are accepted');
   const pin=pins.find(p=>p.producer===args.producer);if(!pin)throw Error('Unknown input producer for this Task round');
   const start=args.start??1,lines=args.lines??200,offset=args.offset??0;if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(lines)||lines<1||lines>200||!Number.isSafeInteger(offset)||offset<0||offset>DELIVER_INPUT_MAX_BYTES+4096)throw Error('Invalid bounded input line range');
   const all=sourceBytes(store,task,pin).toString('utf8').split('\n'),selected=all.slice(start-1,start-1+lines).map((line,i)=>`${start+i}\t${line}`).join('\n');
   const text=selected.slice(offset,offset+24000),nextOffset=offset+text.length<selected.length?offset+text.length:null;
   return{...pin,start,offset,totalLines:all.length,text,nextOffset,truncated:nextOffset!==null};
  }}
 ];
}
