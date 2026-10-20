import "./lib/isolated-env.mjs";
import {existsSync,readFileSync,mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createProjectOverview} from '../src/project-overview';
import {Projects} from '../src/doors';
import {projectFixture} from './lib/firstmate-project-fixture';
let pass=0,fail=0;const ok=(v:unknown,n:string)=>{console.log((v?'ok ':'FAIL ')+n);v?pass++:fail++;};
const f=await projectFixture();
try{
 const before=(await f.api('/api/policies')).body.projects.length;
 const add=await f.api('/api/projects/local-registration',{path:f.repo,name:'Local fixture'});
 ok(add.status===200&&add.body.task,'normal local-path registration creates captain request');
 if(add.body.task){
 await f.until(async()=>(await f.api('/api/wruns/'+add.body.task)).body.nodes?.register?.waiting==='card');
 const card=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===add.body.task&&c.status==='open');
 ok(card?.captainOnly,'actual confirmation is captain-only');
 ok((await f.api('/api/policies')).body.projects.length===before,'preparing card never registers');
 await f.api('/api/scards/'+card.id+'/answer',{choice:'approve'});
 await f.until(async()=>(await f.api('/api/policies')).body.projects.length===before+1);
 ok((await f.api('/api/policies')).body.projects.length===before+1,'captain confirmation registers');
 ok(!(await f.api('/api/wruns')).body.runs.some((r:any)=>r.workflow==='code-firstmate'||r.workflow==='firstmate-proposal'),'registration does not start or propose coding');
 const repeat=await f.api('/api/projects/local-registration',{path:f.repo});
 ok(repeat.status===200&&repeat.body.project&& !repeat.body.task,'already registered returns existing project');
 }
 for(const [label,path] of [['missing',join(f.root,'missing')],['nonrepo',f.root],['protected',f.data],['relative','./repo']]){
 const r=await f.api('/api/projects/local-registration',{path});ok(r.status===409&&r.body.code&&r.body.tw,label+' returns safe actionable error');
 }

 const make=(name:string)=>{const path=join(f.root,name);mkdirSync(path);for(const args of [['init','-b','main'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Fixture']])if(Bun.spawnSync(['git',...args],{cwd:path,stdout:'pipe',stderr:'pipe'}).exitCode)throw new Error('fixture git setup');return path;};
 const alias=join(f.root,'alias');symlinkSync(f.repo,alias);
 ok((await f.api('/api/projects/local-registration',{path:alias})).body.existing,'symlink alias opens existing canonical project');
 const prepare=async(path:string)=>{const r=await f.api('/api/projects/local-registration',{path});if(!r.body.task)throw new Error(JSON.stringify(r));await f.until(async()=>(await f.api('/api/wruns/'+r.body.task)).body.nodes?.register?.waiting==='card');const c=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===r.body.task&&c.status==='open');return{...r.body,card:c};};
 const cancelled=await prepare(make('cancelled'));const count=(await f.api('/api/policies')).body.projects.length;await f.api('/api/scards/'+cancelled.card.id+'/answer',{choice:'close'});await f.until(async()=>(await f.api('/api/wruns/'+cancelled.task)).body.status==='succeeded');ok((await f.api('/api/policies')).body.projects.length===count,'cancelling actual card leaves registry unchanged');
 const stalePath=make('stale'),stale=await prepare(stalePath);Bun.spawnSync(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Changed'],{cwd:stalePath,stdout:'pipe',stderr:'pipe'});await f.api('/api/scards/'+stale.card.id+'/answer',{choice:'approve'});await f.until(async()=>(await f.api('/api/wruns/'+stale.task)).body.status==='failed');ok((await f.api('/api/policies')).body.projects.length===count,'head change after review refuses registration');
 const drift=await prepare(make('registry-drift')),file=join(f.data,'projects.json'),saved=readFileSync(file,'utf8');writeFileSync(file,JSON.stringify([...JSON.parse(saved),{id:'unrelated',name:'Unrelated',path:null,base:'main',sensitive:[],proposed:null,proposedAt:null,approvedAt:null}]));await f.api('/api/scards/'+drift.card.id+'/answer',{choice:'approve'});await f.until(async()=>(await f.api('/api/wruns/'+drift.task)).body.status==='failed');ok(JSON.parse(readFileSync(file,'utf8')).length===count+1,'registry drift refuses without overwriting');writeFileSync(file,saved);
 const simultaneous=make('dedup');const pair=await Promise.all([f.api('/api/projects/local-registration',{path:simultaneous}),f.api('/api/projects/local-registration',{path:simultaneous})]);ok(pair[0].body.task===pair[1].body.task,'duplicate pending requests share one confirmation');
 const invalid=await f.api('/api/projects/local-registration',{path:f.repo,base:'other'});ok(invalid.status===409,'unknown authority fields refused');
 let called=0;const overview=createProjectOverview({dataDir:f.data,engine:{} as any,projects:new Projects(f.data),session:'local-test-session',worktrees:{all:()=>[]},prepareLocalProject:async()=>{called++;return{};}});
 const req=new Request('http://127.0.0.1/api/projects/local-registration',{method:'POST',body:'{}'}),url=new URL(req.url);
 ok((await overview.handle(req,url,{kind:'desktop'},true))?.status===401&&!called,'unauthenticated registration refused before inspection');
 ok((await overview.handle(req,url,{kind:'phone'},true))?.status===403&&!called,'phone cannot register local paths');
 ok((await overview.handle(new Request(req.url),url,{kind:'desktop'},false))?.status===405&&!called,'GET cannot allocate registration');
 const missingRoot={id:'missing-old',name:'Missing old',path:join(f.root,'absent-old'),base:'main',sensitive:[],proposed:null,proposedAt:null,approvedAt:null};writeFileSync(file,JSON.stringify([...JSON.parse(saved),missingRoot]));const next=await f.api('/api/projects/local-registration',{path:make('with-missing-old')});ok(next.status===200&&next.body.task,'unrelated nonexistent project root does not block new registration');writeFileSync(file,saved);

}finally{await f.close();}
console.log(`local-project-add: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
