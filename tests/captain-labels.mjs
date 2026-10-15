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
