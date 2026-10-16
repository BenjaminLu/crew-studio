import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { nativeSkinData, snapshotFor } from '../src/skins';
import { suite } from './rt-harness';
const { ok, end } = suite('skins-native');
const run: any = { id: 'R-101', title: 'Onboarding', workflow: 'web-prototype', version: 1, status: 'running', updatedAt: 'now',
  ctx: { secret: 'DO_NOT_EXPOSE' }, def: { nodes: [{ id: 'draft', kind: 'agent', role: 'designer', label: 'Build modal' }, { id: 'accept', kind: 'card', label: 'Accept' }], edges: [{ from: 'draft', to: 'accept' }] },
  nodes: { draft: { state: 'running', job: 'J1', visits: 1 }, accept: { state: 'pending', visits: 0 } } };
const cards: any[] = [{ id: 'SC-101', run: run.id, status: 'open', title: { en: 'Accept', 'zh-TW': '驗收' }, kind: 'acceptance', secret: 'DO_NOT_EXPOSE' }];
let data = nativeSkinData([run], cards);
ok(data.tasks[0].status === 'running' && data.crew.length === 1 && data.crew[0].task === run.id, 'native active task and actual worker are projected');
ok(data.flow.nodes.some(n => n.id === data.tasks[0].node), 'task location belongs to its native workflow route');
ok(!JSON.stringify(data).includes('DO_NOT_EXPOSE'), 'run context and private card fields never enter the skin projection');
run.nodes.draft.state = 'passed'; run.nodes.accept.state = 'running'; run.status = 'waiting';
data = nativeSkinData([run], cards);
ok(data.tasks[0].status === 'needs-you' && data.crew.length === 0 && data.pending[0].id === 'SC-101' && data.pending[0].title === '驗收', 'waiting task shows its native card without stale worker');
const denied = snapshotFor([], data);
ok(!denied.tasks.length && !denied.pending.length && !denied.crew.length && denied.flow === null, 'skin permissions still hide ungranted snapshot sections');
cards[0].status = 'answered'; run.status = 'succeeded'; run.nodes.accept.state = 'passed';
data = nativeSkinData([run], cards);
ok(data.tasks[0].status === 'done' && !data.pending.length && !data.crew.length, 'completed task removes pending flags and active crew');
run.archived = true;
ok(!nativeSkinData([run], cards).tasks.length, 'archived native tasks are hidden');
const parent: any = { ...run, id:'proposal', archived:false, status:'succeeded', params:{} };
const child: any = { ...run, id:'child', archived:false, status:'running', params:{_firstmateProposal:'proposal', secret:'DO_NOT_EXPOSE'} };
const grandchild: any = { ...child, id:'grandchild', params:{_firstmateProposal:'child'} };
const sibling: any = { ...child, id:'independent', params:{} };
const grouped = snapshotFor(['snapshot.tasks'], nativeSkinData([parent,child,grandchild,sibling],[]));
ok(grouped.tasks.find(t=>t.id==='child')?.rootTask === 'proposal' && grouped.tasks.find(t=>t.id==='grandchild')?.rootTask === 'proposal', 'spawned descendants retain one root task identity in skin snapshots');
ok(grouped.tasks.find(t=>t.id==='independent')?.rootTask === 'independent' && !JSON.stringify(grouped).includes('DO_NOT_EXPOSE'), 'independent tasks stay separate and lineage exposes no private params');
const reviewing:any = {...child, id:'R-review', nodes:{draft:{state:'passed'},accept:{state:'running'}}};
const jobs:any[] = [
  {id:'judge-a',ref:'R-review',kind:'judge:reviewer',status:'running'},
  {id:'judge-b',ref:'R-review',kind:'judge:designer',status:'running'},
  {id:'old',ref:'R-review',kind:'judge:reviewer',status:'done'},
  {id:'unrelated',ref:'other',kind:'judge:reviewer',status:'running'},
];
const reviewCrew=nativeSkinData([reviewing],[],jobs).crew;
ok(reviewCrew.length===2 && reviewCrew.every(c=>c.task==='R-review'), 'both live judges are visible without stale or unrelated jobs');
ok(new Set(reviewCrew.map(c=>c.name)).size===2, 'parallel judges have distinct crew identities');
reviewing.status='succeeded';
ok(!nativeSkinData([reviewing],[],jobs).crew.length,'terminal tasks hide even lingering registry jobs');
run.archived=false;run.status='running';run.nodes.draft.state='running';
ok(!nativeSkinData([run],[],[]).crew.length,'live registry prevents stale node job from appearing active');
end();
