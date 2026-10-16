import {localUnrestricted} from "../local-execution";
// Dedicated source-owned image job. The ordinary Codex provider remains tool-restricted.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { binArgv } from '../host/jsonl';
import { Egress } from '../egress';
import { roundProfile, sandboxInfo } from '../runtime/checks';
import { codexNeeds, type ApprovedCodexConfig } from './needs';
import { probeCodex } from './codex-probe';
import { probeProcess } from './probe-process';
import type { ProviderCapability } from './policy';

const MAX_IMAGE = 16 * 1024 * 1024;
export type CodexImage = { bytes: Buffer; mime: 'image/png'; width: number; height: number; sha256: string; provider: 'codex'; model: string; effort: string | null };
export type CodexImageReference={bytes:Buffer;sha256:string};
export type CodexImageOptions = {
  /** Host-owned complete coffee evidence; not accepted from HTTP/tool arguments. */
  contextProfile?: "coffee-kit";
  reference?:CodexImageReference;
  prompt: string; approved: ApprovedCodexConfig; authorize(): void; signal?: AbortSignal;
  bin?: string; timeoutMs?: number;
  /** Source-owned dependency injection; never populated from a browser request. */
  probe?: (bin: string, signal?: AbortSignal) => Promise<ProviderCapability>;
};

function crc32(b: Buffer) { let crc = 0xffffffff; for (const v of b) { crc ^= v; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
/** Full bounded PNG framing/CRC and decompressed scanline validation, not extension sniffing. */
export function verifyImagePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 57 || bytes.length > MAX_IMAGE || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('image is not a bounded PNG');
  let p = 8, width = 0, height = 0, channels = 0, seenData = false, ended = false, dataEnded = false; const chunks: Buffer[] = [];
  while (p < bytes.length) {
    if (p + 12 > bytes.length) throw new Error('PNG chunk is truncated');
    const n = bytes.readUInt32BE(p), name = bytes.toString('ascii', p + 4, p + 8);
    if (n > MAX_IMAGE || p + 12 + n > bytes.length || !/^[A-Za-z]{4}$/.test(name)) throw new Error('PNG chunk is invalid');
    const b = bytes.subarray(p + 8, p + 8 + n);
    if (crc32(bytes.subarray(p + 4, p + 8 + n)) !== bytes.readUInt32BE(p + 8 + n)) throw new Error('PNG CRC is invalid');
    if (!width && name !== 'IHDR') throw new Error('PNG header is missing');
    if (name === 'IHDR') {
      if (width || n !== 13) throw new Error('PNG header is invalid');
      width = b.readUInt32BE(0); height = b.readUInt32BE(4); channels = ({ 0:1, 2:3, 4:2, 6:4 } as Record<number,number>)[b[9]] ?? 0;
      if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_777_216 || b[8] !== 8 || !channels || b[10] || b[11] || b[12]) throw new Error('PNG format or dimensions unsupported');
    } else if (name === 'IDAT') { if (dataEnded) throw new Error('PNG data is not contiguous'); seenData = true; chunks.push(b); }
    else if (name === 'IEND') { if (n || !seenData || p + 12 !== bytes.length) throw new Error('PNG end is invalid'); ended = true; }
    else { if (seenData) dataEnded = true; if (name[0] === name[0].toUpperCase() && name !== 'PLTE') throw new Error('PNG critical chunk unsupported'); }
    p += n + 12;
  }
  if (!ended) throw new Error('PNG end is missing');
  const stride = width * channels + 1, expected = stride * height;
  const data = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected + 1 });
  if (data.length !== expected) throw new Error('PNG scanlines are invalid');
  for (let y = 0; y < height; y++) if (data[y * stride] > 4) throw new Error('PNG scanline filter unsupported');
  return { width, height };
}

function approvedCapability(c: ProviderCapability, a: ApprovedCodexConfig) {
  const now = Date.now();
  if (!c || c.provider !== 'codex' || c.available !== true || c.auth !== 'verified' || c.quota !== 'available' || c.refusal || !Number.isFinite(c.at) || !Number.isFinite(c.expires) || c.at > now || c.expires <= now || c.expires - c.at > 300000 || !Array.isArray(c.models)) throw new Error('Codex image account capability is unverified');
  const model = c.models.find(m => m?.id === a.model);
  if (!model || a.effort && !model.efforts?.includes(a.effort)) throw new Error('Codex image configured model/effort unavailable');
}

async function runCodexImage(input: CodexImageOptions): Promise<CodexImage> {
  const o = { ...input, approved: input.approved && { ...input.approved } };
  if(o.reference&&(!Buffer.isBuffer(o.reference.bytes)||o.reference.bytes.length>MAX_IMAGE||typeof o.reference.sha256!=="string"))throw new Error("Codex image reference invalid");
  const reference=o.reference?{bytes:Buffer.from(o.reference.bytes),sha256:o.reference.sha256}:undefined;
  if(reference){verifyImagePng(reference.bytes);if(createHash('sha256').update(reference.bytes).digest('hex')!==reference.sha256)throw new Error('Codex image reference hash differs');}
  const guard = () => { if (o.signal?.aborted) throw new Error('Codex image cancelled'); o.authorize(); };
  guard();
  if (typeof o.prompt !== 'string' || !o.prompt.trim() || Buffer.byteLength(o.prompt) > (o.contextProfile === "coffee-kit" ? 262144 : 16000) || !o.approved || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(o.approved.model) || o.approved.effort !== null && !['none','minimal','low','medium','high','xhigh','max','ultra'].includes(o.approved.effort)) throw new Error('Codex image request invalid');
  const timeout = o.timeoutMs ?? 180000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 240000) throw new Error('Codex image deadline invalid');
  if (!sandboxInfo().ok && !localUnrestricted()) throw new Error('Codex image needs the OS sandbox');
  const bin = o.bin ?? process.env.CREW_CODEX_BIN ?? 'codex';
  const cap = await (o.probe ?? probeCodex)(bin, o.signal); guard(); approvedCapability(cap, o.approved);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crew-codex-image-'))), home = join(root,'home'), work = join(root,'work'), temp = join(root,'tmp');
  for (const d of [home,work,temp]) mkdirSync(d);
  const needs = codexNeeds(bin, ['api.openai.com','chatgpt.com','auth.openai.com'], o.approved);
  const egress = new Egress(), token = randomBytes(24).toString('hex');
  let proc: ReturnType<typeof probeProcess> | undefined; let clean = true, timer: ReturnType<typeof setTimeout> | undefined;
  let failure: Error | null = null;
  let failTurn: (e: Error) => void = () => {}; const pending = new Map<number,{resolve(v:any):void;reject(e:Error):void}>();
  const stop = (e: Error) => { failure ??= e; failTurn(e); for (const w of pending.values()) w.reject(e); pending.clear(); proc?.kill(); };
  const abort = () => stop(new Error('Codex image cancelled'));
  try {
    const login = needs.login(home); if (!login.ok) throw new Error('Codex image login unavailable'); guard();
    if(!localUnrestricted()){await egress.start(); guard(); egress.open(token, needs.hosts);}
    const profile = join(root,'image.sb'); writeFileSync(profile, roundProfile({ cwd:work,tmp:temp,writes:[home,work],reads:needs.reads,proxyPort:egress.port,toolPort:egress.port }));
    const proxy = `http://round:${token}@127.0.0.1:${egress.port}`;
    const env:Record<string,string> = { PATH:process.env.PATH ?? '/usr/bin:/bin', HOME:home,TMPDIR:temp,LANG:'en_US.UTF-8',...login.env,CODEX_HOME:join(home,'.codex'),HTTPS_PROXY:proxy,HTTP_PROXY:proxy,https_proxy:proxy,http_proxy:proxy,ALL_PROXY:proxy,all_proxy:proxy,NO_PROXY:'',no_proxy:'',XDG_CACHE_HOME:join(home,'.cache'),XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share') };
    if(localUnrestricted())for(const key of ['HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy','ALL_PROXY','all_proxy'])delete env[key];
    let id = 0, thread = '', turn = '', item: any = null, terminal = false;
    const early: any[] = [];
    let complete:()=>void = ()=>{};
    const finished = new Promise<void>((resolve,reject)=>{ complete=resolve; failTurn=reject; }); finished.catch(()=>{});
    const event = (m:any) => {
      if (m.method === 'item/completed') {
        if (m.params?.threadId !== thread || m.params?.turnId !== turn) { stop(new Error('Codex image event ownership differs')); return; }
        const v = m.params.item;
        if (v?.type === 'imageGeneration') { if (item || v.status !== 'completed' || v.failure != null) { stop(new Error('Codex image generation refused or duplicated')); return; } item=v; }
        else if (v && !['agentMessage','reasoning','userMessage'].includes(v.type)) stop(new Error('Codex image unexpected item: ' + (/^[A-Za-z]{1,48}$/.test(v.type) ? v.type : 'unsupported')));
      } else if (m.method === 'turn/completed') {
        if (m.params?.threadId !== thread || m.params?.turn?.id !== turn || m.params.turn.status !== 'completed' || m.params.turn.error != null) { stop(new Error('Codex image turn failed or ownership differs')); return; }
        terminal=true; complete();
      } else if (m.method === 'error') stop(new Error('Codex image server refused'));
    };
    // Private HOME has no original config or hooks; explicit source policy allows only image generation.
    const args=['app-server','--listen','stdio://','--disable','shell_tool','--enable','image_generation','-c','web_search="disabled"','-c','approval_policy="never"','-c',localUnrestricted()?'sandbox_mode="danger-full-access"':'sandbox_mode="read-only"','-c','analytics.enabled=false'];
    proc=probeProcess(localUnrestricted()?binArgv(bin,args):['/usr/bin/sandbox-exec','-f',profile,...binArgv(bin,args)],work,env,m=>{
      if (m.id !== undefined && !m.method) { const w=pending.get(m.id);if(w){pending.delete(m.id);m.error?w.reject(new Error('Codex image RPC refused')):w.resolve(m.result);} }
      else if(m.id !== undefined && m.method) { proc?.write({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'image owner refuses tool or permission requests'}});stop(new Error('Codex image unexpected permission or tool request')); }
      else if(m.method) { if (!turn && ['item/completed','turn/completed'].includes(m.method)) { if(early.length>=32)stop(new Error('Codex image early events exceeded'));else early.push(m); } else event(m); }
    },{timeoutMs:timeout,bytes:48*1024*1024,lineBytes:32*1024*1024});
    proc.exited.then(()=>{if(!terminal)stop(new Error('Codex image process stopped before verified completion'));},()=>stop(new Error('Codex image process cleanup unavailable')));
    o.signal?.addEventListener('abort',abort,{once:true}); guard();
    timer=setTimeout(()=>stop(new Error('Codex image deadline expired')),timeout);
    const call=(method:string,params:any)=>new Promise<any>((resolve,reject)=>{guard();const n=++id;pending.set(n,{resolve,reject});proc!.write({jsonrpc:'2.0',id:n,method,params});});
    await call('initialize',{clientInfo:{name:'crew-studio-image',version:'1.0.0'}});proc.write({jsonrpc:'2.0',method:'initialized'});guard();
    const t=await call('thread/start',{model:o.approved.model,cwd:work,approvalPolicy:'never',sandbox:localUnrestricted()?'danger-full-access':'read-only',ephemeral:true,baseInstructions:'Generate exactly one requested PNG image using image generation only. No shell, web, file reading, tools, delegated tasks or permissions. Return the generated image, not a promise or instructions.',config:{'features.shell_tool':false,'features.image_generation':true,web_search:'disabled',...(o.approved.effort?{model_reasoning_effort:o.approved.effort}:{})}});guard();
    if(t?.model!==o.approved.model)throw new Error('Codex image actual model differs from approved model');
    thread=t?.thread?.id;if(typeof thread!=='string'||!thread)throw new Error('Codex image thread identity unavailable');
    const r=await call('turn/start',{threadId:thread,model:o.approved.model,effort:o.approved.effort,input:[{type:'text',text:`Generate exactly one PNG image. ${o.prompt}`,text_elements:[]},...(reference?[{type:'image',url:'data:image/png;base64,'+reference.bytes.toString('base64')}]:[])]});guard();
    turn=r?.turn?.id;if(typeof turn!=='string'||!turn)throw new Error('Codex image turn identity unavailable');
    for(const m of early)event(m);
    await finished;guard();if(failure)throw failure;if(!item)throw new Error('Codex image completed without generated image');
    await proc.stop();clean=true;guard();if(failure)throw failure;if(proc.output().failure)throw new Error('Codex image protocol limit or deadline exceeded');
    let bytes:Buffer;
    if (typeof item.savedPath==='string' && item.savedPath) {
      const generated=join(home,'.codex','generated_images'),path=item.savedPath;
      const rel=relative(generated,path);if(!isAbsolute(path)||!rel||rel.startsWith('..')||isAbsolute(rel)||realpathSync(generated)!==generated)throw new Error('Codex image saved path outside owned generation root');
      let at=generated;for(const part of rel.split('/')){at=join(at,part);if(lstatSync(at).isSymbolicLink())throw new Error('Codex image saved path contains symlink');}
      if(realpathSync(path)!==path||!lstatSync(path).isFile()||lstatSync(path).size>MAX_IMAGE)throw new Error('Codex image saved file unsupported');bytes=readFileSync(path);
    } else {
      if(typeof item.result!=='string'||item.result.length>Math.ceil(MAX_IMAGE*4/3)+4||!item.result.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.result))throw new Error('Codex image bytes unavailable');bytes=Buffer.from(item.result,'base64');
    }
    const size=verifyImagePng(bytes);guard();
    return {bytes,...size,mime:'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),provider:'codex',model:o.approved.model,effort:o.approved.effort};
  } finally {
    clearTimeout(timer);o.signal?.removeEventListener('abort',abort);
    for(const w of pending.values())w.reject(new Error('Codex image owner closed'));pending.clear();
    try {if(proc)await proc.stop();}catch{clean=false;}
    egress.close(token);egress.stop();
    if(clean)rmSync(root,{recursive:true,force:true});else throw new CodexImageFailure('Codex image teardown unverified; private home retained',false);
  }
}

/** Verified process cleanup receipt for native queue and credential callers. */
export class CodexImageFailure extends Error {
  constructor(message:string,readonly cleanupSafe:boolean) { super(message); this.name='CodexImageFailure'; }
}
export async function generateCodexImage(options:CodexImageOptions):Promise<CodexImage> {
  try { return await runCodexImage(options); }
  catch(error) {
    if (error instanceof CodexImageFailure) throw error;
    throw new CodexImageFailure(error instanceof Error ? error.message : 'Codex image refused',true);
  }
}
