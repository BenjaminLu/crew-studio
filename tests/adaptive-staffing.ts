import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Adaptive staffing (src/domain/independence.ts, docs/architecture.md "Adaptive staffing"): what is usable comes from the
// provider facts (signed in, not out of quota, verified or verifiable), and an independence rule is relaxed only to what
// the machine can reach: two usable vendors keep it, one vendor allows another model of it, one model allows the same
// model. A judged check that asks for distinct providers follows the same rule and says when it was relaxed.
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
  { provider: "codex", support: "supported", auth: o.codexAuth ?? "verified", quota: o.codexQuota ?? "available", expires: Date.now() + 60000, models: [{ id: "gpt-x", efforts: ["low", "medium", "high"] }], login: "logged-in" },
  { provider: "claude", support: "supported", auth: o.claudeAuth ?? "verified", quota: o.claudeQuota ?? "unknown", expires: Date.now() + 60000, models: [{ id: "opus", efforts: ["high"] }], candidates: [{ id: "opus", efforts: ["high"] }, { id: "sonnet", efforts: ["low", "high"] }], login: o.claudeLogin ?? "logged-in" },
  { provider: "cursor", support: "supported", auth: "unverified", quota: "unknown", expires: Date.now() + 60000, models: [], candidates: [{ id: "composer", efforts: [] }], login: "unknown" }] as any;
const all = usableModels(facts());
ok(all.map((u) => `${u.provider}/${u.model}/${u.verified}`).join(" ") === "codex/gpt-x/true claude/opus/true claude/sonnet/false", "usable: Codex's listed models, Claude's verified and verifiable models; a Cursor key never checked is not usable", JSON.stringify(all));
ok(!usableModels(facts({ claudeAuth: "missing", claudeLogin: "not-logged-in" })).some((u) => u.provider === "claude") && !usableModels(facts({ claudeQuota: "exhausted" })).some((u) => u.provider === "claude") && !usableModels(facts({ codexQuota: "unknown" })).some((u) => u.provider === "codex"),
  "a vendor that is not signed in, is out of quota, or (Codex) whose quota cannot be read is not usable");

// ---------- the rule, relaxed only to what the machine reaches ----------
const one = usableModels(facts()).filter((u) => u.provider === "claude"), single = one.slice(0, 1);
ok(reachable(all) === "vendor" && reachable(one) === "model" && reachable(single) === "same" && reachable([]) === "same", "reachable: two vendors, one vendor with two models, one model");
ok(required("vendor", all) === "vendor" && required("model", all) === "model" && required("vendor", one) === "model" && required("model", single) === "same" && required("vendor", null) === "vendor",
  "a rule keeps its level when two vendors are usable, relaxes to another model with one vendor, to the same model with one model, and never relaxes without facts");

// ---------- the best candidate, earliest on a tie ----------
const maker = [{ provider: "claude", model: "opus" }];
ok(bestOf([{ provider: "claude", model: "opus" }, { provider: "claude", model: "sonnet" }, { provider: "codex", model: "gpt-x" }], maker)?.pick.provider === "codex", "another vendor first");
ok(bestOf([{ provider: "claude", model: "opus" }, { provider: "claude", model: "sonnet" }], maker)?.level === "model" && bestOf([{ provider: "claude", model: "opus" }], maker)?.level === "same" && bestOf([], maker) === null, "then another model of the vendor, then the same model; nothing only when nothing is usable");
ok(/Different vendor/.test(LEVEL_TEXT.vendor.en) && /different model/.test(LEVEL_TEXT.model.en) && /Same model/.test(LEVEL_TEXT.same.en) && LEVEL_TEXT.same.zh.length > 0, "each level has a plain bilingual label");
ok(defaultEffort({ provider: "codex", efforts: ["low", "medium"] }) === "medium" && defaultEffort({ provider: "claude", efforts: ["high"] }) === null, "a model Studio picks itself runs at medium (Codex) or the vendor's default (Claude)");
{ const b: any = withNote({ title: "Merge", en: { intent: "i", why: "Checks pass.", how: "h" }, zh: { intent: "i", why: "檢查通過。", how: "h" }, body: "Branch: x", options: [] } as any, { level: "same", en: "Reviewer: same model.", zh: "Reviewer：同一個模型。" });
  ok(b.en.why === "Checks pass. Reviewer: same model." && b.zh.why === "檢查通過。Reviewer：同一個模型。" && /Branch: x\n\nReviewer: same model\. \/ Reviewer：同一個模型。/.test(b.body) && b.independence.level === "same" && b.title === "Merge", "a merge card body carries the independence note in both languages and its plain body", JSON.stringify(b)); }

// ---------- a judged check asking for distinct providers ----------
const flow = { id: "judge-flow", name: "Judge", version: 1, roles: [{ id: "worker", label: "Worker", skill: "test" }], nodes: [{ id: "work", kind: "hook", label: "Work", x: 0, y: 0 }], edges: [] };
const H = await harness([Y(flow)]), E = H.engine;
const done = E.start({ workflow: flow.id }); await until(() => ["succeeded", "failed"].includes(E.get(done.id)!.status));
const rn = E.get(done.id)!, x = { ...E.x(rn, rn.def.nodes[0], rn.nodes.work), run: { ...rn, id: "try", status: "running" as const } };
let onlyCodex = false;
E.deps.provider = (id?: string, model?: string) => ({ id: onlyCodex ? "codex" : id ?? "codex", model: model ?? "m", sandboxFree: true, start(_s: any, _t: any, ctx: any) { return { interrupt() {}, async *send() { await H.agents.callTool(ctx.token, "judge_report", { verdict: "pass", findings: [] }); yield { type: "turnEnd" as const, status: "ok" as const }; } }; } }) as any;
const man: any = { id: "agreement", ref: "fixture/agreement", title: { en: "Agreement" }, kind: "judged", timeout_s: 5, judge: { prompt: "Judge", vendors: ["claude", "codex"], distinct_providers: true, quorum: { n: 2, of: 2 } } };
const judge = () => E.judge(x as any, man, { use: man.ref } as any, { run: "try", artifact: null } as any);
const U = (...m: [string, string][]) => m.map(([provider, model]) => ({ provider, model, efforts: [], verified: true }));
// two vendors usable: the requirement stands (a vendor that resolves to the other one is still a duplicate)
E.deps.usableModels = () => U(["claude", "c1"], ["codex", "x1"]);
let out: any = await judge();
ok(out.verdict === "pass" && new Set(out.votes.map((v: any) => v.provider)).size === 2 && !out.independence, "with two usable vendors, the two votes come from the two vendors, as before", JSON.stringify(out).slice(0, 300));
onlyCodex = true; out = await judge(); onlyCodex = false;
ok(out.verdict === "error" && /duplicate/.test(out.error ?? ""), "with two usable vendors, distinct providers are still required", JSON.stringify(out).slice(0, 300));
// one vendor, two models: the votes run on its two models, and the result says so
E.deps.usableModels = () => U(["codex", "x1"], ["codex", "x2"]);
out = await judge();
ok(out.verdict === "pass" && out.votes?.length === 2 && new Set(out.votes.map((v: any) => v.model)).size === 2 && out.votes.every((v: any) => v.provider === "codex") && out.independence?.level === "model" && /one vendor/i.test(out.independence?.en ?? ""), "with one usable vendor, two different models of it vote, and the relaxation is recorded", JSON.stringify(out).slice(0, 400));
// one model: both votes on it, said plainly
E.deps.usableModels = () => U(["codex", "x1"]);
out = await judge();
ok(out.verdict === "pass" && out.votes?.length === 2 && out.votes.every((v: any) => v.model === "x1") && out.independence?.level === "same" && /fresh context/.test(out.independence?.en ?? ""), "with one usable model, both votes run on it and the result says it is not independent", JSON.stringify(out).slice(0, 400));
// no facts: unchanged
delete E.deps.usableModels; onlyCodex = true; out = await judge(); onlyCodex = false;
ok(out.verdict === "error" && /duplicate/.test(out.error ?? ""), "without provider facts nothing is relaxed");
H.stop();
end();
