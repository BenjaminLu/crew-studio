// Read-only proof for native Images results. Context alone never certifies approval.
import {createHash} from 'node:crypto';
import type {Engine} from '../runtime/engine';
import type {ArtifactStore} from '../artifacts';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function imageOutcomeProof(engine:Engine,store:ArtifactStore,id:string){
 const no={complete:false};
 try{
  const run=engine.get(id),trust=run&&engine.trusted(id);
  if(!run||run.workflow!=='images'||run.def.kind!=='image'||run.status!=='succeeded'||!trust?.ok||run.nodes.library?.state!=='passed'||run.nodes.done?.state!=='passed')return no;
  const accept=run.nodes.accept,card=accept?.data.offerCard&&engine.cards.get(accept.data.offerCard);
  if(!card||card.run!==id||card.node!=='accept'||card.kind!=='acceptance'||!card.captainOnly||card.status!=='answered'||card.visit!==accept.data.offerVisit||card.visit!==accept.visits||accept.outcome!=='approved')return no;
  const offers=card.detail?.artifactAcceptance?.offered;
  if(!Array.isArray(offers)||offers.length!==1)return no;
  const pin=offers[0];if(pin.format!=='image'||pin.producer!=='draft'||typeof pin.id!=='string'||!Number.isSafeInteger(pin.n)||pin.n<1||!/^[a-f0-9]{64}$/.test(pin.sha256))return no;
  const head=hash(offers),choice='approve-draft';
  const answer=trust.entries.filter(e=>e.record==='card-answer'&&e.node==='accept'&&e.round===card.visit&&e.head===head&&e.data?.card===card.id&&e.data?.choice===choice).at(-1);
  if(!answer||typeof answer.actor!=='string'||!answer.actor||card.answer?.choice!==choice||card.answer.by!==answer.actor)return no;
  // The signed readiness payload pins exactly the same offered source bytes.
  const checked=trust.entries.some(e=>e.check==='core/artifact-ready'&&e.node==='checks'&&e.verdict==='pass'&&e.head===head&&e.seq<answer.seq&&Array.isArray(e.data?.artifacts)&&hash(e.data.artifacts)===head);
  if(!checked)return no;
  const a=store.get(pin.id),v=store.version(pin.id,pin.n);
  if(!a||a.type!=='image'||!v||v.artifact!==pin.id||v.n!==pin.n||v.type!=='image'||v.status!=='approved'||v.sha256!==pin.sha256||v.approvedBy!==answer.actor||v.primary!=='image.png'||!v.files.some(f=>f.path==='image.png'&&f.sha256===pin.sha256)||v.source.run!==id||store.verify(pin.id,pin.n).length||store.notes(pin.id,pin.n).some(n=>n.status==='open'))return no;
  // Retain exact published version, never substitute latest or a newer approval.
  const approved=run.ctx.approved,library=run.ctx.library;
  if(!approved||!library||[approved,library].some(p=>p.artifact!==pin.id||p.version!==pin.n||p.sha256!==pin.sha256||p.by!==answer.actor))return no;
  return{complete:true,artifact:pin.id,version:pin.n};
 }catch{return no;}
}
