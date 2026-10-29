import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A workflow's display name (src/runtime/workflow-names.ts): code-firstmate shows as "coding" on a fresh Studio, the captain
// renames any workflow from the desktop, and no definition, version, hash, export or signed approval changes with it.
// Offline: the real runtime routes on a temporary data folder, stub providers, no model call.      bun tests/workflow-rename.ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../src/runtime";
import { Agents } from "../src/agent";
import { StudioLog } from "../src/rawlog";
import { stubProvider } from "../src/providers/stub";
import { WorkflowDefs } from "../src/runtime/defs";
import { checkDisplayName, DEFAULT_DISPLAY_NAMES } from "../src/runtime/workflow-names";
import { staffingHash } from "../src/domain/staffing";
import { suite } from "./rt-harness";
const { ok, end } = suite("workflow-rename");
const data = mkdtempSync(join(tmpdir(), "crew-workflow-rename-")), agents = new Agents(data, () => "");
const rt = createRuntime({ dataDir: data, agents, provider: () => stubProvider(), defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(data, "events.jsonl")), send() {}, fmRoot: data, studioUrl: () => "" } as any);
const call = async (path: string, b?: any, who: any = { kind: "desktop" }) => { const req = new Request("http://localhost" + path, { method: b === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }); const r = await rt.handle(req, new URL(req.url), who, b !== undefined); return { status: r!.status, body: await r!.json() as any }; };
const rename = (workflow: string, name: unknown, who?: any) => call("/api/workflow-names", { workflow, name }, who);
const files = (id: string) => readdirSync(join(data, "workflows", id)).filter((f) => /^v\d+\.json$/.test(f)).sort().map((f) => readFileSync(join(data, "workflows", id, f), "utf8")).join("\n");
const listed = async (id: string) => (await call("/api/wf")).body.workflows.find((w: any) => w.id === id);
const fm = (name: string) => rt.firstmate.call(name, {}, { key: "rename-" + name, captain: true, text: "What workflows are there?", live: () => true }) as Promise<any>;
const events = () => readFileSync(join(data, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "workflow_renamed");
try {
  // ---- a fresh Studio: code-firstmate shows as "coding"; its definition keeps its own name ----
  ok(!existsSync(join(data, "workflow-names.json")), "a fresh Studio has no rename file");
  const fresh = await listed("code-firstmate");
  ok(fresh?.displayName === "coding" && fresh.name === "code-firstmate" && fresh.renamed === false, "fresh Studio: the Workflows list shows code-firstmate as coding, its definition name unchanged", JSON.stringify(fresh));
  ok((await call("/api/workflow-names")).body.names["code-firstmate"] === "coding", "fresh Studio: /api/workflow-names serves the default");
  const editor = (await call("/api/wf/code-firstmate")).body;
  ok(editor.displayName === "coding" && editor.def.name === "code-firstmate" && editor.defaultName === "coding" && editor.renamed === false, "fresh Studio: the editor gets the display name beside the definition, never in it");
  ok((await listed("documents"))?.displayName === (await listed("documents"))?.name, "a workflow without a default shows its definition's name");
  ok((await fm("studio_list_workflows")).workflows.find((w: any) => w.id === "code-firstmate")?.name === "coding", "Firstmate's workflow list names code-firstmate coding");

  // ---- the definition, its hash and its staffing identity before any rename ----
  const def = rt.defs.get("code-firstmate")!, hash = staffingHash(def), bytes = files("code-firstmate"), version = def.version, versions = rt.defs.versions("code-firstmate").length;
  const exportBefore = (await call(`/api/wf/code-firstmate/export?v=${version}`)).body;

  // ---- rename: persists, shows in the list, the editor, the Task page's data and Firstmate's tools ----
  const r = await rename("code-firstmate", "  My coding crew  ");
  ok(r.status === 200 && r.body.displayName === "My coding crew" && r.body.renamed === true && r.body.names["code-firstmate"] === "My coding crew", "rename is trimmed and answers the new name", JSON.stringify(r.body));
  ok((await listed("code-firstmate"))?.displayName === "My coding crew" && (await listed("code-firstmate"))?.renamed === true, "the Workflows list shows the rename");
  ok((await call("/api/wf/code-firstmate")).body.displayName === "My coding crew", "the editor shows the rename");
  ok(new WorkflowDefs(data).displayName("code-firstmate") === "My coding crew", "the rename persists across a Studio restart (a new store reads it)");
  ok(JSON.parse(readFileSync(join(data, "workflow-names.json"), "utf8")).names["code-firstmate"].by === "captain", "the rename file records who renamed it");
  const run = rt.engine.start({ workflow: "hello-crew-studio", version: rt.defs.get("hello-crew-studio")!.version });
  ok((await rename("hello-crew-studio", "Hello")).status === 200, "a built-in workflow with a Task can be renamed");
  const status = await fm("studio_work_status");
  ok(status.tasks.find((t: any) => t.id === run.id)?.workflowName === "Hello" && status.tasks.find((t: any) => t.id === run.id)?.workflow === "hello-crew-studio", "Firstmate's work status names the Task's workflow by its display name and keeps the id");
  ok((await fm("studio_list_workflows")).workflows.find((w: any) => w.id === "code-firstmate")?.name === "My coding crew", "Firstmate's workflow list follows the rename");
  ok(run.def.name !== "Hello" && (await call("/api/wruns/" + run.id)).body?.run?.def?.name !== "Hello", "a Task keeps its pinned definition's own name");
  await rt.engine.cancel(run.id);

  // ---- nothing a hash, signature or export reads changed ----
  const after = rt.defs.get("code-firstmate")!;
  ok(staffingHash(after) === hash && after.name === "code-firstmate", "the staffing hash of code-firstmate is unchanged by a rename (approvals still verify)");
  ok(files("code-firstmate") === bytes && rt.defs.versions("code-firstmate").length === versions, "a rename writes no definition version and changes no saved byte");
  const exportAfter = (await call(`/api/wf/code-firstmate/export?v=${version}`)).body;
  ok(JSON.stringify(exportAfter) === JSON.stringify(exportBefore) && JSON.stringify(exportAfter).includes('"name":"code-firstmate"') && !JSON.stringify(exportAfter).includes("My coding crew"), "an export keeps the definition's own name");

  // ---- a personal workflow is renamed the same way ----
  rt.defs.create("my-flow", "My flow", "captain", "en", undefined, "starter");
  ok((await rename("my-flow", "Weekly report")).status === 200 && (await listed("my-flow"))?.displayName === "Weekly report" && rt.defs.get("my-flow")!.name === "My flow", "a captain's own workflow is renamed without a new version");
  // a name another workflow answers to (its id, its display name, its default name), ignoring case, is refused
  for (const [taken, why] of [["DOCUMENTS", "another workflow's id"], ["my coding crew", "another workflow's display name"], ["hello", "another workflow's display name (a rename)"], [` ${rt.defs.get("web-prototype")!.name.toUpperCase()} `, "another workflow's definition name"]] as const) {
    const res = await rename("my-flow", taken);
    ok(res.status === 400 && /already called/.test(res.body.error), `a rename to ${why} is refused`, JSON.stringify(res));
  }
  ok((await rename("hello-crew-studio", "Weekly Report")).status === 400, "a rename to a name another captain rename holds is refused, ignoring case");
  ok((await rename("my-flow", "Weekly Report")).status === 200, "a workflow may change the case of its own name");

  // ---- reset ----
  const reset = await rename("code-firstmate", null);
  ok(reset.status === 200 && reset.body.displayName === "coding" && reset.body.renamed === false, "reset brings code-firstmate back to its default name");
  ok((await rename("my-flow", "   ")).body.displayName === "My flow" && (await listed("my-flow"))?.renamed === false, "a blank name resets a workflow to its definition's name");
  ok((await rename("code-firstmate", "coding")).body.renamed === false && !Object.hasOwn(JSON.parse(readFileSync(join(data, "workflow-names.json"), "utf8")).names, "code-firstmate"), "a name equal to the default keeps no rename");
  ok((await rename("code-firstmate", "code-firstmate")).body.displayName === "code-firstmate", "the captain can show the id again by naming it");
  await rename("code-firstmate", null);

  // ---- the ledger: each rename and reset is a captain event ----
  const ev = events();
  ok(ev.length === 9 && ev[0].workflow === "code-firstmate" && ev[0].actor === "captain" && ev[0].data.from === "coding" && ev[0].data.to === "My coding crew" && ev.at(-1).data.reset === true, "every rename and reset is recorded in the event log with the captain, from and to", JSON.stringify(ev.map((e) => e.data)));

  // ---- validation ----
  const before = readFileSync(join(data, "workflow-names.json"), "utf8");
  for (const [bad, why] of [["x".repeat(81), "81 characters"], ["a\u0000b", "a NUL"], ["tab\there", "a tab"], ["line\nbreak", "a newline"], ["‮evil", "a bidi override"], ["a‎b", "an LRM"], ["a‏b", "an RLM"], ["a؜b", "an ALM"], ["a​b", "a zero-width space"], ["a‍b", "a zero-width joiner"], ["a⁠b", "a word joiner"], ["ㅤ", "an invisible filler alone"], ["ㅤ ㅤ", "only fillers and spaces"], [42, "a number"], [["coding"], "an array"]] as const) {
    const res = await rename("code-firstmate", bad);
    ok(res.status === 400, `validation refuses ${why}`, JSON.stringify(res));
  }
  ok((await rename("code-firstmate", "名".repeat(80))).status === 200, "80 characters (CJK counted as characters) are accepted");
  await rename("code-firstmate", null);
  ok(checkDisplayName(" <img src=x onerror=alert(1)> ") === "<img src=x onerror=alert(1)>", "markup is kept as plain text (the page renders names as text nodes)");
  ok((await rename("no-such-flow", "x")).status === 404 && (await rename("../etc", "x")).status === 404, "an unknown or malformed workflow id is refused");
  ok((await call("/api/workflow-names", { workflow: "code-firstmate", name: "x", extra: 1 })).status === 400, "unknown request keys are refused");
  ok(readFileSync(join(data, "workflow-names.json"), "utf8") === before, "refused renames leave the file as it was");

  // ---- who may rename ----
  ok((await rename("code-firstmate", "phone name", { kind: "phone", device: { name: "p" } })).status === 403, "the phone cannot rename");
  ok((await rename("code-firstmate", "remote name", { kind: "remote" })).status === 403, "a non-desktop caller cannot rename");
  ok((await call("/api/workflow-names", undefined, { kind: "phone", device: { name: "p" } })).status === 200, "reading the names is allowed everywhere the board reads");
  ok((await listed("code-firstmate"))?.displayName === "coding", "refused callers changed nothing");

  // ---- an entry this Studio cannot read is skipped on read and kept on the next write ----
  writeFileSync(join(data, "workflow-names.json"), JSON.stringify({ schema: 1, names: { documents: { name: "Docs", by: "captain", at: "t" }, "future-flow": { name: 42, kind: "later" }, "Bad Id": { name: "x" }, "hello-crew-studio": { name: "line\nbreak" } } }));
  ok((await listed("documents"))?.displayName === "Docs" && (await listed("hello-crew-studio"))?.displayName === rt.defs.get("hello-crew-studio")!.name, "a malformed entry is skipped; its neighbours still show");
  ok((await rename("code-firstmate", "Ship code")).status === 200, "a rename next to malformed entries works");
  const kept = JSON.parse(readFileSync(join(data, "workflow-names.json"), "utf8")).names;
  ok(JSON.stringify(kept["future-flow"]) === JSON.stringify({ name: 42, kind: "later" }) && JSON.stringify(kept["Bad Id"]) === JSON.stringify({ name: "x" }) && kept["hello-crew-studio"]?.name === "line\nbreak" && kept.documents?.name === "Docs" && kept["code-firstmate"]?.name === "Ship code", "malformed and unknown entries are kept as they were on the next write", JSON.stringify(kept));
  ok((await rename("hello-crew-studio", null)).status === 200 && !Object.hasOwn(JSON.parse(readFileSync(join(data, "workflow-names.json"), "utf8")).names, "hello-crew-studio"), "a reset removes a malformed entry of that workflow");
  await rename("code-firstmate", null);

  // ---- an unreadable file: defaults show, writes refuse instead of clobbering it ----
  writeFileSync(join(data, "workflow-names.json"), "{not json");
  ok((await listed("code-firstmate"))?.displayName === "coding", "an unreadable rename file shows the defaults");
  ok((await rename("code-firstmate", "x")).status === 409 && readFileSync(join(data, "workflow-names.json"), "utf8") === "{not json", "an unreadable rename file refuses a rename and is kept");
  ok(DEFAULT_DISPLAY_NAMES["code-firstmate"] === "coding" && Object.isFrozen(DEFAULT_DISPLAY_NAMES), "the shipped default is fixed in code");
} finally { rt.engine.disposeExternal(); rmSync(data, { recursive: true, force: true }); }
end();
