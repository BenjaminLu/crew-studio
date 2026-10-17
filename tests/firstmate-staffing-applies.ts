import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// studio_staffing_interview on a workflow staffing does not apply to (web-prototype, documents...) is a normal answer,
// not a failure: the live chat's most frequent red alert was configuration_missing "Native workflow definition is missing
// or unsupported" / "…不要重複登入或直接派工" when Firstmate asked about crew for web-prototype, and then rightly proposed
// the work directly, the very step the alert told the captain not to take. An unknown workflow or version names the
// exact problem, and no native tool failure shares one generic sentence any more.
//      bun tests/firstmate-staffing-applies.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { harness, Y } from "./rt-harness";
import { StaffingStore } from "../src/domain/staffing";
import { installFirstmateStaffing } from "../src/firstmate-staffing";
import { bundledText } from "../src/bundled";
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : " " + extra}`); v ? pass++ : fail++; };
const refusal = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e: any) { return e; } };
const web = { id: "web-fixture", name: "Web fixture", kind: "web", version: 1, roles: [{ id: "designer", label: "Designer", skill: "fixture" }], nodes: [{ id: "make", kind: "agent", role: "designer", label: "Make", x: 1, y: 1 }], edges: [] };
const code = { id: "code-firstmate", name: "Code fixture", kind: "code", version: 1, roles: [{ id: "worker", label: "Worker", skill: "pack:firstmate/skills/worker.md" }], nodes: [{ id: "work", kind: "agent", role: "worker", mode: "receipt", label: "Work", x: 1, y: 1 }], edges: [] };
const h = await harness([Y(web), Y(code), bundledText("workflows/v2/firstmate-staffing.wf.yaml")!]), e = h.engine, store = new StaffingStore(h.data);
// an invented project id resolves to nothing: the answer for a non-staffed workflow must not depend on it
const resolve = (id: string) => { if (id !== "p") throw new Error(`project ${id} is not registered`); return { namespace: "git" as const, id: "p", identity: "fixture" }; };
const tools = installFirstmateStaffing(e, store, resolve, async () => []);
const owner = { key: "captain-1", captain: true, text: "做一個豆花店網站", live: () => true };
try {
  const r: any = await tools.call("studio_staffing_interview", { project: "xiangkou-douhua", workflow: "web-fixture", version: 1 }, owner);
  ok(r?.applies === false && /studio_propose_work/.test(r.next) && /no crew card/.test(r.next), "a workflow staffing does not apply to answers applies:false with the next step", JSON.stringify(r));
  ok(r?.workflow?.id === "web-fixture" && r.workflow.version === 1 && e.list().length === 0, "it names the workflow and starts nothing", JSON.stringify(r));
  const answered: any = await tools.call("studio_staffing_interview", { project: "xiangkou-douhua", workflow: "web-fixture", version: 1, answers: { designer: { provider: "codex" } } }, { ...owner, captain: false, text: "" });
  ok(answered?.applies === false, "answers for such a workflow get the same answer, not a captain-confirmation failure", JSON.stringify(answered));
  const noWorkflow = await refusal(() => tools.call("studio_staffing_interview", { project: "p", workflow: "invented-flow", version: 1 }, owner));
  ok(noWorkflow?.publicFailure?.code === "workflow_missing" && noWorkflow.publicFailure.nextAction === "list_workflows" && /invented-flow/.test(noWorkflow.publicFailure.reason.en) && /invented-flow/.test(noWorkflow.publicFailure.reason["zh-TW"]), "an unknown workflow names itself in both languages and points at the workflow list", JSON.stringify(noWorkflow?.publicFailure));
  const noVersion = await refusal(() => tools.call("studio_staffing_interview", { project: "p", workflow: "code-firstmate", version: 9 }, owner));
  ok(noVersion?.publicFailure?.code === "workflow_missing" && /v9/.test(noVersion.publicFailure.reason.en) && /v1/.test(noVersion.publicFailure.reason.en) && /v9/.test(noVersion.publicFailure.reason["zh-TW"]), "an unknown version names the asked and the installed versions", JSON.stringify(noVersion?.publicFailure));
  const keep = await refusal(() => tools.call("studio_keep_staffing", { project: "p", workflow: "web-fixture", version: 1 }, owner));
  ok(keep?.publicFailure?.code === "staffing_not_applicable" && /studio_propose_work/.test(keep.publicFailure.reason.en) && !/不要.*直接派工/.test(keep.publicFailure.reason["zh-TW"]), "asking to keep a crew for such a workflow says it needs none and to propose the work", JSON.stringify(keep?.publicFailure));
  const staffed: any = await tools.call("studio_staffing_interview", { project: "p", workflow: "code-firstmate", version: 1 }, owner);
  ok(staffed?.applies !== false && Array.isArray(staffed?.frontier), "a staffed workflow still runs the interview", JSON.stringify(staffed).slice(0, 200));
} finally { h.stop(); }
// the audit: no native tool failure tells the captain the generic "not ready; don't sign in again or dispatch directly"
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
const generic = files("src").filter((f) => readFileSync(f, "utf8").includes("必要的流程或配置尚未就緒"));
ok(generic.length === 0, "no source failure carries the generic configuration sentence", generic.join(", "));
console.log(`\nfirstmate-staffing-applies: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
