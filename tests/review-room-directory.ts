import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A directory room (docs/units/review-room.md, "A directory of any GitHub repository"): a GitHub directory's address (any
// repository: a public one as it is, a private one through the captain's gh login) opens a room on that directory, its ref
// resolved once and pinned at its commit, its objects in Studio's own cache. Its lesson explains the directory's parts and how
// they compose; every follow-up of a pull request's room works there (questions on the board, words selected, regenerate, the
// check, the Library, starting over); what only a pull request has (a diff, a merge check, reviewers, new commits) is not
// there. Its turns run on a host Task Studio makes on the first paid turn, with no project and no crew: the tutor the captain
// picked (or Studio's Automatic pick), its receipt for that member. A local bare repository stands in for GitHub; a scripted
// stub tutor; temporary data only.        bun tests/review-room-directory.ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite } from "./rt-harness";
const { ok, end } = suite("review-room-directory");
const { bundledText } = await import("../src/bundled");
const { installStaffingGuard, StaffingStore } = await import("../src/domain/staffing");
const { installReviewRoom, parseDirUrl, dirRoomId } = await import("../src/domain/review-room");
const { must, setGitHome } = await import("../src/git");

/** a stub tutor that calls the room's tools as scripted, then says its answer */
const TOOLRES: [string, any][] = [];
function scriptedTutor(script: any[][], prompts: { text: string }[]) {
  return (id: string, model: string) => ({ id, model, sandboxFree: true, start(_system: string, _tools: any[], ctx: any) {
    const me = { text: "" }; prompts.push(me);
    return { interrupt() {}, async *send(text: string) { me.text = text;
      for (const [name, args] of script.shift() ?? []) {
        if (name === "say") { yield { type: "delta", text: args } as any; continue; }
        const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json(); TOOLRES.push([name, j]);
        yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
      yield { type: "turnEnd", status: "ok", usage: { usd: 0.01, inTokens: 1, outTokens: 1 } } as any; } }; } });
}
const refused = async (f: () => any) => { try { await f(); return null; } catch (e: any) { return e; } };

// ---------- "GitHub": a bare repository with a default branch, a branch whose name holds a slash, a tag ----------
const tmp = checkedTempDir("crew-room-dir-"); setGitHome(join(tmp, "git-home"));
const bare = join(tmp, "kit.git"), work = join(tmp, "work"); mkdirSync(work); for (const d of [bare, work]) assertTempRepo(d);
const id = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
must(tmp, ["init", "-q", "--bare", bare]); must(work, ["init", "-qb", "main"]);
const put = (path: string, text: string) => { mkdirSync(join(work, path, ".."), { recursive: true }); writeFileSync(join(work, path), text); };
put("README.md", "# kit\nA small kit.\n"); put("src/README.md", "# src\nThe kit's code: core does the sums, api serves them.\n");
put("src/core/sum.ts", "export function sum(a: number, b: number) {\n  return a + b;\n}\n"); put("src/core/round.ts", "export const round = (x: number) => Math.round(x);\nexport function calculateInvoiceReserve(total: number) { return round(total * 0.05); }\n");
put("src/工具/說明.md", "工具的說明。\n"); // a name git would quote in its listing
put("src/api/server.ts", "import { sum } from \"../core/sum\";\nexport function handle(q: { a: number; b: number }) {\n  return { total: sum(q.a, q.b) };\n}\n"); put("docs/guide.md", "Read src first.\nexport function migrateLedgerSnapshots() {}\n");
must(work, ["add", "-A"]); must(work, [...id, "commit", "-qm", "kit"]); const V1 = must(work, ["rev-parse", "HEAD"]);
must(work, ["tag", "v1"]); must(work, ["branch", "feature/x"]); must(work, ["push", "-q", bare, "main", "feature/x", "v1"]);
const H = await harness([bundledText("workflows/v2/review-room-dir-host.wf.yaml")!]), E = H.engine;
installStaffingGuard(E, new StaffingStore(H.data), (pid: string) => ({ namespace: "git" as const, id: pid, identity: `dir-${pid}` }));
let tokenAsked = 0, token: string | null = null;
const room = installReviewRoom(E, { dataDir: H.data, dirRemote: (repo: string) => repo === "acme/kit" ? `file://${bare}` : `file://${join(tmp, "missing", repo.replace("/", "-"))}.git`, ghToken: () => { tokenAsked++; return token; },
  web: { search: async () => ({ configured: false }), fetch: async () => { throw new Error("no web in this test"); } } });
const script: any[][] = [], prompts: { text: string }[] = [], selects: any[] = [], tutor = scriptedTutor(script, prompts), runArgs: any[] = [];
E.deps.selectProvider = async (x: any, p: any, c: any) => { selects.push({ run: x.run.id, node: x.node.id, role: c?.role, adaptive: !!c?.adaptive, pick: p }); return { ...tutor(p.provider, p.model), reasoningEffort: p.effort ?? null } as any; };
const baseRun = E.deps.agents.run.bind(E.deps.agents); E.deps.agents.run = (o: any) => { if (o.kind === "review-room") runArgs.push(o); return baseRun(o); };
(E.deps as any).usableModels = () => [{ provider: "codex", model: "c-1", efforts: ["medium"], verified: true, runnable: true, isDefault: true }, { provider: "claude", model: "x-1", efforts: [], verified: true, runnable: true }];
room.setSettings({ autoTeach: false }); // a paste or an arrival starting the lesson is tested on its own, below
const fetched: string[] = [], realFetch = globalThis.fetch; globalThis.fetch = (async (x: any, i: any) => { fetched.push(String(x?.url ?? x)); return realFetch(x, i); }) as any;

try {
  // ---------- the address ----------
  const good = ["https://github.com/acme/kit", "https://github.com/acme/kit/", "https://github.com/acme/kit/tree/main", "https://github.com/acme/kit/tree/feature/x/src/core", "https://github.com/acme/kit/tree/main/src%20x"];
  const bad = ["http://github.com/acme/kit", "https://gitlab.com/acme/kit", "https://github.com/acme/kit/blob/main/README.md", "https://github.com/acme/kit/tree/main?x=1", "https://github.com/acme/kit/tree/main/../x", "https://github.com/acme/kit/pull/1", "https://github.com.evil.example/acme/kit", "javascript:alert(1)", "https://github.com/acme/kit.git", ""];
  ok(good.every((u) => !!parseDirUrl(u)) && bad.every((u) => !parseDirUrl(u)) && JSON.stringify(parseDirUrl(good[3])?.rest) === '["feature","x","src","core"]',
    "a directory's address is a GitHub repository's page or …/tree/<ref>/<path>: no other host, scheme, file (/blob/), query, pull request or ../", JSON.stringify(bad.filter((u) => parseDirUrl(u))));
  const codes = await Promise.all(["https://github.com/acme/kit/blob/main/README.md", "https://example.com/x"].map(async (u) => (await refused(() => room.openDir(u)))?.code));
  ok(codes.every((c) => c === "bad_url"), "anything else is refused before anything is read", JSON.stringify(codes));

  // ---------- any repository: a public one read as it is; one Studio cannot read asks the captain's gh login, then says why ----------
  const before: any = room.pasteOffer("https://github.com/acme/kit/tree/feature/x/src");
  ok(before.createsHost === true && before.provider === "codex" && before.model === "c-1" && typeof before.plan === "string" && before.auto === false,
    "before the paste, the box says what a directory's paste starts: its host Task, one paid round on the tutor (Automatic: this machine's default model)", JSON.stringify(before));
  const opened: any = await room.openDir("https://github.com/acme/kit/tree/feature/x/src", "captain"), v: any = room.view(opened.id, true);
  ok(opened.id === dirRoomId("acme/kit", "feature/x", "src") && v.subject.kind === "dir" && v.dir.ref === "feature/x" && v.dir.refKind === "branch" && v.dir.path === "src" && v.dir.sha === V1 && v.dir.private === false && tokenAsked === 0,
    "a public repository's directory opens without any login: the branch named in the address (its name may hold a slash) told apart from the path, pinned at its commit", JSON.stringify({ id: opened.id, dir: v.dir }));
  ok(JSON.stringify(v.dir.parts.map((p: any) => [p.name, p.kind, p.files])) === JSON.stringify([["core", "dir", 2], ["README.md", "file", 1], ["api", "dir", 1], ["工具", "dir", 1]]) && v.dir.files === 5 && v.dir.readme === true,
    "the room knows the directory's parts (each folder and file under it, with how many files) and its README", JSON.stringify(v.dir.parts));
  const cache = join(H.data, "review-room", "cache"), caches = readdirSync(cache);
  ok(caches.length === 1 && /^dir-[0-9a-f]{16}\.git$/.test(caches[0]) && must(join(cache, caches[0]), ["rev-parse", "--is-bare-repository"]) === "true" && existsSync(join(H.data, "review-room", "dir", `${opened.id}.json`)),
    "its commits are in a bare repository under Studio's data folder; the room is a file of its own", JSON.stringify(caches));
  ok(v.prState === null && v.diffstat === null && v.moved === null && !v.actions.some((a: any) => a.id === "merge-check" || a.id === "reviews") && ["how", "why", "teach", "quiz"].every((x) => v.actions.some((a: any) => a.id === x)) && /Directory acme\/kit\/src @ feature\/x/.test(v.card.title.en),
    "what only a pull request has is not there (its state, a diff, new commits, the merge check, the reviewers' digest); how, why, teach and the check are", JSON.stringify({ actions: v.actions.map((a: any) => a.id), title: v.card.title }));
  const tag: any = await room.openDir("https://github.com/acme/kit/tree/v1"), root: any = await room.openDir("https://github.com/acme/kit"), commit: any = await room.openDir(`https://github.com/acme/kit/tree/${V1}/docs`);
  const tv: any = room.view(tag.id), rv: any = room.view(root.id), cv: any = room.view(commit.id);
  ok(tv.dir.refKind === "tag" && tv.dir.sha === V1 && rv.dir.refKind === "default" && rv.dir.ref === "main" && rv.dir.path === "" && cv.dir.refKind === "commit" && cv.dir.path === "docs",
    "a tag, the repository's own page (its default branch) and a commit's full id each resolve and pin", JSON.stringify([tv.dir.refKind, rv.dir.ref, cv.dir.refKind]));
  const notDir = await refused(() => room.openDir("https://github.com/acme/kit/tree/main/README.md")), noRef = await refused(() => room.openDir("https://github.com/acme/kit/tree/nope/src"));
  ok(notDir?.code === "not_a_directory" && noRef?.code === "bad_ref" && /no branch or tag/.test(noRef.message), "a file is not a directory, and a ref the repository does not have is refused, saying why", JSON.stringify([notDir?.message, noRef?.message]));
  const priv = await refused(() => room.openDir("https://github.com/acme/secret/tree/main/src"));
  ok(priv?.code === "no_access" && tokenAsked === 1 && /no GitHub login/.test(priv.message), "a repository Studio cannot read anonymously asks the captain's gh login; with none there it says so", priv?.message);
  token = "ghp_testtoken_0123456789abcdefABCDEF"; const priv2 = await refused(() => room.openDir("https://github.com/acme/secret/tree/main/src"));
  ok(priv2?.code === "no_access" && tokenAsked === 2 && /your GitHub login \(gh\) cannot read it either/.test(priv2.message) && !priv2.message.includes(token), "with a login that cannot read it either, it says so (the token never in the message)", priv2?.message);
  // pinned: the branch moves on, the room does not
  put("src/core/sum.ts", "export function sum(a: number, b: number) {\n  return b + a;\n}\n"); must(work, [...id, "commit", "-qam", "swap"]); must(work, ["push", "-q", bare, "main:feature/x"]);
  const again: any = await room.openDir("https://github.com/acme/kit/tree/feature/x/src");
  ok(again.id === opened.id && (room.view(opened.id) as any).dir.sha === V1, "pasted again after its branch moved, the room stays pinned at its commit: its citations stay stable", (room.view(opened.id) as any).dir.sha);

  // ---------- a turn: confirmed, on a host Task Studio makes once, the tutor the captain confirmed; read-only; cited to GitHub's commit ----------
  const offer = v.offer; let e: any = await refused(() => room.start(opened.id, { action: "how" }, "captain"));
  ok(offer?.provider === "codex" && offer.model === "c-1" && offer.independence?.level === null && /independence does not apply/.test(offer.independence.en) && e?.code === "confirm_required" && !E.list().some((r: any) => r.def.kind === "review-room-dir-host"),
    "a directory's turn is paid and asks to confirm first; nothing is made before (Automatic: this machine's default model, no author to be independent from)", JSON.stringify([offer, e?.code]));
  script.push([["web_search", { query: "calculate invoice reserve rounding" }], ["web_search", { query: "migrate ledger snapshots tips" }], ["fs_read", { path: "src/core/sum.ts" }], ["git_diff", {}], ["board_draw", { items: [{ type: "diff", title: "x", path: "src/core/sum.ts" }, { type: "code", title: "The sum", path: "src/core/sum.ts", start: 1, end: 3 }] }],
    ["say", "The api serves core's sum [diff:src/api/server.ts:L1-3]; sum adds [diff:src/core/sum.ts:L2]."]]);
  await room.start(opened.id, { action: "how", confirm: offer.hash }, "captain"); await room.settle(opened.id);
  const v1: any = room.view(opened.id), t1 = v1.turns.at(-1), hosts = E.list().filter((r: any) => r.def.kind === "review-room-dir-host"), r0 = TOOLRES.slice(-3), web0 = TOOLRES.slice(-5)[0], web1 = TOOLRES.slice(-4)[0];
  ok(web1?.[0] === "web_search" && /refused/.test(web1[1]?.error ?? ""), "it knows the rest of the repository too (the tutor can read it): an identifier of a file outside the directory is refused", JSON.stringify(web1?.[1]));
  ok(web0?.[0] === "web_search" && /refused/.test(web0[1]?.error ?? "") && v1.sources.some((x: any) => x.refused), "the web filter knows the directory's own code: a query spelling an identifier of it is refused (there is no diff to learn it from)", JSON.stringify(web0?.[1]));
  ok(/工具/.test(prompts.at(-1)?.text ?? "") && !/\\345/.test(prompts.at(-1)?.text ?? ""), "a name git would quote (Chinese) is listed as it is, in the parts and in the tutor's listing", JSON.stringify(v.dir.parts.map((p: any) => p.name)));
  ok(t1.status === "done" && t1.claims.every((c: any) => c.basis === "cited") && hosts.length === 1 && v1.task?.id === hosts[0].id && hosts[0].params.room === opened.id,
    "confirmed, the first turn makes the directory's host Task (once) and answers from the pinned commit, every claim cited", JSON.stringify({ t: [t1.status, t1.error], claims: t1.claims?.map((c: any) => c.basis), hosts: hosts.length }));
  ok(/return a \+ b;/.test(r0[0][1]?.text ?? "") && /no diff/.test(r0[1][1]?.error ?? "") && /no diff/.test(r0[2][1]?.errors?.[0] ?? "") && r0[2][1]?.added?.length === 1 && v1.board.some((b: any) => b.type === "code" && b.commit === V1),
    "its tools read the pinned commit (the file as it was pinned, not the moved branch); there is no diff to read or draw, the code is drawn as it is", JSON.stringify(r0.map(([n, j]) => [n, j.error ?? j.errors ?? j.added ?? (j.text ?? "").slice(0, 40)])));
  const p1 = prompts.at(-1)!.text, fence = /<untrusted-repo-listing-([0-9a-f]+)>/.exec(p1)?.[1];
  ok(/WHAT THIS ROOM IS FOR: explain this directory's submodules/.test(p1) && !!fence && p1.includes(`src/core/sum.ts`) && p1.includes(`<untrusted-repo-readme-${fence}>`) && p1.includes("core does the sums") && !/THE DIFF/.test(p1),
    "the tutor reads the directory's listing and README fenced as untrusted, and is asked for its parts and how they compose; there is no diff in its prompt", p1.slice(0, 600));
  const rec: any = E.trusted(hosts[0].id).entries.filter((x: any) => x.record === "staffing-instructions").at(-1), turnRec: any = E.trusted(hosts[0].id).entries.filter((x: any) => x.record === "review-room-turn").at(-1);
  ok(rec?.data.seat === "review-room-tutor" && rec.data.directory === true && rec.data.provider === "codex" && rec.data.model === "c-1" && rec.data.config === null && turnRec?.data.subject.kind === "dir" && turnRec.data.subject.repository === "acme/kit" && selects.at(-1)?.adaptive === true,
    "the host has no crew: staffing's receipt names the tutor seat's member the captain confirmed (directory: true); the turn's ledger entry names the directory", JSON.stringify({ rec: rec?.data, sub: turnRec?.data?.subject }));
  const cite: any = await room.cite(opened.id, "diff:src/core/sum.ts:L2"), outside = await refused(() => room.cite(opened.id, "diff:docs/guide.md"));
  ok(/return a \+ b;/.test(cite.text) && cite.head === V1 && outside?.code === "bad_cite", "a citation names a file of the directory at the pinned commit (its lines); a file outside the directory is no citation of it", JSON.stringify([cite.text, outside?.message]));
  { const forged = await refused(async () => { const x = E.x(hosts[0], hosts[0].def.nodes[0], hosts[0].nodes[hosts[0].def.nodes[0].id]); return E.deps.instructionReceipt(x, "reviewer", "anything", { id: "codex", model: "c-1", reasoningEffort: "medium" }, undefined); });
    ok(/runs only the tutor seat/.test(forged?.message ?? ""), "the directory host runs nothing but the tutor seat: any other instructions get no receipt", forged?.message); }

  // ---------- the lesson: what it is, each part, how they compose, how data flows (or left out with a reason) ----------
  const nL = v1.turns.length + 1, arch = { type: "arch", title: "The kit", nodes: [{ id: "api", label: "api", kind: "service" }, { id: "core", label: "core", kind: "service" }], edges: [{ from: "api", to: "core", label: "calls sum", cite: "diff:src/api/server.ts:L1" }] };
  script.push([["board_draw", { items: [arch] }],
    ["scene_show", { chapter: "what", title: "The kit's code", points: [{ text: "Sums, served [diff:src/README.md].", cites: ["diff:src/README.md"] }, { text: "Two parts.", cites: [] }] }],
    ["scene_show", { chapter: "modules", title: "core", points: [{ text: "core adds numbers [diff:src/core/sum.ts:L2].", cites: ["diff:src/core/sum.ts:L2"] }, { text: "And rounds them.", cites: [] }] }],
    ["scene_show", { chapter: "modules", title: "api", points: [{ text: "api serves the sum [diff:src/api/server.ts:L3].", cites: ["diff:src/api/server.ts:L3"] }, { text: "One handler.", cites: [] }] }],
    ["scene_show", { chapter: "talks", title: "api calls core", picture: `B${nL}-1`, points: [{ text: "api imports sum [diff:src/api/server.ts:L1].", cites: ["diff:src/api/server.ts:L1"] }, { text: "Nothing calls api here.", cites: [] }] }],
    ["chapter_skip", { chapter: "sequence", reason: "One call, no flow to draw [diff:src/api/server.ts:L3].", cites: ["diff:src/api/server.ts:L3"] }],
    ["scene_show", { chapter: "change", title: "x", points: [{ text: "a.", cites: [] }, { text: "b.", cites: [] }] }],
    ["lesson_check", {}], ["say", "The kit [diff:src/README.md]."]]);
  await room.start(opened.id, { action: "teach", confirm: (room.view(opened.id) as any).offer.hash }, "captain"); await room.settle(opened.id);
  const lt = (room.view(opened.id) as any).turns.at(-1), lr = TOOLRES.slice(-3);
  ok(lt.status === "done" && JSON.stringify(lt.scenes.map((x: any) => x.chapter)) === JSON.stringify(["what", "modules", "modules", "talks", "sequence"]) && /chapter is one of what, modules, talks/.test(lr[1][1]?.error ?? "") && lr[2][1]?.ok === true,
    "a directory's lesson is its own chapters: what it is, each part (one scene a part), how they compose (an architecture), how data flows (or left out with a cited reason); a change's chapters are not there", JSON.stringify({ status: [lt.status, lt.error], chapters: lt.scenes?.map((x: any) => x.chapter), errs: lr.map(([n, j]) => [n, j.error ?? j.ok]) }));
  script.push([["scene_show", { chapter: "what", title: "Only this", points: [{ text: "Sums [diff:src/README.md].", cites: ["diff:src/README.md"] }, { text: "Two.", cites: [] }] }], ["say", "Short [diff:src/README.md]."]]);
  await room.start(opened.id, { action: "teach", confirm: (room.view(opened.id) as any).offer.hash }, "captain"); await room.settle(opened.id);
  const short = (room.view(opened.id) as any).turns.at(-1);
  ok(short.status === "failed" && /left out modules, talks, sequence/.test(short.error ?? "") && /a directory's lesson shows what it is and its parts/.test(short.error ?? ""), "a directory's lesson without its parts (or how they compose) is refused, saying which", short.error);

  // ---------- every follow-up: a question on the board, words selected, regenerate, the check, the voice's rule ----------
  const lessonScene = `t${lt.n}-2`;
  script.push([["say", "core keeps sums pure [diff:src/core/sum.ts:L2]."]]);
  await room.start(opened.id, { thread: { anchor: { scene: lessonScene, kind: "sentence", part: "p0.s0", text: "core adds numbers" }, chip: "why" }, confirm: (room.view(opened.id) as any).offer.hash, lang: "en" }, "captain"); await room.settle(opened.id);
  script.push([["say", "Because the api only serves [diff:src/api/server.ts:L3]."]]);
  await room.start(opened.id, { thread: { anchor: { scene: `t${t1.n}`, kind: "selection", part: "sel:ab12", text: "The api serves core's sum" }, chip: "free", q: "Why split?" }, confirm: (room.view(opened.id) as any).offer.hash, lang: "en" }, "captain"); await room.settle(opened.id);
  const th: any[] = (room.view(opened.id) as any).lesson.threads;
  ok(th.length === 2 && th[0].anchor.chapter === "modules" && th[1].anchor.kind === "selection" && th.every((x: any) => x.nodes[0].versions.length === 1) && (room.view(opened.id) as any).turns.filter((x: any) => x.thread).every((x: any) => x.status === "done"),
    "questions on the board work in a directory's room: on a lesson's sentence and on words selected on an answer, each a turn anchored there", JSON.stringify(th.map((x) => x.anchor)));
  const regenOffer = await refused(() => room.start(opened.id, { regenerate: t1.n, pick: { provider: "claude", model: "x-1" } }, "captain"));
  script.push([["say", "Again: api calls core [diff:src/api/server.ts:L1]."]]);
  await room.start(opened.id, { regenerate: t1.n, pick: { provider: "claude", model: "x-1" }, confirm: regenOffer?.offer?.hash, lang: "en" }, "captain"); await room.settle(opened.id);
  const rg = (room.view(opened.id) as any).turns.at(-1);
  ok(regenOffer?.code === "confirm_required" && rg.regenOf === t1.n && rg.provider === "claude" && rg.status === "done", "regenerate with another model works in a directory's room", JSON.stringify([regenOffer?.code, rg.regenOf, rg.provider, rg.status]));
  script.push([["check_ask", { questions: [{ q: "Who calls sum?", options: ["api", "docs"], answer: 0, why: "api imports it", cites: ["diff:src/api/server.ts:L1"] }, { q: "Where is rounding?", options: ["core", "api"], answer: 0, why: "core/round.ts", cites: [] }] }], ["say", "Two questions [diff:src/api/server.ts:L1]."]]);
  await room.start(opened.id, { action: "quiz", confirm: (room.view(opened.id) as any).offer.hash, lang: "en" }, "captain"); await room.settle(opened.id);
  const graded: any = room.answer(opened.id, 1, 0);
  ok(graded.correct === true && graded.cites?.[0]?.ok === true, "the check works in a directory's room: asked by the tutor, graded by Studio", JSON.stringify(graded).slice(0, 200));
  const voice = await refused(() => room.speech(opened.id, `t${t1.n}`));
  ok(voice?.code === "no_voice" || voice?.code === "not_found" || /OpenAI/.test(voice?.message ?? ""), "the vendor's voice follows the same rule (only the answering tutor's vendor, only with its key)", voice?.message);
  // the tutor the captain picks: the room's own pick runs its next turn
  const picked: any = (room as any).setTutor(opened.id, { provider: "claude", model: "x-1" }, "captain");
  ok(picked.offer.provider === "claude" && picked.offer.picked === "room", "the tutor picker works in a directory's room", JSON.stringify(picked.offer));
  (room as any).setTutor(opened.id, null, "captain");

  // ---------- arrival and paste start the analysis by themselves (auto-teach on), once per pinned commit ----------
  room.setSettings({ autoTeach: true }); const tv2: any = room.view(tag.id, true);
  script.push([["say", "The kit at v1 [diff:README.md]."]]);
  await (room as any).arrive(tag.id, "captain", "en", tv2.arrive?.plan); await room.settle(tag.id); const at = (room.view(tag.id) as any).turns.at(-1);
  ok(!!tv2.arrive?.plan && tv2.arrive.createsHost === true && at?.action === "teach" && at.auto === true && at.autoFrom === "arrival", "arriving in a directory's room starts its full analysis by itself (its host made then)", JSON.stringify({ arrive: tv2.arrive, t: [at?.action, at?.autoFrom, at?.status] }));
  await (room as any).arrive(tag.id, "captain", "en", (room.view(tag.id) as any).arrive?.plan); await room.settle(tag.id);
  ok((room.view(tag.id) as any).turns.filter((x: any) => x.auto).length === 1, "once per pinned commit: arriving again starts nothing more");
  const pv: any = room.pasteOffer("https://github.com/acme/kit/tree/main/docs"); script.push([["say", "The docs [diff:docs/guide.md]."]]);
  const pasted: any = await room.openDir("https://github.com/acme/kit/tree/main/docs", "captain", "en", true, pv.plan); await room.settle(pasted.id); const pt = (room.view(pasted.id) as any).turns.at(-1);
  ok(pt?.auto === true && pt.autoFrom === "paste" && pt.action === "teach", "pasting a directory (the box said so) starts its lesson by itself, as a pull request's paste does", JSON.stringify([pt?.action, pt?.autoFrom]));
  room.setSettings({ autoTeach: false });

  // ---------- the web filter reads the pinned commit once, in a bounded read, not file by file before every answer ----------
  { for (let i = 0; i < 80; i++) put(`many/f${i}.ts`, `export const value${i}Reserve = ${i};\n`);
    must(work, ["add", "-A"]); must(work, [...id, "commit", "-qm", "many"]); must(work, ["push", "-q", bare, "HEAD:refs/heads/many"]);
    const mr: any = await room.openDir("https://github.com/acme/kit/tree/many/many", "captain"), mo = (room.view(mr.id, true) as any).offer;
    const spawn0 = Bun.spawn, reads: string[][] = []; (Bun as any).spawn = (argv: any, o: any) => { if (Array.isArray(argv) && argv.some((a) => /^(show|grep|cat-file)$/.test(String(a)))) reads.push(argv.map(String)); return (spawn0 as any)(argv, o); };
    try { script.push([["say", "Eighty values [diff:many/f0.ts]."]]); await room.start(mr.id, { action: "how", confirm: mo.hash }, "captain"); await room.settle(mr.id); const first = reads.length;
      script.push([["say", "Still eighty [diff:many/f1.ts]."]]); await room.start(mr.id, { action: "why", confirm: mo.hash }, "captain"); await room.settle(mr.id); const second = reads.length - first;
      const done = (room.view(mr.id) as any).turns.filter((t: any) => t.status === "done").length;
      ok(done === 2 && first <= 4 && second <= 2, "a directory room's web filter reads the pinned commit's text in a few git processes, once: not one per file, and not again before the next answer", JSON.stringify({ done, first, second, sample: reads.slice(0, 3) })); }
    finally { (Bun as any).spawn = spawn0; }
    // a read that failed is not kept: that answer's filter is incomplete, the next answer reads again
    const fr: any = await room.openDir("https://github.com/acme/kit/tree/many/src", "captain"), fo = (room.view(fr.id, true) as any).offer, greps: number[] = [];
    let fail = true; (Bun as any).spawn = (argv: any, o: any) => { if (Array.isArray(argv) && argv.includes("grep")) { greps.push(1); if (fail) { fail = false; return (spawn0 as any)(["sh", "-c", "exit 128"], o); } } return (spawn0 as any)(argv, o); };
    try { script.push([["say", "The kit [diff:src/core/sum.ts]."]]); await room.start(fr.id, { action: "how", confirm: fo.hash }, "captain"); await room.settle(fr.id); const g1 = greps.length;
      script.push([["say", "Again [diff:src/core/sum.ts]."]]); await room.start(fr.id, { action: "why", confirm: fo.hash }, "captain"); await room.settle(fr.id); const g2 = greps.length - g1;
      ok(g1 >= 1 && g2 >= 1, "a filter read that failed is not kept for the commit: the next answer reads it again", JSON.stringify({ g1, g2 })); }
    finally { (Bun as any).spawn = spawn0; } }

  // ---------- the Library, the list, starting over ----------
  const saved: any = await room.saveToLibrary(opened.id, "captain"), snap: any = room.librarySnapshot(saved.artifact);
  ok(/^room-dir-[0-9a-f]{12}-[0-9a-f]{12}$/.test(saved.artifact) && snap.view.subject.kind === "dir" && snap.view.dir.sha === V1 && Object.keys(snap.cites).some((c) => c.startsWith("diff:src/")), "a directory's room is saved to the Library like any room (its citations resolved inside)", JSON.stringify({ a: saved.artifact, cites: Object.keys(snap.cites).slice(0, 3) }));
  const listed = room.list().filter((x: any) => x.kind === "dir");
  ok(listed.length >= 4 && listed.some((x: any) => x.id === opened.id && /Directory acme\/kit\/src/.test(x.title)), "the room list lists directory rooms", JSON.stringify(listed.map((x: any) => x.title)));
  const rs: any = room.reset(opened.id, "captain"), after: any = room.view(opened.id);
  ok(rs.reset && after.turns.length === 0 && after.dir.sha === V1 && after.subject.kind === "dir" && after.task?.id === hosts[0].id, "started over, a directory's room is fresh at once, still pinned, on the same host", JSON.stringify({ sha: after.dir?.sha, task: after.task }));
  ok(!fetched.some((x) => /github\.com/.test(x)) && fetched.every((x) => x.startsWith(H.toolUrl)), "no request left Studio but the repository's own git reads", JSON.stringify(fetched.filter((x) => !x.startsWith(H.toolUrl))));
} finally { globalThis.fetch = realFetch; for (const r of E.list()) if (!["succeeded", "failed", "cancelled"].includes(r.status)) await E.cancel(r.id, "cleanup"); H.stop(); }
end();
