import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The reviewer's modes (unit review-modes; v1's config.yaml `reviewer: mode: diff|run`, bin/fm-review.sh and
// skills/reviewer/SKILL.md). Diff mode (opt-in): read-only, type-aware reads of a fresh checkout of the head,
// no execution; review-depth asks that every changed file be read (any type, within the read budget). Run mode (the
// default) adds sandboxed test runs and verification commands (no network) and asks for one executed verification, unless it
// cannot run here (recorded and flagged, never a loop). No APPROVE stands over a worker who said its tests were not run or
// not green, unless the reviewer ran the covering tests green itself. A review still unverified after its retry raises the
// step-back card, never a failed run.      bun tests/review-depth.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("review-depth");
const root = join(import.meta.dir, "..");
const WF = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
const boot = async (policies?: string) => { const data = checkedTempDir("crew-revmode-"); prepareSandbox(data); registerSandbox(data);
  const H = await harness([WF], { data, checkRoots: [], policies }); installCode(H.engine, { dataDir: data, projects: new Projects(data) }); return H; };
const intent = (extra: string) => ["Add a percent function to money-kit",
  `STUB_FILE src/percent.ts :: ${extra ? `// ${extra}\\n` : ""}export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n`,
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
const flow = (E: any) => {
  const until2 = (id: string, f: () => boolean) => until(() => f() || ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status), 180000);
  const dispatch = async (id: string) => { await until2(id, () => E.cards.list({ run: id, open: true }).some((c: any) => c.kind === "dispatch")); const d = E.cards.list({ run: id, open: true }).find((c: any) => c.kind === "dispatch"); if (d) await E.answer(d.id, { choice: "dispatch", by: "captain" }); };
  return { until2, dispatch };
};

// ---------- diff mode (opt-in; run is the default): a shallow reviewer, then a reading one ----------
{ const H = await boot("reviewer:\n  mode: diff\n"); const E = H.engine; const { until2, dispatch } = flow(E);
  const shallow = E.start({ workflow: "code-firstmate", params: {}, text: intent("STUB_SHALLOW_REVIEW") }); await dispatch(shallow.id);
  await until2(shallow.id, () => E.cards.list({ run: shallow.id, open: true }).some((c: any) => c.node === "step-back"));
  const retry = E.timeline(shallow.id).find((e: any) => e.type === "retry" && e.node === "review");
  ok(!!retry && /refused \(diff mode\): .*read \(fs_read.*\): src\/percent\.ts, test\/percent\.test\.ts/.test(retry.error ?? "") && !/run_tests/.test(retry.error ?? ""),
    "diff mode: a verdict from a reviewer that only read the diff is refused, naming the files to read (and asking for no execution)", String(retry?.error).slice(0, 400));
  ok(/BRIEF \(your last attempt\): Your verdict is refused/.test(E.get(shallow.id)!.ctx.lastPrompt?.review ?? ""), "the reviewer's retry is given that refusal as its brief");
  await until(() => E.get(shallow.id)!.status === "waiting", 20000);
  const stuck = E.cards.list({ run: shallow.id, open: true }).find((c: any) => c.node === "step-back");
  ok(E.ledger(shallow.id).some((e: any) => e.check === "firstmate/review-depth" && e.verdict === "fail" && e.findings.some((f: any) => f.class === "review-unverified")) && E.get(shallow.id)!.nodes.review?.state !== "error",
    "still refused after the retry, the review fails its review-depth check (review-unverified) instead of erroring, and the refine loop routes it to the step-back card");
  ok(!!stuck && stuck.kind === "step-back" && /The reviewer would not verify its claims/.test(stuck.title.en) && /reviewer 不肯先驗證就下判定/.test(stuck.title["zh-TW"]) && JSON.stringify(stuck.options.map((o: any) => o.id)) === '["other-model","rescope","park"]'
    && !E.cards.list({ run: shallow.id }).some((c: any) => c.kind === "merge") && !(E.get(shallow.id)!.ctx.reviews ?? []).length,
    "still shallow after its retry: no verdict, no merge card, and the run waits on the step-back card (another model, rescope, drop), never a failed run", JSON.stringify([E.get(shallow.id)!.status, stuck?.title]));
  if (stuck) await E.answer(stuck.id, { choice: "other-model", note: "stub/second-model", by: "captain" });
  await until2(shallow.id, () => E.cards.list({ run: shallow.id, open: true }).some((c: any) => c.node === "step-back" && c.id !== stuck?.id));
  const again = E.cards.list({ run: shallow.id, open: true }).find((c: any) => c.node === "step-back");
  ok(!!again && E.get(shallow.id)!.steps.some((s: any) => s.node === "review" && s.model === "second-model"), "'another model' runs the next review on the model the captain named; still unverified, the card comes back");
  if (again) await E.answer(again.id, { choice: "park", by: "captain" });
  await until(() => ["succeeded", "failed", "cancelled"].includes(E.get(shallow.id)!.status), 30000);
  ok(E.get(shallow.id)!.status === "succeeded" && E.get(shallow.id)!.result === "closed", "drop parks the run (closed), never a failed run", JSON.stringify([E.get(shallow.id)!.status, E.get(shallow.id)!.result]));
  // The parked shallow Task legitimately retains its accepted unmerged scope.
  // The independent deep-review case owns a different real temporary project.
  const HD = await boot("reviewer:\n  mode: diff\n"); const ED = HD.engine; const { until2: untilDeep, dispatch: dispatchDeep } = flow(ED);
  const deep = ED.start({ workflow: "code-firstmate", params: {}, text: intent("") }); await dispatchDeep(deep.id);
  await untilDeep(deep.id, () => ED.cards.list({ run: deep.id, open: true }).some((c: any) => c.kind === "merge"));
  const dep = ED.ledger(deep.id).filter((e: any) => e.check === "firstmate/review-depth").at(-1) as any; const m = ED.cards.list({ run: deep.id, open: true }).find((c: any) => c.kind === "merge");
  ok(dep?.verdict === "pass" && dep.data.mode === "diff" && !dep.data.executed.length && JSON.stringify(dep.data.read.map((r: any) => r.path).sort()) === '["src/percent.ts","test/percent.test.ts"]',
    "diff mode: a reviewer that read every changed file passes review-depth with nothing executed; the ledger records the mode and what was read", JSON.stringify(dep?.data));
  ok(!!m && /Reviewed in diff mode\./.test(m.body) && m.detail?.review?.mode === "diff", "the merge card says 'Reviewed in diff mode'", JSON.stringify([m?.detail?.review, m?.body.slice(-200)]));
  ED.cancel(deep.id, "captain"); HD.stop(); H.stop(); }

// ---------- run mode (policy reviewer.mode: run): the tests and a verification command, in the sandbox ----------
{ const H = await boot("reviewer:\n  mode: run\n"); const E = H.engine; const { until2, dispatch } = flow(E);
  const r = E.start({ workflow: "code-firstmate", params: {}, text: intent("") }); await dispatch(r.id);
  await until2(r.id, () => E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge"));
  const dep = E.ledger(r.id).filter((e: any) => e.check === "firstmate/review-depth").at(-1) as any; const m = E.cards.list({ run: r.id, open: true }).find((c: any) => c.kind === "merge");
  ok(dep?.verdict === "pass" && dep.data.mode === "run" && dep.data.executed.some((e: any) => /scripts\/test-shard\.ts/.test(e.command) && e.exit === 0) && dep.data.executed.some((e: any) => e.command === "ls" && e.exit === 0) && dep.data.read.length === 2,
    "run mode: the reviewer ran the repository's tests and a verification command in the sandbox (exit 0) and read the changed files; the ledger records them", JSON.stringify(dep?.data));
  ok(!!m && /Reviewed in run mode\./.test(m.body) && m.detail?.review?.mode === "run" && !/Needs your eye \(the review did not cover\)/.test(m.body), "the merge card says 'Reviewed in run mode' (and has nothing to flag)");
  E.cancel(r.id, "captain");
  // a run the sandbox refuses: the review goes on, and the built merge card flags it under needs your eye
  process.env.CREW_TEST_REVIEW_SANDBOX_REFUSE = "1";
  const HF = await boot("reviewer:\n  mode: run\n"); const EF = HF.engine; const { until2: untilRefused, dispatch: dispatchRefused } = flow(EF);
  const rf = EF.start({ workflow: "code-firstmate", params: {}, text: intent("") }); await dispatchRefused(rf.id);
  await untilRefused(rf.id, () => EF.cards.list({ run: rf.id, open: true }).some((c: any) => c.kind === "merge")); delete process.env.CREW_TEST_REVIEW_SANDBOX_REFUSE;
  const mf = EF.cards.list({ run: rf.id, open: true }).find((c: any) => c.kind === "merge");
  ok(!!mf && /Needs your eye \(the review did not cover\):\n· not executed: the sandbox refused the run: /.test(mf.body) && (mf.detail?.review?.notes ?? []).some((nt: string) => /^not executed: the sandbox refused the run: /.test(nt)),
    "run mode, a refused run: the built merge card flags 'not executed: <reason>' under needs your eye, in its body and its detail", JSON.stringify([mf?.detail?.review, mf?.body.slice(-300)]));
  EF.cancel(rf.id, "captain"); HF.stop(); H.stop(); }

// ---------- over the read budget, end to end: the built merge card carries what was not read ----------
{ const H = await boot("reviewer:\n  read_budget: 4\n"); const E = H.engine; const { until2, dispatch } = flow(E);
  const extra = Array.from({ length: 5 }, (_, i) => `STUB_FILE src/extra${i}.ts :: export const extra${i} = ${i};\n`);
  const r = E.start({ workflow: "code-firstmate", params: {}, text: [intent(""), ...extra].join("\n") }); await dispatch(r.id);
  await until2(r.id, () => E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge"));
  const m = E.cards.list({ run: r.id, open: true }).find((c: any) => c.kind === "merge"); const notes: string[] = m?.detail?.review?.notes ?? [];
  ok(!!m && notes.filter((nt) => nt.startsWith("not read (budget): ")).length === 3 && /Needs your eye \(the review did not cover\):\n(· not read \(budget\): src\/[\w.]+\.ts\n?){3}/.test(m.body) && !notes.some((nt) => nt.includes("test/percent.test.ts")),
    "over the read budget the built merge card carries each file not read (budget) in its body and its detail; the file the done line names was read", JSON.stringify([notes, m?.body.slice(-300)]));
  E.cancel(r.id, "captain"); H.stop(); }

// ---------- the review tools directly: no test command, a refused run, the budget, any file type ----------
const H = await boot(); const E = H.engine;
const sh = (cwd: string, ...a: string[]) => Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).stdout.toString().trim();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const pdf = (text: string, flate: boolean) => { const content = Buffer.from(`BT /F1 24 Tf 72 720 Td (${text}) Tj ET`); const body = flate ? deflateSync(content) : content;
  const parts = ["%PDF-1.4\n", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n", "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${body.length}${flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`];
  return Buffer.concat([Buffer.from(parts.join("")), body, Buffer.from("\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")]); };
const repoWith = (gates: any, files: Record<string, string | Buffer>, baseFiles: Record<string, string | Buffer> = {}) => {
  const repo = checkedTempDir("crew-revrepo-"); sh(repo, "git", "init", "-q", "-b", "main");
  mkdirSync(join(repo, ".crew")); writeFileSync(join(repo, ".crew", "gates.json"), JSON.stringify(gates)); writeFileSync(join(repo, "README.md"), "# r\n");
  for (const [p, c] of Object.entries(baseFiles)) { mkdirSync(join(repo, p, ".."), { recursive: true }); writeFileSync(join(repo, p), c); }
  sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", "base"); const base = sh(repo, "git", "rev-parse", "HEAD");
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(repo, p, ".."), { recursive: true }); writeFileSync(join(repo, p), c); }
  sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", "head"); return { repo, base };
};
let n = 900;
const fakeX = (repo: string, base: string, policy: Record<string, any>, done: string[] = []) => ({ run: { id: `R-${n++}`, nodes: {}, def: { nodes: [] } }, node: { id: "review", retries: 1 }, rn: { data: {} as any, attempt: 0 }, visit: 1,
  ctx: { worktree: repo, repo, baseCommit: base, spec: { title: "t", what: "w", why: [], done, scope: [] } }, dir: checkedTempDir("crew-revx-"), log() {}, save() {}, policy: (k: string) => policy[k] }) as any;
const mode = (E as any).modes.review;
const toolsOf = async (x: any) => { await mode.prepare(x); const t = mode.tools(x); return Object.fromEntries(t.map((y: any) => [y.name, y])); };
const verdict = async (T: any) => T.review_verdict.run({ verdict: "APPROVE", findings: [] });
// no test command, run mode: recorded as not executed, flagged, the verdict stands (no loop)
{ const { repo, base } = repoWith({}, { "src/a.ts": "export const a = 1;\n" }); const x = fakeX(repo, base, { "reviewer.mode": "run" }); const T = await toolsOf(x);
  await T.fs_read.run({ path: "./src/a.ts" }); const v = await verdict(T);
  const r: any = await (E as any).natives["review-depth"]({}, { x });
  ok(v.ok && v.notCovered.includes("not executed: the repository declares no test command") && r.verdict === "pass" && r.data.notExecuted === "the repository declares no test command",
    "run mode with no test command: the verdict stands with 'not executed: the repository declares no test command' recorded (no refusal loop); a ./ path counts as the changed file", JSON.stringify([v, r.data]));
  { const { mergeDetail } = await import("../src/domain/mergecard"); const d = mergeDetail({ run: x.run.id, intent: "x", spec: x.ctx.spec, ctx: { ...x.ctx, reviews: [{ ...x.rn.data.verdict, by: "stub", head: "h" }] }, ledger: [], doneMap: [], diff: "", stat: "", cost: null } as any);
    ok(d.review?.mode === "run" && (d.review?.notes ?? []).includes("not executed: the repository declares no test command"), "…and the merge card's detail carries it under the review's notes (needs your eye)", JSON.stringify(d.review)); }
  await mode.end?.(x, "done"); }
// a refused run, run mode: recorded with its reason, flagged, the verdict stands
{ const { repo, base } = repoWith({ test: ["bun", "test"] }, { "src/a.ts": "export const a = 1;\n" }); const x = fakeX(repo, base, { "reviewer.mode": "run" }); const T = await toolsOf(x);
  process.env.CREW_TEST_REVIEW_SANDBOX_REFUSE = "1"; const t = await T.run_tests.run({}); delete process.env.CREW_TEST_REVIEW_SANDBOX_REFUSE;
  await T.fs_read.run({ path: "src/a.ts" }); const v = await verdict(T); const r: any = await (E as any).natives["review-depth"]({}, { x });
  ok(/refused: /.test(t.error ?? "") && v.ok && v.notCovered.some((s: string) => /^not executed: the sandbox refused the run: /.test(s)) && r.data.executed[0].refused && r.verdict === "pass",
    "run mode, a run the sandbox refuses: recorded with its reason and flagged as not executed; the verdict stands, no loop", JSON.stringify([t, v.notCovered])); await mode.end?.(x, "done"); }
// any file type counts as read: text (a lockfile too), an image, a PDF, an opaque binary with its base
{ const blobBase = Buffer.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4]), blobHead = Buffer.concat([Buffer.from([0xde, 0xad, 0xbe, 0xef]), Buffer.alloc(300, 7)]);
  const { repo, base } = repoWith({}, { "bun.lock": '{ "lockfileVersion": 1 }\n', "img/logo.png": PNG, "docs/guide.pdf": pdf("Hello yen totals", true), "data/blob.bin": blobHead }, { "data/blob.bin": blobBase });
  const x = fakeX(repo, base, { "reviewer.mode": "diff" }); const T = await toolsOf(x);
  const im = await T.fs_read.run({ path: "img/logo.png" }); const pd = await T.fs_read.run({ path: "docs/guide.pdf" }); const bn = await T.fs_read.run({ path: "data/blob.bin" }); const lk = await T.fs_read.run({ path: "bun.lock" });
  ok(im.view === "image" && im.__image?.mimeType === "image/png" && im.__image.data === PNG.toString("base64"), "an image is returned as a picture the model can see (image input)", JSON.stringify({ ...im, __image: !!im.__image }));
  ok(pd.view === "pdf" && pd.pages === 1 && /Hello yen totals/.test(pd.text) && (process.platform !== "darwin" || pd.__image?.mimeType === "image/png"), "a PDF is returned as its page text (Flate too) and page 1 as a picture", JSON.stringify({ ...pd, __image: !!pd.__image }));
  ok(bn.view === "metadata" && bn.type === "application/octet-stream" && bn.size === 304 && /^de ad be ef 07/.test(bn.hexHead) && bn.base?.size === 8 && bn.changed?.sha256 === true && bn.changed?.size === 296,
    "an opaque binary is shown as its type, size, sha256 and hex head, beside the base version's (a metadata diff)", JSON.stringify(bn).slice(0, 400));
  ok(lk.view === "text" && lk.totalLines === 2, "a lockfile is read as text");
  const v = await verdict(T); const r: any = await (E as any).natives["review-depth"]({}, { x });
  ok(v.ok && JSON.stringify(r.data.read.map((y: any) => [y.path, y.view]).sort()) === '[["bun.lock","text"],["data/blob.bin","metadata"],["docs/guide.pdf","pdf"],["img/logo.png","image"]]' && !r.data.unreadable.length,
    "review-depth counts every view as read (text, image, pdf, metadata); nothing is 'not readable'", JSON.stringify(r.data)); await mode.end?.(x, "done"); }
// over the read budget: the files the done lines name plus a sample are required; the rest is recorded as not read (budget) and shown
{ const files: Record<string, string> = {}; for (let i = 0; i < 12; i++) files[`src/f${String(i).padStart(2, "0")}.ts`] = `export const v${i} = ${i};\n`;
  const { repo, base } = repoWith({}, files); const x = fakeX(repo, base, { "reviewer.mode": "diff", "reviewer.read_budget": 5 }, ["src/f11.ts: v11 is 11 (fails on base)"]); const T = await toolsOf(x);
  const plan = x.rn.data.plan;
  ok(plan.required.length === 5 && plan.required.includes("src/f11.ts") && plan.notRead.length === 7 && plan.notRead.every((y: any) => y.reason === "budget"), "over the read budget the done lines' files and a sample are required; the rest is 'not read: budget'", JSON.stringify(plan));
  const early = await verdict(T); for (const p of plan.required) await T.fs_read.run({ path: p }); const v = await verdict(T);
  ok(!!early.error && /src\/f11\.ts/.test(early.error) && v.ok && v.notCovered.filter((s: string) => s.startsWith("not read (budget)")).length === 7, "the required files must be read; the verdict then carries the files not read (budget)", JSON.stringify(v.notCovered));
  await mode.end?.(x, "done"); }
// a type with no view: too large to read is 'not readable' with its reason
{ const { READ_CAP_BYTES } = await import("../src/review-read"); const { repo, base } = repoWith({}, { "big.bin": Buffer.alloc(READ_CAP_BYTES + 1, 1), "src/a.ts": "x\n" });
  const x = fakeX(repo, base, {}); const T = await toolsOf(x); await T.fs_read.run({ path: "src/a.ts" }); const v = await verdict(T);
  ok(v.ok && x.rn.data.plan.unreadable.some((u: any) => u.path === "big.bin" && /larger than/.test(u.reason)) && v.notCovered.some((s: string) => /^not readable \(larger than .*\): big\.bin$/.test(s)), "a file over the read cap is 'not readable' with its reason, not required", JSON.stringify(v.notCovered)); await mode.end?.(x, "done"); }
// run mode on a fresh checkout with nothing installed: the project's install (default bun install --frozen-lockfile; or its
// install policy) runs in the sandbox, the network only to the hosts egress.allow grants; the runs themselves get no network
const depRepo = (extra: Record<string, string> = {}) => repoWith({ test: ["bun", "test"] }, {
  "package.json": '{ "name": "r", "private": true, "dependencies": { "dep": "file:./vendor/dep" } }\n',
  "bun.lock": '{\n  "lockfileVersion": 1,\n  "configVersion": 1,\n  "workspaces": {\n    "": {\n      "name": "r",\n      "dependencies": {\n        "dep": "file:./vendor/dep",\n      },\n    },\n  },\n  "packages": {\n    "dep": ["dep@file:vendor/dep", {}],\n  }\n}\n',
  "vendor/dep/package.json": '{ "name": "dep", "version": "1.0.0", "main": "index.js" }\n', "vendor/dep/index.js": "exports.answer = 42;\n",
  "test/dep.test.ts": 'import { expect, test } from "bun:test";\nimport { answer } from "dep";\ntest("the dependency is there", () => expect(answer).toBe(42));\n', ".gitignore": "node_modules/\n", ...extra });
{ const { existsSync, readdirSync } = await import("node:fs"); const { repo, base } = depRepo();
  const opened: string[][] = []; const agents = (E as any).deps.agents; const savedEgress = agents.egress; agents.egress = { port: 1, open: (_t: string, h: string[]) => opened.push(h), close() {} };
  const x = fakeX(repo, base, { "reviewer.mode": "run", "egress.allow": ["registry.npmjs.org"] }); x.ctx.head = sh(repo, "git", "rev-parse", "HEAD"); const T = await toolsOf(x);
  const t = await T.run_tests.run({}); const c = await T.run_command.run({ argv: ["ls", "node_modules/dep"] });
  ok(!existsSync(join(repo, "node_modules")) && t.exit === 0 && c.exit === 0 && /index\.js/.test(c.tail) && x.rn.data.runDeps?.ran?.join(" ") === "bun install --frozen-lockfile --ignore-scripts" && x.rn.data.depth.executed.every((e: any) => e.exit === 0),
    "run mode on a fresh checkout with no dependencies installed: the install runs in the sandbox first, so a test importing a dependency passes (run_tests and run_command)", JSON.stringify([t, c, x.rn.data.runDeps]).slice(0, 600));
  ok(opened.length === 1 && JSON.stringify(opened[0]) === '["registry.npmjs.org"]', "the install reaches the network only through the egress proxy, to the hosts egress.allow grants; the runs open none", JSON.stringify(opened));
  ok(readdirSync(join(x.dir, "review-runs", "round-1")).join() === "base", "each run's throwaway clone is removed afterwards (the installed base stays for the next run)", readdirSync(join(x.dir, "review-runs", "round-1")).join());
  // a command a reviewer names resolves on the fixed PATH only: no absolute program, nothing off it, no path or link out of the copy
  const abs = await T.run_command.run({ argv: ["/opt/elsewhere/tools/cat", "x"] }); const off = await T.run_command.run({ argv: ["no-such-program-xyz"] }); const out = await T.run_command.run({ argv: ["../../bin/sh"] });
  ok(/^refused: .* absolute path/.test(abs.error ?? "") && /^refused: .*fixed PATH/.test(off.error ?? "") && /^refused: /.test(out.error ?? ""), "run_command refuses an absolute program, one off the fixed PATH and a path out of the copy", JSON.stringify([abs, off, out]));
  await mode.end?.(x, "done"); agents.egress = savedEgress;
  ok(!existsSync(join(x.dir, "review-runs")), "the review's end removes the installed copy"); }
// the install policy is what runs (a project's own install), and the PATH a run gets is the fixed one; a link out of the copy is refused
{ const { symlinkSync } = await import("node:fs");
  const { repo, base } = depRepo({ "scripts/install.ts": 'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("node_modules/dep2", { recursive: true });\nwriteFileSync("node_modules/dep2/package.json", \'{ "name": "dep2", "main": "index.js" }\');\nwriteFileSync("node_modules/dep2/index.js", "exports.two = 2;\\n");\n',
    "test/dep2.test.ts": 'import { expect, test } from "bun:test";\nimport { two } from "dep2";\ntest("the policy installed it", () => expect(two).toBe(2));\n', "test/dep.test.ts": 'import { test } from "bun:test";\ntest("x", () => {});\n' });
  symlinkSync("/bin/sh", join(repo, "outside-sh")); sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", "link");
  const x = fakeX(repo, base, { "reviewer.mode": "run", install: ["bun", "scripts/install.ts"] }); x.ctx.head = sh(repo, "git", "rev-parse", "HEAD"); const T = await toolsOf(x);
  const t = await T.run_tests.run({}); const p = await T.run_command.run({ argv: ["sh", "-c", "echo PATH=$PATH"] }); const l = await T.run_command.run({ argv: ["./outside-sh", "-c", "true"] });
  ok(t.exit === 0 && x.rn.data.runDeps?.ran?.join(" ") === "bun scripts/install.ts", "the project's install policy installs the fresh checkout's dependencies before the run", JSON.stringify([t, x.rn.data.runDeps]).slice(0, 500));
  ok(p.exit === 0 && new RegExp(`PATH=[^\\n]*/copy/node_modules/\\.bin:/usr/bin:/bin:/usr/sbin:/sbin:[^:\\n]+$`, "m").test(p.tail) && /^refused: .*fixed PATH/.test(l.error ?? ""), "a run gets the fixed PATH only (the copy's node_modules/.bin, then the system's and bun's), and a link out of the copy is refused", JSON.stringify([p, l]).slice(0, 500));
  await mode.end?.(x, "done"); }
// the sandbox never adds a reviewer-chosen program's folder to its reads (argvRead: false, as both review runs call it)
{ const { sandboxed } = await import("../src/runtime/checks"); const { copyFileSync } = await import("node:fs");
  const d = checkedTempDir("crew-argv-"); writeFileSync(join(d, "show"), '#!/bin/sh\n/bin/cat "$(dirname "$0")/secret.txt"\n', { mode: 0o755 }); writeFileSync(join(d, "secret.txt"), "SECRET-ARGV-DIR\n"); void copyFileSync; const box = checkedTempDir("crew-argvbox-");
  const run = (argvRead: boolean) => sandboxed([join(d, "show")], { cwd: box, out: join(box, "out"), tmp: join(box, "tmp"), timeoutS: 20, network: false, argvRead });
  const wide = await run(true), narrow = await run(false);
  ok(/SECRET-ARGV-DIR/.test(wide.stdout) && !/SECRET-ARGV-DIR/.test(narrow.stdout) && narrow.code !== 0, "with argvRead: false the program's folder is not readable: an absolute argv[0] never widens the sandbox's reads", JSON.stringify([wide.code, narrow.code, narrow.stderr.slice(0, 200)]));
  const reviewSrc = readFileSync(join(root, "src/domain/code.ts"), "utf8").split("engine.modes.review = {")[1]?.split("engine.cardBodies")[0] ?? "";
  ok((reviewSrc.match(/sandboxed\(/g) ?? []).length === 1 && /sandboxed\(cmd, \{[^\n]*argvRead: false/.test(reviewSrc), "the review's one sandbox call (both run tools go through it) passes argvRead: false"); }
// the read plan: a done line names a path on its boundaries (src/a.ts is not src/a.tsx), never more than the budget, and the tool budget follows the plan
{ const files: Record<string, string> = { "src/a.ts": "a\n", "src/a.tsx": "b\n" }; for (let i = 0; i < 6; i++) files[`src/z${i}.ts`] = `${i}\n`;
  const { repo, base } = repoWith({}, files); const x = fakeX(repo, base, { "reviewer.read_budget": 4 }, ["src/a.tsx renders (fails on base)"]); await toolsOf(x); const plan = x.rn.data.plan;
  ok(plan.required[0] === "src/a.tsx" && plan.required.indexOf("src/a.ts") !== 0 && plan.requiredCost <= 4 && plan.required.length + plan.notRead.length === 8,
    "only src/a.tsx is named by the done line (path boundaries), named files come first, and the required reads stay within the budget", JSON.stringify(plan));
  const big = fakeX(repo, base, { "reviewer.read_budget": 200 }); await toolsOf(big);
  ok(mode.maxTools(big) >= 2 * big.rn.data.plan.requiredCost + 20 && mode.maxTools(x) >= 2 * plan.requiredCost + 20, "the review's tool budget is sized from its plan (every required read twice over, plus the run tools and the verdict)", String(mode.maxTools(big)));
  await mode.end?.(x, "done"); await mode.end?.(big, "done"); }
// a Flate bomb in a PDF: bounded time and memory, the stream over the cap skipped
{ const { deflateSync: def } = await import("node:zlib"); const bomb = def(Buffer.alloc(150_000_000, 0x41));
  const pdfBomb = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Length " + bomb.length + " /Filter /FlateDecode >>\nstream\n"), bomb, Buffer.from("\nendstream endobj\n%%EOF\n")]);
  const { repo, base } = repoWith({}, { "docs/bomb.pdf": pdfBomb }); const x = fakeX(repo, base, {}); const T = await toolsOf(x);
  Bun.gc(true); const rss0 = process.memoryUsage().rss; const t0 = Date.now(); const r = await T.fs_read.run({ path: "docs/bomb.pdf" }); const ms = Date.now() - t0; const grew = process.memoryUsage().rss - rss0;
  ok(r.view === "pdf" && /skipped/.test(r.streamsSkipped ?? "") && ms < 20000 && grew < 200_000_000, "a Flate bomb inside a PDF is read within bounded time and memory: the stream over the inflate cap is skipped", JSON.stringify({ ms, grewMB: Math.round(grew / 1e6), skipped: r.streamsSkipped }));
  await mode.end?.(x, "done"); }
// a crafted PDF cannot stall the event loop: a TJ array with no end and many stream keywords are scanned linearly, and
// the page picture (Quick Look) runs off the event loop
{ const { pdfText } = await import("../src/review-read");
  const crafted = Buffer.from(`%PDF-1.4\n1 0 obj << /Length 9 >>\nstream\nBT ${`[${"(a)".repeat(20)} `.repeat(40)} Tj ET\nendstream endobj\n${"<< >> stream\n".repeat(60000)}%%EOF\n`);
  pdfText(Buffer.from("%PDF-1.4\n")); const t0 = Date.now(); const r = pdfText(crafted); const ms = Date.now() - t0;
  ok(ms < 250, "a crafted PDF (TJ arrays that never close, 60000 stream keywords) is scanned in bounded time", JSON.stringify({ ms, len: r.text.length }));
  const { repo, base } = repoWith({}, { "docs/guide.pdf": pdf("Hello yen totals", true) }); const x = fakeX(repo, base, {}); const T = await toolsOf(x);
  let ticks = 0; const tick = setInterval(() => { ticks++; }, 5); const t1 = Date.now();
  const pd = await T.fs_read.run({ path: "docs/guide.pdf" }); const took = Date.now() - t1; clearInterval(tick);
  ok(pd.view === "pdf" && (process.platform !== "darwin" || (!!pd.__image && ticks > 0)), "a PDF read keeps the event loop free while Quick Look draws page 1 (timers run during the read: no blocking spawn)", JSON.stringify({ ticks, took, image: !!pd.__image }));
  await mode.end?.(x, "done"); }
// the provider contract: a tool result's picture is its own part; each provider maps it to its image input or keeps a note
{ const PNG64 = PNG.toString("base64"); const seen: Record<string, any[]> = { anthropic: [], openai: [], compat: [] }; let turn: Record<string, number> = { anthropic: 0, openai: 0, compat: 0 };
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => { const u = new URL(req.url);
    if (u.pathname.startsWith("/api/tools/")) return Response.json({ path: "img/logo.png", view: "image", __image: { mimeType: "image/png", data: PNG64 } });
    const body = await req.json(); const who = u.pathname === "/v1/messages" ? "anthropic" : u.pathname === "/v1/responses" ? "openai" : "compat"; seen[who].push(body); const first = turn[who]++ === 0;
    if (who === "anthropic") return Response.json({ content: first ? [{ type: "tool_use", id: "t1", name: "img", input: {} }] : [{ type: "text", text: "done" }] });
    if (who === "openai") return Response.json({ output: first ? [{ type: "function_call", call_id: "c1", name: "img", arguments: "{}" }] : [{ type: "message", content: [{ type: "output_text", text: "done" }] }] });
    return Response.json({ choices: [{ message: first ? { content: null, tool_calls: [{ id: "k1", type: "function", function: { name: "img", arguments: "{}" } }] } : { content: "done" } }] }); } });
  const base = `http://127.0.0.1:${srv.port}`; const saved = { ...process.env };
  Object.assign(process.env, { CREW_ANTHROPIC_BASE: base, CREW_OPENAI_BASE: base, ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", CREW_COMPAT_BASE_URL: `${base}/compat/v1` });
  const { anthropicProvider, openaiProvider, compatProvider } = await import("../src/providers/http"); const { stubProvider } = await import("../src/providers/stub");
  const ctx: any = { studioUrl: base, token: "t" }; const tools = [{ name: "img", description: "an image", inputSchema: { type: "object" } }];
  const drive = async (p: any, text = "go") => { const evs: any[] = []; for await (const e of p.start("sys", tools, ctx).send(text)) evs.push(e); return evs; };
  const ea = await drive(anthropicProvider("m")), eo = await drive(openaiProvider("m")), ec = await drive(compatProvider("m")), es = await drive(stubProvider(), "TEST AGENT\nCall: img {}");
  const has = (x: any) => JSON.stringify(x).includes(PNG64);
  const aBlock = seen.anthropic[1]?.messages?.at(-1)?.content?.[0]?.content?.[0];
  ok(aBlock?.type === "image" && aBlock.source?.data === PNG64, "Anthropic: the picture goes as an image block in the tool result", JSON.stringify(seen.anthropic[1]?.messages?.at(-1)).slice(0, 300));
  ok(seen.openai.length === 2 && !has(seen.openai[1]) && /attached \(image\/png/.test(JSON.stringify(seen.openai[1])), "OpenAI: no base64 in the request; the function output carries a note instead", JSON.stringify(seen.openai[1]).slice(0, 300));
  ok(seen.compat.length === 2 && !has(seen.compat[1]) && /attached \(image\/png/.test(JSON.stringify(seen.compat[1])), "OpenAI-compatible: no base64 in the request; the tool message carries a note", JSON.stringify(seen.compat[1]).slice(0, 300));
  ok([ea, eo, ec, es].every((evs) => evs.some((e) => e.type === "toolEnd") && !has(evs)), "no provider's events (what logs and the UI see) carry the picture: anthropic, openai, openai-compatible, stub", JSON.stringify(es.filter((e) => e.type === "toolEnd")).slice(0, 300));
  // the CLIs (claude, codex) as the vendors answer: each asks Studio's MCP server for the tool, which hands the picture as an
  // MCP image block; claude prints it as an Anthropic image block, codex as the MCP block itself. Their events keep a note only.
  const cliDir = checkedTempDir("crew-cli-img-");
  const tokenFile=join(cliDir,"tool-token"),toolToken="review-depth-private-tool-fixture";writeFileSync(tokenFile,toolToken,{mode:0o600});
  ok((statSync(tokenFile).mode&0o777)===0o600,"CLI image fixture uses private tool credential file");
  const mcpCall = `if(process.env.CREW_TOOL_TOKEN||process.argv.some(a=>a.includes(${JSON.stringify(toolToken)})))throw new Error("tool token leaked into CLI env or argv"); const { spawn } = await import("node:child_process"); const cmd = JSON.parse(process.env.STUB_MCP);
const srv = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "inherit"], env: process.env }); let buf = ""; const waiting = new Map();
srv.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
const rpc = (id, method, params) => new Promise((r) => { waiting.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n"); });
await rpc(1, "initialize", {}); const res = (await rpc(2, "tools/call", { name: "img", arguments: {} })).result; srv.kill();
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");`;
  writeFileSync(join(cliDir, "claude.mjs"), `${mcpCall}
out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "mcp__studio__img", input: {} }] } });
out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: res.content.map((c) => c.type === "image" ? { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } } : c) }] } });
out({ type: "result", subtype: "success", is_error: false, result: "done" });\n`);
  writeFileSync(join(cliDir, "codex.mjs"), `${mcpCall}
out({ type: "item.started", item: { id: "m1", type: "mcp_tool_call", tool: "img", arguments: {} } });
out({ type: "item.completed", item: { id: "m1", type: "mcp_tool_call", tool: "img", result: { content: res.content } } });
out({ type: "item.completed", item: { id: "a1", type: "agent_message", text: "done" } }); out({ type: "turn.completed", usage: {} });\n`);
  const { claudeProvider } = await import("../src/providers/claude"); const { codexProvider } = await import("../src/providers/codex");
  const cliEnv={...process.env};for(const key of ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","OPENAI_API_KEY","CODEX_API_KEY"])delete cliEnv[key];
  const mcpCommand = [process.execPath, join(root, "src/mcp.ts")]; const cliCtx: any = { ...ctx, tokenFile, cwd: cliDir, mcpCommand, env: { ...cliEnv, STUB_MCP: JSON.stringify(mcpCommand), CREW_STUDIO_URL: base, CREW_TOOL_TOKEN_FILE: tokenFile } };
  const driveCli = async (p: any) => { const evs: any[] = []; for await (const e of p.start("sys", tools, cliCtx).send("go")) evs.push(e); return evs; };
  const ecl = await driveCli(claudeProvider("m", join(cliDir, "claude.mjs"))), ecx = await driveCli(codexProvider("m", join(cliDir, "codex.mjs")));
  const endOf = (evs: any[]) => evs.find((e) => e.type === "toolEnd");
  ok(!!endOf(ecl) && !has(ecl) && /\[image attached \(image\/png\)\]/.test(endOf(ecl).result) && /"view":"image"/.test(endOf(ecl).result), "claude CLI: the picture reaches the model through MCP as an image block; its events keep a note, never the base64", JSON.stringify(ecl).slice(0, 400));
  ok(!!endOf(ecx) && !has(ecx) && /\[image attached \(image\/png\)\]/.test(endOf(ecx).result) && /"view":"image"/.test(endOf(ecx).result), "codex CLI: the same through its MCP tool call", JSON.stringify(ecx).slice(0, 400));
  const { mcpContent } = await import("../src/tool-content"); const mc = mcpContent({ view: "image", __image: { mimeType: "image/png", data: PNG64 } });
  ok(mc[0].type === "image" && mc[0].data === PNG64 && mc[0].mimeType === "image/png" && !mc[1].text.includes(PNG64), "Studio's MCP server hands the picture as an MCP image block and the rest as text");
  srv.stop(true); for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
// T185: an on-disk pre-upgrade review has a complete plan and reads but no binding.
// Resume the saved context through the public review callers; never retrofit history.
{ const { repo, base } = repoWith({}, { "src/a.ts": "a\n" }); const started = fakeX(repo, base, {});
  const initial = await toolsOf(started); await initial.fs_read.run({ path: "src/a.ts" });
  const historic = { verdict: "APPROVE", findings: [], followups: [], head: base, by: "legacy reviewer", round: 0 };
  started.ctx.reviews = [historic]; delete started.rn.data.plan.binding;
  const saved = join(started.dir, "legacy-review.json");
  writeFileSync(saved, JSON.stringify({ run: started.run, node: started.node, rn: started.rn, visit: started.visit, ctx: started.ctx }));
  const x = { ...started, ...JSON.parse(readFileSync(saved, "utf8")) };
  const history = JSON.stringify(x.ctx.reviews), legacyPlan = JSON.stringify(x.rn.data.plan);
  const resumed = Object.fromEntries(mode.tools(x).map((t: any) => [t.name, t]));
  const native = await (E as any).natives["review-depth"]({}, { x });
  ok(native.verdict === "fail" && native.findings.some((f: any) => f.class === "review-unverified"), "T185 resumed legacy complete-read unbound plan fails native verification");
  const refused = await verdict(resumed);
  ok(!!refused.error && !x.rn.data.verdict, "T185 resumed legacy complete-read unbound plan refuses the real verdict tool");
  // Model output or a pre-upgrade saved verdict cannot bypass after's guard.
  x.rn.data.verdict = { verdict: "APPROVE", findings: [], followups: [] };
  let retryError = ""; try { await mode.after(x, { provider: "stub", model: "fixture" }); } catch (e) { retryError = String(e); }
  ok(/verdict was refused/.test(retryError) && !x.rn.data.verdict && JSON.stringify(x.ctx.reviews) === history,
    "T185 after initial refusal asks for retry and records no approval from the resumed legacy attempt");
  ok(JSON.stringify(x.rn.data.plan) === legacyPlan && !x.rn.data.plan.binding && JSON.stringify(JSON.parse(readFileSync(saved, "utf8")).ctx.reviews) === history,
    "T185 refusal synthesizes no binding and preserves persisted historical verdict records");
  x.rn.attempt++; const retry = await toolsOf(x);
  const beforeRead = await verdict(retry);
  ok(!!x.rn.data.plan.binding && !!beforeRead.error && x.ctx.reviewBrief && JSON.stringify(x.ctx.reviews) === history,
    "T185 retry preparation makes a fresh bound plan, keeps history and refusal brief, and requires new reads");
  await retry.fs_read.run({ path: "src/a.ts" }); const accepted = await verdict(retry);
  const verified = await (E as any).natives["review-depth"]({}, { x });
  ok(accepted.ok && verified.verdict === "pass", "T185 retry recovers through real read, verdict and native verification callers");
  await mode.after(x, { provider: "stub", model: "fixture" });
  ok(x.ctx.reviews.length === 2 && JSON.stringify(x.ctx.reviews[0]) === JSON.stringify(historic) && x.ctx.reviews[1].head === sh(repo, "git", "rev-parse", "HEAD") && !x.ctx.reviewUnverified && !x.ctx.reviewBrief,
    "T185 successful retry appends only its fresh approval and preserves the original historic verdict");
  await mode.end?.(x, "done"); }

// ---------- review-depth follow-ups: fail closed, retry context, path punctuation ----------
{ const { repo, base } = repoWith({}, { "src/a.ts": "a\n" });
  const x = fakeX(repo, base, {}); x.ctx.head = sh(repo, "git", "rev-parse", "HEAD");
  x.rn.data.verdict = { verdict: "APPROVE", findings: [], followups: [] };
  const native = await (E as any).natives["review-depth"]({}, { x });
  ok(native.verdict === "fail" && native.findings.some((f: any) => f.class === "review-unverified"), "missing plan fails unverified even with an injected APPROVE verdict");
  const T = Object.fromEntries(mode.tools(x).map((t: any) => [t.name, t])); const v = await verdict(T);
  ok(!!v.error && /current.*plan|plan.*head/.test(v.error), "real verdict tool refuses verification without a prepared current-attempt plan");
  x.rn.attempt = 1; await mode.after(x, { provider: "stub", model: "fixture" });
  ok(!(x.ctx.reviews ?? []).length && x.rn.data.judged.verdict === "fail" && x.ctx.reviewUnverified, "after caller cannot record injected approval without a plan"); }
{ const { repo, base } = repoWith({}, { "src/a.ts": "a\n" });
  const x = fakeX(repo, base, {}); const T = await toolsOf(x); await T.fs_read.run({ path: "src/a.ts" });
  const good = JSON.parse(JSON.stringify(x.rn.data.plan));
  for (const [label, mutate] of [["missing", () => null], ["malformed", (p: any) => ({ ...p, required: "src/a.ts" })], ["empty-for-changed-head", (p: any) => ({ ...p, files: [], required: [], unreadable: [], notRead: [], cost: {}, total: 0, requiredCost: 0 })], ["stale-attempt", (p: any) => ({ ...p, binding: { ...(p.binding ?? {}), attempt: 99 } })], ["stale-head", (p: any) => ({ ...p, binding: { ...(p.binding ?? {}), head: base } })]] as const) {
    x.rn.data.plan = mutate(JSON.parse(JSON.stringify(good)));
    x.rn.data.verdict = { verdict: "APPROVE", findings: [], followups: [] };
    let r: any; try { r = await (E as any).natives["review-depth"]({}, { x }); } catch {}
    ok(r?.verdict === "fail" && r.findings.some((f: any) => f.class === "review-unverified"), `${label} plan is rejected without crashing or passing native verification`);
    let v: any; try { v = await verdict(T); } catch {}
    ok(!!v?.error, `${label} plan is refused by the real verdict tool without crashing`);
  }
  x.rn.data.plan = good; x.rn.data.verdict = null;
  sh(repo, "git", "commit", "--allow-empty", "-qm", "head moved after review prepared");
  const moved = await verdict(T);
  ok(!!moved.error, "a moved actual head invalidates the prepared plan even while ctx.head is unchanged");
  await mode.end?.(x, "done"); }
{ const { repo, base } = repoWith({}, {}); const x = fakeX(repo, base, {}); const T = await toolsOf(x); const v = await verdict(T);
  const native = await (E as any).natives["review-depth"]({}, { x });
  ok(x.rn.data.plan.files.length === 0 && v.ok && native.verdict === "pass", "prepared genuinely empty diff retains a valid passing review"); await mode.end?.(x, "done"); }
{ const { repo, base } = repoWith({}, { "src/a.ts": "a\n" }); const x = fakeX(repo, base, {});
  x.ctx.reviewUnverified = "previous review refused"; x.ctx.reviewBrief = "retry verification brief";
  await toolsOf(x);
  ok(x.ctx.reviewUnverified === null && x.ctx.reviewBrief === "retry verification brief", "preparation clears only the prior attempt's unverified flag and preserves its retry brief");
  x.ctx.briefs = { review: { text: "current ordinary failure" } };
  const card = (E as any).cardBodies["step-back"](x);
  ok(!card.title.includes("would not verify") && !card.zhTitle.includes("不肯先驗證"), "an ordinary later failure cannot produce a stale unverified step-back card");
  await mode.end?.(x, "done"); }
{ const files: Record<string, string> = { "src/a.ts": "a\n", "src/a.tsx": "b\n" }; for (let i = 0; i < 6; i++) files[`src/z${i}.ts`] = `${i}\n`;
  const { repo, base } = repoWith({}, files);
  for (const line of ["Read src/a.tsx.", "Read src/a.tsx...", "Read src/a.tsx: done", 'Read "src/a.tsx".', "Read 'src/a.tsx';", "Read (src/a.tsx), done"]) {
    const x = fakeX(repo, base, { "reviewer.read_budget": 4 }, [line]); await toolsOf(x);
    const first = JSON.stringify(x.rn.data.plan.required);
    ok(x.rn.data.plan.required[0] === "src/a.tsx" && x.rn.data.plan.requiredCost <= 4, `sentence punctuation preserves named file priority: ${line}`);
    await mode.prepare(x); ok(JSON.stringify(x.rn.data.plan.required) === first, `punctuation priority is stable under repeated preparation: ${line}`);
    await mode.end?.(x, "done");
  }
  for (const line of ["Read src/a.tsx.map.", "Read longer/src/a.tsx.", "Read src/a.tsx/child.", "Read src/a.tsx-backup."]) {
    const x = fakeX(repo, base, { "reviewer.read_budget": 4 }, [line]); await toolsOf(x);
    ok(x.rn.data.plan.required[0] === "src/a.ts", `longer path, suffix and child do not name a shorter file: ${line}`); await mode.end?.(x, "done");
  }
}
// run mode with a gates.json shard adapter that selects by basename (money-kit): files reach it, zero-test runs and refusals do not count
{ const { repo, base } = repoWith({ test: ["bun", "scripts/test-shard.ts"], tests: ["test/**"] }, {
    "scripts/test-shard.ts": readFileSync(join(root, "templates/sandbox-repo/scripts/test-shard.ts"), "utf8"),
    "test/a.test.ts": 'import { expect, test } from "bun:test";\ntest("a passes", () => expect(1).toBe(1));\n',
    "test/b.test.ts": 'import { expect, test } from "bun:test";\ntest("b fails", () => expect(1).toBe(2));\n' });
  const x = fakeX(repo, base, { "reviewer.mode": "run" }); x.ctx.head = sh(repo, "git", "rev-parse", "HEAD"); const T = await toolsOf(x);
  const sel = await T.run_tests.run({ files: ["test/a.test.ts"] }); const bare = await T.run_tests.run({ files: ["a.test.ts"] }); const none = await T.run_tests.run({ files: ["test/missing.test.ts"] });
  ok(sel.status === "executed" && sel.exit === 0 && /Ran 1 test/.test(sel.tail) && sel.runsRemaining === 2, "the reviewer's selected test reaches the basename adapter: only test/a.test.ts runs, never the whole suite", JSON.stringify(sel).slice(0, 500));
  ok(/Call run_tests\(\{"files":\["test\/a\.test\.ts"\]\}\)/.test(bare.error ?? "") && bare.runsRemaining === 2, "a bare basename is refused with the exact call to make, and does not count", JSON.stringify(bare));
  ok(none.status === "no-tests" && none.runsRemaining === 2 && x.rn.data.depth.executed.length === 1, "a selection that runs no tests is not an executed verification and does not count", JSON.stringify([none, x.rn.data.depth.executed]).slice(0, 500));
  const r2 = await T.run_tests.run({}), r3 = await T.run_tests.run({}), over = await T.run_tests.run({});
  ok(r2.exit === 1 && r3.runsRemaining === 0 && /test run limit reached: all 3 executed runs/.test(over.error ?? "") && over.runsRemaining === 0, "three executed runs with a countdown, then a limit message saying what to do", JSON.stringify([r2.runsRemaining, r3.runsRemaining, over]));
  await mode.end?.(x, "done"); }
// run is the default mode (E2E F20: a diff-mode reviewer approved in 17 s and executed nothing), and no APPROVE stands over a
// worker report that says its tests were not run or not green unless the reviewer ran the covering tests green itself
{ const shipped = readFileSync(join(root, "packs/firstmate/policies.yaml"), "utf8");
  ok(/^reviewer:\n  mode: run$/m.test(shipped), "the shipped policy's reviewer mode is run");
  const gates = { test: ["bun", "scripts/test-shard.ts"], tests: ["test/**"] };
  const files = { "scripts/test-shard.ts": readFileSync(join(root, "templates/sandbox-repo/scripts/test-shard.ts"), "utf8"), "src/a.ts": "export const a = 1;\n",
    "test/a.test.ts": 'import { expect, test } from "bun:test";\ntest("a passes", () => expect(1).toBe(1));\n' };
  const said = (x: any, summary: string) => { x.run.nodes.build = { data: { report: { marker: "WORKER_COMPLETE", summary } } }; return x; };
  const NOT_GREEN = "Corrected the matcher. Thus the final suite is NOT verified green.";
  const readAll = async (T: any) => { for (const p of Object.keys(files)) await T.fs_read.run({ path: p }); };
  { const { repo, base } = repoWith(gates, files); const x = said(fakeX(repo, base, {}), NOT_GREEN); x.ctx.head = sh(repo, "git", "rev-parse", "HEAD"); const T = await toolsOf(x);
    ok(!!T.run_tests, "with no reviewer.mode set, the review runs in run mode (it has run_tests)");
    await readAll(T); await T.run_command.run({ argv: ["ls"] }); const early = await verdict(T);
    ok(/Your APPROVE is refused \(run mode\): the worker reported its tests were not run or not green \(".*NOT verified green\."\); run the covering tests green yourself/.test(early.error ?? ""),
      "run mode: an APPROVE over 'NOT verified green' is refused after a verification command alone, until the reviewer runs the covering tests", String(early.error).slice(0, 300));
    const t = await T.run_tests.run({ files: ["test/a.test.ts"] }); const v = await verdict(T); const r: any = await (E as any).natives["review-depth"]({}, { x });
    ok(t.exit === 0 && v.ok && r.verdict === "pass" && /NOT verified green/.test(r.data.workerUnverified ?? ""),
      "…and stands once the reviewer ran the changed tests green itself; the ledger records the worker's words", JSON.stringify([t.exit, v, r.findings, r.data.workerUnverified]));
    await mode.end?.(x, "done"); }
  { const { repo, base } = repoWith(gates, files); const x = said(fakeX(repo, base, { "reviewer.mode": "diff" }), NOT_GREEN); const T = await toolsOf(x);
    await readAll(T); const a = await verdict(T);
    ok(/Your APPROVE is refused \(diff mode\): .*diff mode cannot run them/.test(a.error ?? ""), "diff mode: an APPROVE over an unverified worker report is refused (it cannot run the tests)", String(a.error).slice(0, 300));
    const rej = await T.review_verdict.run({ verdict: "REJECT", findings: [{ path: "src/a.ts", line: 1, text: "the final suite was never run green", tag: "must-fix", fix: "run the suite green" }] });
    ok(rej.ok === true, "…a REJECT naming the missing verification is accepted");
    x.rn.data.verdict = { verdict: "APPROVE", findings: [], followups: [] }; const r: any = await (E as any).natives["review-depth"]({}, { x });
    ok(r.verdict === "fail" && r.findings.some((f: any) => f.class === "review-depth" && /an APPROVE over an unverified worker report/.test(f.message)), "review-depth fails an APPROVE recorded over the unverified report", JSON.stringify(r.findings));
    await mode.end?.(x, "done"); }
  { const { repo, base } = repoWith(gates, files); const x = said(fakeX(repo, base, { "reviewer.mode": "diff" }), "Full head declared run passed: 29 tests, no tests failed, exit 0."); const T = await toolsOf(x);
    await readAll(T); const v = await verdict(T); ok(v.ok === true, "a worker report of a green run (\"no tests failed\") does not block an APPROVE", JSON.stringify(v)); await mode.end?.(x, "done"); }
  // what the worker said, read one sentence at a time: fail-first wording and other things not run stay quiet
  { const { unverifiedClaim } = await import("../src/domain/report-verification");
    const yes = ["Thus final 28-test suite is NOT verified green.", "Corrected matcher; final rerun unavailable because tool reports test run limit reached.", "These are inspection findings, not executed tests.", "I could not run the test suite in the sandbox."];
    const no = ["The new test fails on the base and passes on the head; all 28 tests pass.", "The test failed before the fix and passes now.", "The job is not run twice.", "Full head declared run passed: 29 tests, exit 0."];
    ok(yes.every((s) => unverifiedClaim(s)) && no.every((s) => !unverifiedClaim(s)), "the worker's words: R-058's 'NOT verified green' and 'limit reached' count; fail-first wording and 'the job is not run twice' do not",
      JSON.stringify([yes.map((s) => !!unverifiedClaim(s)), no.map((s) => unverifiedClaim(s))])); }
  // no declared test command: nobody can run the tests, so the APPROVE stands and the merge card says what the worker said
  { const { repo, base } = repoWith({}, { "src/a.ts": "export const a = 1;\n" }); const x = said(fakeX(repo, base, {}), NOT_GREEN); const T = await toolsOf(x);
    await T.fs_read.run({ path: "src/a.ts" }); const v = await verdict(T); const r: any = await (E as any).natives["review-depth"]({}, { x });
    ok(v.ok === true && v.notCovered.some((s: string) => /^not executed: the repository declares no test command; the worker said: ".*NOT verified green\."$/.test(s)) && r.verdict === "pass" && r.data.notes?.[0]?.startsWith("not executed: the repository declares no test command"),
      "no test command: an APPROVE over an unverified report stands, with 'not executed: no test command; the worker said …' on the merge card and in the ledger", JSON.stringify([v, r.data.notes])); await mode.end?.(x, "done"); }
  // a build round stopped at the time limit has no report, and is unverified
  { const { repo, base } = repoWith(gates, files); const x = fakeX(repo, base, { "reviewer.mode": "diff" }); x.ctx.rounds = [{ round: 2, head: "h", report: { marker: "TIMEOUT", summary: "stopped at the round time limit", round: 2 } }]; x.run.nodes.build = { data: { report: null } };
    const T = await toolsOf(x); await readAll(T); const a = await verdict(T);
    ok(/Your APPROVE is refused \(diff mode\): .*build round 2 stopped at the round time limit/.test(a.error ?? ""), "a TIMEOUT build round counts as unverified: no APPROVE without the covering tests", String(a.error).slice(0, 300)); await mode.end?.(x, "done"); }
  // no changed test file: only the whole declared command covers the change, not a file-scoped run of an old test
  { const { repo, base } = repoWith(gates, { "src/a.ts": "export const a = 2;\n" }, { "scripts/test-shard.ts": files["scripts/test-shard.ts"], "test/a.test.ts": files["test/a.test.ts"] });
    const x = said(fakeX(repo, base, {}), NOT_GREEN); x.ctx.head = sh(repo, "git", "rev-parse", "HEAD"); const T = await toolsOf(x); await T.fs_read.run({ path: "src/a.ts" });
    const one = await T.run_tests.run({ files: ["test/a.test.ts"] }); const early = await verdict(T);
    const all = await T.run_tests.run({}); const late = await verdict(T);
    ok(one.exit === 0 && /Your APPROVE is refused \(run mode\)/.test(early.error ?? "") && /run_tests with no files\)/.test(early.error ?? "") && all.exit === 0 && late.ok === true,
      "with no changed test file a file-scoped green run does not cover the change; the whole declared command does", JSON.stringify([one.exit, early.error?.slice(0, 200), all.exit, late])); await mode.end?.(x, "done"); } }
H.stop();
end();
