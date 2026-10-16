import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {join} from "node:path";
import {harness,Y,until,suite} from "./rt-harness";
import {installCode} from "../src/domain/code";
import {Projects} from "../src/doors";
import {must,setGitHome} from "../src/git";
const {ok,end}=suite("remote-gates-approval");const temp=checkedTempDir("approval-bound-"),repo=join(temp,"repo");mkdirSync(repo);setGitHome(join(temp,"git-home"));must(repo,["init","-qb","main"]);writeFileSync(join(repo,"file"),"base");must(repo,["add","."]);must(repo,["commit","-qm","base"]);const base=must(repo,["rev-parse","HEAD"]);writeFileSync(join(repo,"file"),"head");must(repo,["commit","-qam","head"]);const head=must(repo,["rev-parse","HEAD"]);
for(const mode of ["direct","skipped","legacy","unverified","later-reject","carry","carry-later-reject","wrong-head"]){
 const H=await harness([Y({id:"approval",name:"approval",roles:[],nodes:[{id:"n",kind:"hook",do:"fixture.approval",label:"Approval",x:0,y:0}],edges:[]})]);const E=H.engine;installCode(E,{dataDir:H.data,projects:new Projects(H.data)});let result:any;
 E.actions["fixture.approval"]=async x=>{x.ctx.repo=x.ctx.worktree=repo;x.ctx.base="main";x.ctx.baseCommit=base;x.ctx.head=head;x.ctx.pr={adapter:"github"};
 const old="a".repeat(40),reviewHead=mode.startsWith("carry")?old:mode==="wrong-head"?old:head;
 const review=E.record(x,"fixture-review",{check:"firstmate/review-verdict",head:reviewHead,verdict:mode==="skipped"?"skipped":"pass",data:mode==="legacy"?{}:{binding:{version:1,head:reviewHead,base,patch:"b".repeat(40)}}} as any)!;
 if(mode.startsWith("carry"))E.record(x,"approval-carry",{head,data:{review:review.seq,proof:{version:1,fromHead:old,fromBase:base,toBase:base,toHead:head,patch:"b".repeat(40),clean:true}}} as any);
 if(mode.includes("later-reject"))E.record(x,"fixture-reject",{check:"firstmate/review-verdict",head,verdict:"fail"} as any);
 if(mode==="unverified")x.ctx.reviewUnverified="missing verification";
 result=await E.natives["gate-approval"]({} as any,{x} as any);return "ok";};
 const r=E.start({workflow:"approval"});await until(()=>!!result||r.status==="failed",8000);ok(result?.verdict===(["direct","carry"].includes(mode)?"pass":"fail"),`${mode}: remote approval requires actual signed bound pass with no later rejection`);H.stop();
}rmSync(temp,{recursive:true,force:true});end();
