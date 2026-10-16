import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import {codeHandoffView} from '../src/domain/code-handoff';
import {emptySections,type SCard} from '../src/runtime/cards';
const card={workflow:'code-firstmate',node:'scope-card',kind:'scope',status:'open',body:'SCOPE-BLOCKED: repo.lint is not declared in .crew/gates.json',sections:{en:emptySections(),'zh-TW':emptySections()},options:[{id:'rescope',note:true},{id:'park'}]} as SCard;
const original=JSON.stringify(card),view=codeHandoffView(card);
assert.match(view.sections['zh-TW'].why,/執行設定/);assert.match(view.sections['zh-TW'].how,/不是重試 build/);
assert.equal(JSON.stringify(card),original);assert.equal(view.body,card.body);assert.deepEqual(view.options.map(o=>o.id),card.options.map(o=>o.id));
assert.match(codeHandoffView({...card,body:'scope-overlap: tests/a.ts overlaps R-023'}).sections['zh-TW'].why,/衝突/);
assert.equal(codeHandoffView({...card,status:'answered'}).sections,card.sections);
assert.equal(codeHandoffView({...card,node:'other'}).sections,card.sections);
const savedMode=process.env.CREW_LOCAL_UNRESTRICTED,savedRoot=process.env.CREW_LOCAL_DEPENDENCY_ROOT;
try {
 delete process.env.CREW_LOCAL_UNRESTRICTED;
 const restricted=codeHandoffView(card);
 assert.match(restricted.sections.en.how,/under the current sandbox policy/);
 assert.match(restricted.sections['zh-TW'].how,/現有 sandbox 限制/);
 const overlapRestricted=codeHandoffView({...card,body:'scope-overlap: tests/a.ts overlaps R-023'});
 process.env.CREW_LOCAL_UNRESTRICTED='1';
 process.env.CREW_LOCAL_DEPENDENCY_ROOT='/operator/dependencies';
 const unrestricted=codeHandoffView(card);
 assert.match(unrestricted.sections.en.how,/OS sandbox and outbound-network restrictions are disabled/);
 assert.match(unrestricted.sections['zh-TW'].how,/OS sandbox 與對外網路限制已停用/);
 assert.doesNotMatch(unrestricted.sections.en.how,/under the current sandbox policy/);
 assert.doesNotMatch(unrestricted.sections['zh-TW'].how,/現有 sandbox 限制/);
 for (const guidance of [restricted,unrestricted]) {
  assert.match(guidance.sections.en.how,/Task scope, captain approvals, repository identity, signed ledger and artifact validation remain enforced/);
  assert.match(guidance.sections['zh-TW'].how,/不是重試 build/);
  assert.equal(guidance.body,card.body);
  assert.deepEqual(guidance.options.map(o=>o.id),card.options.map(o=>o.id));
 }
 assert.match(unrestricted.sections.en.how,/dependency installation remains limited to the operator-configured directory/);
 assert.equal(JSON.stringify(card),original);
 assert.deepEqual(codeHandoffView({...card,body:'scope-overlap: tests/a.ts overlaps R-023'}),overlapRestricted);
} finally {
 if(savedMode===undefined)delete process.env.CREW_LOCAL_UNRESTRICTED;else process.env.CREW_LOCAL_UNRESTRICTED=savedMode;
 if(savedRoot===undefined)delete process.env.CREW_LOCAL_DEPENDENCY_ROOT;else process.env.CREW_LOCAL_DEPENDENCY_ROOT=savedRoot;
}
console.log('code-handoff: read-only reason, owner, required input and unchanged authority PASS');
