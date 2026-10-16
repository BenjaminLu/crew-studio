import { checkedTempDir, assertTempRepo } from "./git-hygiene.mjs"; // scrubs inherited GIT_* first; repositories only in checked temp folders
// Offline visual fixture: actual staffing source/tools/cards, synthetic project authority.
// This does not certify a real account, repository, model quality or coffee workflow.
import {harness,Y} from '../rt-harness';
import {bundledText} from '../../src/bundled';
import {StaffingStore,installStaffingGuard} from '../../src/domain/staffing';
import {installFirstmateStaffing} from '../../src/firstmate-staffing';
import {rmSync} from 'node:fs';
async function runVisualFixture(){
const roles=['coordinator','worker','reviewer','designer'].map(id=>({id,label:id,skill:`pack:firstmate/skills/${id==='coordinator'?'firstmate':id}.md`}));
const definition={id:'code-firstmate',name:'Synthetic visual staffing target',kind:'code',version:1,roles,nodes:[{id:'wait',kind:'card',label:'No work starts',x:1,y:1,card:{options:[{id:'done',label:'Done'}]}}],edges:[]};
const h=await harness([Y(definition),bundledText('workflows/v2/firstmate-staffing.wf.yaml')!]),e=h.engine,store=new StaffingStore(h.data),project={namespace:'git' as const,id:'fixture-project',identity:'strict-synthetic-visual-fixture'};
e.deps.skillText=(ref:string)=>bundledText('packs/'+ref.slice(5))!;
const facts=async()=>[{provider:'codex',support:'supported' as const,auth:'verified',quota:'available',expires:Date.now()+30000,models:[{id:'fixture-model',efforts:['low','high']}]},{provider:'claude',support:'unsupported' as const,auth:'unverified',quota:'unknown',expires:Date.now()+30000,models:[]}];
installStaffingGuard(e,store,id=>{if(id!==project.id)throw new Error('Fixture project identity rejected');return project;});
const tools=installFirstmateStaffing(e,store,id=>{if(id!==project.id)throw new Error('Fixture project rejected');return project;},facts);let turn=0;
const server=Bun.serve({port:0,hostname:'127.0.0.1',async fetch(req){if(req.headers.get('x-fixture-token')!==process.env.STAFFING_FIXTURE_TOKEN)return new Response('Denied',{status:403});const url=new URL(req.url);try{if(url.pathname==='/cards')return Response.json(e.cards.list());if(url.pathname==='/status')return Response.json({runs:e.list().length,work:e.list().filter(r=>r.workflow==='code-firstmate').length,current:(()=>{try{return store.current(project)}catch{return null}})()});const b=await req.json() as any;const name=b.confirm===true?'studio_propose_staffing':'studio_staffing_interview';delete b.confirm;return Response.json(await tools.call(name,b,{captain:true,key:`visual-captain-${++turn}`,text:'Explicit synthetic visual captain selection',live:()=>!req.signal.aborted}));}catch(error){return Response.json({error:String((error as any).message)},{status:409})}}});
console.log(JSON.stringify({port:server.port}));
let closing=false;const stop=async()=>{if(closing)return;closing=true;server.stop(true);for(const r of e.list())if(!['succeeded','failed','cancelled'].includes(r.status))await e.cancel(r.id,'visual fixture cleanup');h.stop();rmSync(h.data,{recursive:true,force:true});process.exit(0);};process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());

}
if(import.meta.main)await runVisualFixture();


export async function staffingConversationFixture(){
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{spawn}=await import('node:child_process');const{freePort,waitUp}=await import('../boot.mjs');
 const root=checkedTempDir('staffing-conversation-'),home=join(root,'home'),data=join(root,'data'),repo=join(root,'repo'),log=join(root,'rpc.jsonl'),token='offline-staffing-conversation-session';mkdirSync(join(home,'.codex'),{recursive:true});mkdirSync(data);mkdirSync(repo);
 writeFileSync(join(home,'.codex','config.toml'),'model="fixture-model"\nmodel_reasoning_effort="low"\n');writeFileSync(join(home,'.codex','.fixture-account.json'),'{"authenticated":true}');writeFileSync(join(home,'.codex','auth.json'),JSON.stringify({auth_mode:'chatgpt',last_refresh:'2020-02-29T12:34:56.123+08:00',tokens:{access_token:'abcdefgh.abcdefgh.abcdefgh',id_token:'fixture-id-token',account_id:'fixture-native-staffing',refresh_token:'source-fixture-refresh-must-not-copy'}}),{mode:0o600});
 for(const args of [['init','-b','main'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Initial fixture']]){if(Bun.spawnSync(['git',...args],{cwd:repo,stdout:'pipe',stderr:'pipe'}).exitCode)throw new Error('Temporary repository setup failed');}
 const fixture=join(import.meta.dir,'../fixture/codex-account.mjs'),port=await freePort(),base=`http://127.0.0.1:${port}`,env:any={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_RUNTIME_DIR:join(root,'runtime'),CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_CODEX_BIN:fixture,CREW_HOST_CODEX_BIN:fixture,CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',ACCOUNT_FIXTURE_LOG:log};for(const key of ['CREW_MAIN_PROJECT','CREW_FM_STATE','OPENAI_API_KEY','ANTHROPIC_API_KEY','GITHUB_TOKEN','GH_TOKEN'])delete env[key];
 const app=spawn('bun',['src/server.ts'],{cwd:join(import.meta.dir,'../..'),env,stdio:['ignore','pipe','pipe']});let output='';app.stdout?.on('data',b=>output+=b);app.stderr?.on('data',b=>output+=b);await waitUp(base,app);
 const api=async(path:string,body?:any)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()as any}};
 const until=async(test:()=>Promise<boolean>)=>{for(let i=0;i<200;i++){if(await test())return true;await Bun.sleep(30)}return false};const rows=()=>{try{return readFileSync(log,'utf8').split('\n').filter(Boolean).map(row=>JSON.parse(row))}catch{return[]}};
 return{root,home,data,repo,api,until,rows,output:()=>output,close:async()=>{try{for(const run of (await api('/api/wruns')).body.runs)if(!['succeeded','failed','cancelled'].includes(run.status))await api(`/api/wruns/${run.id}/cancel`,{});}finally{if(app.exitCode===null&&app.signalCode===null){const done=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await done;}rmSync(root,{recursive:true,force:true});}}};
}
