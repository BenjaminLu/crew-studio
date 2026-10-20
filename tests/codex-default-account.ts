import "./lib/isolated-env.mjs";
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CodexAccount} from '../src/host/codex-account';
import {suite} from './rt-harness';
const {ok,end}=suite('codex-default-account');
const root=mkdtempSync(join(tmpdir(),'crew-codex-default-')),home=join(root,'codex');mkdirSync(home);writeFileSync(join(home,'.fixture-account.json'),'{"authenticated":true}');
process.env.CODEX_HOME=home;process.env.ACCOUNT_FIXTURE_MODELS=JSON.stringify([['fixture-default',['low','high']],['other',['low']]]);
const bin=join(import.meta.dir,'fixture/codex-account.mjs');
for(const [label,config,ready] of [
 ['empty vendor configuration',{model:null,effort:null},true],
 ['explicit model with vendor default effort',{model:'other',effort:null},true],
 ['unsupported explicit model',{model:'absent',effort:null},false],
 ['unsupported explicit effort',{model:null,effort:'ultra'},false],
] as const){
 const c=new CodexAccount({cwd:root,bin,configured:()=>config,busy:()=>false});
 try{const v=await c.verify();ok(v.state===(ready?'ready':'hold')&&v.authenticated,label,JSON.stringify(v));if(ready){ok(v.model===(config.model||'fixture-default')&&v.effort==='low','uses only vendor-declared model and effort defaults');const now=Date.now;try{Date.now=()=>now()+31000;const expired=c.view();ok(expired.state==='hold'&&expired.authenticated,'capability expiry does not sign out the account');}finally{Date.now=now;}}}
 finally{await c.shutdown();}
}
for(const [label,defaults] of [['missing official default',[false,false]],['ambiguous official defaults',[true,true]]] as const){
 process.env.ACCOUNT_FIXTURE_MODELS=JSON.stringify([['one',['low'],defaults[0]],['two',['low'],defaults[1]]]);
 const c=new CodexAccount({cwd:root,bin,configured:()=>({model:null,effort:null}),busy:()=>false});
 try{const v=await c.verify();ok(v.state==='hold'&&v.authenticated,label+' fails closed without signing out');}finally{await c.shutdown();}
}
end();
