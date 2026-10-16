import { strict as assert } from 'node:assert';
import { installReadinessViews, readinessNodes } from '../src/runtime/readiness-view';
import { emptySections } from '../src/runtime/cards';
let passed = 0;
function ok(value: unknown, label: string) { assert(value, label); console.log(`PASS ${++passed} ${label}`); }
const card: any = {id:'SC-039',run:'R-023',node:'spec',visit:4,status:'open',sections:{en:emptySections(),'zh-TW':emptySections()},detail:{why:[],how:[]},options:[{id:'retry'},{id:'close'}]};
const run: any = {id:'R-023',workflow:'code-firstmate',status:'waiting',nodes:{spec:{state:'running',visits:4,waiting:'card',card:card.id,note:'owned round admitted',data:{nativeQueueCapability:{reason:'Staffing approval requires confirmation: ENOENT current.json'}}}}};
const original = JSON.stringify({run,card});
const get = (id:string) => id===card.id ? card : undefined;
const engine: any = {get:(id:string)=>id===run.id?run:undefined,cards:{get,view:(c:any)=>({...c,priorProjection:true})}};
installReadinessViews(engine);
const view = engine.cards.view(card);
ok(view.priorProjection, 'existing card projection remains chained');
ok(view.sections['zh-TW'].why.includes('角色配置'), 'existing card explains staffing requirement in Chinese');
ok(view.sections.en.why.includes('ENOENT'), 'English card retains exact readiness diagnosis');
ok(view.sections['zh-TW'].how.includes('R-023')&&view.sections['zh-TW'].how.includes('spec')&&view.sections.en.how.includes('studio_change_staffing'), 'recovery identifies exact existing task and node');
ok(view.detail.how[0].en.includes('Approve that configuration card first')&&view.sections['zh-TW'].how.includes('只重試不會'), 'detailed card explains configuration approval before separate retry');
ok(JSON.stringify(view.options)===JSON.stringify(card.options), 'projection grants no new actions');
const nodes = readinessNodes(run,get);
ok(nodes.spec.note.includes('等待角色配置核准')&&!nodes.spec.note.includes('owned round admitted'), 'run node displays real current hold instead of stale admission note');
ok(JSON.stringify({run,card})===original, 'projection does not mutate historical card or node state');
for (const [label, change] of [
 ['answered card',()=>card.status='answered'],
 ['stale card visit',()=>card.visit=3],
 ['different current card',()=>run.nodes.spec.card='SC-other'],
 ['finished task',()=>run.status='succeeded'],
 ['not waiting on card',()=>run.nodes.spec.waiting=null],
] as const) {
 const saved=JSON.parse(original);Object.assign(run,saved.run);Object.assign(card,saved.card);change();
 ok(readinessNodes(run,get).spec.note==='owned round admitted'&&!engine.cards.view(card).sections.en.how.includes('studio_change_staffing'), `${label} does not project an obsolete hold`);
}
Object.assign(run,JSON.parse(original).run);Object.assign(card,JSON.parse(original).card);
run.nodes.spec.data.nativeQueueCapability.reason='scope held by R-001';
ok(readinessNodes(run,get).spec.note.includes('scope held by R-001')&&!engine.cards.view(card).sections.en.how.includes('studio_change_staffing'), 'non-staffing hold preserves actual reason without staffing advice');
run.workflow='coffee-kit';run.nodes.spec.data.nativeQueueCapability.reason='Staffing approval requires confirmation';
ok(!readinessNodes(run,get).spec.note.includes('studio_change_staffing')&&!engine.cards.view(card).sections.en.how.includes('studio_change_staffing'), 'unsupported workflow is never directed to code-only recovery tool');
console.log(`${passed} PASS`);
