import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// The Board names who works on a Task from the Task's own crew resolution (docs/units/board.md round 6): /api/wruns/<id>
// carries `crew`, read from the signed crew-resolved record the Task started with. Each staffed node's seat is the one the
// resolution gave it (a team's workflow-node override moves a node to another seat), named as that team names it (a seat
// the team declares, which the definition does not know), with its pick. A Task without a record carries crew null, so the
// Board names no seat; the effective round cap (project and workflow policy over org) comes along as roundCap.
//      bun tests/board-crew.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, until } from "./rt-harness";
const { ok, end } = suite("board-crew");
const { createRuntime } = await import("../src/runtime");
const { Agents } = await import("../src/agent");
const { StudioLog } = await import("../src/rawlog");
const C = await import("../src/domain/crew");
const pin = (id: string) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(import.meta.dir, "..", `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
const dir = checkedTempDir("board-crew-");
const rt: any = createRuntime({ dataDir: dir, agents: new Agents(dir, () => ""), provider: () => { throw new Error("no provider"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(dir, "events")), send() {}, fmRoot: join(dir, "fm"), readiness: false } as any);
const call = async (path: string, body?: any) => { const u = new URL("http://x" + path); const r = await rt.handle(new Request(u, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), u, { kind: "desktop" }, body !== undefined); return { status: r.status, j: await r.json() }; };
try {
  const writer = "bundled:workflows/skills/v2/writer.md";
  const def: any = { id: "draft", name: "Own newsletter", version: 1, policies: { round_cap: 5 }, roles: [{ id: "writer", label: "Writer", skill: writer, seat: "maker" }, { id: "checker", label: "Checker", skill: writer, seat: "reviewer" }],
    nodes: [{ id: "make", kind: "agent", label: "Write it", role: "writer", mode: "deliver", args: { format: "document" }, provider: "claude", model: "sonnet-5.5", x: 0, y: 0 },
      { id: "check", kind: "agent", label: "Check it", role: "checker", mode: "deliver", args: { format: "document" }, provider: "claude", model: "sonnet-5.5", x: 1, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }],
    edges: [{ from: "make", to: "check" }, { from: "check", to: "done" }] };
  const own = rt.defs.createDrafted("own-newsletter", def, "captain", { schema: 1, source: "firstmate-draft", draft: "d-000000000001", revision: 1, definition: "x" });
  const store = new C.CrewStore(dir);
  const m = (provider: "codex" | "claude", model: string, effort: string | null, skills: any[] = []) => ({ provider, model, effort, skills });
  // the team: a "Copy editor" seat of its own, and a workflow-node override that moves this workflow's make node onto it
  store.write({ schema: 1, members: { maker: m("codex", "gpt-6.1-sol", "high", [pin("plain-writing")]), reviewer: m("claude", "opus-5.5", "high"), coordinator: m("codex", "gpt-6-astra", "medium"), "copy-editor": m("codex", "gpt-6-astra", "high") },
    seats: { "copy-editor": { id: "copy-editor", label: "Copy editor", labelZh: "文字編輯" } }, workflows: { [own.id]: { nodes: { make: { at: { role: "writer", kind: "agent" }, seat: "copy-editor" } } } } }, null, { by: "captain", via: "page" });
  const first = await call("/api/wruns", { workflow: own.id, text: "this week's issue" });
  const plan = first.j.staffing;
  ok(plan?.plan?.find((r: any) => r.node === "make")?.seat === "copy-editor", "the fixture's override moves make onto the team's Copy editor seat", JSON.stringify(first.j).slice(0, 300));
  const started = await call("/api/wruns", { workflow: own.id, text: "this week's issue", staffingConfirm: plan.hash, claudeVerification: plan.claudeVerification });
  ok(started.status === 200 && !!started.j.id, "the Task starts on the confirmed crew", JSON.stringify(started.j).slice(0, 300));
  const view = await call(`/api/wruns/${started.j.id}`);
  const make = view.j.crew?.nodes?.make, check = view.j.crew?.nodes?.check;
  ok(make?.seat === "copy-editor" && make.label?.en === "Copy editor" && make.label?.zh === "文字編輯" && make.provider === plan.plan.find((r: any) => r.node === "make").provider && make.model === plan.plan.find((r: any) => r.node === "make").model,
    "the run detail names make's resolved seat (the workflow-node override), as the team names it, with the pick it confirmed", JSON.stringify(view.j.crew));
  ok(check?.seat === "reviewer" && check.label?.en === "Reviewer" && check.label?.zh === "審查", "a node on a built-in seat is named by the built-in seat name", JSON.stringify(check));
  ok(view.j.roundCap === 5, "the run detail carries the effective round cap: the workflow's policy (5) over the org default (3)", String(view.j.roundCap));
  // no crew record: a workflow the team does not staff (no agent node) carries crew null, so no seat is guessed
  const hooks = rt.defs.createDrafted("plain-hooks", { id: "plain", name: "Plain", version: 1, roles: [], nodes: [{ id: "a", kind: "hook", do: "note", label: "Start", x: 0, y: 0 }, { id: "b", kind: "hook", do: "note", label: "Done", x: 1, y: 0 }], edges: [{ from: "a", to: "b" }] }, "captain", { schema: 1, source: "firstmate-draft", draft: "d-000000000002", revision: 1, definition: "y" });
  const plain = rt.engine.start({ workflow: hooks.id, text: "no crew" });
  await until(() => !rt.engine.busy(plain.id));
  const pv = await call(`/api/wruns/${plain.id}`);
  ok(pv.status === 200 && pv.j.crew === null, "a Task with no crew resolution carries crew null", JSON.stringify(pv.j.crew));
} catch (e: any) { ok(false, "board-crew threw", e?.stack ?? String(e)); }
end();
