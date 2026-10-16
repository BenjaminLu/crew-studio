// Actual bounded subprocess fixture; never calls a vendor.
import {createInterface} from 'node:readline';
import {writeFileSync,mkdirSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const args=process.argv.slice(2);
if(args[0]!=='app-server'||!args.includes('image_generation')||!args.includes('shell_tool')||!args.includes('web_search="disabled"')||!args.includes('sandbox_mode="read-only"'))process.exit(9);
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let n=0;n<8;n++)c=c>>>1^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;}
function chunk(name,b){const n=Buffer.from(name),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([n,b])));return Buffer.concat([l,n,b,c]);}
const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,161,90,28,255]))),chunk('IEND',Buffer.alloc(0))]);
const out=x=>console.log(JSON.stringify(x));const rpc=(m,result)=>out({jsonrpc:'2.0',id:m.id,result});
const event=(method,params)=>out({jsonrpc:'2.0',method,params});
let base='';
createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{return;}if(!m.method)return;
 if(m.method==='initialize')return rpc(m,{});
 if(m.method==='thread/start'){
  if(m.params.approvalPolicy!=='never'||m.params.sandbox!=='read-only'||m.params.model!=='fixture-model'||m.params.config['features.shell_tool']!==false||m.params.config['features.image_generation']!==true)return process.exit(10);
  // the captain's operating rules always lead the image job's base instructions
  if(typeof m.params.baseInstructions!=='string'||!m.params.baseInstructions.includes('# Operating rules (set by the captain)'))return process.exit(12);base=m.params.baseInstructions;
  return rpc(m,{thread:{id:'thread-1'},model:'fixture-model'});
 }
 if(m.method!=='turn/start')return;
 if(m.params.model!=='fixture-model'||m.params.effort!=='low'||m.params.threadId!=='thread-1')return process.exit(11);
 const prompt=m.params.input[0].text,mustRule=prompt.match(/RULES_MUST:(\S+)/)?.[1],mode=prompt.split('MODE:')[1]?.trim().split(/\s/)[0]||'success',planted=prompt.match(/PLANTED:([^\n]+)/)?.[1];
 if(mode==='reference'){
  const ref=m.params.input[1],expected=prompt.match(/REFERENCE_SHA:([a-f0-9]{64})/)?.[1];
  if(m.params.input.length!==2||ref?.type!=='image'||typeof ref.url!=='string'||!ref.url.startsWith('data:image/png;base64,')||createHash('sha256').update(Buffer.from(ref.url.slice(22),'base64')).digest('hex')!==expected){event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'failed'}});return;}
 }
 if(mustRule&&!base.includes(mustRule))return process.exit(13);
 rpc(m,{turn:{id:'turn-1'}});
 event('item/completed',{threadId:'thread-1',turnId:'turn-1',item:{type:'userMessage',id:'user-1'}});
 if(mode==='timeout')return;
 if(mode==='permission'){out({jsonrpc:'2.0',id:900,method:'item/commandExecution/requestApproval',params:{}});return;}
 if(mode==='oversize'){process.stdout.write('X'.repeat(49*1024*1024));return;}
 let item={type:'imageGeneration',id:'image-1',status:'completed',result:png.toString('base64')};
 if(mode==='malformed')item.result='not a PNG';
 if(mode==='fake-png')item.result=Buffer.from('PNG fixture pretending').toString('base64');
 if(mode==='failed')item.failure={code:'unsupported'};
 if(mode==='partial')item.status='in_progress';
 if(mode==='outside')item.savedPath=planted;
 if(mode==='saved'||mode==='symlink'){
  const generated=join(process.env.CODEX_HOME,'generated_images');mkdirSync(generated,{recursive:true});
  const path=join(generated,'coffee.png');
  if(mode==='symlink')symlinkSync(planted,path);else writeFileSync(path,png);item.savedPath=path;
 }
 if(mode==='os-deny'){
  let denied=false;try{readFileSync(join(process.cwd(),'../../outside.txt'));}catch{denied=true;}if(!denied)process.exit(12);
 }
 if(mode==='unexpected-tool')item={type:'commandExecution',id:'shell-1'};
 if(mode!=='text-only')event('item/completed',{threadId:mode==='wrong-thread'?'foreign':'thread-1',turnId:mode==='wrong-turn'?'foreign':'turn-1',item});
 if(mode==='duplicate')event('item/completed',{threadId:'thread-1',turnId:'turn-1',item});
 event('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:mode==='turn-failed'?'failed':'completed'}});
 if(mode==='post-completion-duplicate')event('item/completed',{threadId:'thread-1',turnId:'turn-1',item});
});
