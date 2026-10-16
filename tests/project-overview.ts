// The read-only projects overview (projects design §3.1, phase 1): GET /api/projects/overview (the sidebar) and
// GET /api/projects/<id>/overview (one page), on temporary data: a busy local project, an external project, the
// built-in sandbox and a run with no project.          bun tests/project-overview.ts
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Projects } from "../src/doors";
import { createProjectOverview, readGatesTest } from "../src/project-overview";
import { prepareSandbox, registerSandbox } from "../src/sandbox-repo";
import { StaffingStore } from "../src/domain/staffing";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("project-overview");

const H = await harness([
  Y({ id: "code-ish", name: "code-ish", kind: "code", roles: [{ id: "worker", label: "Worker", skill: "x" }], nodes: [
    { id: "build", kind: "agent", label: "Build", role: "worker", mode: "test", x: 0, y: 0 },
    { id: "merge", kind: "card", label: "Merge", card: { title: { en: "Merge it?", "zh-TW": "要合併嗎？" }, options: [{ id: "go", label: "Go" }] }, x: 1, y: 0 },
    { id: "end", kind: "hook", label: "Done", x: 2, y: 0 }], edges: [["build", "merge"], ["merge", "end", "go"]] }),
  Y({ id: "plain", name: "plain", roles: [], nodes: [{ id: "ask", kind: "card", label: "Ask", card: { title: "Ok?", options: [{ id: "go", label: "Go" }] }, x: 0, y: 0 }], edges: [] })]);
const E = H.engine as any, DATA = H.data;
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).toString().trim();
const repos = mkdtempSync(join(tmpdir(), "crew-po-repos-"));
const mkRepo = (name: string) => { const d = join(repos, name); mkdirSync(d); git(d, "init", "-q", "-b", "main"); writeFileSync(join(d, "README.md"), name); git(d, "add", "README.md"); git(d, "commit", "-q", "-m", "start"); return d; };
const harbor = mkRepo("harbor-api"), tide = mkRepo("tidepool-docs");
mkdirSync(join(harbor, ".crew")); writeFileSync(join(harbor, ".crew", "gates.json"), JSON.stringify({ test: ["bun", "test"] }));
const head = git(harbor, "rev-parse", "HEAD");
prepareSandbox(DATA); registerSandbox(DATA);
const reg = JSON.parse(readFileSync(join(DATA, "projects.json"), "utf8"));
reg.push({ id: "harbor-api", name: "harbor-api", path: harbor, base: "main", sensitive: [], proposed: [{ glob: "infra/terraform/**", why: "cloud resources" }], proposedAt: "2026-10-01T00:00:00Z", approvedAt: null });
reg.push({ id: "tidepool-docs", name: "tidepool-docs", path: tide, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null,
  github: { mode: "github", repository: "acme/tidepool-docs", localPath: tide, pushUrl: "https://github.com/acme/tidepool-docs.git", apiOrigin: "https://api.github.com", base: "main", branchPrefix: "crew/", approvedAt: "2026-10-02T00:00:00Z", approvalId: "x" } });
reg.push({ id: "old-off", name: "old-off", path: tide, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: false });
writeFileSync(join(DATA, "projects.json"), JSON.stringify(reg));
mkdirSync(join(DATA, "policies"), { recursive: true });
writeFileSync(join(DATA, "policies", "project-harbor-api.yaml"), "sensitive_paths:\n  - glob: migrations/**\n    why: schema changes\n");

// an approved crew for harbor-api, signed by the real store
const projects = new Projects(DATA);
const store = new StaffingStore(DATA);
const identity = projects.staffingIdentity("harbor-api");
const text = "# worker skill\n";
const pin = store.snapshot({ ref: "pack:firstmate/skills/worker.md", version: 1, text });
store.approve({ schema: 1, algorithm: "sha256-canonical-v1", project: identity, workflow: { id: "code-firstmate", version: 1, sha256: createHash("sha256").update("wf").digest("hex") },
  roles: { worker: { provider: "codex", model: "gpt-5.5", effort: "high", skill: pin } }, review: { freshContexts: 3, distinctProviders: true } } as any, null, { run: "R-0", card: "SC-0", answerSeq: 1 }, { "pack:firstmate/skills/worker.md": text });

// runs: two in harbor-api waiting at their merge card, one with no project
const a = E.start({ workflow: "code-ish", text: "Add rate limiting", title: "Add rate limiting", params: { project: "harbor-api" } });
const b = E.start({ workflow: "plain", text: "loose", title: "Loose task" });
await until(() => E.get(a.id)?.status === "waiting" && E.get(b.id)?.status === "waiting", 15000);
// a held Task in harbor-api: queued for capacity (the state the engine records while a round waits)
const held = structuredClone(E.get(a.id)); held.id = "R-900"; held.title = "Write the changelog"; held.status = "queued";
held.nodes = { build: { ...held.nodes.build, state: "running", waiting: null, card: null, job: null, data: { nativeQueue: { version: 1, state: "waiting", reason: "live owned-round capacity is full" } } }, merge: { ...held.nodes.merge, state: "pending", waiting: null, card: null }, end: held.nodes.end };
E.runs.set(held.id, held);
// a failed Task outside the last 24 h does not count; a merged one is an output
const merged = structuredClone(E.get(a.id)); merged.id = "R-901"; merged.status = "succeeded"; merged.result = "done"; merged.endedAt = new Date(Date.now() - 3 * 86400e3).toISOString();
merged.ctx = { ...merged.ctx, project: "harbor-api", base: "main", merged: { base: "main", head, at: merged.endedAt }, pr: { id: "local-1", adapter: "local", repo: harbor, base: "main", branch: "crew/R-901", head, title: "t", body: "", openedAt: merged.endedAt, url: null } };
E.runs.set(merged.id, merged);
// a worktree record for harbor-api (as src/worktrees.ts writes it, with its marker)
const wtDir = join(DATA, "work", "wt", "harbor-api"); mkdirSync(wtDir, { recursive: true });
writeFileSync(join(wtDir, `${a.id}.marker`), "");
writeFileSync(join(wtDir, `${a.id}.json`), JSON.stringify({ kind: "crew-worktree", project: "harbor-api", task: a.id, repo: harbor, base: "main", baseCommit: head, branch: `crew/${a.id}`, path: join(DATA, "work", "wt", "harbor-api", a.id), head, run: a.id, kept: [], history: [], createdAt: "x", removedAt: null }));
const { Worktrees } = await import("../src/worktrees");

let staffingCalls: string[] = [];
const orig = Projects.prototype.staffingIdentity;
Projects.prototype.staffingIdentity = function (this: Projects, id: string, roots?: string[]) { staffingCalls.push(id); return orig.call(this, id, roots); };
// two artifacts named "harbor-api": one made by a harbor-api Task, one by the Task in no project (a coffee-style namespace clash)
const { ArtifactStore } = await import("../src/artifacts");
const arts = new ArtifactStore(DATA);
for (const [aid, run] of [["harbor-doc", a.id], ["clash-doc", b.id]]) { arts.create({ id: aid, title: aid, type: "doc", project: "harbor-api", source: "md" }); arts.addVersion(aid, { createdBy: { kind: "agent" } as any, url: "https://example.invalid/x", source: { run } }); }
const ov = createProjectOverview({ dataDir: DATA, projects, engine: E, session: "s3cret", worktrees: new Worktrees(DATA), artifacts: arts });
const desk = (headers: Record<string, string> = {}, method = "GET") => new Request("http://127.0.0.1/x", { method, headers });
const get = async (path: string, who: any = { kind: "desktop" }, headers: Record<string, string> = { "x-crew-session": "s3cret" }) => {
  const r = await ov.handle(desk(headers), new URL(`http://127.0.0.1${path}`), who, false); return r ? { status: r.status, body: await r.json() } : null;
};
// a fingerprint of everything under the data dir and the repositories: an overview read changes none of it
const tree = (root: string): string => { const out: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) { if (n === ".git" && d !== root) { out.push(p); continue; } walk(p); } else out.push(`${p}:${st.size}:${st.mtimeMs}`); } }; walk(root); return out.sort().join("\n"); };
const before = tree(DATA) + "\n" + tree(repos);

// ---- auth ----
ok((await get("/api/projects/overview", { kind: "desktop" }, {}))?.status === 401, "a desktop request without a session: 401");
ok((await get("/api/projects/harbor-api/overview", { kind: "desktop" }, {}))?.status === 401, "the page without a session: 401");
ok((await get("/api/projects/overview", { kind: "desktop" }, { cookie: "crew_session=s3cret" }))?.status === 200, "the page's session cookie reads");
ok((await get("/api/projects/overview"))?.status === 200, "x-crew-session reads");
ok((await get("/api/projects/overview", { kind: "phone", device: { id: "d" } }, {}))?.status === 200, "a paired phone reads, as it reads Tasks");
ok((await get("/api/projects/harbor-api/overview", { kind: "phone", device: { id: "d" } }, {}))?.status === 200, "a paired phone reads a project page");
ok((await get("/api/projects/overview", { kind: "refused" }, {}))?.status === 403, "anyone else is refused");
{ const r = await ov.handle(desk({ "x-crew-session": "s3cret" }, "POST"), new URL("http://127.0.0.1/api/projects/overview"), { kind: "desktop" }, true); ok(r?.status === 405, "a write is refused: read only"); }
ok((await ov.handle(desk(), new URL("http://127.0.0.1/api/projects"), { kind: "desktop" }, false)) === null, "other project routes are left to their own handlers");

// ---- the sidebar ----
const side = (await get("/api/projects/overview"))!.body;
const row = (id: string) => side.projects.find((p: any) => p.id === id);
ok(side.projects.map((p: any) => p.id).join() === "harbor-api,old-off,tidepool-docs,sandbox,studio", "order: projects with cards, then the rest, the sandbox, and Studio last", side.projects.map((p: any) => p.id).join());
ok(row("harbor-api").attention === 1 && row("harbor-api").held === 1 && row("harbor-api").kind === "local", "harbor-api: one card waits, one Task is held", JSON.stringify(row("harbor-api")));
ok(row("harbor-api").status.en === "1 held" && row("harbor-api").status.tw === "1 暫緩" && row("harbor-api").status.tone === "human", "its status line does not repeat the card count", JSON.stringify(row("harbor-api").status));
ok(row("tidepool-docs").kind === "external" && row("tidepool-docs").status.en === "External: cannot dispatch yet" && row("tidepool-docs").status.tw === "外部專案：暫無法派工", "an external project: cannot dispatch yet");
ok(row("old-off").enabled === false && row("old-off").status.en === "Disabled", "a disabled project says so");
ok(row("sandbox").kind === "builtin" && row("sandbox").status.en === "Built-in · idle" && row("sandbox").status.tw === "內建 · 閒置", "the sandbox: built-in, idle");
ok(row("studio").kind === "studio" && row("studio").attention === 1 && row("studio").status.en === "No project · Waiting for you", "the Studio row carries the run with no project", JSON.stringify(row("studio")));

// ---- one page ----
const pg = (await get("/api/projects/harbor-api/overview"))!.body;
ok(pg.project.id === "harbor-api" && pg.project.path === harbor && pg.project.base === "main" && pg.project.kind === "local" && pg.project.enabled === true, "identity: path, base, kind, enabled");
const hk = Object.fromEntries(pg.health.map((t: any) => [t.key, t]));
ok(pg.health.map((t: any) => t.key).join() === "enabled,registered,base,crew,test,rules,gitconfig", "seven health tiles, in order");
ok(hk.enabled.tone === "ok" && hk.registered.en === "Registered" && hk.base.tone === "ok" && hk.base.detail.en === `main · ${head.slice(0, 7)}`, "enabled, registered, base found with its sha", JSON.stringify(hk.base));
ok(hk.crew.tone === "ok" && hk.crew.detail.en === "code-firstmate v1 · config v1", "crew approved: workflow and config version", JSON.stringify(hk.crew));
ok(hk.test.code === "bun test" && hk.test.detail.en === "from .crew/gates.json", "the test command from .crew/gates.json");
ok(hk.rules.detail.en === "Not checked yet" && hk.gitconfig.detail.en === "Not checked yet" && hk.rules.detail.tw === "尚未檢查", "operating rules and shared git config: not checked yet");
ok(pg.tasks.length === 2 && pg.tasks.some((t: any) => t.id === a.id && t.waitsOn.kind === "captain" && t.waitsOn.nodeLabel === "Merge" && t.pipe.join() === "done,human") && pg.tasks.some((t: any) => t.id === "R-900" && t.waitsOn.kind === "queue"), "active Tasks with who each waits on and its pipe", JSON.stringify(pg.tasks.map((t: any) => [t.id, t.waitsOn.kind, t.pipe])));
ok(!pg.tasks.some((t: any) => t.id === "R-901"), "an ended Task is not active");
const card = E.cards.list({ run: a.id, open: true })[0];
ok(pg.cards.length === 1 && pg.cards[0].id === card.id && pg.cards[0].href === `#/run/${a.id}?card=${card.id}` && pg.cards[0].title.tw === "要合併嗎？", "cards waiting are deep links to the card", JSON.stringify(pg.cards));
ok(pg.crew?.workflow === "code-firstmate" && pg.crew.config === 1 && pg.crew.roles[0].role === "worker" && pg.crew.roles[0].provider === "codex" && pg.crew.roles[0].skill === "worker.md" && pg.crew.signed === true, "the approved crew, read only", JSON.stringify(pg.crew));
ok(pg.sensitive.project[0]?.glob === "migrations/**" && pg.sensitive.proposed?.[0]?.glob === "infra/terraform/**" && pg.sensitive.orgCount === pg.sensitive.org.length && pg.sensitive.orgCount > 0, "sensitive paths: the project's, the proposed list, the org defaults");
ok(pg.outputs.some((o: any) => o.kind === "merge" && o.task === "R-901") && pg.outputs.some((o: any) => o.kind === "review" && o.task === "R-901") === false, "outputs: a merge (a merged change is no longer an open review request)", JSON.stringify(pg.outputs));
ok(pg.worktrees.length === 1 && pg.worktrees[0].branch === `crew/${a.id}` && pg.worktrees[0].path.endsWith(`/work/wt/harbor-api/${a.id}`) && pg.worktrees[0].busy === false, "worktrees with branch and path", JSON.stringify(pg.worktrees));

ok(staffingCalls.includes("harbor-api"), "harbor-api's crew is read through staffingIdentity", JSON.stringify(staffingCalls));
ok(pg.outputs.some((o: any) => o.title.en === "harbor-doc") && !pg.outputs.some((o: any) => o.title.en === "clash-doc"), "an artifact counts where its Task counts: the no-project Task's artifact stays with Studio", JSON.stringify(pg.outputs.map((o: any) => o.title.en)));
// ---- the external project: staffing is not attempted ----
staffingCalls = [];
const ext = (await get("/api/projects/tidepool-docs/overview"))!.body;
const ek = Object.fromEntries(ext.health.map((t: any) => [t.key, t]));
ok(ext.project.kind === "external" && ext.project.repository === "acme/tidepool-docs", "an external project names its repository");
ok(ek.registered.tone === "warn" && ek.registered.en === "External project: cannot dispatch yet" && ek.registered.detail.en === "Its GitHub grant cannot be verified on this build.", "its registration tile: cannot dispatch yet");
ok(ext.crew === null && ek.crew.detail.en === "External project" && !staffingCalls.includes("tidepool-docs"), "staffing is not attempted for it", JSON.stringify(staffingCalls));
ok(ek.test.detail.en === "No .crew/gates.json", "no .crew/gates.json says so");
const sb = (await get("/api/projects/sandbox/overview"))!.body;
ok(sb.project.kind === "builtin" && sb.health.find((t: any) => t.key === "registered").en === "Built-in", "the sandbox page: built-in");
const off = (await get("/api/projects/old-off/overview"))!.body;
ok(off.health[0].tone === "bad" && off.health[0].en === "Disabled" && off.crew === null, "a disabled project: the Disabled tile, no crew read");
const st = (await get("/api/projects/studio/overview"))!.body;
ok(st.project.kind === "studio" && st.tasks.length === 1 && st.tasks[0].id === b.id && st.cards.length === 1 && st.health.length === 0, "the studio id: its Tasks and cards only");
ok((await get("/api/projects/nope/overview"))?.status === 404, "an unknown id: 404 No such project");

// ---- .crew/gates.json: missing, oversized, linked ----
const g = mkRepo("gates");
ok(readGatesTest(g).state === "missing", "gates.json missing");
mkdirSync(join(g, ".crew")); writeFileSync(join(g, ".crew", "gates.json"), JSON.stringify({ test: ["npm", "test"], pad: "x".repeat(70 * 1024) }));
ok(readGatesTest(g).state === "oversized" && readGatesTest(g).test === null, "an oversized gates.json is not read");
const outside = join(repos, "outside.json"); writeFileSync(outside, JSON.stringify({ test: ["evil"] }));
const g2 = mkRepo("gates2"); mkdirSync(join(g2, ".crew")); symlinkSync(outside, join(g2, ".crew", "gates.json"));
ok(readGatesTest(g2).state === "link" && readGatesTest(g2).test === null, "a linked gates.json is not followed");
const g3 = mkRepo("gates3"); symlinkSync(join(harbor, ".crew"), join(g3, ".crew"));
ok(readGatesTest(g3).state === "link", "a linked .crew folder is not followed");
const g4 = mkRepo("gates4"); mkdirSync(join(g4, ".crew")); writeFileSync(join(g4, ".crew", "gates.json"), "{nope");
ok(readGatesTest(g4).state === "unreadable", "an unparseable gates.json is unreadable");

// ---- nothing written, no cost ----
const after = tree(DATA) + "\n" + tree(repos);
const strip = (s: string) => s.split("\n").filter((l) => !/\/gates[234]?(\/|:|$)|outside\.json/.test(l)).join("\n");
{ const A = new Set(strip(after).split("\n")), B = new Set(strip(before).split("\n")); const diff = [...A].filter((x) => !B.has(x)).concat([...B].filter((x) => !A.has(x)).map((x) => "-" + x));
  ok(!diff.length, "an overview read writes nothing under the data dir or the repositories", diff.slice(0, 6).join(" | ")); }
ok(!existsSync(join(DATA, "projects", store.key({ namespace: "git", id: "sandbox", identity: "x" } as any))), "no staffing folder is created for a project without crew");
const all = JSON.stringify([side, pg, ext, sb, st]);
ok(!/cost|usd|price|token|\$\d/i.test(all), "no cost fields anywhere", (all.match(/.{30}(cost|usd|price|token).{30}/i) || [""])[0]);

// ---- m3: a read creates no folder, not even policies/ (the engine made it at start; take it away first) ----
{ const pol = join(DATA, "policies"), keep = readFileSync(join(pol, "project-harbor-api.yaml"), "utf8");
  rmSync(pol, { recursive: true, force: true });
  await get("/api/projects/overview"); await get("/api/projects/harbor-api/overview"); await get("/api/projects/old-off/overview");
  ok(!existsSync(pol), "an overview read creates no policies folder");
  mkdirSync(pol, { recursive: true }); writeFileSync(join(pol, "project-harbor-api.yaml"), keep); }

// ---- broken registrations elsewhere (written now, after the healthy reads above) ----
// gone-off: disabled, folder gone; lost: enabled, folder gone; ghost-wt: .git file pointing at a gone gitdir; junk: garbage .git file.
// staffingIdentity (unchanged) refuses every project while one exists: the crew tile must say which registration, never a path,
// and must not claim the crew is fine (real dispatch refuses too).
const gone = join(repos, "gone-folder"), lost = join(repos, "lost-folder");
const ghost = join(repos, "ghost-wt"); mkdirSync(ghost); writeFileSync(join(ghost, ".git"), `gitdir: ${join(repos, "gone-gitdir")}\n`);
const junk = join(repos, "junk"); mkdirSync(junk); writeFileSync(join(junk, ".git"), "not a git pointer at all\n");
const rec = (id: string, path: string, extra: any = {}) => ({ id, name: id, path, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, ...extra });
const healthy = readFileSync(join(DATA, "projects.json"), "utf8");
const withBroken = (list: any[]) => writeFileSync(join(DATA, "projects.json"), JSON.stringify([...JSON.parse(healthy), ...list]));
const crewTile = async (id: string) => (await get(`/api/projects/${id}/overview`))!.body.health.find((t: any) => t.key === "crew");
const leak = (v: any) => /ENOENT|EACCES|no such file|stat '|Error:|gitdir/i.test(JSON.stringify(v));
for (const [label, list, names] of [["a disabled registration whose folder is gone", [rec("gone-off", gone, { enabled: false })], "gone-off"],
  ["a registration whose .git points at a gone gitdir", [rec("ghost-wt", ghost)], "ghost-wt"], ["a registration with a garbage .git file", [rec("junk", junk)], "junk"]] as any[]) {
  withBroken(list);
  const t = await crewTile("harbor-api"), page = (await get("/api/projects/harbor-api/overview"))!.body;
  ok(t.tone === "warn" && t.en === "No task can start" && t.detail.en === `Registration ${names} points to a missing or broken folder.` && t.detail.tw === `登錄的專案 ${names} 指向不見或損壞的資料夾。`, `${label}: harbor-api's crew tile names it and warns`, JSON.stringify(t));
  ok(!leak(page) && ![gone, lost, ghost, junk].some((x) => JSON.stringify(page).includes(x)), `${label}: no exception text and no other folder in the reply`, (JSON.stringify(page).match(/.{40}(ENOENT|no such file|stat '|gitdir|crew-po-repos).{40}/) || [""])[0]);
}
withBroken([rec("gone-off", gone, { enabled: false }), rec("lost", lost), rec("junk", junk)]);
{ const t = await crewTile("harbor-api");
  ok(t.tone === "warn" && /^Registration (gone-off|lost|junk) points to a missing or broken folder\. \(\+2 more\)$/.test(t.detail.en), "several broken registrations: one named, the rest counted", JSON.stringify(t)); }
const side2 = (await get("/api/projects/overview"))!.body, lrow = side2.projects.find((p: any) => p.id === "lost");
ok(lrow.status.en === "Folder missing" && lrow.status.tw === "資料夾不見了" && lrow.status.tone === "warn" && lrow.folderMissing === true, "F3: a project whose own folder is missing reads Folder missing in the sidebar", JSON.stringify(lrow));
ok(side2.projects.find((p: any) => p.id === "gone-off").status.en === "Disabled", "a disabled project still reads Disabled first");
const lostPg = (await get("/api/projects/lost/overview"))!.body;
const lk = Object.fromEntries(lostPg.health.map((t: any) => [t.key, t]));
ok(lostPg.project.folderMissing === true && lk.crew.tone === "warn" && lk.crew.detail.en === "This project's folder is missing." && lk.crew.detail.tw === "這個專案的資料夾不見了。", "a project whose own folder is missing: the crew tile says so in plain words", JSON.stringify(lk.crew));
const goneOff = (await get("/api/projects/gone-off/overview"))!.body;
ok(!leak(lostPg) && !leak(goneOff) && !leak(side2), "no reply carries exception text");
ok(goneOff.health[0].en === "Disabled" && goneOff.crew === null && goneOff.health.find((t: any) => t.key === "base").en === "Repository folder missing" && lk.base.en === "Repository folder missing", "a missing folder reads as such on the base tile");
writeFileSync(join(DATA, "projects.json"), healthy);
H.stop();
end();
