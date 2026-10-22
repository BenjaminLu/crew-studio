import "./lib/isolated-env.mjs";
import {strict as a} from 'node:assert';
import {rmSync,readFileSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {gateHarness,until} from './gate-harness';
import {WorkflowDefs} from '../src/runtime/defs';
import {WorkflowDrafts} from '../src/workflow-drafts';
import {WORKFLOW_DRAFT_EXAMPLE} from '../src/workflow-draft-contract';
import {snapshotPackage} from '../src/workflow-package';
import {join} from 'node:path';
const h=gateHarness({skills:true});
try{
 const raw=structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any;raw.workflow.roles[0].skill='bundled:workflows/skills/v2/writer.md';raw.workflow.nodes.find((n:any)=>n.id==='make').args.format='document';
 const sourceDefs=new WorkflowDefs(join(h.data,'source'),()=>[]),drafts=new WorkflowDrafts(join(h.data,'source'),sourceDefs),draft=drafts.draft(raw,'fixture-source');
 const saved=drafts.save(draft.id,'fixture captain',draft.revision),source=sourceDefs.versions(saved.workflow)[0];
 for(const n of source.nodes)if(n.kind==='agent'){n.provider='codex';n.model='fixture-model';n.effort='low';}
 const bytes=snapshotPackage(source,join(h.data,'source'));
 const preview=await h.api('/api/workflow-packages/preview',{archive:bytes.toString('base64')});a.equal(preview.status,200,JSON.stringify(preview.body));
 const stored=await h.api('/api/workflow-packages/commit',{token:preview.body.token});a.equal(stored.status,201,JSON.stringify(stored.body));
 const wfRoot=join(h.data,'workflows');mkdirSync(wfRoot,{recursive:true});chmodSync(wfRoot,0o500);let blocked:any;try{blocked=await h.api('/api/workflow-packages/adopt',{id:stored.body.id,sha256:stored.body.sha256});}finally{chmodSync(wfRoot,0o700);}
 a.equal(blocked.status,409);a(/EACCES/.test(blocked.body.error)&&!blocked.body.error.includes(h.data),blocked.body.error); // route error names the cause without the absolute data path
 const adopted=await h.api('/api/workflow-packages/adopt',{id:stored.body.id,sha256:stored.body.sha256});a.equal(adopted.status,201,JSON.stringify(adopted.body));
 const def=h.rt.defs.get(adopted.body.workflow);a.deepEqual(def.nodes,source.nodes);a.deepEqual(def.edges,source.edges);a.equal(def.origin.source,'package-import');const deleted=await h.api('/api/workflow-packages/delete',{id:stored.body.id});a.equal(deleted.status,200);a(readFileSync(join(h.data,'workflow-adoptions',def.origin.transaction,'source.zip')).equals(bytes));a.equal(h.seen.length,0);a.equal(h.rt.engine.list().length,0);
 const bigUrl=new URL('http://t.local/api/workflow-packages/preview'),big=await h.rt.handle(new Request(bigUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({archive:'A'.repeat(12*1024*1024)})}),bigUrl,{kind:'desktop'},true);a.equal(big?.status,413);
 const holdTxn=join(h.data,'workflow-adoptions','import-'+'c'.repeat(24));mkdirSync(holdTxn);writeFileSync(join(holdTxn,'recovery-hold.json'),JSON.stringify({txn:'import-'+'c'.repeat(24),reason:'fixture hold',at:'2026-01-01T00:00:00Z'}));
 const listedHolds=await h.api('/api/workflow-packages');a.equal(listedHolds.status,200);a.deepEqual(listedHolds.body.adoptionHolds.map((x:any)=>x.reason),['fixture hold']);
 mkdirSync(join(h.data,'workflows','imp-'+'d'.repeat(24)));writeFileSync(join(h.data,'workflows','imp-'+'e'.repeat(24)+'.tmp'),'');mkdirSync(join(h.data,'workflows','imp-'+'f'.repeat(24)));writeFileSync(join(h.data,'workflows','imp-'+'f'.repeat(24),'v1.json'),'{"id":');
 const catalog=await h.api('/api/wf');a.equal(catalog.status,200,JSON.stringify(catalog.body));a(catalog.body.workflows.some((w:any)=>w.id===def.id));
 const gate=await h.api(`/api/wf/${def.id}/gate`);a.equal(gate.body.gate,null);a.equal(h.seen.length,0);
 const refused=await h.api('/api/wruns',{workflow:def.id,text:'Write a short document.'});a.equal(refused.status,409);a.equal(refused.body.code,'staffing_confirmation_required');
 const run=await h.api('/api/wruns',{workflow:def.id,text:'Write a short document.',staffingConfirm:refused.body.staffing.hash});a.equal(run.status,200,JSON.stringify(run.body));
 a(await until(()=>h.rt.engine.cards.list({run:run.body.id,open:true}).some((c:any)=>c.node==='confirm')));
 let card=h.rt.engine.cards.list({run:run.body.id,open:true})[0];a.equal((await h.api(`/api/scards/${card.id}/answer`,{choice:'begin'})).status,200);
 a(await until(()=>h.rt.engine.cards.list({run:run.body.id,open:true}).some((c:any)=>c.node==='accept'),30000),JSON.stringify(h.rt.engine.get(run.body.id)));
 card=h.rt.engine.cards.list({run:run.body.id,open:true}).find((c:any)=>c.node==='accept');const option=card.options.find((o:any)=>o.id.startsWith('approve-'));a(option,JSON.stringify(card));
 const answer=await h.api(`/api/scards/${card.id}/answer`,{choice:option.id,aligned:[0]});a.equal(answer.status,200,JSON.stringify(answer.body));
 a(await until(()=>h.rt.engine.get(run.body.id).status==='succeeded'));a(h.seen.length>0);a(h.rt.engine.get(run.body.id).steps.some((s:any)=>s.node==='accept-ready'&&s.outcome==='pass'));
 console.log('PASS real API ZIP→held package→fresh workflow→separate staffing→stub deliver→native readiness→explicit fixture acceptance→succeeded; no import execution');
}finally{h.rt.readiness.stop();for(const r of h.rt.engine.list())if(!['succeeded','cancelled','failed'].includes(r.status))await h.rt.engine.cancel(r.id);h.rt.engine.disposeExternal();h.agents.cancelAll?.();rmSync(h.data,{recursive:true,force:true});}
