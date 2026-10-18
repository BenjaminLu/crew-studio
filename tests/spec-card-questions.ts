import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The spec card (code-firstmate's dispatch) carries its spec as data (live E2E S14, S20): the spec writer records open
// scope questions as data, with the choices it proposes; the card lists them (unanswered, they stay out of scope) with
// the spec's scope and what it reads to verify; a spec raised again shows what changed since the last spec card.
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

H.stop();
console.log(`\nspec-card-questions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
