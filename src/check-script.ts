// Embedded JavaScript checks run only in the existing OS sandboxed child.
// This helper never loads Studio settings, providers, credentials or the server.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {dlopen,ptr} from 'bun:ffi';
const [file,expected,guard]=process.argv.slice(2);
if(process.platform!=='darwin'||!file||!isAbsolute(file)||!guard||!isAbsolute(guard)||!expected||!/^[a-f0-9]{64}$/.test(expected))throw new Error('embedded check requires canonical script hash and OS sandbox');
const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||realpathSync(file)!==file)throw new Error('check script must be a canonical regular file, without links');
const ffi=dlopen('/usr/lib/libsandbox.dylib',{sandbox_check:{args:['i32','ptr','i32','ptr'],returns:'i32'}});
try{
 const check=ffi.symbols.sandbox_check;
 const network=Buffer.from('network-outbound\0');
 if(check(process.pid,ptr(network),0,null)!==1)throw new Error('check helper refuses execution outside its network sandbox');
 const denial=(f:()=>void)=>{try{f();}catch(e){if(['EPERM','EACCES'].includes(String((e as any).code)))return;throw new Error('sandbox canary was not readable for an unexpected reason');}throw new Error('check helper refuses execution outside its read/write sandbox');};
 denial(()=>{readFileSync(guard);});denial(()=>{writeFileSync(guard,'sandbox escape probe');});
}finally{ffi.close();}
const code=readFileSync(file);if(createHash('sha256').update(code).digest('hex')!==expected)throw new Error('check script hash changed');
// No parent-process eval: this module is reached only in the sandboxed child.
await import('data:text/javascript;base64,'+code.toString('base64'));
