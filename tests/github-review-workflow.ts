import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
const {GitHubPrAdapter}=await import(process.env.GITHUB_REVIEW_BASE?process.env.GITHUB_REVIEW_BASE+'/src/adapters/github.ts':'../src/adapters/github');
let pass=0;const ok=(v:unknown,n:string)=>{assert.ok(v,n);pass++;console.log('PASS '+n);};
const temp=mkdtempSync('/tmp/github-review-test-'),repo=join(temp,'repo');mkdirSync(repo);assert.equal(Bun.spawnSync(['git','init','-q',repo]).exitCode,0);assert.equal(Bun.spawnSync(['git','init','--bare','-q',join(temp,'bare.git')]).exitCode,0); 
const head='a'.repeat(40),old='b'.repeat(40),user={id:101,login:'review-fixture-a'},calls:string[]=[];
let reviews:any[]=[{id:11,user,state:'APPROVED',commit_id:head,submitted_at:'2026-10-15T01:00:00Z',html_url:'https://github.com/fixture/project/pull/1#pullrequestreview-11',body:''}],comments:any[]=[],issues:any[]=[];
let failure=0,changeHead=false,current=head;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const u=new URL(req.url);calls.push(u.pathname+u.search);assert.equal(req.method,'GET');if(failure)return Response.json({message:'denied'},{status:failure});const p=u.pathname.replace('/repos/fixture/project','');let data:any;if(p==='/pulls/1')data={number:1,state:'open',head:{sha:current,ref:'crew/task',repo:{full_name:'fixture/project'}},base:{ref:'main',repo:{full_name:'fixture/project'}}};else if(p==='/pulls/1/reviews'){data=reviews.slice((Number(u.searchParams.get('page'))-1)*100,Number(u.searchParams.get('page'))*100);if(changeHead)current=old;}else if(p==='/pulls/1/comments')data=comments;else if(p==='/issues/1/comments')data=issues;else if(p===`/commits/${head}/check-runs`)data={total_count:0,check_runs:[]};else return Response.json({error:'not allowlisted'},{status:400});return Response.json(data);}});
const grant={mode:'simulator' as const,repository:'fixture/project',localPath:repo,pushUrl:join(temp,'bare.git'),apiOrigin:`http://127.0.0.1:${server.port}`,base:'main',branchPrefix:'crew/',approvedAt:'2026-10-15T00:00:00Z',approvalId:'offline-only'};
try{const adapter=new GitHubPrAdapter(grant,()=> 'fake-token',150);
 const rows=await adapter.remoteRead('reviews' as any,'1',1);ok(Array.isArray(rows)&&rows[0].user.id===101,'typed read-only adapter discovers actual formal reviewer account identity');
 const {scanGitHubReview,evaluateGitHubReview,parsePullURL}=await import('../src/domain/github-review-workflow');
 for(const url of ['http://github.com/fixture/project/pull/1','https://evil.invalid/fixture/project/pull/1','https://github.com/fixture/project/pull/1?token=private','https://github.com/fixture/project/pull/1/../../2']){let denied=false;try{parsePullURL(url)}catch{denied=true}ok(denied,'reject noncanonical PR URL');}
 const scan=()=>scanGitHubReview(adapter,'https://github.com/fixture/project/pull/1');let result=await scan();ok(result.accounts[0].id===101&&result.head===head,'scanner binds candidate account to authoritative PR head');
 const policy:any={schema:1,repository:grant.repository,pr:1,accounts:[{id:101,login:user.login,required:true}],trigger:'manual'};
 ok(evaluateGitHubReview(result,policy).state==='pass','formal current-head APPROVED satisfies exact required account');
 reviews=[{...reviews[0],commit_id:old}];ok(evaluateGitHubReview(await scan(),policy).state==='pending','old approval never unlocks new head');
 issues=[{id:9,user,body:`APPROVE ${head}`,html_url:'https://github.com/fixture/project/pull/1#issuecomment-9',updated_at:'2026-10-15T02:00:00Z'}];reviews=[];ok(evaluateGitHubReview(await scan(),policy).state==='pending','body SHA in ordinary comment is only an unverified claim');
 reviews=[{id:12,user,state:'APPROVED',commit_id:head,submitted_at:'2026-10-15T02:00:00Z',html_url:'https://github.com/fixture/project/pull/1#pullrequestreview-12'}];comments=[{id:19,user,commit_id:head,original_commit_id:old,path:'src/file.ts',line:2,body:'Fix fixture finding',html_url:'https://github.com/fixture/project/pull/1#discussion_r19'}];ok(evaluateGitHubReview(await scan(),policy).state==='fail','current inline finding remains blocking despite formal approval');comments=[];
 reviews.push({...reviews[0],id:13,state:'CHANGES_REQUESTED',submitted_at:'2026-10-15T03:00:00Z'});ok(evaluateGitHubReview(await scan(),policy).state==='fail','later current-head negative invalidates earlier approval');
 reviews=Array.from({length:100},(_,i)=>({...reviews[0],id:1000+i,user:{id:2000+i,login:'synthetic-'+i},state:'COMMENTED'})).concat({...reviews[0],id:2001,user,state:'APPROVED'});result=await scan();ok(result.accounts.length===101&&calls.some(c=>c.includes('reviews?per_page=100&page=2')),'actual pagination discovers multiple accounts including second page');
 changeHead=true;let drift=false;try{await scan()}catch{drift=true}ok(drift,'head movement during scan refuses stale result');changeHead=false;current=head;
 for(const status of [403,500]){failure=status;let refused=false;try{await scan()}catch{refused=true}ok(refused,'permission/server error never becomes approval '+status);}failure=0;
 console.log(`github-review-workflow: ${pass} passed, 0 failed`);
}finally{server.stop(true);rmSync(temp,{recursive:true,force:true});}
