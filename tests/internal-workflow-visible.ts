import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Workflows page shows one internal workflow, pr-follow (the Pull requests page's follow-through), read-only: it is
// listed apart from the catalog with what Studio says about it, and every write a person or a peer could make is refused
// (start, save, layout, rename, copy, trash; it is never held). Every other internal workflow stays hidden.
//                                                                          bun tests/internal-workflow-visible.ts
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntime } from "../src/runtime";
import { Agents } from "../src/agent";
import { StudioLog } from "../src/rawlog";
import { FOLLOW_BRANCHES } from "../src/pr-watch-follow";

const root = mkdtempSync(join(tmpdir(), "internal-visible-"));
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log("FAIL " + n + (extra ? " " + extra : "")); } };
const HIDDEN = ["local-project-register", "firstmate-proposal", "firstmate-register-project", "firstmate-staffing", "firstmate-connect-github", "firstmate-grant-merge", "crew-change", "issue-triage", "issue-categories", "review-room-host", "review-room-dir-host", "pr-watch-apply-depends"];
try {
  const data = join(root, "data");
  const about = { label: { en: "Follow-through", zh: "跟進" }, enabled: false, startedFrom: { href: "#/prs", en: "Pull requests → Settings → Follow-through", zh: "Pull requests → 設定 → 跟進" }, branches: Object.entries(FOLLOW_BRANCHES).map(([branch, b]) => ({ branch, ...b })) };
  const rt = createRuntime({ dataDir: data, agents: new Agents(data, () => ""), provider: () => { throw new Error("No provider needed"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(data, "events")), send() {}, fmRoot: join(root, "fm"),
    internalAbout: (id: string) => id === "pr-follow" ? about : null } as any);
  const call = async (path: string, body?: unknown, kind = "desktop") => { const url = new URL("http://fixture" + path), r = await rt.handle(new Request(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), url, { kind } as any, body !== undefined); return { status: r!.status, body: await r!.json() as any }; };
  const files = () => readdirSync(join(data, "workflows", "pr-follow")).sort().map((f) => f + ":" + readFileSync(join(data, "workflows", "pr-follow", f), "utf8")).join("\n");
  const before = files();

  // ---- listed, apart from the catalog ----
  const list = (await call("/api/wf")).body;
  ok(!list.workflows.some((w: any) => w.id === "pr-follow"), "pr-follow is not in the startable catalog");
  ok(list.internal.length === 1 && list.internal[0].id === "pr-follow" && list.internal[0].internal === true, "the internal list holds pr-follow and nothing else", JSON.stringify(list.internal.map((w: any) => w.id)));
  ok(list.internal[0].nodes === 2 && list.internal[0].about?.enabled === false && list.internal[0].about?.startedFrom?.href === "#/prs", "the listed entry carries its nodes and where it is started (off by default)");
  for (const id of HIDDEN) ok(rt.engine.defs.get(id) && ![...list.workflows, ...list.held, ...list.internal, ...list.trash].some((w: any) => w.id === id), `${id} stays installed and hidden from every list`);
  ok(!(await rt.firstmate.call("studio_list_workflows", {}, { key: "fixture", captain: true, text: "List", live: () => true } as any) as any).workflows.some((w: any) => w.id === "pr-follow"), "Firstmate's catalog does not offer pr-follow");

  // ---- its page: the graph, its branches, read-only ----
  const page = (await call("/api/wf/pr-follow")).body;
  ok(page.def.nodes.map((n: any) => n.id).join() === "card,done" && page.def.edges.length === 1, "its page returns the definition's nodes and edge");
  ok(page.selectable === false && page.personal === false && page.held === null && page.internal?.about?.branches?.length === Object.keys(FOLLOW_BRANCHES).length, "its page says not selectable, not personal, not held, internal with every branch");
  const branches = page.internal.about.branches.map((b: any) => b.branch);
  for (const b of ["wait", "needs-evidence", "evidence-covers-head", "missing-approvals", "mergeable", "ask"]) ok(branches.includes(b), `branch ${b} is shown`);
  ok(FOLLOW_BRANCHES["needs-evidence"].card?.en === "Ask QA to test" && FOLLOW_BRANCHES["evidence-covers-head"].card?.en === "Ask reviewers to look again" && FOLLOW_BRANCHES["missing-approvals"].card?.en === "Ask for approval" && FOLLOW_BRANCHES.mergeable.card?.en === "Ready to merge" && FOLLOW_BRANCHES.wait.card === null, "each branch names the card it makes");
  ok((await call("/api/wf/code-firstmate")).body.internal === null, "a public workflow's page is not marked internal");

  // ---- every write a person or a peer could make is refused ----
  const runs = rt.engine.list().length;
  for (const kind of ["desktop", "phone", "peer"]) { const r = await call("/api/wruns", { workflow: "pr-follow", text: "Must not start" }, kind); ok(r.status >= 400 && rt.engine.list().length === runs, `a ${kind} caller cannot start pr-follow`, String(r.status)); }
  const def = rt.engine.defs.get("pr-follow")!;
  const save = await call("/api/wf/pr-follow", { ...def, base: def.version, description: "edited" });
  ok(save.status === 409 && save.body.code === "workflow_internal", "saving an edit is refused", JSON.stringify(save));
  ok((await call("/api/wf/pr-follow/layout", { version: def.version, positions: { card: { x: 1, y: 1 } } })).status === 409, "moving its nodes is refused");
  ok((await call("/api/workflow-names", { workflow: "pr-follow", name: "Renamed" })).status === 409, "renaming it is refused");
  ok((await call("/api/wf/pr-follow/trash", { base: def.version, revision: 0 })).status === 409, "trashing it is refused");
  ok((await call("/api/wf/pr-follow/copy", { version: def.version, id: "follow-copy", name: "Copy", asTemplate: false })).status >= 400 && !rt.engine.defs.get("follow-copy"), "copying it into a startable workflow is refused");
  { const r = await call("/api/wf/pr-follow/package?v=" + def.version); ok(r.status === 409 && r.body.code === "workflow_internal", "packaging it (a package adopts as a startable copy) is refused"); }
  { const n = rt.engine.list().length; let started = false; try { rt.engine.start({ workflow: "pr-follow", version: def.version, text: "Studio's own start", params: { follow: "{}" }, by: "studio (PR follow-through)" } as any); started = rt.engine.list().length === n + 1; } catch (e: any) { console.log("  start: " + e.message); }
    ok(started, "Studio itself can still start a pr-follow Task (engine.start)"); }
  for (const [what, f] of [["save", () => rt.engine.defs.save("pr-follow", { base: def.version, description: "x" }, "captain")], ["layout", () => rt.engine.defs.setLayout("pr-follow", def.version, {})], ["rename", () => rt.engine.defs.rename("pr-follow", "x", "captain")]] as const) {
    let refused = false; try { f(); } catch (e: any) { refused = /internal/.test(e.message); } ok(refused, `defs.${what} refuses an internal workflow`); }
  ok(!rt.engine.defs.selectable("pr-follow") && rt.engine.defs.held("pr-follow") === null && /internal/.test(rt.engine.defs.unavailable("pr-follow") ?? ""), "it is never selectable nor held, and says why it is unavailable");
  ok(files() === before, "no write changed its saved versions or layout");
  ok(rt.engine.defs.save("code-firstmate", { ...rt.engine.defs.get("code-firstmate")!, base: rt.engine.defs.get("code-firstmate")!.version, description: "a captain's edit" }, "captain").version > 1, "a public built-in is still editable");
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
