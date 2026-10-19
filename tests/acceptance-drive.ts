import "./lib/isolated-env.mjs";
// The acceptance gate must validate the exact artifact version a Task approved.
import assert from "node:assert/strict";
import { verify } from "./acceptance/drive";

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
