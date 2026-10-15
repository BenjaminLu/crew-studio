// Product guidance records progress only. It cannot create work or grant authority.
import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,lstatSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerKey} from './runtime/checks';
import {staffingHash} from './domain/staffing';
import type {Engine} from './runtime/engine';
import type {ArtifactStore} from './artifacts';
import {coffeeJourneyProof} from './domain/coffee-kit';
type State={schema:1;revision:number;previous:string|null;id:string;choice:'coffee'|'own';paused:boolean;proposal:string|null;task:string|null};
const hash=(v:unknown)=>staffingHash(v);
export class Onboarding {
 private path:string;
 constructor(private engine:Engine,private artifacts:ArtifactStore){this.path=join(engine.deps.dataDir,'onboarding');}
 private read():State|null {
  if(!existsSync(this.path))return null;
  const st=lstatSync(this.path);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Onboarding storage is unavailable');
  const files=readdirSync(this.path).sort();if(files.length>256)throw new Error('Onboarding history limit; recover explicitly');
  let current:State|null=null,previous:string|null=null;
  for(let i=0;i<files.length;i++){
   if(files[i]!==String(i+1).padStart(6,'0')+'.json')throw new Error('Onboarding history is incomplete');
   const at=join(this.path,files[i]),s=lstatSync(at);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>4096)throw new Error('Onboarding record is unavailable');
   const record=JSON.parse(readFileSync(at,'utf8')),body=record.body as State;
   if(!body||Object.keys(body).sort().join('|')!=='choice|id|paused|previous|proposal|revision|schema|task'||body.schema!==1||body.revision!==i+1||body.previous!==previous||!['coffee','own'].includes(body.choice)||typeof body.paused!=='boolean'||typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id)||[body.proposal,body.task].some(x=>x!==null&&(typeof x!=='string'||!/^R-\d+$/.test(x))))throw new Error('Onboarding record schema differs');
   const signature=createHmac('sha256',ledgerKey(this.engine.deps.dataDir)).update(hash(body)).digest('hex');
   if(typeof record.signature!=='string'||!/^[a-f0-9]{64}$/.test(record.signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(record.signature)))throw new Error('Onboarding signature differs');
   previous=hash(body);current=body;
  }
  return current;
 }
 private write(next:Omit<State,'schema'|'revision'|'previous'>){const old=this.read();mkdirSync(this.path,{recursive:true,mode:0o700});const body:State={schema:1,revision:(old?.revision??0)+1,previous:old?hash(old):null,...next};const signature=createHmac('sha256',ledgerKey(this.engine.deps.dataDir)).update(hash(body)).digest('hex');writeFileSync(join(this.path,String(body.revision).padStart(6,'0')+'.json'),JSON.stringify({body,signature}),{flag:'wx',mode:0o600});return body;}
 choose(choice:unknown){if(choice!=='coffee'&&choice!=='own')throw new Error('Choose coffee or your own goal');const old=this.read();if(old){if(old.choice!==choice)throw new Error('An existing journey is retained; resume it or use Firstmate for another goal');return this.view();}this.write({id:randomBytes(16).toString('hex'),choice,paused:false,proposal:null,task:null});return this.view();}
 pause(paused:boolean){const old=this.read();if(old&&old.paused!==paused){const{schema,revision,previous,...rest}=old;this.write({...rest,paused});}return this.view();}
 proposal(id:string){const old=this.read();if(!old||old.choice!=='coffee'||old.proposal)return;const r=this.engine.get(id),t=r&&this.engine.trusted(id);if(!r||r.workflow!=='firstmate-proposal'||!t?.ok)throw new Error('Onboarding proposal authority is unavailable');const{schema,revision,previous,...rest}=old;this.write({...rest,proposal:id});}
 dispatch(proposal:string,task:string){const old=this.read();if(!old||old.proposal!==proposal)return;if(old.task){if(old.task!==task)throw new Error('Onboarding dispatch identity changed');return;}this.bound(proposal,task);const{schema,revision,previous,...rest}=old;this.write({...rest,task});}
 private bound(proposal:string,task:string){const p=this.engine.get(proposal),r=this.engine.get(task),t=p&&this.engine.trusted(proposal);if(!p||!r||p.workflow!=='firstmate-proposal'||r.def.kind!=='coffee-kit'||!t?.ok||r.params._firstmateProposal!==proposal||r.params._firstmateDefinition!==p.params.definition||staffingHash(r.def)!==p.params.definition)throw new Error('Onboarding Task binding is unavailable');const dispatch=t.entries.find(e=>e.record==='native-dispatch'&&e.data?.proposal===proposal&&e.data?.child===task&&e.data?.definition===p.params.definition);const card=dispatch&&this.engine.cards.get(dispatch.data.card);if(!card?.captainOnly||card.run!==proposal||card.node!=='dispatch'||card.answer?.choice!=='approve'||!t.entries.some(e=>e.record==='card-answer'&&e.data?.card===card.id&&e.data?.choice==='approve'))throw new Error('Onboarding dispatch requires actual captain approval');return r;}
 view(){try{const s=this.read();if(!s)return{stage:'choose',started:false,complete:false,paused:false};if(s.choice==='own')return{stage:'own-goal',started:true,complete:false,paused:s.paused,choice:s.choice};if(!s.proposal)return{stage:'discuss',started:true,complete:false,paused:s.paused,choice:s.choice};if(!s.task)return{stage:'confirm',started:true,complete:false,paused:s.paused,choice:s.choice,proposal:s.proposal,href:`#/run/${s.proposal}`};const run=this.bound(s.proposal,s.task),proof=coffeeJourneyProof(this.engine,this.artifacts,s.task);return{started:true,paused:s.paused,choice:s.choice,proposal:s.proposal,task:s.task,href:`#/run/${s.task}`,stage:proof.complete?'complete':proof.hold?'hold':['cancelled','failed','succeeded'].includes(run.status)?'hold':proof.review?'review':'produce',...proof};}catch{return{stage:'hold',started:true,complete:false,paused:false,reason:'Saved onboarding evidence is unavailable. Existing work is preserved; no replacement is started.'};}}
}
