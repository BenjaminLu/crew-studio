import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// "Explain with" (docs/units/review-room.md, src/domain/review-explain.ts) on a real code-firstmate Task stopped at its merge
// card, with a scripted stub provider and temporary data: the picker lists the built-in tutor and the captain's library skills;
// a run is paid and needs the exact confirmation; generation is a background run of as many rounds as the skill needs (a round
// that ends before explain_done is followed by another, with its notes), with live progress, a Stop, a configurable safety limit
// and a stall guard; the materials are read-only files in the run's workspace; each generation and each follow-up that changes
// the output is a new version; a follow-up carries the boxed selection; a version's page is served only with its capability,
// under a CSP with no network, with Studio's storage shim and selection helper first; every run is on the ledger with its cost.
//        bun tests/review-room-explain.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("review-room-explain");
const root = join(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "crew-room-explain-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { OUTPUT_CSP, STORAGE_SHIM, EXPLAINER_FRAME, injected, kindOf } = await import("../src/domain/review-explain");
const { Projects } = await import("../src/doors");
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")
  .replace('- { id: reviewer, label: Reviewer, seat: reviewer, skill: "pack:firstmate/skills/reviewer.md" }', '- { id: reviewer, label: Reviewer, seat: reviewer, provider: tutor, model: t-1, skill: "pack:firstmate/skills/reviewer.md" }');
const H = await harness([def], { data, checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: data, projects: new Projects(data), reviewWeb: { search: async () => ({ configured: false }), fetch: async () => { throw new Error("no web in this test"); } } });
E.policies.setProject("sandbox", { install: false });

// ---------- a made-up Task to its merge card ----------
const intent = ["Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };
await E.answer((await waitCard("dispatch"))!.id, { choice: "dispatch", by: "captain" });
const merge = (await waitCard("merge"))!;
if (!merge) { console.log(E.get(r.id)!.status, E.get(r.id)!.error); throw new Error("the Task never reached its merge card"); }
await until(() => E.get(r.id)!.nodes[merge.node].waiting === "card", 10000);
const room = E.reviewRoom!, X = room.explain, id = merge.id;

// ---------- the captain's own skill, imported into Studio's library (a made-up one, with a supporting file) ----------
const sk = mkdtempSync(join(tmpdir(), "crew-skill-walkthrough-"));
writeFileSync(join(sk, "SKILL.md"), "---\nname: walkthrough\ndescription: An interactive one-page walkthrough of a change, with a figure per step.\n---\n# Walkthrough\n\nWrite index.html: one section per step, an SVG figure whose nodes carry data-node ids, and a language toggle kept in localStorage.\n");
mkdirSync(join(sk, "templates")); writeFileSync(join(sk, "templates", "page.html"), "<!-- the walkthrough's page skeleton -->\n");
E.skillLibrary().importFolder(sk, "captain");
const lib = E.skillLibrary().library().find((s: any) => s.id === "walkthrough" || s.name === "walkthrough")!;
ok(!!lib, "fixture: the skill is in Studio's library", JSON.stringify(E.skillLibrary().library().map((s: any) => s.id)));

// ---------- a scripted provider: each round runs the next script, through the real tool route ----------
const script: any[][] = [], prompts: { system: string; text: string; tools: string[] }[] = [], results: [string, any][] = [];
let release: (() => void) | null = null;
const scripted = (pid: string, model: string) => ({ id: pid, model, sandboxFree: true, start(system: string, tools: any[], ctx: any) {
  const me = { system, text: "", tools: tools.map((t) => t.name) }; prompts.push(me); let stop: (() => void) | null = null, stopped = false;
  return { interrupt() { stopped = true; stop?.(); }, async *send(text: string) { me.text = text;
    for (const [name, args] of script.shift() ?? []) {
      if (stopped) break;
      if (name === "msg") { yield { type: "delta", text: args } as any; yield { type: "message", text: args } as any; continue; }
      // a round that works until it is stopped (or its time runs out)
      if (name === "hang") { await new Promise<void>((res) => { stop = res; release = res; }); continue; }
      const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json(); results.push([name, j]);
      yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
    yield { type: "turnEnd", status: stopped ? "interrupted" : "ok", usage: { usd: 0.25, inTokens: 100, outTokens: 50 } } as any; } }; } });
const baseProvider = E.deps.provider; E.deps.provider = (pid?: string, model?: string) => pid === "tutor" ? scripted(pid, model ?? "") : baseProvider(pid, model);
const realFetch = globalThis.fetch, fetched: string[] = []; globalThis.fetch = (async (u: any, i: any) => { fetched.push(String(u?.url ?? u)); return realFetch(u, i); }) as any;
const refused = async (f: () => any) => { try { await f(); return null; } catch (e: any) { return e; } };
const waitRun = async (n: number, ms = 60000) => { await until(() => { const v = X.view(id); return v.running == null && v.runs.find((x: any) => x.n === n)?.status !== "running"; }, ms); return X.view(id).runs.find((x: any) => x.n === n); };

// ---------- the picker: the built-in tutor (selected: null) and the library's skills; picking costs nothing ----------
let v: any = X.view(id);
ok(v.selected === null && v.skills.some((s: any) => s.id === lib.id && s.name === "walkthrough" && /walkthrough of a change/.test(s.description)) && v.versions.length === 0 && v.runs.length === 0, "the picker: the tutor by default, and the captain's library skill listed", JSON.stringify(v.skills));
v = X.select(id, lib.id); ok(v.selected?.id === lib.id && v.runs.length === 0, "selecting a skill is free: nothing runs");
v = X.select(id, null); ok(v.selected === null, "the built-in tutor again (unchanged behaviour)");
let e: any = await refused(() => X.select(id, "no-such-skill")); ok(e?.code === "bad_skill", "a skill that is not in the library is refused", e?.message);

// ---------- a generation is paid: the confirmation names the model, the materials, the time and the isolation ----------
e = await refused(() => X.generate(id, { skill: lib.id }, "captain"));
const offer = e?.offer;
ok(e?.code === "confirm_required" && offer?.provider === "tutor" && offer.model === "t-1" && offer.skill?.id === lib.id && typeof offer.hash === "string" && offer.limitMin === 120 && offer.materials.en.includes("the diff") && /isolated frame/.test(offer.isolation.en) && /隔離框/.test(offer.isolation.zh) && /No round cap/.test(offer.rounds.en) && offer.expected === null,
  "a generation without the confirmation is refused, offering provider, model, skill, materials, the safety limit and the isolation note", JSON.stringify(offer));
ok(JSON.stringify(X.offer(id, lib.id, "generate")) === JSON.stringify(offer), "the page reads the same offer before it asks");
e = await refused(() => X.generate(id, { skill: lib.id, confirm: "0000000000000000" }, "captain")); ok(e?.code === "confirm_required", "a wrong confirmation is refused");

// round 1 reads the materials, reports progress, keeps notes and ends without explain_done; round 2 writes the page and finishes
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>percent, step by step</title></head><body>
<h1>How percent works</h1><h2>Step 1 · rounding</h2>
<svg width="400" height="120"><g data-node="round"><rect x="10" y="10" width="160" height="60"></rect><text x="20" y="45">Math.round</text></g></svg>
<p id="lang"></p><script>localStorage.setItem('walk-lang','en');document.getElementById('lang').textContent='lang='+localStorage.getItem('walk-lang');</script></body></html>`;
script.push([["explain_progress", { text: "reading the diff and the commits" }], ["mat_read", { path: "README.md" }], ["mat_read", { path: "diff.txt" }], ["mat_list", {}], ["skill_read", { path: "templates/page.html" }],
  ["mat_read", { path: "../../out/x.md" }], ["out_write", { path: ".notes.md", content: "todo: the figure" }], ["msg", "I read the change; the page comes next round."]]);
script.push([["explain_progress", { text: "drawing the rounding figure" }], ["out_read", { path: ".notes.md" }], ["out_write", { path: "index.html", content: PAGE }], ["out_write_base64", { path: "shot.exe", base64: "AAAA" }],
  ["explain_done", { entry: "missing.html", summary: "x" }], ["explain_done", { entry: "index.html", summary: "One page: what percent does, step by step" }], ["msg", "Done."]]);
v = await X.generate(id, { skill: lib.id, confirm: offer.hash }, "captain");
ok(v.running === 1 && v.selected?.id === lib.id && v.runs[0].status === "running", "confirmed: the run starts in the background and the room switches to the skill", JSON.stringify({ running: v.running, sel: v.selected }));
e = await refused(() => X.generate(id, { skill: lib.id, confirm: offer.hash }, "captain")); ok(e?.code === "busy", "one run at a time in a room", e?.code);
const run1 = await waitRun(1);
v = X.view(id);
ok(run1.status === "done" && run1.rounds.length === 2 && run1.version === 1 && v.versions.length === 1 && v.versions[0].entry === "index.html" && v.versions[0].kind === "html" && /step by step/.test(v.versions[0].summary),
  "the skill kept going for a second round and finished: v1 is kept", JSON.stringify({ status: run1.status, error: run1.error, rounds: run1.rounds, versions: v.versions }));
ok(run1.cost?.usd === 0.5 && run1.rounds.every((x: any) => x.cost?.usd === 0.25 && x.job), "the run's cost is every round's, each round a job of its own", JSON.stringify(run1.cost));
ok(run1.progress.map((p: any) => p.text).includes("reading the diff and the commits") && run1.progress.map((p: any) => p.text).includes("drawing the rounding figure"), "live progress: the skill's own lines");
const gen = prompts.slice(-2);
ok(gen[0].system.includes(EXPLAINER_FRAME.slice(0, 200)) && gen[0].system.includes("Write index.html: one section per step") && /^ROOM EXPLAIN\n/.test(gen[0].text) && /diff\.txt/.test(gen[0].text) && /templates\/page\.html/.test(gen[0].text),
  "round 1: Studio's frame and the captain's skill as the instructions, the materials and the skill's files named", gen[0].text.slice(0, 300));
ok(/ROOM EXPLAIN \(continued\)/.test(gen[1].text) && /Round 2/.test(gen[1].text) && /\.notes\.md/.test(gen[1].text) && /I read the change/.test(gen[1].text) && /reading the diff/.test(gen[1].text), "round 2 carries the notes, the files so far and the last message", gen[1].text);
ok(gen[0].tools.includes("mat_read") && gen[0].tools.includes("out_write") && gen[0].tools.includes("explain_done") && !gen[0].tools.some((t) => /^mat_(write|replace)$|^skill_(write|replace)$|web_|board_draw|git_/.test(t)), "materials and the skill's files are read-only; only the output folder is written; no web, no board", gen[0].tools.join(","));
const res = (name: string, i = 0) => results.filter(([n]) => n === name)[i]?.[1];
ok(/untrusted/.test(res("mat_read", 0)?.text ?? "") && /diff\.txt/.test(res("mat_read", 0)?.text ?? "") && /percent/.test(res("mat_read", 1)?.text ?? ""), "the materials: a README that says what is untrusted, and the real diff", JSON.stringify(res("mat_read", 1)).slice(0, 600));
ok(res("mat_list").some((f: any) => f.path === "head/src/percent.ts") && res("mat_list").some((f: any) => f.path === "commits.md") && res("mat_list").some((f: any) => f.path === "checks.md"), "the head of every changed file, the commits and the checks are there", JSON.stringify(res("mat_list").map((f: any) => f.path)));
ok(!!res("mat_read", 2)?.error && /not allowed/.test(res("mat_read", 2).error), "a path out of the materials is refused", JSON.stringify(res("mat_read", 2)));
ok(!!res("out_write_base64")?.error && !!res("explain_done", 0)?.error && res("explain_done", 1)?.ok, "a binary that is not a picture or a video, and an entry that is not there, are refused");
const vdir = join(E.rdir(r.id), "review-room", `${id}-explain`, "v1");
ok(existsSync(join(vdir, "index.html")) && !existsSync(join(vdir, ".notes.md")) && !existsSync(join(E.rdir(r.id), "review-room", `${id}-explain`, "work", "run-1")), "v1 is the output's files (working notes left out); the run's workspace is gone");
const led = E.trusted(r.id).entries.filter((x: any) => x.record === "review-room-explain");
ok(led.length === 1 && led[0].data.skill.id === lib.id && led[0].data.skill.sha256 === lib.sha256 && led[0].data.provider === "tutor" && led[0].data.model === "t-1" && led[0].data.cost.usd === 0.5 && led[0].data.rounds.length === 2 && led[0].data.version === 1 && led[0].data.confirm === offer.hash,
  "the ledger records the run: skill pin, model, confirmation, rounds, cost, version", JSON.stringify(led[0]?.data));
ok(!fetched.some((u) => !u.startsWith(H.toolUrl)), "nothing but Studio's own tool route was called (no GitHub, no network)", fetched.filter((u) => !u.startsWith(H.toolUrl)).join(","));
ok(X.offer(id, lib.id, "generate").expected?.minutes >= 1, "the next offer says how long this skill took");

// ---------- serving v1: only with its capability, under the output policy, Studio's scripts first ----------
const cap = X.cap(id, 1);
let page = X.page(cap.cap, id, "1", "index.html"), html = await page.text();
ok(page.status === 200 && page.headers.get("content-security-policy") === OUTPUT_CSP && /default-src 'none'/.test(OUTPUT_CSP) && /connect-src 'none'/.test(OUTPUT_CSP) && /^sandbox allow-scripts;/.test(OUTPUT_CSP) && !/allow-same-origin/.test(OUTPUT_CSP) && page.headers.get("x-content-type-options") === "nosniff",
  "a version's page carries the output CSP: no network, an opaque-origin sandbox", JSON.stringify(Object.fromEntries(page.headers)));
ok(html.indexOf(STORAGE_SHIM) > 0 && html.indexOf("crew-room-select") > 0 && html.indexOf(STORAGE_SHIM) < html.indexOf("<title>") && html.includes("data-node=\"round\""), "the storage shim and the selection helper come before anything of the page's own");
ok((await X.page("1.0", id, "1", "index.html").text()).includes("capability") && X.page("1.0", id, "1", "index.html").status === 401 && X.page(cap.cap, id, "2", "index.html").status === 404, "no capability (or another version's) serves nothing");
ok(X.page(cap.cap, id, "1", "../state.json").status !== 200 && X.page(cap.cap, id, "1", ".notes.md").status === 404, "nothing outside the version is served");
ok(injected("<p>x</p>").startsWith("<script data-crew-studio=\"storage\">") && kindOf("a.md") === "markdown" && kindOf("v.mp4") === "video" && kindOf("i.png") === "image", "a page without a head still gets the scripts first; kinds by entry");

// ---------- a follow-up: the boxed region goes with the question; an update is a new version ----------
e = await refused(() => X.ask(id, { question: "Why round here?" }, "captain")); const askOffer = e?.offer;
ok(e?.code === "confirm_required" && askOffer?.kind === "ask" && askOffer.materials.en[0].includes("current output"), "a follow-up is a paid run too: confirmed", JSON.stringify(askOffer));
script.push([["out_read", { path: "index.html" }], ["out_replace", { path: "index.html", old: "<h2>Step 1 · rounding</h2>", new: "<h2>Step 1 · rounding</h2><p data-node=\"half\">Halves round up: 2.5 becomes 3.</p>" }],
  ["explain_answer", { answer: "Rounding happens once, at the end, so the cents never drift.", cites: ["src/percent.ts:L3", "commit:abc1234"], updated: true, summary: "added a note on halves to step 1" }]]);
const sel = { rect: { x: 10, y: 40, w: 300, h: 90 }, text: "Math.round <script>x</script>", headings: ["How percent works", "Step 1 · rounding"], nodes: ["round"], title: "percent, step by step" };
v = await X.ask(id, { question: "Why round here?", selection: sel, version: 1, confirm: askOffer.hash, consent: true }, "captain");
const run2 = await waitRun(2);
ok(run2.status === "done" && run2.answer === "Rounding happens once, at the end, so the cents never drift." && run2.cites.join("|") === "src/percent.ts:L3|commit:abc1234" && run2.version === 2 && run2.from === 1, "the answer comes with its citations, and the change to the page is v2 (from v1)", JSON.stringify({ s: run2.status, e: run2.error, a: run2.answer, v: run2.version }));
const ask = prompts.at(-1)!;
ok(/^ROOM EXPLAIN ASK/.test(ask.text) && ask.text.includes("Why round here?") && ask.text.includes("Headings: How percent works › Step 1 · rounding") && ask.text.includes("Figure elements: round") && ask.text.includes("Math.round") && /current output \(v1/.test(ask.text) && ask.tools.includes("explain_answer") && !ask.tools.includes("explain_done"),
  "the follow-up's prompt: the question, what lies in the boxed region (headings, figure ids, text), the current version", ask.text);
v = X.view(id);
ok(v.versions.length === 2 && v.versions[1].from === 1 && /halves/.test(v.versions[1].summary) && readFileSync(join(E.rdir(r.id), "review-room", `${id}-explain`, "v2", "index.html"), "utf8").includes("data-node=\"half\"") && !readFileSync(join(vdir, "index.html"), "utf8").includes("half"), "v2 is kept beside v1, which is unchanged");
ok(v.consent?.plan === askOffer.hash, "the captain agreed to ask the next follow-ups on this plan without confirming each");
// with that agreement, a follow-up starts without the confirmation; it does not change the page: no new version
script.push([["explain_answer", { answer: "No: the test pins 300.", cites: ["test/percent.test.ts:L2"], updated: false }]]);
v = await X.ask(id, { question: "Is there a test?", version: 2 }, "captain");
const run3 = await waitRun(3);
ok(run3.status === "done" && run3.auto === true && run3.version === null && X.view(id).versions.length === 2, "an agreed follow-up runs unconfirmed; an answer that changes nothing makes no version", JSON.stringify(run3));

// ---------- Stop: the round that runs is cancelled; a stopped generation keeps no version ----------
script.push([["explain_progress", { text: "working" }], ["hang", null]]);
v = await X.generate(id, { skill: lib.id, confirm: X.offer(id, lib.id, "generate").hash }, "captain");
await until(() => !!X.view(id).runs.at(-1).rounds[0]?.job && X.view(id).log.length > 0, 10000);
e = await refused(() => room.start(id, { action: "how", confirm: (room.view(id) as any).offer.hash }, "captain"));
ok(e?.code === "busy", "while the skill works, the tutor takes no turn in this room", e?.message);
ok(X.view(id).log.some((l: any) => /explain_progress/.test(l.text)), "the live log shows the round's tool calls", JSON.stringify(X.view(id).log));
X.stop(id);
const run4 = await waitRun(4, 20000);
ok(run4.status === "stopped" && /captain/.test(run4.stop) && run4.version === null && X.view(id).versions.length === 2 && X.view(id).running === null, "Stop ends the run at once; nothing half-made becomes a version", JSON.stringify(run4));

// ---------- the stall guard and the safety limit ----------
script.push([["msg", "thinking"]], [["msg", "still thinking"]]);
await X.generate(id, { skill: lib.id, confirm: X.offer(id, lib.id, "generate").hash }, "captain");
const run5 = await waitRun(5);
ok(run5.status === "failed" && /did nothing/.test(run5.error) && run5.rounds.length === 2, "two rounds in a row that do nothing stop the run (never an endless paid loop)", JSON.stringify(run5));
e = await refused(() => X.setSettings({ limitMin: 0 })); ok(e?.code === "bad_request", "the safety limit is a number of minutes, at least one");
ok(X.setSettings({ limitMin: 45 }).limitMin === 45 && X.offer(id, lib.id, "generate").limitMin === 45, "the safety limit is the captain's setting, and the offer names it");
// a fraction of a minute through the environment (tests only): the round that hangs is stopped by the limit
writeFileSync(join(data, "review-room-explain.json"), "{}"); process.env.CREW_REVIEW_EXPLAIN_LIMIT_MIN = "0.02";
script.push([["hang", null]]);
await X.generate(id, { skill: lib.id, confirm: X.offer(id, lib.id, "generate").hash }, "captain");
const run6 = await waitRun(6, 30000);
ok(run6.status === "stopped" && /safety limit/.test(run6.stop), "the wall-clock safety limit stops a run that is still going", JSON.stringify(run6));
delete process.env.CREW_REVIEW_EXPLAIN_LIMIT_MIN; release?.();

ok(E.trusted(r.id).entries.filter((x: any) => x.record === "review-room-explain").length === 6, "every run is on the ledger");
globalThis.fetch = realFetch; H.stop();
end();
