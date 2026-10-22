/** ZIP with Node built-ins only: a deterministic writer (stored or deflate) and a strict bounded STORED-only reader (no compression, ZIP64, encryption, data descriptors, extras or comments). */
import {deflateRawSync} from 'node:zlib';

const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export const crc32=(b:Uint8Array)=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
const LOCAL=0x04034b50,CENTRAL=0x02014b50,END=0x06054b50,UTF8=0x800,DOS_DATE=0x21;

/** Entries in the given order with a fixed 1980-01-01 timestamp, so equal input gives equal bytes. `store` writes method 0 instead of deflate; `mode` records Unix file permissions. */
export function zip(files:{name:string;data:Buffer|string}[],opts:{store?:boolean;mode?:number}={}):Buffer{
 const parts:Buffer[]=[],central:Buffer[]=[],method=opts.store?0:8,madeBy=opts.mode===undefined?20:0x0314,attrs=opts.mode===undefined?0:(opts.mode<<16)>>>0;let off=0;
 for(const f of files){
  const raw=Buffer.isBuffer(f.data)?f.data:Buffer.from(f.data,'utf8'),comp=opts.store?raw:deflateRawSync(raw),name=Buffer.from(f.name,'utf8'),crc=crc32(raw);
  const lh=Buffer.alloc(30);lh.writeUInt32LE(LOCAL,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(UTF8,6);lh.writeUInt16LE(method,8);lh.writeUInt16LE(0,10);lh.writeUInt16LE(DOS_DATE,12);
  lh.writeUInt32LE(crc,14);lh.writeUInt32LE(comp.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(name.length,26);lh.writeUInt16LE(0,28);
  parts.push(lh,name,comp);
  const ch=Buffer.alloc(46);ch.writeUInt32LE(CENTRAL,0);ch.writeUInt16LE(madeBy,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(UTF8,8);ch.writeUInt16LE(method,10);ch.writeUInt16LE(0,12);ch.writeUInt16LE(DOS_DATE,14);
  ch.writeUInt32LE(crc,16);ch.writeUInt32LE(comp.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(name.length,28);ch.writeUInt32LE(attrs,38);ch.writeUInt32LE(off,42);
  central.push(ch,name);off+=30+name.length+comp.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(END,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cd,end]);
}

export type ZipLimits={archive:number;entry:number;total:number;count:number;name:(path:string)=>boolean};
export class ZipError extends Error{}
const fail=(s:string):never=>{throw new ZipError(s);};
/** Every entry must be stored (no decompressor runs), agree in its local and central headers, sit contiguously before the directory, match its CRC and stay inside the limits. */
export function unzip(b:Buffer,lim:ZipLimits):Map<string,Buffer>{
 if(b.length<22||b.length>lim.archive)fail('ZIP exceeds size limit or is truncated');
 const e=b.length-22;if(b.readUInt32LE(e)!==END||b.readUInt16LE(e+20)!==0)fail('ZIP comments/trailing data are unsupported');
 const count=b.readUInt16LE(e+10),size=b.readUInt32LE(e+12),offset=b.readUInt32LE(e+16);
 if(b.readUInt16LE(e+4)||b.readUInt16LE(e+6)||b.readUInt16LE(e+8)!==count||!count||count===0xffff||count>lim.count||offset+size!==e)fail('Unsupported ZIP directory, ZIP64 or entry count');
 const files=new Map<string,Buffer>(),seen=new Set<string>(),dirs=new Set<string>();let pos=offset,next=0,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>e||b.readUInt32LE(pos)!==CENTRAL)fail('Invalid ZIP central entry');
  const needed=b.readUInt16LE(pos+6),flags=b.readUInt16LE(pos+8),method=b.readUInt16LE(pos+10),crc=b.readUInt32LE(pos+16),compressed=b.readUInt32LE(pos+20),expanded=b.readUInt32LE(pos+24),n=b.readUInt16LE(pos+28),attrs=b.readUInt32LE(pos+38),local=b.readUInt32LE(pos+42);
  if(needed>20)fail('Unsupported ZIP version (ZIP64 or newer features)');
  if(method!==0)fail('Unsupported ZIP compression method: only stored entries are accepted');
  if(flags&~UTF8)fail('Encrypted or data-descriptor ZIP entries are unsupported');
  if(b.readUInt16LE(pos+30)||b.readUInt16LE(pos+32)||b.readUInt16LE(pos+34)||b.readUInt16LE(pos+36)||compressed!==expanded||expanded>lim.entry||pos+46+n>e)fail('Unsupported ZIP entry metadata or file size');
  const name=b.subarray(pos+46,pos+46+n),path=name.toString('utf8'),mode=(attrs>>>16)&0xf000;
  const lower=path.toLowerCase(),parents=lower.split('/').slice(0,-1).map((_,j,a)=>a.slice(0,j+1).join('/'));
  // a file may not share a name with another file or with a folder of another entry, in any letter case
  if(!lim.name(path)||seen.has(lower)||dirs.has(lower)||parents.some(p=>seen.has(p)))fail('ZIP entry name is duplicate, colliding or unsafe');seen.add(lower);for(const p of parents)dirs.add(p);
  if(mode&&mode!==0x8000||attrs&0x10)fail('ZIP link, directory or nonregular entry');
  if(local!==next||local+30+n>offset||b.readUInt32LE(local)!==LOCAL||b.readUInt16LE(local+4)!==needed||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method||b.readUInt32LE(local+14)!==crc||b.readUInt32LE(local+18)!==compressed||b.readUInt32LE(local+22)!==expanded||b.readUInt16LE(local+26)!==n||b.readUInt16LE(local+28)!==0||!b.subarray(local+30,local+30+n).equals(name))fail('ZIP local/central headers differ or entries overlap');
  const start=local+30+n;next=start+compressed;if(next>offset)fail('ZIP data overlaps directory');total+=expanded;if(total>lim.total)fail('Expanded ZIP exceeds limit');
  const data=Buffer.from(b.subarray(start,next));if(crc32(data)!==crc)fail('ZIP CRC mismatch');
  files.set(path,data);pos+=46+n;
 }
 if(pos!==e||next!==offset)fail('ZIP contains unlisted bytes or entries');
 return files;
}
