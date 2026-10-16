import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The record of every agent round (units round-record, fix-round-record-r1): the
// captain sees the exact prompt of every agent invocation.
// data/runs/<run>/nodes/<node>/<round>/ holds prompt.md (a header naming the run,
// node, round, attempt, hop, head, the bound brief and the ledger entries it came
// from, the job, provider and model; then the exact bytes the provider received,
// written before it starts), system.md, stream.jsonl ({ts, type:
// message|tool_call|tool_result|status}) and report.json; a hand-off in the same round
// writes prompt.hop<n>.md with the same n as its header. No credential is written: one
// registry (secure.ts) removes real key formats and the values of Studio's own secrets
// (env and file-held). A record that cannot be written fails the job, never a ghost.
//   bun tests/round-record.ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("round-record");
const tmp = mkdtempSync(join(tmpdir(), "crew-rec-"));
// Studio's secrets: one in its environment, one in its key store (a file), neither credential-shaped
const ENV_SECRET = "plain-env-value-without-pattern-123456", FILE_SECRET = "plain-file-held-secret-7890xyz";
process.env.CREW_COMPAT_API_KEY = ENV_SECRET;
const { setKeysDir, saveKeys } = await import("../src/keys"); setKeysDir(tmp); saveKeys({ openai: FILE_SECRET });
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const roles = [{ id: "maker", label: "Maker", skill: "x" }];
const H = await harness([Y({ id: "rec", name: "rec", roles, nodes: [
  { id: "start", kind: "hook", label: "Start", do: "set", args: { key: "head", value: HEAD }, x: -1, y: 0 },
  { id: "make", kind: "agent", label: "Make", role: "maker", mode: "test", args: { say: 'Call: note_write {"a":1}' }, checks: [{ use: "t/failer", params: { cls: "same-class", flagfile: join(tmp, "never") } }], x: 0, y: 0 },
  { id: "fix", kind: "loop", label: "Fix", args: { producer: "make", round_cap: 2 }, x: 0, y: 1 },
  { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }, { id: "stop", kind: "hook", label: "Stop", args: { result: "closed" }, x: 1, y: 1 }],
  edges: [["start", "make"], ["make", "done", "ok"], ["make", "fix", "fail|timeout"], ["fix", "make", "retry|report"], ["fix", "done", "pass"], ["fix", "stop", "step-back|stalled|cap"]] }),
  Y({ id: "swap", name: "swap", roles, nodes: [{ id: "make", kind: "agent", label: "Make", role: "maker", mode: "test", args: { say: "STUB_SLOW" }, x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["make", "done"]] })], { refine: true });
const E = H.engine;
// what the provider really receives (text and system), per provider
const received: { provider: string; text: string; system: string }[] = []; const orig = (E as any).deps.provider;
(E as any).deps.provider = (id?: string, m?: string) => { const p = orig(id, m); return { ...p, start: (sys: string, tools: any, ctx: any) => { const s = p.start(sys, tools, ctx); return { interrupt: () => s.interrupt(), send: (t: string) => { received.push({ provider: p.id, text: t, system: sys }); return s.send(t); } }; } }; };
// the system prompt carries a secret too
const testMode = E.modes.test; E.modes.test = { ...testMode, system: (x: any, sk: string) => `${testMode.system(x, sk)} (key ${FILE_SECRET})` };
const KEYS = ["sk-ant-api03-AbCdEfGhIjKlMnOpQr_StUvWxYz0123456789-abcdEFGH", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_abc", "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"];
const r = E.start({ workflow: "rec", text: `please do it (keys ${KEYS.join(" ")} ${ENV_SECRET} ${FILE_SECRET})` });
await until(() => ["succeeded", "failed"].includes(E.get(r.id)!.status), 60000);
const dir = (n: number) => join(H.data, "runs", r.id, "nodes", "make", String(n));
const parse = (f: string) => { const t = readFileSync(f, "utf8"); const i = t.indexOf("\n---\n"); const head: any = {};
  for (const l of t.slice(4, i).split("\n")) { const k = l.slice(0, l.indexOf(":")); head[k] = JSON.parse(l.slice(l.indexOf(":") + 1)); } return { head, text: t.slice(i + 5) }; };
ok(existsSync(join(dir(1), "prompt.md")) && existsSync(join(dir(2), "prompt.md")), "every round of an agent node leaves data/runs/<run>/nodes/<node>/<round>/prompt.md", E.get(r.id)!.status);
const p1 = parse(join(dir(1), "prompt.md")), p2 = parse(join(dir(2), "prompt.md"));
ok(received.length >= 2 && p1.text === received[0].text && p2.text === received[1].text && readFileSync(join(dir(1), "system.md"), "utf8") === received[0].system, "prompt.md's bytes after its header (and system.md) equal what the provider received");
// the header's values, not only its keys
{ const g = E.get(r.id)!; const brief = g.ctx.briefs?.make; const rep1 = JSON.parse(readFileSync(join(dir(1), "report.json"), "utf8"));
  const failing1 = E.ledger(r.id).filter((e: any) => e.node === "make" && e.round === 1 && e.check === "t/failer" && e.verdict === "fail").map((e: any) => e.seq);
  ok(p1.head.run === r.id && p1.head.node === "make" && p1.head.round === 1 && p1.head.attempt === 1 && p1.head.hop === 0 && p1.head.head === HEAD && p1.head.brief === null && JSON.stringify(p1.head.ledger) === "[]"
    && p1.head.job === rep1.job && p1.head.provider === "stub" && p1.head.model === "no model" && /^\d{4}-/.test(p1.head.sent), "round 1's header: run, node, round, attempt, hop, head, no brief yet, job, provider, model, sent", JSON.stringify(p1.head));
  ok(p2.head.round === 2 && p2.head.head === HEAD && p2.head.brief === `make@1:${HEAD.slice(0, 12)}` && /^make@\d+:/.test(brief?.id ?? "") && JSON.stringify(p2.head.ledger) === JSON.stringify(failing1) && failing1.length > 0,
    "round 2's header names the exact brief it was bound to (round 1's, at the head) and the ledger entries (seqs) of round 1's failures", JSON.stringify([p2.head, brief?.id, failing1])); }
// no credential: real key formats and Studio's own secret values (env and file-held), in prompt, system and stream
{ const all = received.map((x) => x.text + x.system).join("\n") + readFileSync(join(dir(1), "prompt.md"), "utf8") + readFileSync(join(dir(1), "system.md"), "utf8") + readFileSync(join(dir(1), "stream.jsonl"), "utf8");
  const left = [...KEYS, ENV_SECRET, FILE_SECRET].filter((k) => all.includes(k) || all.includes(k.slice(-12)));
  ok(!left.length && /\[credential removed\]/.test(p1.text) && /\[credential removed\]/.test(readFileSync(join(dir(1), "system.md"), "utf8")),
    "no credential reaches a prompt or the record: Anthropic, OpenAI project, GitHub and JWT formats, and the values of Studio's env and key-store secrets", JSON.stringify(left)); }
const st = readFileSync(join(dir(1), "stream.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(st.every((e) => e.ts && ["message", "tool_call", "tool_result", "status"].includes(e.type)) && st.some((e) => e.type === "tool_call" && e.name === "note_write") && st.some((e) => e.type === "tool_result") && st.at(-1).type === "status", "stream.jsonl holds the provider's events, normalized", JSON.stringify(st.map((e) => e.type)));
const rep = JSON.parse(readFileSync(join(dir(1), "report.json"), "utf8"));
ok(rep.status === "done" && typeof rep.said === "string" && rep.prompt === "prompt.md", "report.json holds the final output");
// a hand-off in the same round: prompt.hop1.md, header hop 1, the bytes the new provider received
{ const before = received.length; const s = E.start({ workflow: "swap", text: "swap me" });
  await until(() => !!E.get(s.id)!.nodes.make.job, 10000); await new Promise((res) => setTimeout(res, 300));
  E.setAgent(s.id, "make", { provider: "other", model: "m2" }); await until(() => ["succeeded", "failed"].includes(E.get(s.id)!.status), 60000);
  const d = join(H.data, "runs", s.id, "nodes", "make", "1"); const hop = existsSync(join(d, "prompt.hop1.md")) ? parse(join(d, "prompt.hop1.md")) : null;
  const second = received.slice(before).find((x) => x.provider === "other");
  ok(!!hop && hop.head.hop === 1 && hop.head.provider === "other" && hop.text === second?.text && /HANDOFF/.test(hop.text) && existsSync(join(d, "system.hop1.md")) && existsSync(join(d, "prompt.md")),
    "a hand-off in the same round writes prompt.hop1.md (header hop 1) with the bytes the new provider received", JSON.stringify(hop?.head)); }
// a record that cannot be written fails the job; nothing is left running
{ const blocker = join(tmp, "a-file"); writeFileSync(blocker, "x");
  const { stubProvider } = await import("../src/providers/stub");
  const j = await H.agents.run({ kind: "t", title: "t", system: "s", text: "hi", tools: [], provider: stubProvider(), timeoutMs: 5000, record: { dir: join(blocker, "nodes"), header: {} } });
  ok(j.status === "failed" && /record could not be written/.test(j.error ?? "") && ![...H.agents.jobs.values()].some((x: any) => x.status === "running"), "a record that cannot be written fails the job (no ghost running job, its token released)", j.error ?? ""); }
H.stop();
end();
