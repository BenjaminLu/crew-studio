// Syntax gate only: no dependency resolution, downloads, emitted files or type-check claim.
import {readdirSync,readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
let failures=0;
function walk(dir:string){for(const item of readdirSync(dir,{withFileTypes:true})){
 if(['vendor','node_modules'].includes(item.name)||item.isSymbolicLink())continue;
 const path=join(dir,item.name);if(item.isDirectory()){walk(path);continue;}
 const ext=extname(path);if(!['.js','.mjs','.ts','.tsx','.jsx'].includes(ext))continue;
 try{new Bun.Transpiler({loader:ext==='.ts'?'ts':ext==='.tsx'?'tsx':ext==='.jsx'?'jsx':'js',target:'bun'}).transformSync(readFileSync(path,'utf8'));}
 catch(error){failures++;console.error(`${path}:1: ${String(error)}`);}
}}
for(const dir of ['src','public','scripts'])walk(dir);
console.log(failures?`${failures} syntax failures`:'Source syntax PASS (not a type check)');process.exit(failures?1:0);
