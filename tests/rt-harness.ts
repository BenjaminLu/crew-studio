// Test harness for the v2 runtime: an engine over temporary data, the stub
// provider, and the tool route the stub's agents call. Shared by the unit suites
// that came after tests/runtime.ts.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/agent";
import { stubProvider } from "../src/providers/stub";
import { StudioLog } from "../src/rawlog";
import { WorkflowDefs } from "../src/runtime/defs";
import { Engine } from "../src/runtime/engine";

export const Y = (o: any) => JSON.stringify(o);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const until = async (f: () => boolean, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(40); } return f(); };
export function suite(name: string) {
  let pass = 0, fail = 0;
  const ok = (c: boolean, n: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${extra}`); } };
  const end = () => { console.log(`\n${name}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, end };
}
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];

export async function harness(flows: string[], o: { policies?: string; data?: string; checkRoots?: string[]; refine?: boolean } = {}) {
  const data = o.data ?? mkdtempSync(join(tmpdir(), "crew-rt-"));
  if (o.policies) { mkdirSync(join(data, "policies"), { recursive: true }); writeFileSync(join(data, "policies", "org.yaml"), o.policies); }
  let port = 0;
  const agents = new Agents(data, () => `http://127.0.0.1:${port}`);
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
    const u = new URL(req.url); const t = req.headers.get("x-crew-tool-token") ?? "";
    if (u.pathname === "/api/tools") return Response.json(agents.toolList(t));
    let a: any = {}; try { a = await req.json(); } catch {}
    return Response.json(await agents.callTool(t, decodeURIComponent(u.pathname.slice("/api/tools/".length)), a));
  } });
  port = srv.port;
  const sent: any[] = [];
  const provider = (id?: string, model?: string) => { const p = stubProvider(); return { ...p, id: id || "stub", model: model || "no model", start: p.start }; };
  const defs = new WorkflowDefs(data, () => flows);
  const engine = new Engine({ dataDir: data, agents, provider, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(data, "events.jsonl")), send: (t: string, d: unknown) => sent.push([t, d]),
    skillText: () => "# Test skill\n", checkRoots: o.checkRoots ?? [join(import.meta.dir, "fixture/checks")] } as any, defs);
  let briefFor: (x: any) => any = () => null;
  if (o.refine) { const r = await import("../src/runtime/refine"); r.installRefine(engine); briefFor = r.briefFor; }
  // a scriptable agent: "Call:" lines in its prompt are made by the stub; args.onBrief joins the prompt only when a brief is bound to this round
  engine.modes.test = { tools: (x) => [{ name: "note_write", description: "write a note", schema: { type: "object" }, run: (a: any) => { x.rn.data = { ...x.rn.data, wrote: a }; if (a.flag) writeFileSync(a.flag, "fixed"); return { ok: true }; } }],
    system: () => "test", prompt: (x) => { const b = briefFor(x); return `TEST AGENT\n${x.node.args?.say ?? ""}\n${b ? `${b.text}\n${x.node.args?.onBrief ?? ""}` : ""}\n${x.run.text}`; }, after: (x) => (x.node.args?.outcome ?? "ok"),
    handoffState: () => "state: half done", onTimeout: (x) => { x.rn.data = { ...x.rn.data, keptWork: true }; } };
  engine.natives["test-native"] = (i: any) => ({ verdict: i.params.want, score: i.params.want === "pass" ? 1 : 0, findings: i.params.want === "fail" ? [{ locator: { type: "card", field: "x" }, message: "native says no", expected: "yes", class: "nat", severity: "blocking" }] : [] });
  engine.needs.fixture_input = (x: any) => x.ctx.fixtureInput ?? null; // a path the runtime materializes for a test check
  engine.actions["set"] = (x) => { x.ctx[x.node.args!.key] = x.node.args!.value; return x.node.args?.out ?? "ok"; };
  engine.actions["merge-sim"] = (x) => { x.ctx.merged = { at: new Date().toISOString() }; return "ok"; };
  // the harness server serves agent tools only: it is also the tools-only listener a sandboxed round reaches
  return { data, engine, defs, agents, sent, toolUrl: `http://127.0.0.1:${port}`, stop: () => srv.stop(true) };
}
