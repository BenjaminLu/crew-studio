import "./lib/isolated-env.mjs";
// The acceptance gate must validate the exact artifact version a Task approved.
import assert from "node:assert/strict";
import { verify, cardWordingProblems } from "./acceptance/drive";

const cases = [
  { name: "missing v2 is rejected even when v1 is approved", version: 2, versions: [{ n: 1, status: "approved" }], error: /v2/ },
  { name: "an empty version list is rejected", version: 1, versions: [], error: /v1/ },
  { name: "a draft reference is rejected even when another version is approved", version: 2, versions: [{ n: 1, status: "approved" }, { n: 2, status: "draft" }], error: /v2.*draft/ },
  { name: "the exact approved v1 passes", version: 1, versions: [{ n: 1, status: "approved" }], error: null },
  { name: "the exact approved v2 passes despite draft v1", version: 2, versions: [{ n: 1, status: "draft" }, { n: 2, status: "approved" }], error: null },
  { name: "a missing artifact is rejected", version: 1, versions: null, error: /out-fixture/ },
];
for (const c of cases) {
  const s: any = { api: async () => ({ status: 200, body: { artifacts: c.versions ? [{ id: "out-fixture", versions: c.versions }] : [] } }) };
  const view: any = { id: "R-fixture", status: "succeeded", nodes: {}, events: [], ctx: { library: { artifact: "out-fixture", version: c.version } } };
  const failures = await verify(s, { view, answered: [], problems: [] }, { status: "succeeded", visited: [], library: true });
  if (c.error) assert(failures.some(f => c.error!.test(f)), `${c.name}: ${JSON.stringify(failures)}`);
  else assert.deepEqual(failures, [], c.name);
  console.log(`  ok    ${c.name}`);
}
console.log(`acceptance-drive: ${cases.length} passed, 0 failed`);

const card = {id:"SC-001",run:"R-fixture",node:"accept",visit:2,ste:{verdict:"pass",seq:7}};
const view = {id:"R-fixture",def:{card_checks:["core/ste-wording"]},cards:[card]};
const receipt:any = {run:"R-fixture",node:"accept",round:2,edge:"card:SC-001",check:"core/ste-wording",seq:7,verdict:"pass"};
assert.deepEqual(cardWordingProblems(view,[receipt]),[]);
for (const [name,v,entries] of [
  ["missing receipt",view,[]],
  ["missing card check state",{...view,cards:[{...card,ste:null}]},[receipt]],
  ["check exception",{...view,cards:[{...card,ste:{verdict:"error",seq:null}}]},[receipt]],
  ["wrong card",view,[{...receipt,edge:"card:SC-other"}]],
  ["wrong visit",view,[{...receipt,round:1}]],
  ["wrong node",view,[{...receipt,node:"other"}]],
  ["wrong Task",view,[{...receipt,run:"R-other"}]],
  ["wrong sequence",view,[{...receipt,seq:6}]],
  ["failed check",view,[{...receipt,verdict:"fail"}]],
  ["disabled wording policy",{...view,def:{card_checks:[]}},[receipt]],
] as const) { assert(cardWordingProblems(v,entries as any).length>0,name);console.log(`  ok    wording: ${name} is rejected`); }
console.log("acceptance wording: 11 passed, 0 failed");
