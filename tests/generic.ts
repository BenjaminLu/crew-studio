// A generic runtime (fix round 1, runtime class "generic", check-runtime#7; arch §1.1, §1.2):
// the runtime knows no domain. Hooks fire on the lifecycle points a node declares
// (not on mode === "build" or do === "git.merge"); the loop's routed classes and
// report checks, a card's checks and its auto option come from the workflow; no
// domain literal is left in src/runtime's generic files.     bun tests/generic.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("generic");
const H = await harness([
  // a documents-like workflow: its publish step declares after_merge, nothing is called "git.merge"
  Y({ id: "doclike", name: "doclike", roles: [], hooks: [{ at: "after_merge", use: "t/hk" }, { at: "after_round", use: "t/hk" }], nodes: [
    { id: "publish", kind: "hook", label: "Publish", do: "set", args: { key: "p", value: 1 }, lifecycle: ["after_merge"], x: 0, y: 0 },
    { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["publish", "e"]] }),
  // a code-like workflow whose merge step does not declare the lifecycle point: no hook
  Y({ id: "nodecl", name: "nodecl", roles: [], hooks: [{ at: "after_merge", use: "t/hk" }], nodes: [
    { id: "merge", kind: "hook", label: "Merge", do: "set", args: { key: "m", value: 1 }, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["merge", "e"]] }),
  // a one-way door on a card whose option ids are its own: every option but a hold needs the confirmation
  Y({ id: "ownids", name: "ownids", roles: [], nodes: [
    { id: "d", kind: "hook", label: "Door", do: "set", args: { key: "gate", value: { door: "one-way" } }, x: 0, y: 0 },
    { id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship", "zh-TW": "出貨" }, confirm_door: true, door_from: "gate", options: [{ id: "ship", label: "Ship" }, { id: "abandon", label: "Abandon", hold: true }] }, x: 1, y: 0 },
    { id: "shipped", kind: "hook", label: "Shipped", args: { result: "shipped" }, x: 2, y: 0 }, { id: "abandoned", kind: "hook", label: "Abandoned", args: { result: "abandoned" }, x: 2, y: 1 }],
    edges: [["d", "q"], ["q", "shipped", "ship"], ["q", "abandoned", "abandon"]] }),
  // a loop that routes a class of its own choosing
  Y({ id: "routes", name: "routes", roles: [{ id: "w", label: "W", skill: "x" }], nodes: [
    { id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "make", kind: "agent", label: "Make", role: "w", mode: "test", checks: [{ use: "t/failer", params: { cls: "needs-redesign" } }], x: 1, y: 0 },
    { id: "fix", kind: "loop", label: "Fix", args: { producer: "make", route_classes: { "needs-redesign": "redesign" } }, x: 1, y: 1 },
    { id: "redesign", kind: "hook", label: "Redesign", args: { result: "redesign" }, x: 2, y: 1 }, { id: "e", kind: "hook", label: "E", x: 2, y: 0 }],
    edges: [["s", "make"], ["make", "e", "ok"], ["make", "fix", "fail"], ["fix", "make", "retry"], ["fix", "redesign", "redesign"], ["fix", "e", "pass"]] }),
]);
const E = H.engine;
{ const r = E.start({ workflow: "doclike", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 8000);
  await until(() => E.ledger(r.id).some((e) => e.check === "t/hk"), 8000); await sleep(400);
  const hk = E.ledger(r.id).filter((e) => e.check === "t/hk");
  ok(hk.length === 1 && hk[0].edge === "hook:after_merge" && hk[0].node === "publish", "a node that declares lifecycle after_merge fires the workflow's after_merge hook (and only the points it declares)", JSON.stringify(hk.map((e) => e.edge))); }
{ const r = E.start({ workflow: "nodecl", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 8000); await sleep(400);
  ok(E.ledger(r.id).filter((e) => e.check === "t/hk").length === 0, "a node named merge fires nothing unless it declares the lifecycle point"); }
{ const r = E.start({ workflow: "routes", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 10000);
  ok(E.get(r.id)!.result === "redesign", "the loop routes a finding class the workflow names (route_classes), not one the runtime knows"); }
{ const r = E.start({ workflow: "ownids", text: "x" }); await until(() => E.get(r.id)!.status === "waiting", 8000);
  const c = E.cards.list({ run: r.id })[0]; let e1 = ""; try { await E.answer(c.id, { choice: "ship", by: "captain" }); } catch (e: any) { e1 = e.message; }
  ok(c.door === "one-way" && /confirm the door/.test(e1), "a card declares its door from the door node's output; on a one-way door any option but a hold needs the confirmation, whatever its id", e1);
  await E.answer(c.id, { choice: "ship", by: "captain", confirm: "one-way" }); await until(() => E.get(r.id)!.status === "succeeded", 8000);
  ok(E.get(r.id)!.result === "shipped", "with the confirmation, the option goes through");
  const r2 = E.start({ workflow: "ownids", text: "x" }); await until(() => E.get(r2.id)!.status === "waiting", 8000);
  await E.answer(E.cards.list({ run: r2.id })[0].id, { choice: "abandon", by: "captain" }); await until(() => E.get(r2.id)!.status === "succeeded", 8000);
  ok(E.get(r2.id)!.result === "abandoned", "a hold option needs no confirmation"); }
H.stop();
// no domain literal in the generic runtime
const generic = ["engine.ts", "refine.ts", "checks.ts", "defs.ts", "cards.ts", "grants.ts", "locator.ts", "index.ts"];
const banned = [/firstmate\//, /git\.merge/, /mode === "build"/, /report-schema/, /door-change/, /\bmigration\b/, /\bworktree\b/i, /\bfail-first\b/, /choice === "/, /=== "(merge|dispatch|close|approve)"/, /ctx\.door\b/];
const hits: string[] = [];
for (const f of generic) { const t = readFileSync(join(import.meta.dir, "..", "src", "runtime", f), "utf8").split("\n");
  t.forEach((l, i) => { if (/^\s*(\/\/|\*)/.test(l)) return; for (const b of banned) if (b.test(l)) hits.push(`${f}:${i + 1} ${b}`); }); }
ok(!hits.length, "the generic runtime files carry no domain literal (firstmate, git merge, build mode, report schema, door change, migration, worktree, fail-first)", hits.join(" | "));
end();
