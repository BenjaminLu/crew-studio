import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
let receive, view;
const code = readFileSync('scripts/captain-adapter.js', 'utf8').replace("import { BoardSource } from './board-source.js';", '');
vm.runInNewContext(code, {
  BoardSource: class { accept(value) { view = value; } },
  window: {}, document: {documentElement:{}, getElementById:()=>({})},
  CrewSkin: {onSnapshot(fn){receive=fn;},onEvent(){}},
  setInterval(){}, addEventListener(){},
});
const title='完整任務描述與不含空白的長字串'.repeat(100);
const name='worker-🐕'.repeat(30);
receive({tasks:[{id:'R-012',title,status:'running'}],crew:[{name,task:'R-012',role:'worker',alive:true}],pending:[]});
assert.equal(view.crew[0].crew_name,'R-012');
assert.equal(view.tasks[0].title,title);
assert.equal(view.crew[1].id,name);
assert.ok(Array.from(view.crew[1].crew_name).length<=20);
assert.ok(!view.crew[1].crew_name.includes('\uFFFD'));
console.log('PASS Captain labels stay compact; full task titles and worker identities survive');

for (const status of ['failed', 'succeeded', 'cancelled', 'done', 'closed', 'parked']) {
  receive({tasks:[{id:'R-012',title,status}],crew:[{name,task:'R-012',role:'worker',alive:true}],pending:[{id:'stale-card',task:'R-012'}]});
  assert.equal(view.crew.length,0,`${status} must remove all task crew`);
  assert.equal(view.pending.length,0,`${status} must not resurrect a task through stale cards`);
  assert.ok(['merged','closed','parked'].includes(view.tasks[0].stage));
}
receive({tasks:[{id:'R-009',status:'succeeded'},{id:'R-010',rootTask:'R-009',status:'failed'}],crew:[],pending:[]});
assert.equal(view.crew.length,0,'a failed child must not keep its completed parent on deck');
console.log('PASS terminal tasks and failed children leave Captain');
