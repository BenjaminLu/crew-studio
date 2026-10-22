import "./lib/isolated-env.mjs";
import AdmZip from 'adm-zip';
import {strict as a} from 'node:assert';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,mkdirSync,symlinkSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {WorkflowPackages,encodePackage,verifyPackage,snapshotPackage,packageSha,boundedDescriptorBytes} from '../src/workflow-package';
const data=mkdtempSync(join(tmpdir(),'crew-package-'));let assertions=0;const check=(f:()=>void)=>{f();assertions++;};
const definition:any={id:'test',name:'Exact v2',version:2,roles:[],nodes:[{id:'done',kind:'hook',label:'Done',x:0,y:0}],edges:[],origin:{schema:1,source:'starter',brief:{goal:'private interview'}}};
try{
 const bytes=snapshotPackage(definition,data),v=verifyPackage(bytes);check(()=>a.equal(v.manifest.source.version,2));check(()=>a(!bytes.includes(Buffer.from('private interview'))));
 const zip=join(data,'standard.zip');writeFileSync(zip,bytes);const py=spawnSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;assert 'workflow/definition.json' in z.namelist()",zip]);check(()=>a.equal(py.status,0,py.stderr.toString()));
 let time=0;const service=new WorkflowPackages(data,()=>time),one=service.preview('alice',bytes.toString('base64'));check(()=>a(!existsSync(service.root)));check(()=>a.throws(()=>service.file('bob',one.token,'workflow/definition.json')));check(()=>a.equal(service.file('alice',one.token,'workflow/definition.json').viewable,true));service.cancel('alice',one.token);check(()=>a(!existsSync(service.root)));check(()=>a.throws(()=>service.commit('alice',one.token)));
 const two=service.preview('alice',bytes.toString('base64')),saved=service.commit('alice',two.token);check(()=>a.equal(service.list().length,1));check(()=>a.equal(saved.status,'held'));check(()=>a.throws(()=>service.commit('alice',two.token)));check(()=>a(!existsSync(join(data,'workflows'))));const reopened=service.reopen('alice',saved.id);check(()=>a.equal(reopened.sha256,two.sha256));time=300001;check(()=>a.throws(()=>service.commit('alice',reopened.token)));service.remove(saved.id);check(()=>a.equal(service.list().length,0));
 const corrupt=Buffer.from(bytes);corrupt[35]^=1;check(()=>a.throws(()=>verifyPackage(corrupt)));const compressed=Buffer.from(bytes);compressed.writeUInt16LE(8,8);check(()=>a.throws(()=>verifyPackage(compressed)));
 const files=new Map([['workflow/definition.json',Buffer.from(JSON.stringify({...definition,origin:undefined}))],['skills/test/v1/files/evil.sh',Buffer.from('touch '+join(data,'MUST_NOT_RUN'))]]);const manifest:any={...v.manifest,files:[...files].map(([path,b])=>({path,size:b.length,sha256:packageSha(b)}))};const inert=encodePackage(files,manifest);service.commit('alice',service.preview('alice',inert.toString('base64')).token);check(()=>a(!existsSync(join(data,'MUST_NOT_RUN'))));check(()=>a.equal(service.list()[0].manifest.files.length,2));

 const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
 const bad=(change)=>{const b=Buffer.from(bytes);change(b);check(()=>a.throws(()=>verifyPackage(b)));};
 bad(b=>b[30+b.readUInt16LE(26)]^=1); // actual data CRC mismatch
 bad(b=>b.writeUInt16LE(1,central+8)); // encryption
 bad(b=>b.writeUInt32LE(0xa0000000,central+38)); // symlink mode
 bad(b=>b.writeUInt32LE(0x10000000,central+38)); // special file mode
 bad(b=>b.writeUInt16LE(1,central+30)); // central extra
 bad(b=>b.writeUInt16LE(1,28)); // local extra
 bad(b=>b.writeUInt32LE(1,central+42)); // wrong local offset
 bad(b=>b.writeUInt32LE(3*1024*1024,central+24)); // size bomb
 bad(b=>b.writeUInt16LE(65535,b.length-12)); // ZIP64 sentinel count
 bad(b=>b[30]=46); // local/central name mismatch
 const makeZip=(entries)=>{const z=new AdmZip();for(const [name,value]of entries){z.addFile(name,Buffer.from(value));z.getEntry(name).header.method=0;}return z.toBuffer();};
 check(()=>a.throws(()=>verifyPackage(makeZip([['../evil','x']]))));
 check(()=>a.throws(()=>verifyPackage(makeZip([['UPPER','x'],['upper','x']]))));
 check(()=>a.throws(()=>verifyPackage(makeZip([['manifest.json',JSON.stringify(v.manifest)],['workflow/definition.json','{}'],['unlisted','x']]))));
 const wrong={...v.manifest,files:v.manifest.files.map(f=>({...f,sha256:'0'.repeat(64)}))};check(()=>a.throws(()=>verifyPackage(encodePackage(new Map([['workflow/definition.json',v.files.get('workflow/definition.json')]]),wrong))));
 const capped=new WorkflowPackages(join(data,'caps'));for(let i=0;i<4;i++)capped.preview('same',bytes.toString('base64'));check(()=>a.throws(()=>capped.preview('same',bytes.toString('base64'))));for(let i=0;i<12;i++)capped.preview('owner-'+i,bytes.toString('base64'));check(()=>a.throws(()=>capped.preview('another',bytes.toString('base64'))));check(()=>a(!existsSync(capped.root)));
 const unknown=verifyPackage(snapshotPackage({...definition,customExecution:{script:'never-run'}},data));check(()=>a(unknown.manifest.holds.some(x=>x.includes('customExecution'))));check(()=>a(unknown.files.get('workflow/definition.json')!.toString().includes('never-run')));
 const tooManyHolds={...v.manifest,holds:Array(10000).fill('')};check(()=>a.throws(()=>verifyPackage(encodePackage(new Map([['workflow/definition.json',v.files.get('workflow/definition.json')]]),tooManyHolds))));
 const nested={...v.manifest,dependencies:[[[[[[[[[['deep']]]]]]]]]]};check(()=>a.throws(()=>verifyPackage(encodePackage(new Map([['workflow/definition.json',v.files.get('workflow/definition.json')]]),nested))));
 const grown=join(data,'grown');writeFileSync(grown,'ABCD');const grownFd=openSync(grown,'r');try{check(()=>a.throws(()=>boundedDescriptorBytes(grownFd,1,4),/changed while reading/));}finally{closeSync(grownFd);}
 const roleDir=join(data,'skills','test','writer');mkdirSync(roleDir,{recursive:true});writeFileSync(join(roleDir,'v1.md'),'immutable role snapshot');const roleIndex=JSON.stringify([{n:1,sha256:packageSha('immutable role snapshot')}]);writeFileSync(join(roleDir,'index.json'),roleIndex);const rolePackage=verifyPackage(snapshotPackage({...definition,roles:[{id:'writer',label:'Writer',skill:'bundled:workflows/skills/v2/writer.md'}]},data));check(()=>a([...rolePackage.files].some(([p,b])=>p.startsWith('roles/writer-v1-')&&b.toString()==='immutable role snapshot')));check(()=>a.equal(readFileSync(join(roleDir,'index.json'),'utf8'),roleIndex));
 const missingId={...v.manifest,source:{version:2,recordSha256:v.manifest.source.recordSha256}};const missingDef=Buffer.from(JSON.stringify({version:2,roles:[],nodes:[],edges:[]}));missingId.files=[{path:'workflow/definition.json',size:missingDef.length,sha256:packageSha(missingDef)}];check(()=>a.throws(()=>verifyPackage(encodePackage(new Map([['workflow/definition.json',missingDef]]),missingId))));
 const folder=join(data,'skills','_library','fixture');mkdirSync(join(folder,'v1','files','scripts'),{recursive:true});const md=Buffer.from('fixture skill'),scriptFile=Buffer.from('echo inert');writeFileSync(join(folder,'v1','SKILL.md'),md);writeFileSync(join(folder,'v1','files','scripts','run.sh'),scriptFile);const filesHash=packageSha('scripts/run.sh\0'+packageSha(scriptFile));const rec={n:1,sha256:packageSha(md),filesSha256:filesHash,files:['scripts/run.sh']};writeFileSync(join(folder,'index.json'),JSON.stringify([rec]));const pinned={...definition,nodes:[{...definition.nodes[0],skills:[{id:'fixture',v:1,sha256:rec.sha256,filesSha256:filesHash}]}]};const included=verifyPackage(snapshotPackage(pinned,data));check(()=>a.equal(included.files.get('skills/fixture/v1/files/scripts/run.sh')?.toString(),'echo inert'));
 writeFileSync(join(folder,'index.json'),JSON.stringify([{...rec,files:Array.from({length:199},(_,i)=>'absent-'+i)}]));check(()=>a.throws(()=>snapshotPackage(pinned,data),/count limit/));writeFileSync(join(folder,'index.json'),JSON.stringify([rec]));
 const largeNames=['large0','large1','large2','large3','absent-after-cap'];for(const name of largeNames.slice(0,4))writeFileSync(join(folder,'v1','files',name),Buffer.alloc(2*1024*1024));writeFileSync(join(folder,'index.json'),JSON.stringify([{...rec,files:largeNames}]));check(()=>a.throws(()=>snapshotPackage(pinned,data),/bounded regular file/));writeFileSync(join(folder,'index.json'),JSON.stringify([rec]));
 writeFileSync(join(folder,'v1','files','scripts','run.sh'),'changed');check(()=>a.throws(()=>snapshotPackage(pinned,data),/supporting files changed/));rmSync(join(folder,'v1','files','scripts','run.sh'));symlinkSync(join(data,'standard.zip'),join(folder,'v1','files','scripts','run.sh'));check(()=>a.throws(()=>snapshotPackage(pinned,data),/link/));
 console.log(`${assertions} assertions passed`);
}finally{rmSync(data,{recursive:true,force:true});}
