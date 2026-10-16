// Recovery changes authority only through signed captain decisions. Context is
// a cache: the ledger and locked, pristine task branch establish every effect.
import { hashInput } from '../runtime/checks';
import { FailureRefusal, failure, fromError, rescopeRefusal } from '../runtime/failures';
import type { Engine, X } from '../runtime/engine';
import { git, must } from '../git';
import { RoundBlocked, patchEquivalentBase, type Worktrees } from '../worktrees';
import { signedReservation } from './code-queue';

export function installCodeRecovery(engine:Engine,W:Worktrees){
  const key=(r:any)=>({project:r.ctx.wt?.project,task:r.ctx.wt?.task});
  const relation=(repo:string,from:string,target:string,admitted:boolean)=>{
    if(git(repo,['merge-base','--is-ancestor',from,target]).ok)return {};
    if(!admitted&&patchEquivalentBase(repo,from,target))return {baseRelation:'patch-equivalent-unadmitted' as const};
    throw new Error('rescope base is neither an ancestor nor an explicitly recoverable unadmitted patch series');
  };
  const descriptor=(c:any,rec:any,target:string,extra:ReturnType<typeof relation>)=>({version:1 as const,card:c.id,visit:c.visit,base:rec.base,from:rec.head,target,...extra});
  // the scope card a worker's report raises carries the report's class: a question (ASK) is never a scope conflict
  engine.cardPrepared['failure-class']=(x,card)=>{
    if(card.kind!=='scope'||x.run.workflow!=='code-firstmate'&&!x.run.def.nodes.some(n=>n.do==='git.merge'))return;
    const rep=x.run.nodes.build?.data?.report;if(!rep?.marker||!['ASK','SCOPE-BLOCKED','DOOR-CHANGE','BLOCKED'].includes(rep.marker))return;
    const msg=String(rep.summary??rep.marker);
    const typed=rep.marker==='ASK'?failure('ask.agent-question',msg,{source:'agent',run:x.run.id,node:'build'}):rep.marker==='BLOCKED'?fromError(Object.assign(new Error(msg),{outcome:'blocked'}),{source:'agent',run:x.run.id,node:'build'}):failure('scope.blocked',msg,{source:'agent',run:x.run.id,node:'build'});
    const cur=engine.cards.get(card.id);if(!cur)return;cur.failure=typed;card.failure=typed;engine.cards.save(cur); // the stored card keeps its STE result
  };
  const priorView=engine.cards.view;
  engine.cards.view=c=>{
    const view=priorView(c),r=engine.get(c.run);
    if(c.status!=='open'||!c.options.some(o=>o.id==='rescope')||!r?.ctx.wt||!r.def.nodes.some(n=>n.do==='git.merge'))return view;
    try{
      const k=key(r),rec=W.get(k.project,k.task),trusted=engine.trusted(r.id),{prior,signed}=signedReservation(engine,r,trusted);
      if(!rec||r.ctx.pr||rec.nativeRebase||r.ctx.remoteRebaseApproved||r.ctx.remoteUpdatePending||rec.head!==rec.baseCommit||rec.head!==r.ctx.head||rec.baseCommit!==r.ctx.baseCommit||
        rec.branch!==r.ctx.branch||rec.base!==r.ctx.base||rec.path!==r.ctx.worktree||rec.run!==r.id||rec.removedAt||
        engine.queueRepo(rec.repo)!==engine.queueRepo(r.ctx.repo)||rec.project!==engine.queueProject(r)||
        (prior?hashInput(signed)!==hashInput(r.ctx.nativeAdmission):!!r.ctx.nativeAdmission)||
        must(rec.path,['rev-parse','HEAD'])!==rec.head||must(rec.path,['status','--porcelain=v1','--untracked-files=all']))return view;
      const target=must(rec.repo,['rev-parse',`refs/heads/${rec.base}`]);
      // a refresh from X to X changes nothing: no refresh is offered, and the card says why (runtime/failures.ts)
      const same=rescopeRefusal({note:null,from:rec.head,target,base:rec.base});
      if(same)return {...view,...(view.detail?{detail:{...view.detail,how:[...view.detail.how,{en:same.en,'zh-TW':same['zh-TW']}]}}:{}),sections:{...view.sections,en:{...view.sections.en,how:view.sections.en.how+'\n'+same.en.replace('Rescope refused: it refreshes','A base refresh is not offered: it refreshes')},'zh-TW':{...view.sections['zh-TW'],how:view.sections['zh-TW'].how+'\n'+same['zh-TW'].replace('已拒絕重新界定範圍：','不提供基底更新：')}}};
      const localRescope=descriptor(c,rec,target,relation(rec.repo,rec.head,target,!!prior));
      const en=(localRescope.baseRelation?'This unadmitted task uses rewritten base history. Every old-side patch has a patch-id match on the selected target; this is not a semantic guarantee. Approval abandons the old base lineage. ':'')+`This task has no changes. Rescope refreshes base ${rec.base} from ${rec.head} to ${target}, rewrites the spec, and waits for a new dispatch approval. Checks and review run again.`;
      const zh=(localRescope.baseRelation?'此任務尚未派工，基底歷史已改寫。舊側所有 patch 在目標都有 patch-id 對應，但不保證語義等價。核准會放棄舊基底的歷史連接。':'')+`此任務尚未修改檔案。重新界定範圍會將基底 ${rec.base} 從 ${rec.head} 更新至 ${target}，重寫規格後再次等待派工核准；檢查與審查必須重跑。`;
      return {...view,localRescope,...(view.detail?{detail:{...view.detail,how:[...view.detail.how,{en,'zh-TW':zh}]}}:{}),sections:{...view.sections,en:{...view.sections.en,how:view.sections.en.how+'\n'+en},'zh-TW':{...view.sections['zh-TW'],how:view.sections['zh-TW'].how+'\n'+zh}}};
    }catch{return view;}
  };
  const original=engine.answer.bind(engine);
  engine.answer=async(id,a)=>{
    const c=engine.cards.get(id),r=c&&engine.get(c.run);
    if(c?.status==='open'&&a.choice==='rescope'&&(a as any).localRescope!=null&&r?.ctx.wt&&r.def.nodes.some(n=>n.do==='git.merge')){
      const rn=r.nodes[c.node],node=r.def.nodes.find(n=>n.id===c.node)!;
      if(String(a.by).startsWith('auth window')||!c.options.some(o=>o.id==='rescope')||rn.state!=='running'||rn.waiting!=='card'||rn.card!==c.id||rn.visits!==c.visit)
        throw new Error('local rescope requires the current captain card');
      const trusted=engine.trusted(r.id),{prior,signed}=signedReservation(engine,r,trusted),k=key(r),rec=W.get(k.project,k.task);
      // Ordinary rescope (without this explicit descriptor) retains its semantics.
      // A submitted refresh preview must still be pristine; never silently downgrade it.
      if(r.ctx.pr||r.ctx.remoteRebaseApproved||r.ctx.remoteUpdatePending||rec?.nativeRebase||rec&&(
        rec.head!==rec.baseCommit||must(rec.path,['rev-parse','HEAD'])!==rec.head||must(rec.path,['status','--porcelain=v1','--untracked-files=all'])))throw new Error('local rescope preview is stale; reload the current card');
      if(!trusted.ok||r.ctx.nativeQueueVersion!==1||!rec||rec.removedAt||
        rec.run!==r.id||engine.queueRepo(rec.repo)!==engine.queueRepo(r.ctx.repo)||rec.project!==engine.queueProject(r)||rec.path!==r.ctx.worktree||rec.branch!==r.ctx.branch||rec.base!==r.ctx.base||
        rec.head!==r.ctx.head||rec.baseCommit!==r.ctx.baseCommit||must(rec.path,['symbolic-ref','--short','HEAD'])!==rec.branch||
        (prior?hashInput(signed)!==hashInput(r.ctx.nativeAdmission):!!r.ctx.nativeAdmission))
        throw new Error('rescope base recovery requires intact task identity and signed admission');
      if(prior&&(signed.repo!==engine.queueRepo(rec.repo)||signed.project!==rec.project||hashInput(signed.dependencies)!==hashInput(engine.queueDependencies(r))))throw new Error('rescope cannot change repository, project or dependencies');
      if(!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(rec.base))throw new Error('rescope base branch is invalid');
      const target=must(rec.repo,['rev-parse',`refs/heads/${rec.base}`]);
      const same=rescopeRefusal({note:a.note,from:rec.head,target,base:rec.base});if(same)throw new FailureRefusal(same);
      const shown=a.localRescope!,expected=descriptor(c,rec,target,relation(rec.repo,rec.head,target,!!prior));
      if(Object.keys(shown).length!==Object.keys(expected).length||Object.entries(expected).some(([k,v])=>(shown as any)[k]!==v))throw new Error('local rescope target changed; reload the current card before approving');
      const intent={version:1,card:c.id,node:c.node,visit:c.visit,project:rec.project,repo:engine.queueRepo(rec.repo),branch:rec.branch,base:rec.base,from:rec.head,target,...(expected.baseRelation?{baseRelation:expected.baseRelation}:{}),
        prior:prior?.seq??null,priorHash:prior?hashInput(signed):null,dependencies:engine.queueDependencies(r)};
      const earlier=trusted.entries.filter(e=>e.record==='local-rescope-request'&&e.data?.card===c.id).at(-1);
      if(!earlier||hashInput(earlier.data)!==hashInput(intent))engine.record(engine.x(r,node,rn),'local-rescope-request',{head:rec.head,data:intent});
    }
    return original(id,a);
  };
  return (x:X)=>{
    const trusted=engine.trusted(x.run.id);
    if(!trusted.ok)throw new RoundBlocked('local rescope cannot read untrusted history');
    const request=trusted.entries.filter(e=>e.record==='local-rescope-request').at(-1);
    if(!request)return;
    const i:any=request.data;
    const latestRescope=trusted.entries.filter(e=>e.record==='card-answer'&&e.data?.choice==='rescope').at(-1);
    if(latestRescope?.data?.card!==i.card)return; // ordinary rescope cannot reuse an old refresh
    const answer=trusted.entries.find(e=>e.record==='card-answer'&&e.seq>request.seq&&e.data?.card===i.card&&e.data?.choice==='rescope'&&!String(e.actor??'').startsWith('auth window'));
    if(!answer?.data?.localRescope||hashInput(answer.data.localRescope)!==hashInput({version:1,card:i.card,visit:i.visit,base:i.base,from:i.from,target:i.target,...(i.baseRelation?{baseRelation:i.baseRelation}:{})}))return; // an orphan request or ordinary rescope grants no refresh
    const later=trusted.entries.some(e=>e.record==='scope-admission'&&e.seq>answer.seq);
    if(later)return; // the new epoch already owns its normal build/spec lifecycle
    const done=trusted.entries.find(e=>e.record==='local-rescope-applied'&&e.data?.request===request.seq);
    const k=key(x.run),rec=W.get(k.project,k.task),{prior,signed}=signedReservation(engine,x.run,trusted);
    if(i.baseRelation!==undefined&&(i.baseRelation!=='patch-equivalent-unadmitted'||prior||x.ctx.nativeAdmission))throw new RoundBlocked('patch-equivalent recovery requires an unadmitted task');
    if(i.version!==1||i.project!==engine.queueProject(x.run)||i.repo!==engine.queueRepo(x.ctx.repo)||i.branch!==x.ctx.branch||i.base!==x.ctx.base||
      i.prior!==(prior?.seq??null)||i.priorHash!==(prior?hashInput(signed):null)||hashInput(i.dependencies)!==hashInput(engine.queueDependencies(x.run))||
      (prior?hashInput(x.ctx.nativeAdmission)!==hashInput(signed):!!x.ctx.nativeAdmission)||x.ctx.pr||!rec||rec.path!==x.ctx.worktree||!engine.owns(x))
      throw new RoundBlocked('local rescope authority or task identity changed');
    if(done&&(done.head!==i.target||done.data?.intentHash!==hashInput(i)))throw new RoundBlocked('local rescope applied evidence changed');
    if(!done){
      const next=W.refreshPristine(k.project,k.task,`${x.run.id}/rescope/${i.card}`,i);
      engine.record(x,'local-rescope-applied',{head:next.head,data:{request:request.seq,intentHash:hashInput(i)}});
    }
    // Replay after the signed effect, before the cache save, is harmless.
    const current=W.get(k.project,k.task)!;
    if(current.head!==i.target||current.baseCommit!==i.target||must(current.path,['rev-parse','HEAD'])!==i.target)
      throw new RoundBlocked('refreshed rescope head changed before spec');
    x.ctx.head=i.target;x.ctx.baseCommit=i.target;x.ctx.gatedHead=null;x.ctx.remoteCI=null;x.ctx.captures=null;x.ctx.plan=null;x.ctx.reviews=[];
    x.ctx.reviewUnverified='captain rescope requires fresh checks and review';x.save();
  };
}
