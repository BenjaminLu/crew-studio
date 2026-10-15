// Independent engine-only fail-first: no GitHub adapter or vendor dependency.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/runtime/engine";
import { WorkflowDefs } from "../src/runtime/defs";
import { Agents } from "../src/agent";
import { StudioLog } from "../src/rawlog";
let passed = 0, failed = 0;
const ok = (v: any, name: string) => { console.log(`${v ? "PASS" : "FAIL"} ${name}`); v ? passed++ : failed++; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await sleep(5); };
const data = mkdtempSync(join(tmpdir(), "external-wait-")), engines: Engine[] = [];
const workflow = "id: external\nname: External\nversion: 1\nnodes:\n  - {id: wait, kind: hook, do: wait, label: Wait}\n  - {id: done, kind: hook, do: note, label: Done, args: {result: done}}\nedges:\n  - [wait, done, ok]\n";
let registrations = 0, owners = 0, wake: any;
const create = () => {
  const e = new Engine({ dataDir: data, agents: new Agents(data, () => "http://127.0.0.1:9"), log: new StudioLog(join(data, "log")), send: () => {}, defaultProvider: () => ({ provider: "stub", model: null }), skillText: () => "" } as any, new WorkflowDefs(data, () => [workflow])); engines.push(e);
  (e as any).externalHandlers ??= {};
  (e as any).externalHandlers.fixture = (_x: any, _d: any, callback: any) => { registrations++; owners++; wake = callback; return () => { owners--; }; };
  e.actions.wait = (x: any) => { const descriptor = { version: 1 as const, handler: "fixture", deadline: Date.now() + 1000 }; x.rn.data.external = descriptor; return { wait: true as const, external: descriptor }; };
  return e;
};
try {
  let e = create(); e.load(); const run = e.start({ workflow: "external" }); await until(() => run.status === "waiting");
  const deadline = run.nodes.wait.data.external.deadline;
  ok(run.nodes.wait.waiting === "external" && registrations === 1 && owners === 1, "external result durably registers exactly one owner, not a card wait");
  (e as any).disposeExternal?.(); await sleep(30); e = create(); e.load(); await until(() => e.get(run.id)?.status === "waiting"); const recovered = e.get(run.id)!;
  ok(recovered.nodes.wait.data.external.deadline === deadline && recovered.nodes.wait.visits === 1 && registrations === 2 && owners === 1, "restart restores the original deadline/visit instead of replaying the action");
  if (!["failed", "succeeded", "cancelled"].includes(recovered.status)) e.cancel(run.id); await until(() => !e.busy(run.id)); const count = e.events(run.id).length; wake?.({ outcome: "ok" }); await sleep(30);
  ok(owners === 0 && e.events(run.id).length === count && recovered.status === "cancelled", "cancellation unregisters callback and rejects its late completion without an event");
} finally { for (const e of engines) (e as any).disposeExternal?.(); rmSync(data, { recursive: true, force: true }); }
console.log(`${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
