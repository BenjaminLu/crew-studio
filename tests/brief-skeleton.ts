import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The brief skeleton and the operating manual (retro 2026-10-17, findings 1 and 2): every agent brief ends with the
// same six sections, BRIEFING, ENVIRONMENT, TOOLS, TESTS, DEPENDENCIES, DELIVERABLE, each filled with the round's facts
// (graph, environment preflight: test and lint command, dependency state, browser and renderer availability, run
// budget) and the manual page it names, with no absolute operator path. Checked on the real modes with stub
// providers: code-firstmate's spec, build, root cause and review rounds, and the deliver producers of documents,
// web-prototype and video. The manual is bundled, the procedure moved out of the build and deliver system prompts,
// and Firstmate reads it with studio_manual.
//   bun tests/brief-skeleton.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("brief-skeleton");
const root = join(import.meta.dir, "..");
const SECTIONS = ["BRIEFING", "ENVIRONMENT", "TOOLS", "TESTS", "DEPENDENCIES", "DELIVERABLE"];
/** The section bodies of a brief's skeleton (null when the skeleton is missing). */
const sectionsOf = (t: string): Record<string, string> | null => {
  const at = t.indexOf("BRIEF SECTIONS"); if (at < 0) return null;
  const out: Record<string, string> = {}; const body = t.slice(at);
  SECTIONS.forEach((k, i) => { const s = body.indexOf(`\n## ${k}\n`); const e = i + 1 < SECTIONS.length ? body.indexOf(`\n## ${SECTIONS[i + 1]}\n`) : body.length; if (s >= 0 && e > s) out[k] = body.slice(s + k.length + 5, e).trim(); });
  return out;
};
const filled = (t: string) => { const s = sectionsOf(t); return !!s && SECTIONS.every((k) => (s[k] ?? "").split("\n").some((l) => /^- \S/.test(l)) && /\(Manual: [a-z0-9/-]+ § /.test(s[k] ?? "")); };
const PRIVATE = /\/(?:Users|home)\/[^/\s]+|\/private\/|\/var\/folders\//;

// ---------- 1. the manual: bundled, one page per shipped workflow and role, the six headings on each ----------
const { manualIds, manualSection, manualFor, studioManual } = await import("../src/manual");
const ids = manualIds();
const expected = ["index", "studio/firstmate", "studio/agents", "studio/deliver", "code-firstmate/coordinator", "code-firstmate/worker", "code-firstmate/reviewer", "code-firstmate/designer", "code-firstmate/github",
  "hello-crew-studio/overview", "web-prototype/designer", "file-organization/overview", "video/editor", "images/overview", "documents/writer"];
ok(expected.every((i) => ids.includes(i)), "the manual has a page per shipped workflow and role (code-firstmate local and GitHub, hello, web, file-organization, video, images, documents)", JSON.stringify(ids));
const pages = ids.filter((i) => i !== "index");
ok(pages.every((p) => ["Briefing", "Environment", "Tools", "Tests", "Dependencies", "Deliverable"].every((h) => manualSection(p, h))), "every page has the six sections, each with text", pages.filter((p) => !manualSection(p, "Tests")).join(","));
ok(/DUR/.test(manualSection("video/editor", "Renderer contract") ?? "") && /#stage/.test(manualSection("video/editor", "Renderer contract") ?? "") && /render\(t\)/.test(manualSection("video/editor", "Renderer contract") ?? "") && /960x540/.test(manualSection("video/editor", "Renderer contract") ?? ""),
  "the film renderer contract (#stage, DUR, render(t), 960x540) lives in the manual");
const worker = (manualSection("code-firstmate/worker", "Tests") ?? "") + (manualSection("code-firstmate/worker", "Dependencies") ?? "") + (manualSection("code-firstmate/worker", "Tools") ?? "");
ok(/PLAYWRIGHT_MODULE/.test(worker) && /CREW_TEST_OUTPUT_DIR/.test(worker) && /keep one for the final check/.test(worker) && /60 read or search calls/.test(worker) && /npm-test/.test(worker), "the build procedure (run budget, selection, PLAYWRIGHT_MODULE, read caps) lives in the manual");
{ const gen = readFileSync(join(root, "src/bundled.gen.ts"), "utf8"), build = readFileSync(join(root, "scripts/gen-assets.ts"), "utf8");
  ok(/"manual"/.test(build) && ids.every((i) => gen.includes(`"manual/${i}.md"`)), "the manual is embedded in the binary like the skills (scripts/gen-assets.ts, src/bundled.gen.ts)"); }
{ const code = readFileSync(join(root, "src/domain/code.ts"), "utf8"), deliver = readFileSync(join(root, "src/domain/deliver.ts"), "utf8");
  ok(!/Tests can import the host browser library through PLAYWRIGHT_MODULE/.test(code) && !/Use at most 60 read\/search calls/.test(code) && /operating manual, code-firstmate\/worker/.test(code), "the build system prompt points to the manual instead of carrying the procedure");
  ok(!/#stage must be a fixed 960x540/.test(deliver) && /operating manual, video\/editor/.test(deliver), "the deliver system prompt points to the manual instead of carrying the film contract"); }
ok(manualFor("code-firstmate", "worker") === "code-firstmate/worker" && manualFor("images", null) === "images/overview" && manualFor("my-own-flow", "writer", "studio/deliver") === "studio/deliver", "a step's page: <workflow>/<role>, else <workflow>/overview, else the fallback");
{ const idx: any = studioManual(), page: any = studioManual("code-firstmate/worker"), bad: any = studioManual("../secrets");
  ok(idx.section === "index" && /operating manual/i.test(idx.text) && idx.sections.includes("video/editor") && page.section === "code-firstmate/worker" && /run_tests/.test(page.text) && bad.error && !bad.text, "studio_manual: the index without a section, a page by id, an error (with the ids) for anything else"); }

// ---------- 2. Firstmate's tool and seed ----------
{ const { installFirstmate } = await import("../src/firstmate"); const { Projects } = await import("../src/doors");
  const h = await harness([]); const tools = installFirstmate(h.engine, new Projects(h.data)); const owner = { key: "manual", captain: true, text: "how does the worker test?", live: () => true };
  const spec = tools.specs.find((t: any) => t.name === "studio_manual");
  const idx: any = await tools.call("studio_manual", {}, owner as any), page: any = await tools.call("studio_manual", { section: "video/editor" }, owner as any);
  let refused = false; try { await tools.call("studio_manual", { section: "index", write: "x" }, owner as any); } catch { refused = true; }
  ok(!!spec && idx.section === "index" && page.section === "video/editor" && /#stage/.test(page.text) && refused, "Firstmate's studio_manual(section?) reads the index or a page, and takes no other argument");
  const { nativeFreshText } = await import("../src/host/main"); const seed = nativeFreshText("workspace");
  ok(/studio_manual/.test(seed) && /before you brief an agent or answer an agent's question/.test(seed), "Firstmate's seed tells it to consult the manual when briefing or answering an agent question");
  h.stop(); }

// ---------- 3. the skeleton itself: no operator path, a placeholder for the dependency root ----------
{ const { composeSkeleton } = await import("../src/runtime/brief-skeleton");
  const depRoot = checkedTempDir("crew-dep-root-"); const before = { u: process.env.CREW_LOCAL_UNRESTRICTED, d: process.env.CREW_LOCAL_DEPENDENCY_ROOT };
  process.env.CREW_LOCAL_UNRESTRICTED = "1"; process.env.CREW_LOCAL_DEPENDENCY_ROOT = depRoot;
  const def: any = { id: "code-firstmate", name: "code-firstmate", version: 1, roles: [], nodes: [{ id: "build", kind: "agent", label: "Build", role: "worker", mode: "build", x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [{ from: "build", to: "done" }] };
  const t = composeSkeleton({ def, node: def.nodes[0], visit: 1, modeName: "build", tools: ["fs_read", "run_tests"], maxTools: 180, timeoutS: 1500, facts: { DEPENDENCIES: [`Browser module at ${depRoot}/node_modules/playwright`] }, dataDir: depRoot });
  if (before.u === undefined) delete process.env.CREW_LOCAL_UNRESTRICTED; else process.env.CREW_LOCAL_UNRESTRICTED = before.u;
  if (before.d === undefined) delete process.env.CREW_LOCAL_DEPENDENCY_ROOT; else process.env.CREW_LOCAL_DEPENDENCY_ROOT = before.d;
  ok(filled(t) && !t.includes(depRoot) && /\$CREW_LOCAL_DEPENDENCY_ROOT\/node_modules\/playwright/.test(t) && /Local unrestricted mode/.test(t) && !PRIVATE.test(t), "the skeleton shows the dependency root as $CREW_LOCAL_DEPENDENCY_ROOT, never the operator's absolute path", t.slice(0, 600)); }

// ---------- 4. code-firstmate with the stub provider: spec, build, root cause and review briefs ----------
{ const data = checkedTempDir("crew-brief-skeleton-");
  const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo"); prepareSandbox(data); registerSandbox(data);
  const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
  const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data, checkRoots: [] }); const E = H.engine;
  installCode(E, { dataDir: data, projects: new Projects(data) });
  const intent = ["Add a percent function to money-kit",
    "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100); \\n}\\n",
    'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent.ts"); expect(percent(1999, 15)).toBe(300); });\\n',
    "STUB_FIX src/percent.ts :: / 100);  => / 100);"].join("\n");
  const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
  const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };
  const dispatch = await waitCard("dispatch"); E.policies.setProject("sandbox", { install: false });
  if (dispatch) await E.answer(dispatch.id, { choice: "dispatch", by: "captain" });
  const merge = await waitCard("merge");
  ok(!!merge, "the stub run reaches the merge card", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
  const nodes = join(data, "runs", r.id, "nodes"); const briefs: Record<string, string> = {};
  for (const n of existsSync(nodes) ? readdirSync(nodes) : []) for (const v of readdirSync(join(nodes, n))) { const f = join(nodes, n, v, "prompt.md"); if (existsSync(f)) briefs[`${n}/${v}`] = readFileSync(f, "utf8"); }
  const mode = (k: string) => k.split("/")[0];
  for (const want of ["spec", "build", "review"]) ok(Object.keys(briefs).some((k) => mode(k) === want), `a ${want} round left its prompt.md`, Object.keys(briefs).join(","));
  const bad = Object.entries(briefs).filter(([, t]) => !filled(t)).map(([k]) => k);
  ok(Object.keys(briefs).length >= 3 && !bad.length, "every agent brief of the run (spec, build, root cause, review) has the six sections, each filled and naming its manual page", bad.join(",") + " " + (briefs[bad[0]] ?? "").slice(-1500));
  const build = sectionsOf(briefs["build/1"] ?? "") ?? {};
  ok(/Test command: bun scripts\/test-shard\.ts \(from \.crew\/gates\.json/.test(build.TESTS ?? "") && /Lint command: bun scripts\/lint\.ts/.test(build.TESTS ?? "") && /run_tests budget: 10 executed runs/.test(build.TESTS ?? "") && /Manual: code-firstmate\/worker § Tests/.test(build.TESTS ?? ""),
    "build: TESTS names the test command and lint command from the base, the run budget and the manual page", build.TESTS);
  ok(/Dependency install: /.test(build.DEPENDENCIES ?? "") && /Host browser library: /.test(build.DEPENDENCIES ?? "") && /Environment preflight: |Open preflight gaps: /.test(build.DEPENDENCIES ?? ""), "build: DEPENDENCIES names the install, the browser library and the preflight state", build.DEPENDENCIES);
  ok(/worker_report/.test(build.DELIVERABLE ?? "") && /run_tests/.test(build.TOOLS ?? "") && /Fix \(refine loop\)|fix/.test(build.BRIEFING ?? "") && /role worker/.test(build.BRIEFING ?? ""), "build: BRIEFING from the graph (role, what follows), TOOLS from the mode, DELIVERABLE the report", `${build.BRIEFING}\n${build.DELIVERABLE}`);
  const review = sectionsOf(Object.entries(briefs).find(([k]) => mode(k) === "review")?.[1] ?? "") ?? {};
  ok(/Review mode: (diff|run)/.test(review.TESTS ?? "") && /review_verdict/.test(review.DELIVERABLE ?? "") && /code-firstmate\/reviewer/.test(review.TESTS ?? ""), "review: TESTS names the review mode and read budget, DELIVERABLE the verdict", review.TESTS);
  const spec = sectionsOf(briefs["spec/1"] ?? "") ?? {};
  ok(/spec_write/.test(spec.DELIVERABLE ?? "") && /Test globs: /.test(spec.TESTS ?? "") && /code-firstmate\/coordinator/.test(spec.BRIEFING ?? ""), "spec: DELIVERABLE spec_write, TESTS the test globs, the coordinator page", spec.TESTS);
  const leaks = Object.entries(briefs).filter(([, t]) => t.includes(data) || PRIVATE.test(t.slice(t.indexOf("\n---\n")))).map(([k]) => k);
  ok(!leaks.length, "no brief carries an absolute path of the operator's data or home folder (the spec names the project, not its path)", leaks.join(","));
  H.stop(); }

// ---------- 5. deliver producers: documents, web-prototype, video ----------
{ const { ArtifactStore } = await import("../src/artifacts"); const { installDeliver } = await import("../src/domain/deliver"); const { bundledText } = await import("../src/bundled");
  const H = await harness(["documents", "web-prototype", "video"].map((w) => bundledText(`workflows/v2/${w}.wf.yaml`)!)); const E = H.engine; const store = new ArtifactStore(H.data);
  installDeliver(E, { dataDir: H.data, artifacts: store, lane: {}, fileorg: {}, docs: {} } as any);
  const seen: { text: string; system: string }[] = [];
  E.deps.provider = () => ({ id: "fixture", model: "offline", sandboxFree: true, start(system: string, _tools: any[], ctx: any) { return { interrupt() {}, async *send(text: string) {
    seen.push({ text, system }); const fmt = /DELIVER (\w+)/.exec(text)?.[1], file = fmt === "video" ? "film.html" : fmt === "web" ? "index.html" : "doc.md";
    const content = file === "doc.md" ? "# Fixture\n\nA short fixture document body." : file === "film.html" ? '<!doctype html><div id="stage" style="width:960px;height:540px"></div><script>const DUR=1;function build(){}function schedule(){}function render(t){}</script>' : "<!doctype html><main><h1>Fixture</h1></main>";
    await H.agents.callTool(ctx.token, "work_write", { path: file, content }); yield { type: "turnEnd", status: "ok" }; } }; } }) as any;
  for (const [wf, fmt] of [["documents", "document"], ["web-prototype", "web"], ["video", "video"]] as const) {
    const before = seen.length; const run = E.start({ workflow: wf, params: {}, text: `Fixture ${wf}` });
    await until(() => seen.slice(before).some((s) => s.text.startsWith(`DELIVER ${fmt}`)), 30000);
    const got = seen.slice(before).find((s) => s.text.startsWith(`DELIVER ${fmt}`));
    const s = got ? sectionsOf(got.text) : null;
    ok(!!got && filled(got.text) && /Node: [a-z-]+ — /.test(got.text) && new RegExp(`\\(Manual: ${wf === "documents" ? "documents/writer" : wf === "video" ? "video/editor" : "web-prototype/designer"} § Deliverable\\)`).test(s?.DELIVERABLE ?? "")
      && /core\/artifact-ready/.test(s?.TESTS ?? "") && /role (writer|designer|editor) · mode deliver/.test(s?.BRIEFING ?? ""), `${wf}: the deliver brief has the six sections, its manual page, and the readiness check it faces`, (got?.text ?? "(no round)").slice(-1200));
    if (wf === "video") ok(/Renderer contract:/.test(s?.DELIVERABLE ?? "") && /#stage/.test(s?.DELIVERABLE ?? "") && /Film renderer \(runs after you, in Studio\): Node (installed|missing), Playwright (installed|missing), ffmpeg (installed|missing)/.test(s?.DEPENDENCIES ?? "") && /operating manual, video\/editor/.test(got?.system ?? ""),
      "video: DELIVERABLE carries the renderer contract from the manual, DEPENDENCIES the renderer's availability, the system prompt only a pointer", s?.DEPENDENCIES);
    await E.cancel(run.id); }
  H.stop(); }
end();
