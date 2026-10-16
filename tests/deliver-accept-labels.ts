import './lib/isolated-env.mjs';
import {harness,suite,until,Y} from './rt-harness';
import {installDeliver} from '../src/domain/deliver';
import {ArtifactStore} from '../src/artifacts';
import {dryStubProvider} from '../src/readiness/dryrun';
const {ok,end}=suite('deliver-accept-labels');
process.env.CREW_TEST_IN_PROCESS='1';
for(const producers of [['brand','menu','social'],['design-one','design-three','social']]){
const flow={id:'accept-label-fixture',version:1,name:'Three deliverables',roles:[{id:'writer',label:'Writer',skill:'fixture'}],nodes:[
 {id:'intake',kind:'hook',do:'deliver.intake',label:'Start',x:0,y:0},
 ...producers.map(id=>({id,kind:'agent',role:'writer',mode:'deliver',args:{format:'document'},label:id,x:0,y:0})),
 ...producers.map(id=>({id:'accept-'+id,kind:'card',args:{mode:'deliver-accept',card_kind:'acceptance'},label:'Accept '+id,x:0,y:0})),
 {id:'done',kind:'hook',label:'Done',x:0,y:0}],edges:[['intake',producers[0]],[producers[0],producers[1]],[producers[1],producers[2]],[producers[2],'accept-'+producers[0]],['accept-'+producers[0],'accept-'+producers[1],'approved'],['accept-'+producers[1],'accept-'+producers[2],'approved'],['accept-social','done','approved'],['accept-'+producers[0],producers[0],'changes']]};
const H=await harness([Y(flow)]),E=H.engine,store=new ArtifactStore(H.data);
installDeliver(E,{dataDir:H.data,artifacts:store,lane:null,fileorg:null,docs:null});
const provider=dryStubProvider((name,args,token)=>H.agents.callTool(token,name,args));E.deps.provider=()=>provider;
const card=async(id:string,node:string)=>{if(!await until(()=>E.cards.list({run:id,open:true}).some(c=>c.node===node),5000))throw Error('no card '+node);return E.cards.list({run:id,open:true}).find(c=>c.node===node)!;};
try{
 for(const revise of [false,true]){
  const run=E.start({workflow:flow.id,text:'Produce three local documents'});let first=await card(run.id,'accept-'+producers[0]);
  const old=structuredClone(run.ctx.deliver);
  if(revise){
   await E.answer(first.id,{choice:'changes',note:'Refine all three documents',by:'captain'});first=await card(run.id,'accept-'+producers[0]);
   ok(producers.every(p=>run.ctx.deliver[p].id===old[p].id&&run.ctx.deliver[p].n===2&&store.version(old[p].id,1)), 'rerunning original producer updates only its keyed latest ref and preserves v1 history');
   ok(producers.every(p=>run.nodes[p].visits===2),'revision graph reruns all three original producers');
  }
  for(const producer of producers){
   const c=await card(run.id,'accept-'+producer),offers=c.detail!.artifactAcceptance!.offered;
   const approve=c.options.filter(o=>o.id.startsWith('approve-'));
   ok(offers.length===3&&new Set(approve.map(o=>o.label)).size===3&&new Set(approve.map(o=>o.labelZh)).size===3,'each acceptance card distinctly labels all 3 offers in both languages');
   ok(approve.every(o=>o.label.includes(o.id.slice('approve-'.length))&&o.labelZh?.includes(o.id.slice('approve-'.length))),'producer identity appears in each approval label');
   const pinned=offers.find(o=>o.producer===producer)!;
   await E.answer(c.id,{choice:'approve-'+producer,note:'Checked this producer',by:'captain'});
   ok(store.version(pinned.id,pinned.n)?.status==='approved'&&run.ctx.approved.artifact===pinned.id&&run.ctx.approved.version===pinned.n,'exact '+producer+' option approves its pinned artifact version');
  }
  await until(()=>run.status==='succeeded',5000);
  ok(run.status==='succeeded'&&producers.every(p=>store.version(run.ctx.deliver[p].id,run.ctx.deliver[p].n)?.status==='approved'),'three sequential choose-one cards complete with all three artifacts approved');
  ok(E.trusted(run.id).entries.filter(e=>e.record==='card-answer'&&e.data?.choice?.startsWith('approve-')).map(e=>e.data!.choice).join()===producers.map(p=>'approve-'+p).join(),'signed card history retains each exact selection despite final ctx.approved pointer');
 }
}catch(e){ok(false,'fixture',String((e as any).stack??e));}finally{for(const r of E.list())if(!['succeeded','cancelled','failed'].includes(r.status))await E.cancel(r.id);H.stop();}
}
end();
