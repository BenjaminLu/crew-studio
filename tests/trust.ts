// Follow-ups of the check-runtime review (#13, #14): the ledger is verified before
// any read that decides something — a tampered entry proves nothing, a ledger cut
// short proves nothing and stops the refine loop — and an edit of a workflow must
// say which version it edited.     bun tests/trust.ts
import { readFileSync, writeFileSync } from "node:fs";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("trust");
const H = await harness([
  Y({ id: "prove", name: "prove", roles: [], nodes: [{ id: "a", kind: "hook", label: "A", do: "set", args: { key: "spec", value: { done: ["proved by t/ok"] } }, x: 0, y: 0 }, { id: "k", kind: "check", label: "K", checks: [{ use: "t/ok" }], x: 1, y: 0 }, { id: "e", kind: "hook", label: "E", x: 2, y: 0 }], edges: [["a", "k"], ["k", "e", "pass"]] }),
  Y({ id: "loopy", name: "loopy", roles: [{ id: "w", label: "W", skill: "x" }], nodes: [{ id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "make", kind: "agent", label: "Make", role: "w", mode: "test", checks: [{ use: "t/failer" }], x: 1, y: 0 }, { id: "fix", kind: "loop", label: "Fix", args: { producer: "make" }, x: 1, y: 1 },
    { id: "e", kind: "hook", label: "E", x: 2, y: 0 }, { id: "broken", kind: "hook", label: "Broken", args: { result: "ledger-broken" }, x: 2, y: 1 }],
    edges: [["s", "make"], ["make", "e", "ok"], ["make", "fix", "fail"], ["fix", "make", "retry"], ["fix", "e", "pass"], ["fix", "broken", "error"]] }),
]);
const E = H.engine;
const { Ledger } = await import("../src/runtime/checks");
{ const r = E.start({ workflow: "prove", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 8000);
  ok(E.doneLines(E.get(r.id)!)[0].proved, "an intact ledger proves the line");
  const f = new Ledger(H.data, r.id).file(); const orig = readFileSync(f, "utf8");
  writeFileSync(f, orig + "{malformed-ledger-row\n");
  ok(!E.trusted(r.id).ok, "a malformed raw ledger line cannot disappear from full trust");
  writeFileSync(f, orig);
  for (const seq of ["not-a-number", "2", 0, -1, 1.5, 2, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    const rows = orig.trim().split("\n"), last = JSON.parse(rows.at(-1)!);
    if (seq === undefined) delete last.seq; else last.seq = seq;
    last.sig = (new Ledger(H.data, r.id) as any).sign(last);
    rows[rows.length - 1] = JSON.stringify(last); writeFileSync(f, rows.join("\n") + "\n");
    ok(!E.trusted(r.id).ok, "full trust rejects even a signed invalid sequence " + String(seq));
  }
  writeFileSync(f, orig);
  for (const raw of ["null", "[]", "true"]) {
    writeFileSync(f, orig + raw + "\n");
    ok(!E.trusted(r.id).ok, "a non-object raw ledger row is never silently trusted: " + raw);
  }
  writeFileSync(f, orig);
  const scan = (new Ledger(H.data, r.id) as any).authenticatedPrefix;
  ok(typeof scan === "function", "the ledger exposes a host-authenticated ordered prefix");
  if (typeof scan === "function") {
    const L = new Ledger(H.data, r.id), before = L.authenticatedPrefix();
    writeFileSync(f, orig + "{malformed-ledger-row\n" + orig);
    const broken = L.authenticatedPrefix();
    ok(before.prefix.length > 0 && broken.malformed && broken.prefix.length === before.prefix.length && broken.bad.length > 0 && !E.trusted(r.id).ok, "a raw failure closes prefix permanently before later parseable signed objects");
    writeFileSync(f, orig);
    const eventsFile = E.rdir(r.id) + "/events.jsonl", events = readFileSync(eventsFile, "utf8");
    const altered = events.trim().split("\n").map(line => { const e = JSON.parse(line); if ((e.type === "check_result" || e.type === "evidence") && e.seq === before.prefix[0].seq) e.sig = "0".repeat(64); return JSON.stringify(e); });
    writeFileSync(eventsFile, altered.join("\n") + "\n");
    const conflict = E.trusted(r.id);
    ok(L.authenticatedPrefix().prefix.length === before.prefix.length && !conflict.ok && conflict.prefix.length === 0, "host event signature disagreement cuts the authenticated prefix at the verified object position");
    writeFileSync(eventsFile, events);
  }
  const lines = orig.trim().split("\n"); const i = lines.findIndex((l) => /"t\/ok"/.test(l)); const t = JSON.parse(lines[i]); t.ms = 1; lines[i] = JSON.stringify(t); writeFileSync(f, lines.join("\n") + "\n");
  ok(!E.doneLines(E.get(r.id)!)[0].proved && E.trusted(r.id).bad.size > 0, "a tampered entry proves nothing: its line needs the captain's eye");
  writeFileSync(f, orig.trim().split("\n").slice(0, -1).join("\n") + "\n");
  const tr = E.trusted(r.id);
  ok(tr.truncated && !tr.ok && !E.doneLines(E.get(r.id)!)[0].proved, "a ledger cut short at its tail is caught (it is shorter than the run's events) and proves nothing"); }
{ const r = E.start({ workflow: "loopy", text: "x" });
  await until(() => E.ledger(r.id).some((e) => e.check === "t/failer"), 8000);
  // tamper the failing result while the loop is about to read it
  const f = new Ledger(H.data, r.id).file(); const lines = readFileSync(f, "utf8").trim().split("\n"); const j = lines.findIndex((l) => /"t\/failer"/.test(l)); const t = JSON.parse(lines[j]); t.verdict = "pass"; lines[j] = JSON.stringify(t); writeFileSync(f, lines.join("\n") + "\n");
  await until(() => E.get(r.id)!.status === "succeeded" || E.get(r.id)!.status === "failed", 15000);
  ok(E.get(r.id)!.result === "ledger-broken" && /failed verification/.test(E.get(r.id)!.nodes.fix.error ?? ""), "the refine loop refuses to decide from a ledger that fails verification", `${E.get(r.id)!.result} ${E.get(r.id)!.nodes.fix.error}`); }
{ let e = ""; try { H.defs.save("prove", { nodes: H.defs.get("prove")!.nodes, edges: H.defs.get("prove")!.edges, description: "changed" }, "t"); } catch (x: any) { e = x.message; }
  ok(/say which version you edited/.test(e), "an edit that does not say which version it edited is refused", e); }
H.stop();
end();
