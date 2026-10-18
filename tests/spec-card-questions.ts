import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The spec card (code-firstmate's dispatch) carries its spec as data (live E2E S14, S20): the spec writer records open
// scope questions as data, with the choices it proposes; the card lists them (unanswered, they stay out of scope) with
// the spec's scope and what it reads to verify; a spec raised again shows what changed since the last approved spec (or the last spec card, before any approval).
//      bun tests/spec-card-questions.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "./rt-harness";
import { installCode, specMd, specQuestions } from "../src/domain/code";
import { Projects } from "../src/doors";
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : " " + extra}`); v ? pass++ : fail++; };

// ---- S14: open scope questions are data ----
const qs = specQuestions([{ q: "Negative half-cent ties: which way?", choices: ["away from zero", "banker's", "not supported yet"] }, "Fractional percentages?", { q: "Invalid input", choices: ["throw"] }, { q: "" }]);
ok(qs.length === 3 && qs[0].choices.length === 3 && qs[1].q === "Fractional percentages?" && qs[1].choices.length === 0 && qs[2].choices.length === 0, "questions keep their proposed choices (two to four); a bare string is a question without choices; an empty one is dropped", JSON.stringify(qs));
const d0 = mkdtempSync(join(tmpdir(), "crew-spec-card-"));
const H = await harness([], { data: d0, checkRoots: [] }); installCode(H.engine, { dataDir: d0, projects: new Projects(d0) });
const E: any = H.engine;
const spec = { title: "Add percent()", what: "A percent helper", why: ["shops need discounts"], done: ["test/percent.test.ts: percent(1999, 15) is 300 (planned fail-first)"], scope: ["src/money.ts", "test/percent.test.ts"], verificationScope: ["app/server.ts"],
  door: { kind: "two-way", reason: "plain code" }, explain: { en: "Adds percent().", "zh-TW": "新增 percent()。" }, zh: { title: "新增 percent()", why: ["商店需要折扣"] }, questions: qs, version: 1 };
const xOf = (s: any, visit = 1, ctx: any = {}) => ({ ctx: { spec: s, repo: "/r", base: "main", branch: "crew/R-9", ...ctx }, run: { id: "R-9", title: s?.title ?? "t", text: s?.what ?? "t", nodes: {} }, rn: { visits: visit }, visit, node: { id: "dispatch" }, save() {} } as any);
const b = await E.cardBodies.dispatch(xOf(spec));
ok(b.spec?.questions?.length === 3 && b.spec.questions[0].choices[1] === "banker's" && b.spec.scope.join() === "src/money.ts,test/percent.test.ts" && b.spec.verification.join() === "app/server.ts", "the spec card carries the questions, the scope and the read-only verification paths as data", JSON.stringify(b.spec));
ok(/Open scope questions \(unanswered, they stay out of scope\):\n1\. Negative half-cent ties: which way\? \[away from zero \/ banker's \/ not supported yet\]\n2\. Fractional percentages\?/.test(specMd(spec)), "the spec text lists the open questions and says unanswered ones stay out of scope", specMd(spec));
// the spec writer's tool takes questions
const wx = { ...xOf(null, 1, { worktree: d0 }), dir: d0 };
const tool = E.modes.spec.tools(wx).find((t: any) => t.name === "spec_write");
ok(!!tool?.schema?.properties?.questions && tool.schema.properties.questions.items.properties.choices && /questions: each open scope question/.test(tool.description), "spec_write asks for the open scope questions and their proposed choices", JSON.stringify(tool?.schema?.properties?.questions));
await tool.run({ ...spec, questions: [{ q: "Negative ties?", choices: ["away from zero", "banker's"] }, { q: "  " }] });
ok(JSON.stringify(wx.ctx.spec.questions) === JSON.stringify([{ q: "Negative ties?", choices: ["away from zero", "banker's"] }]), "the written spec keeps the questions as data", JSON.stringify(wx.ctx.spec?.questions));

// ---- S20: a spec raised again says what changed since the last spec card ----
const ctx: any = { spec, repo: "/r", base: "main", branch: "crew/R-9" };
const at = (visit: number) => ({ ctx, run: { id: "R-9", title: "t", text: "t", nodes: {} }, rn: { visits: visit }, visit, node: { id: "dispatch" }, save() {} } as any);
const first = await E.cardBodies.dispatch(at(1));
ok(first.spec.changed === null && !/Changed since/.test(first.body), "the first spec card has nothing to compare with", JSON.stringify(first.spec.changed));
ctx.answers = { dispatch: { choice: "dispatch", by: "captain", at: "2026-10-18T10:00:00Z" } };
ctx.spec = { ...spec, version: 2, done: [spec.done[0].replace("300", "300 (rounded half away from zero)"), "test/percent.test.ts: percent(-1, 50) is -1 (planned fail-first)"], scope: [...spec.scope, "app/shop.ts"], verificationScope: [] };
const again = await E.cardBodies.dispatch(at(2)), ch = again.spec.changed;
ok(ch?.since === 1 && ch.approved === true && ch.done.added.length === 2 && ch.done.removed.join() === spec.done[0] && ch.scope.added.join() === "app/shop.ts" && !ch.scope.removed.length && ch.verification.removed.join() === "app/server.ts",
  "after a rescope the spec card lists the done lines, scope and verification paths added and removed since the spec the captain approved", JSON.stringify(ch));
ok(again.body.startsWith("Changed since spec v1 (the one you approved):\n+ Done lines: ") && again.body.includes("+ Scope: app/shop.ts") && again.body.includes("- Read to verify: app/server.ts"), "the card text says the same, first", again.body.slice(0, 400));
const same = await E.cardBodies.dispatch(at(2));
ok(JSON.stringify(same.spec.changed) === JSON.stringify(ch), "raising the same card again (same visit) compares with the same earlier spec");
ctx.answers = { dispatch: { choice: "rescope", note: "x", by: "captain", at: "2026-10-18T11:00:00Z" } };
// v2's card was rescoped, not approved: the baseline stays v1, the spec the captain approved
ctx.spec = { ...ctx.spec, version: 3, explain: { en: "Reworded.", "zh-TW": "改寫。" }, scope: [...ctx.spec.scope, "app/cart.ts"] };
const v3 = await E.cardBodies.dispatch(at(3)), c3 = v3.spec.changed;
ok(c3?.since === 1 && c3.approved === true && c3.done.added.length === 2 && c3.done.removed.join() === spec.done[0] && c3.scope.added.join() === "app/shop.ts,app/cart.ts" && c3.verification.removed.join() === "app/server.ts",
  "v1 approved, v2 rescoped, v3: the v3 card compares with v1, the last approved spec, not with v2", JSON.stringify(c3));
ok(v3.body.startsWith("Changed since spec v1 (the one you approved):"), "its card text names v1 as the approved spec", v3.body.slice(0, 120));
ctx.spec = { ...ctx.spec, version: 4 }; await E.cardBodies.dispatch(at(4));
ctx.spec = { ...ctx.spec, version: 5 }; const v5 = await E.cardBodies.dispatch(at(5));
ok(Object.keys(ctx.specCards).join() === "3,4,5" && ctx.specApproved?.version === 1 && v5.spec.changed?.since === 1, "only the last three cards' specs are kept, and the approved spec outlives them", JSON.stringify([Object.keys(ctx.specCards), ctx.specApproved?.version, v5.spec.changed?.since]));
// a run whose spec was never approved compares with the spec on the last card, and says so
const ctx2: any = { spec: { ...spec, version: 1 }, repo: "/r", base: "main", branch: "crew/R-8" };
const at2 = (visit: number) => ({ ctx: ctx2, run: { id: "R-8", title: "t", text: "t", nodes: {} }, rn: { visits: visit }, visit, node: { id: "dispatch" }, save() {} } as any);
await E.cardBodies.dispatch(at2(1)); ctx2.answers = { dispatch: { choice: "rescope", note: "y", by: "captain", at: "2026-10-18T12:00:00Z" } };
ctx2.spec = { ...ctx2.spec, version: 2, explain: { en: "Reworded.", "zh-TW": "改寫。" } };
const words = await E.cardBodies.dispatch(at2(2));
ok(words.spec.changed?.approved === false && words.spec.changed.since === 1 && !words.spec.changed.done.added.length && /the wording changed/.test(words.body) && !ctx2.specApproved, "never approved: compared with the last spec card, not called approved, and only its wording changed", JSON.stringify(words.spec.changed));
const same2 = await E.cardBodies.dispatch(at2(3));
ok(same2.spec.changed === null, "a spec card at the same spec version as the last one, with nothing approved, shows no change");

H.stop();
console.log(`\nspec-card-questions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
