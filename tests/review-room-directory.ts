import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A directory room (docs/units/review-room.md, "A directory of any GitHub repository"): a GitHub directory's address (any
// repository: a public one as it is, a private one through the captain's gh login) opens a room on that directory, its ref
// resolved once and pinned at its commit, its objects in Studio's own cache. What only a pull request has (a diff, its state,
// new commits) is not there. Its pages (baton's, the default) are paid runs the captain confirms, on a host Task Studio makes
// on the first one, with no project and no crew: the tutor the captain picked (or Studio's Automatic pick), its receipt for
// that member; their materials are the directory's own files at the pinned commit. Opening the room starts baton by itself,
// once per pinned commit; the Library and the room list keep it. A local bare repository stands in for GitHub; a scripted
// stub skill; temporary data only.        bun tests/review-room-directory.ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("review-room-directory");
const { bundledText } = await import("../src/bundled");
const { installStaffingGuard, StaffingStore } = await import("../src/domain/staffing");
const { installReviewRoom, parseDirUrl, dirRoomId } = await import("../src/domain/review-room");
const { must, setGitHome } = await import("../src/git");

/** a stub provider that runs the scripted tool calls through Studio's real tool route, then ends its round */
const TOOLRES: [string, any][] = [];
function scriptedTutor(script: any[][], prompts: { text: string }[]) {
  return (id: string, model: string) => ({ id, model, sandboxFree: true, start(_system: string, _tools: any[], ctx: any) {
    const me = { text: "" }; prompts.push(me);
    return { interrupt() {}, async *send(text: string) { me.text = text;
      for (const [name, args] of script.shift() ?? []) {
        if (name === "msg") { yield { type: "delta", text: args } as any; yield { type: "message", text: args } as any; continue; }
        const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json(); TOOLRES.push([name, j]);
        yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
      yield { type: "turnEnd", status: "ok", usage: { usd: 0.01, inTokens: 1, outTokens: 1 } } as any; } }; } });
}
const refused = async (f: () => any) => { try { await f(); return null; } catch (e: any) { return e; } };
/** baton's page, as a scripted round (extra: tool calls before it, e.g. reading materials) */
const baton = (t: string, extra: any[] = []) => [...extra, ["out_write", { path: ".baton/packet.json", content: "{}" }], ["out_write", { path: "index.html", content: `<!doctype html><title>${t}</title><h1>${t}</h1>` }], ["explain_done", { entry: "index.html", summary: t }], ["msg", "Done."]];

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
const room = installReviewRoom(E, { dataDir: H.data, dirRemote: (repo: string) => repo === "acme/kit" ? `file://${bare}` : `file://${join(tmp, "missing", repo.replace("/", "-"))}.git`, ghToken: () => { tokenAsked++; return token; } }), X = room.explain;
const script: any[][] = [], prompts: { text: string }[] = [], selects: any[] = [], tutor = scriptedTutor(script, prompts);
E.deps.selectProvider = async (x: any, p: any, c: any) => { selects.push({ run: x.run.id, node: x.node.id, role: c?.role, adaptive: !!c?.adaptive, pick: p }); return { ...tutor(p.provider, p.model), reasoningEffort: p.effort ?? null } as any; };
(E.deps as any).usableModels = () => [{ provider: "codex", model: "c-1", efforts: ["medium"], verified: true, runnable: true, isDefault: true }, { provider: "claude", model: "x-1", efforts: [], verified: true, runnable: true }];
const fetched: string[] = [], realFetch = globalThis.fetch; globalThis.fetch = (async (x: any, i: any) => { fetched.push(String(x?.url ?? x)); return realFetch(x, i); }) as any;
/** a run in room id to its end: n is the run's number */
const waitRun = async (id: string, n: number) => { await until(() => !X.running(id) && X.view(id).runs.find((x: any) => x.n === n)?.status !== "running", 60000); return X.view(id).runs.find((x: any) => x.n === n); };
/** a confirmed baton page in room id */
const pageIn = async (id: string) => { const o: any = X.offer(id, "studio-baton", "generate"); if (o.error) throw Object.assign(new Error(o.error), { code: o.code });
  const s: any = await X.generate(id, { skill: "studio-baton", confirm: o.hash }, "captain"); return waitRun(id, s.running ?? X.view(id).runs.at(-1)?.n); };

try {
  // ---------- the address ----------
  const good = ["https://github.com/acme/kit", "https://github.com/acme/kit/", "https://github.com/acme/kit/tree/main", "https://github.com/acme/kit/tree/feature/x/src/core", "https://github.com/acme/kit/tree/main/src%20x"];
  const bad = ["http://github.com/acme/kit", "https://gitlab.com/acme/kit", "https://github.com/acme/kit/blob/main/README.md", "https://github.com/acme/kit/tree/main?x=1", "https://github.com/acme/kit/tree/main/../x", "https://github.com/acme/kit/pull/1", "https://github.com.evil.example/acme/kit", "javascript:alert(1)", "https://github.com/acme/kit.git", ""];
  ok(good.every((u) => !!parseDirUrl(u)) && bad.every((u) => !parseDirUrl(u)) && JSON.stringify(parseDirUrl(good[3])?.rest) === '["feature","x","src","core"]',
    "a directory's address is a GitHub repository's page or …/tree/<ref>/<path>: no other host, scheme, file (/blob/), query, pull request or ../", JSON.stringify(bad.filter((u) => parseDirUrl(u))));
  const codes = await Promise.all(["https://github.com/acme/kit/blob/main/README.md", "https://example.com/x"].map(async (u) => (await refused(() => room.openDir(u)))?.code));
  ok(codes.every((c) => c === "bad_url"), "anything else is refused before anything is read", JSON.stringify(codes));

  // ---------- any repository: a public one read as it is; one Studio cannot read asks the captain's gh login, then says why ----------
  const opened: any = await room.openDir("https://github.com/acme/kit/tree/feature/x/src"), v: any = room.view(opened.id, true);
  ok(opened.id === dirRoomId("acme/kit", "feature/x", "src") && v.subject.kind === "dir" && v.dir.ref === "feature/x" && v.dir.refKind === "branch" && v.dir.path === "src" && v.dir.sha === V1 && v.dir.private === false && tokenAsked === 0,
    "a public repository's directory opens without any login: the branch named in the address (its name may hold a slash) told apart from the path, pinned at its commit", JSON.stringify({ id: opened.id, dir: v.dir }));
  ok(JSON.stringify(v.dir.parts.map((p: any) => [p.name, p.kind, p.files])) === JSON.stringify([["core", "dir", 2], ["README.md", "file", 1], ["api", "dir", 1], ["工具", "dir", 1]]) && v.dir.files === 5 && v.dir.readme === true,
    "the room knows the directory's parts (each folder and file under it, with how many files) and its README", JSON.stringify(v.dir.parts));
  const cache = join(H.data, "review-room", "cache"), caches = readdirSync(cache);
  ok(caches.length === 1 && /^dir-[0-9a-f]{16}\.git$/.test(caches[0]) && must(join(cache, caches[0]), ["rev-parse", "--is-bare-repository"]) === "true" && existsSync(join(H.data, "review-room", "dir", `${opened.id}.json`)),
    "its commits are in a bare repository under Studio's data folder; the room is a file of its own", JSON.stringify(caches));
  ok(v.prState === null && v.diffstat === null && v.moved === null && /Directory acme\/kit\/src @ feature\/x/.test(v.card.title.en),
    "what only a pull request has is not there (its state, a diff, new commits)", JSON.stringify({ prState: v.prState, diffstat: v.diffstat, moved: v.moved, title: v.card.title }));
  ok(v.offer?.provider === "codex" && v.offer.model === "c-1" && v.offer.independence?.level === null && /independence does not apply/.test(v.offer.independence.en),
    "before anything runs, the room offers its tutor (Automatic: this machine's default model, no author to be independent from)", JSON.stringify(v.offer));
  // Automatic (no pick) is unchanged by picks being free: it still takes only a model that runs now and is verified, never a held one
  { const real = (E.deps as any).usableModels; (E.deps as any).usableModels = () => [{ provider: "codex", model: "c-held", efforts: ["medium"], verified: true, runnable: false, held: "codex is out of quota", isDefault: true }, { provider: "claude", model: "x-unv", efforts: [], verified: false, runnable: true }, ...real().filter((u: any) => u.provider === "claude")];
    const auto: any = room.view(opened.id).offer; (E.deps as any).usableModels = real;
    ok(auto.provider === "claude" && auto.model === "x-1", "Automatic for a directory passes over a held default and an unverified model: it takes a model that runs now and is verified", JSON.stringify(auto)); }
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

  // ---------- a page: confirmed, on a host Task Studio makes once, the tutor the captain confirmed; read from the pinned commit ----------
  let e: any = await refused(() => X.generate(opened.id, { skill: "studio-baton" }, "captain"));
  ok(e?.code === "confirm_required" && e.offer?.provider === "codex" && e.offer.model === "c-1" && !E.list().some((r: any) => r.def.kind === "review-room-dir-host"),
    "a directory's page is paid and asks to confirm first, on the room's tutor; nothing is made before", JSON.stringify([e?.code, e?.offer?.provider]));
  script.push(baton("kit/src"));
  const r1 = await pageIn(opened.id), hosts = E.list().filter((r: any) => r.def.kind === "review-room-dir-host"), v1: any = room.view(opened.id);
  ok(hosts.length === 1 && v1.task?.id === hosts[0].id && hosts[0].params.room === opened.id, "confirmed, the first page makes the directory's host Task, once", JSON.stringify({ hosts: hosts.length, task: v1.task }));
  ok(r1?.status === "done" && X.view(opened.id).versions.at(-1)?.entry === "index.html", "the first confirmed page, on the host Task it just made, runs to its version", JSON.stringify({ r: r1 && [r1.status, r1.error, r1.rounds?.length], host: E.get(hosts[0]?.id)?.status }));
  // its materials, read by the next page (a round that never ran leaves its script unread)
  script.length = 0; const n0 = TOOLRES.length; script.push(baton("kit/src again", [["mat_list", {}], ["mat_read", { path: "pull-request.md" }], ["mat_read", { path: "head/src/core/sum.ts" }]]));
  const r2 = await pageIn(opened.id);
  ok(r2?.status === "done" && E.list().filter((r: any) => r.def.kind === "review-room-dir-host").length === 1, "the next page runs on the same host and makes a version", JSON.stringify(r2 && [r2.status, r2.error]));
  { const res = TOOLRES.slice(n0), list = res.find(([n]) => n === "mat_list")?.[1] ?? [], reads = res.filter(([n]) => n === "mat_read").map(([, j]) => String(j?.text ?? j?.error ?? ""));
    const heads = (Array.isArray(list) ? list : []).map((f: any) => f.path).filter((p: string) => p.startsWith("head/"));
    ok(heads.includes("head/src/core/sum.ts") && heads.includes("head/src/api/server.ts") && heads.length >= 4 && /a directory, not a change/.test(reads[0] ?? ""),
      "its head/ holds the directory's files (not the empty diff of base..head), and pull-request.md says it is a directory", JSON.stringify({ heads, r0: (reads[0] ?? "").slice(0, 200) }));
    ok(/return a \+ b;/.test(reads[1] ?? "") && !/return b \+ a;/.test(reads[1] ?? ""), "its materials are the pinned commit (the file as it was pinned, not the moved branch)", (reads[1] ?? "").slice(0, 200));
    ok(heads.includes("head/src/工具/說明.md") && !heads.some((p: string) => /\\345/.test(p)), "a name git would quote (Chinese) is listed as it is, in the parts and in the materials", JSON.stringify(heads)); }
  const rec: any = E.trusted(hosts[0].id).entries.filter((x: any) => x.record === "staffing-instructions").at(-1), xRec: any = E.trusted(hosts[0].id).entries.filter((x: any) => x.record === "review-room-explain").at(-1);
  ok(/^review-room-explainer:studio-baton@v\d+$/.test(rec?.data.seat ?? "") && rec.data.directory === true && rec.data.provider === "codex" && rec.data.model === "c-1" && rec.data.config === null && xRec?.data.subject.kind === "dir" && xRec.data.subject.repository === "acme/kit" && selects.at(-1)?.adaptive === true,
    "the host has no crew: staffing's receipt names the seat's member the captain confirmed (directory: true); the run's ledger entry names the directory", JSON.stringify({ rec: rec?.data, sub: xRec?.data?.subject }));
  { const forged = await refused(async () => { const x = E.x(hosts[0], hosts[0].def.nodes[0], hosts[0].nodes[hosts[0].def.nodes[0].id]); return E.deps.instructionReceipt(x, "reviewer", "anything", { id: "codex", model: "c-1", reasoningEffort: "medium" }, undefined); });
    ok(/runs only the tutor seat/.test(forged?.message ?? ""), "the directory host runs nothing but the room's own seat: any other instructions get no receipt", forged?.message); }

  // ---------- the tutor the captain picks: the room's own pick runs its next page ----------
  const picked: any = room.setTutor(opened.id, { provider: "claude", model: "x-1" }, "captain");
  ok(picked.offer.provider === "claude" && picked.offer.picked === "room", "the tutor picker works in a directory's room", JSON.stringify(picked.offer));
  // a captain pick this machine does not list (entered by hand), or lists as held, still gets the directory host's receipt, marked picked
  for (const [pick, usable] of [[{ provider: "claude", model: "x-hand-3" }, null], [{ provider: "claude", model: "x-held" }, { provider: "claude", model: "x-held", efforts: [], verified: true, runnable: false, held: "claude is out of quota" }]] as const) {
    const real = (E.deps as any).usableModels; if (usable) (E.deps as any).usableModels = () => [...real(), usable];
    try { room.setTutor(opened.id, pick, "captain"); script.push(baton(`By the captain's pick ${pick.model}`));
      const rp = await pageIn(opened.id), rec: any = E.trusted(hosts[0].id).entries.filter((x: any) => x.record === "staffing-instructions").at(-1);
      ok(rp?.status === "done" && rp.model === pick.model && rec?.data.directory === true && rec.data.model === pick.model && rec.data.picked === true && selects.at(-1)?.pick.model === pick.model,
        `a directory room runs a captain pick ${usable ? "this machine holds" : "entered by hand"}: the host's receipt names it, marked picked`, JSON.stringify({ r: rp && [rp.status, rp.model, rp.error], rec: rec?.data })); }
    finally { (E.deps as any).usableModels = real; } }
  room.setTutor(opened.id, null, "captain");

  // ---------- opening a directory's room starts baton by itself (the default skill), once per pinned commit ----------
  { const before = X.view(tag.id).runs.length; script.push(baton("The kit at v1"));
    const w: any = await X.auto(tag.id, "captain"), n = w.running ?? X.view(tag.id).runs.at(-1)?.n; const ra = n != null ? await waitRun(tag.id, n) : null;
    ok(w.running != null && ra?.opened === true && E.list().filter((r: any) => r.def.kind === "review-room-dir-host" && r.params.room === tag.id).length === 1,
      "opening a directory's room starts baton by itself, no confirmation (its host made then)", JSON.stringify({ running: w.running, r: ra && [ra.status, ra.opened], runs: X.view(tag.id).runs.length - before }));
    ok(ra?.status === "done" && X.view(tag.id).versions.length === 1, "that page, on the host it just made, runs to its version", JSON.stringify(ra && [ra.status, ra.error]));
    script.length = 0; await X.auto(tag.id, "captain"); await until(() => !X.running(tag.id), 30000);
    ok(X.view(tag.id).runs.length === before + 1, "once per pinned commit: opening it again starts nothing more", String(X.view(tag.id).runs.length - before)); }

  // ---------- the Library, the list ----------
  const saved: any = await room.saveToLibrary(opened.id, "captain"), snap: any = room.librarySnapshot(saved.artifact);
  ok(/^room-dir-[0-9a-f]{12}-[0-9a-f]{12}$/.test(saved.artifact) && snap.kind === "review-room-pages" && snap.room === opened.id && snap.pages.length === X.view(opened.id).versions.length && snap.integrity.length === 0,
    "a directory's room is saved to the Library like any room: its pages, verified as written", JSON.stringify({ a: saved.artifact, kind: snap.kind, pages: snap.pages?.length }));
  const listed = room.list().filter((x: any) => x.kind === "dir");
  ok(listed.length >= 4 && listed.some((x: any) => x.id === opened.id && /Directory acme\/kit\/src/.test(x.title) && x.versions === X.view(opened.id).versions.length), "the room list lists directory rooms, with their pages", JSON.stringify(listed.map((x: any) => [x.title, x.versions])));
  const after: any = room.view(opened.id);
  ok(after.dir.sha === V1 && after.subject.kind === "dir" && after.task?.id === hosts[0].id, "after all of it the room is still pinned, on the same host", JSON.stringify({ sha: after.dir?.sha, task: after.task }));
  ok(!fetched.some((x) => /github\.com/.test(x)) && fetched.every((x) => x.startsWith(H.toolUrl)), "no request left Studio but the repository's own git reads", JSON.stringify(fetched.filter((x) => !x.startsWith(H.toolUrl))));
} finally { globalThis.fetch = realFetch; for (const r of E.list()) if (!["succeeded", "failed", "cancelled"].includes(r.status)) await E.cancel(r.id, "cleanup"); H.stop(); }
end();
