import "./lib/isolated-env.mjs";
import { strict as assert } from "node:assert";
import { workerManifest, WorkerLease } from "../src/worker-boundary";
let passed = 0;
const test = (name: string, f: () => void) => { f(); passed++; console.log(`ok ${name}`); };
const policy = { controllerUid: 501, workerUid: 502, workerGid: 502, workerHome: "/Users/crew-worker", stagingRoot: "/private/var/crew-worker", path: "/usr/bin:/bin" };
const request = { run: "R-123", argv: ["node", "tests/run.js"], cwd: "worktree", timeoutS: 60 };
test("broker selects OS identity and never inherits controller env", () => {
  const m = workerManifest(request, policy);
  assert.equal(m.uid, 502); assert.equal(m.gid, 502); assert.equal(m.env.HOME, policy.workerHome);
  assert.deepEqual(Object.keys(m.env).sort(), ["CI", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "HOME", "HOST", "LANG", "PATH"]);
});
for (const field of ["uid", "gid", "env", "home", "stagingRoot", "protocol"]) test(`request cannot supply ${field}`, () => assert.throws(() => workerManifest({ ...request, [field]: "injected" }, policy)));
for (const cwd of ["/Users/operator", "../secret", "a/../b", "a/./b", "a//b", "a\\b", "a\0b", ""]) test(`reject cwd ${JSON.stringify(cwd)}`, () => assert.throws(() => workerManifest({ ...request, cwd }, policy)));
test("reject same uid and root", () => {
  assert.throws(() => workerManifest(request, { ...policy, workerUid: 501 }));
  assert.throws(() => workerManifest(request, { ...policy, workerUid: 0 }));
  assert.throws(() => workerManifest(request, { ...policy, workerGid: 0 }));
});
test("reject command protocol abuse", () => {
  for (const argv of [[], [""], ["node", "a\0b"], Array(257).fill("x"), ["node", "x".repeat(65537)]]) assert.throws(() => workerManifest({ ...request, argv }, policy));
  for (const timeoutS of [0, -1, 1.5, Infinity, 3601]) assert.throws(() => workerManifest({ ...request, timeoutS }, policy));
  assert.throws(() => workerManifest({ ...request, run: "../../escape" }, policy));
});
test("manifest does not alias caller argv", () => { const r = { ...request, argv: ["node"] }; const m = workerManifest(r, policy); r.argv[0] = "changed"; assert.equal(m.argv[0], "node"); });
test("a dedicated uid cannot host concurrent runs or reuse before cleanup", () => {
  const lease = new WorkerLease(); lease.start("a"); assert.throws(() => lease.start("b"));
  assert.throws(() => lease.finish("b")); lease.finish("a"); assert.throws(() => lease.start("b"));
  assert.throws(() => lease.cleaned("b", true)); lease.cleaned("a", true); lease.start("b"); assert.equal(lease.state, "running");
});
test("unverified cleanup quarantines worker", () => { const lease = new WorkerLease(); lease.start("a"); lease.finish("a"); lease.cleaned("a", false); assert.equal(lease.state, "quarantined"); assert.throws(() => lease.start("b")); });
test("truthy non-boolean cleanup cannot release lease", () => { const lease = new WorkerLease(); lease.start("a"); lease.finish("a"); lease.cleaned("a", "false" as any); assert.equal(lease.state, "quarantined"); });
console.log(`${passed} passed, 0 failed`);
