import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Adaptive staffing (src/domain/independence.ts, docs/architecture.md "Adaptive staffing"): what is usable comes from the
// provider facts (signed in, the model verified or verifiable), and an independence rule is relaxed only to what
// the machine can reach: two usable vendors keep it, one vendor allows another model of it, one model allows the same
// model. Only a vendor that is not there (not installed, not signed in) relaxes a rule; one that is signed in but out of quota,
// with unreadable quota or stale facts holds the work instead. A judged check asking for distinct providers is never relaxed.
// Stub providers and temporary data only.        bun tests/adaptive-staffing.ts
import { harness, suite, until, Y } from "./rt-harness";
import { levelOf, levelAgainst, usableModels, reachable, required, bestOf, LEVEL_TEXT, defaultEffort, withNote } from "../src/domain/independence";
const { ok, end } = suite("adaptive-staffing");

// ---------- levels ----------
ok(levelOf({ provider: "claude", model: "a" }, { provider: "codex", model: "a" }) === "vendor" && levelOf({ provider: "claude", model: "a" }, { provider: "claude", model: "b" }) === "model"
  && levelOf({ provider: "claude", model: "a" }, { provider: "claude", model: "a" }) === "same" && levelOf({ provider: "claude", model: null }, { provider: "claude", model: "b" }) === "same", "levels: another vendor, another model of one vendor, the same model (an unknown model on one vendor counts as the same)");
ok(levelAgainst({ provider: "codex", model: "x" }, [{ provider: "claude", model: "a" }, { provider: "codex", model: "y" }]) === "model", "against a group, the weakest level counts");

// ---------- usable: from the facts, never config alone ----------
const facts = (o: any = {}) => [
  { provider: "codex", support: "supported", auth: o.codexAuth ?? "verified", quota: o.codexQuota ?? "available", expires: o.codexExpires ?? Date.now() + 60000, models: [{ id: "gpt-x", efforts: ["low", "medium", "high"] }], default: { model: "gpt-x", effort: "low" }, login: o.codexLogin ?? "logged-in" },
  { provider: "claude", support: "supported", auth: o.claudeAuth ?? "verified", quota: o.claudeQuota ?? "unknown", expires: Date.now() + 60000, models: [{ id: "opus", efforts: ["high"] }], candidates: [{ id: "opus", efforts: ["high"] }, { id: "sonnet", efforts: ["low", "high"] }], login: o.claudeLogin ?? "logged-in" },
  { provider: "cursor", support: "supported", auth: "unverified", quota: "unknown", expires: Date.now() + 60000, models: [], candidates: [{ id: "composer", efforts: [] }], login: "unknown" }] as any;
const all = usableModels(facts()), runnable = (u: any[]) => u.filter((x) => x.runnable);
ok(all.map((u) => `${u.provider}/${u.model}/${u.verified}/${u.runnable}`).join(" ") === "codex/gpt-x/true/true claude/opus/true/true claude/sonnet/false/true" && all[0].isDefault === true, "usable: Codex's listed models (its default marked), Claude's verified and verifiable models; a Cursor key never checked is not there at all", JSON.stringify(all));
ok(!usableModels(facts({ claudeAuth: "missing", claudeLogin: "not-logged-in" })).some((u) => u.provider === "claude") && !usableModels(facts({ codexAuth: "unverified", codexLogin: "unknown" })).some((u) => u.provider === "codex"), "a vendor that is not signed in, or not installed, is not there");
// signed in but held for now: out of quota, quota unreadable, facts expired. Present (no rule relaxes for it), not runnable.
{ const held = (o: any, p: string) => usableModels(facts(o)).filter((u) => u.provider === p);
  const ex = held({ claudeQuota: "exhausted" }, "claude"), unk = held({ codexQuota: "unknown" }, "codex"), old = held({ codexExpires: Date.now() - 1 }, "codex");
  ok(ex.length > 0 && ex.every((u) => !u.runnable && /out of quota/.test(u.held ?? "")) && unk.length === 1 && !unk[0].runnable && /quota could not be read/.test(unk[0].held ?? "") && old.length === 1 && !old[0].runnable && /expired/.test(old[0].held ?? ""),
    "a vendor signed in but out of quota, with unreadable quota or with expired facts is present but held, with its reason", JSON.stringify({ ex, unk, old })); }

// ---------- the rule, relaxed only when a vendor is not there (not installed, not signed in), never for a hold ----------
const one = usableModels(facts({ codexAuth: "unverified", codexLogin: "unknown" })), single = one.slice(0, 1);
ok(reachable(all) === "vendor" && reachable(one) === "model" && reachable(single) === "same" && reachable([]) === "same", "reachable: two vendors, one vendor with two models, one model");
ok(required("vendor", all) === "vendor" && required("model", all) === "model" && required("vendor", one) === "model" && required("model", single) === "same" && required("vendor", null) === "vendor",
  "a rule keeps its level when two vendors are there, relaxes to another model with one vendor, to the same model with one model, and never relaxes without facts");
{ const heldCodex = usableModels(facts({ codexQuota: "unknown" }));
  ok(reachable(heldCodex) === "vendor" && required("model", heldCodex) === "model" && runnable(heldCodex).every((u) => u.provider === "claude"),
    "a second vendor that is signed in but held (quota unreadable) still counts: nothing relaxes, the work holds instead"); }

// ---------- the best candidate, earliest on a tie ----------
const maker = [{ provider: "claude", model: "opus" }];
ok(bestOf([{ provider: "claude", model: "opus" }, { provider: "claude", model: "sonnet" }, { provider: "codex", model: "gpt-x" }], maker)?.pick.provider === "codex", "another vendor first");
ok(bestOf([{ provider: "claude", model: "opus" }, { provider: "claude", model: "sonnet" }], maker)?.level === "model" && bestOf([{ provider: "claude", model: "opus" }], maker)?.level === "same" && bestOf([], maker) === null, "then another model of the vendor, then the same model; nothing only when nothing is usable");
ok(/Different vendor/.test(LEVEL_TEXT.vendor.en) && /different model/.test(LEVEL_TEXT.model.en) && /Same model/.test(LEVEL_TEXT.same.en) && LEVEL_TEXT.same.zh.length > 0, "each level has a plain bilingual label");
ok(defaultEffort({ provider: "codex", efforts: ["low", "medium"] }) === "medium" && defaultEffort({ provider: "claude", efforts: ["high"] }) === null, "a model Studio picks itself runs at medium (Codex) or the vendor's default (Claude)");
{ const b: any = withNote({ title: "Merge", en: { intent: "i", why: "Checks pass.", how: "h" }, zh: { intent: "i", why: "檢查通過。", how: "h" }, body: "Branch: x", options: [] } as any, { level: "same", en: "Reviewer: same model.", zh: "Reviewer：同一個模型。" });
  ok(b.en.why === "Checks pass. Reviewer: same model." && b.zh.why === "檢查通過。Reviewer：同一個模型。" && /Branch: x\n\nReviewer: same model\. \/ Reviewer：同一個模型。/.test(b.body) && b.independence.level === "same" && b.title === "Merge", "a merge card body carries the independence note in both languages and its plain body", JSON.stringify(b)); }

// ---------- the reviewer against the worker, as staffed: a node override wins over its role ----------
{ const { reviewPair } = await import("../src/domain/staffing");
  const def = { roles: [{ id: "worker" }, { id: "reviewer" }], nodes: [{ id: "build", kind: "agent", mode: "build", role: "worker" }, { id: "review", kind: "agent", mode: "review", role: "reviewer" }] };
  const roles = { worker: { provider: "claude", model: "sonnet", effort: "low" }, reviewer: { provider: "claude", model: "opus", effort: "low" } } as any;
  const plain = reviewPair(def, { roles }), over = reviewPair(def, { roles, nodes: { review: { model: "sonnet" } } } as any);
  ok(plain?.reviewer.model === "opus" && levelOf(plain.worker, plain.reviewer) === "model" && over?.reviewer.model === "sonnet" && levelOf(over.worker, over.reviewer) === "same", "the pair is judged as it runs: a review node overridden onto the worker's model is the same model, though the roles differ", JSON.stringify({ plain, over })); }

// ---------- a judged check asking for distinct providers: never relaxed (pack judges need two vendors to promote) ----------
const flow = { id: "judge-flow", name: "Judge", version: 1, roles: [{ id: "worker", label: "Worker", skill: "test" }], nodes: [{ id: "work", kind: "hook", label: "Work", x: 0, y: 0 }], edges: [] };
const H = await harness([Y(flow)]), E = H.engine;
const done = E.start({ workflow: flow.id }); await until(() => ["succeeded", "failed"].includes(E.get(done.id)!.status));
const rn = E.get(done.id)!, x = { ...E.x(rn, rn.def.nodes[0], rn.nodes.work), run: { ...rn, id: "try", status: "running" as const } };
E.deps.provider = (_id?: string, model?: string) => ({ id: "codex", model: model ?? "m", sandboxFree: true, start(_s: any, _t: any, ctx: any) { return { interrupt() {}, async *send() { await H.agents.callTool(ctx.token, "judge_report", { verdict: "pass", findings: [] }); yield { type: "turnEnd" as const, status: "ok" as const }; } }; } }) as any;
const man: any = { id: "agreement", ref: "fixture/agreement", title: { en: "Agreement" }, kind: "judged", timeout_s: 5, judge: { prompt: "Judge", vendors: ["claude", "codex"], distinct_providers: true, quorum: { n: 2, of: 2 } } };
const judge = () => E.judge(x as any, man, { use: man.ref } as any, { run: "try", artifact: null } as any);
for (const [what, usable] of [["one usable vendor", usableModels(facts({ claudeAuth: "missing", claudeLogin: "not-logged-in" }))], ["two vendors, one with unreadable quota", usableModels(facts({ codexQuota: "unknown" }))]] as const) {
  E.deps.usableModels = () => usable; const out: any = await judge();
  ok(out.verdict === "error" && /duplicate/.test(out.error ?? "") && !out.independence, `distinct providers are not relaxed (${what}): one vendor twice is still an error`, JSON.stringify(out).slice(0, 300)); }
delete E.deps.usableModels;
H.stop();
end();
