import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// M3 checks: artifact versions and manifest integrity, the web and video review
// loops with a stub agent and a stub renderer, the work tools' path guard, and
// the trivial lane against a local bare repo plus a mock GitHub REST server.
// No model, no browser, no real GitHub.   bun tests/m3.ts
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
import { PREVIEW_SANDBOX } from "../src/preview-csp";
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];
process.env.CREW_GH_NO_CLI = "1";
const here = import.meta.dir;
const sh = (cwd: string, ...args: string[]) => { const r = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (!r.success) throw new Error(`${args.join(" ")}: ${r.stderr}`); return r.stdout.toString().trim(); };
// a tiny PNG and a second, different one
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

// ---------- 1. artifact store: versions and integrity ----------
{
  const { ArtifactStore } = await import("../src/artifacts");
  const data = checkedTempDir("crew-m3-store-");
  const s = new ArtifactStore(data);
  const src = join(data, "src"); mkdirSync(src); writeFileSync(join(src, "index.html"), "<h1>v1</h1>"); writeFileSync(join(src, "style.css"), "h1{}");
  s.create({ id: "page", title: "Page", type: "web", source: "html", entry: "index.html" });
  const v1 = s.addVersion("page", { from: src, createdBy: { kind: "captain" } });
  ok(v1.n === 1 && v1.parent === null && v1.files.length === 2 && v1.primary === "index.html" && /^[0-9a-f]{64}$/.test(v1.sha256 ?? ""), "v1: files recorded with sha256, primary is the entry", JSON.stringify(v1));
  ok(s.verify("page", 1).length === 0, "an untouched version verifies");
  writeFileSync(join(src, "index.html"), "<h1>v2</h1>");
  const v2 = s.addVersion("page", { from: src, createdBy: { kind: "agent", provider: "stub", model: "x", run: "W1" }, annotations: ["P1"] });
  ok(v2.n === 2 && v2.parent === 1 && v2.annotations[0] === "P1" && v2.sha256 !== v1.sha256, "v2: parent 1, the notes that produced it, a new sha");
  ok(readFileSync(join(s.filesDir("page", 1), "index.html"), "utf8") === "<h1>v1</h1>", "v1's bytes are untouched by v2");
  writeFileSync(join(s.filesDir("page", 2), "index.html"), "<h1>tampered</h1>");
  ok(s.verify("page", 2).join() === "index.html", "a file changed after the fact is reported by verify()");
  let threw = ""; try { s.approve("page", 2, "captain"); } catch (e: any) { threw = e.message; }
  ok(/changed since they were recorded/.test(threw), "approving a tampered version is refused", threw);
  const approvedEvents: any[] = []; s.onApproved = (a, v, prev) => approvedEvents.push({ v: v.n, prev: prev?.n ?? null });
  s.approve("page", 1, "captain");
  ok(s.version("page", 1)!.status === "approved" && s.version("page", 1)!.approvedBy === "captain" && !!s.version("page", 1)!.approvedAt, "approve records who and when");
  writeFileSync(join(s.filesDir("page", 2), "index.html"), "<h1>v2</h1>");
  s.approve("page", 2, "captain");
  ok(s.version("page", 1)!.status === "superseded" && s.version("page", 2)!.status === "approved", "a newer approval supersedes the old one");
  ok(approvedEvents.at(-1)?.prev === 1, "the approval hook gets the previous approved version");
  const n = s.addNote("page", 2, { kind: "pin", comment: "bigger title", selector: "h1", bbox: { x: 1, y: 2, w: 3, h: 4 } });
  ok(n.id === "P1" && n.selector === "h1" && n.status === "open", "pin note recorded");
  let bad = ""; try { s.addNote("page", 2, { kind: "range", comment: "x", t0: 5, t1: 2 }); } catch (e: any) { bad = e.message; }
  ok(/t0 ≤ t1/.test(bad), "a range note with t1 < t0 is refused");
  ok(s.file("page", 2, "../../v1/files/index.html") === null && s.file("page", 2, "index.html") !== null, "version files are served only from inside their own folder");
  // shared assets are links: listed, never hashed
  const assets = join(data, "assets"); mkdirSync(assets); writeFileSync(join(assets, "a.png"), "x");
  s.create({ id: "film", title: "Film", type: "video", source: "film", entry: "film.html" });
  const fsrc = join(data, "fsrc"); mkdirSync(fsrc); writeFileSync(join(fsrc, "film.html"), "<div id=stage></div>");
  const fv = s.addVersion("film", { from: fsrc, createdBy: { kind: "import" }, links: { cast: assets } });
  ok(fv.files.length === 1 && !!s.sharedLinks("film", 1).cast, "a film's cast/ is linked into the version, not copied or hashed");
}

// ---------- 2. the work tools' guard ----------
{
  const { ArtifactStore } = await import("../src/artifacts");
  const { WorkRuns } = await import("../src/work");
  const data = checkedTempDir("crew-m3-work-");
  const s = new ArtifactStore(data); const w = new WorkRuns(s, data);
  const dir = join(data, "wd"); mkdirSync(dir); writeFileSync(join(dir, "index.html"), "<body>x</body>"); mkdirSync(join(data, "shared")); writeFileSync(join(data, "shared", "a.png"), "x");
  symlinkSync(join(data, "shared"), join(dir, "cast"));
  (w as any).tokens.set("tk", { run: "R", dir, calls: 0, max: 20, expires: Date.now() + 60_000 });
  w.runs.set("R", { id: "R", status: "running", notes: ["P1"], log: [], claims: [] } as any);
  const call = (n: string, a: any) => w.callTool("tk", n, a);
  ok(call("work_write", { path: "../escape.html", content: "x" }).error?.includes("not allowed") && !existsSync(join(data, "escape.html")), "work_write refuses a path outside the work folder");
  ok(call("work_write", { path: "/etc/x.html", content: "x" }).error?.includes("not allowed"), "work_write refuses an absolute path");
  ok(call("work_write", { path: "cast/b.html", content: "x" }).error?.includes("read-only"), "work_write refuses a shared-asset folder");
  ok(call("work_write", { path: "run.sh", content: "x" }).error?.includes("not editable"), "work_write refuses a non-text file type");
  ok(call("work_read", { path: "cast/a.png" }).error !== undefined, "binary files are not readable through the tools");
  ok(call("work_replace", { path: "index.html", old: "x", new: "y" }).ok === true && readFileSync(join(dir, "index.html"), "utf8") === "<body>y</body>", "work_replace edits inside the folder");
  ok(call("work_replace", { path: "index.html", old: "zzz", new: "y" }).error?.includes("not found"), "work_replace needs the exact text");
  ok(w.callTool("nope", "work_list", {}).error === "no valid work token", "a call without the run's token is refused");
  (w as any).tokens.get("tk").max = 0;
  ok(String(call("work_list", {}).error).includes("tool limit"), "the per-run tool limit is enforced");
}

// ---------- 3. the trivial lane: checks, unit level ----------
const gseen: { method: string; path: string; body: any; auth: string | null }[] = [];
let ciMode: "success" | "failure" | "pending" = "success";
const gapi = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const u = new URL(req.url); let body: any = null; try { body = await req.json(); } catch {}
  gseen.push({ method: req.method, path: u.pathname, body, auth: req.headers.get("authorization") });
  if (req.headers.get("authorization") !== "Bearer lane_token_1234567890abcdef") return Response.json({ message: "Bad credentials" }, { status: 401 });
  if (req.method === "POST" && u.pathname === "/repos/acme/demo/pulls") return Response.json({ number: 42, html_url: "https://github.com/acme/demo/pull/42" }, { status: 201 });
  if (req.method === "PUT" && u.pathname === "/repos/acme/demo/pulls/42/merge") return Response.json({ merged: true, sha: "abc" });
  if (/\/repos\/acme\/demo\/commits\/\w+\/check-runs/.test(u.pathname)) return Response.json({ check_runs: [{ name: "ci", status: ciMode === "pending" ? "in_progress" : "completed", conclusion: ciMode === "pending" ? null : ciMode }] });
  return Response.json({ message: "not found" }, { status: 404 });
} });
process.env.CREW_GITHUB_API = `http://127.0.0.1:${gapi.port}`;

const mkRepo = (root: string, name: string, readme: string) => {
  const bare = join(root, `${name}.git`); sh(root, "git", "init", "-q", "--bare", "-b", "main", bare);
  const clone = join(root, name); sh(root, "git", "clone", "-q", bare, clone);
  writeFileSync(join(clone, "README.md"), readme); mkdirSync(join(clone, "src"), { recursive: true }); writeFileSync(join(clone, "src", "app.js"), "1\n");
  sh(clone, "git", "add", "-A"); sh(clone, "git", "commit", "-q", "-m", "init"); sh(clone, "git", "push", "-q", "origin", "main");
  return { bare, clone };
};
{
  const { ArtifactStore } = await import("../src/artifacts");
  const { Lane } = await import("../src/recipes");
  const data = checkedTempDir("crew-m3-lane-");
  const s = new ArtifactStore(data);
  const img = join(data, "banner.png"); writeFileSync(img, PNG_A);
  const t = join(data, "t"); mkdirSync(t); cpSync(img, join(t, "image.png"));
  s.create({ id: "banner", title: "Crew banner", type: "image", source: "file", entry: "image.png" });
  s.addVersion("banner", { from: t, createdBy: { kind: "captain" } });
  const lane = new Lane(data, s);
  const { clone } = mkRepo(data, "r1", "# Demo\n\nSee [the docs](docs/guide.md).\n");
  lane.addRepo({ path: clone, name: "r1" });
  let e1 = ""; try { lane.run({ artifact: "banner", repo: "r1" }); } catch (e: any) { e1 = e.message; }
  ok(/approve a version first/.test(e1), "an unapproved artifact cannot go into a repo", e1);
  s.approve("banner", 1, "captain");
  const c = lane.run({ artifact: "banner", repo: "r1" });
  const ck = (id: string) => c.checks.find((x) => x.id === id);
  ok(c.state === "fallback" && ck("readme")?.ok === false && /docs\/guide\.md/.test(ck("readme")!.detail), "a README link to a missing file fails the README check: fallback", JSON.stringify(c.checks));
  ok(ck("paths")?.ok === true && ck("sha")?.ok === true && ck("size")?.ok === true, "the other checks still pass on that card");
  let e2 = ""; try { await lane.merge(c.id, "captain"); } catch (e: any) { e2 = e.message; }
  ok(/normal two-way path/.test(e2) && sh(clone, "git", "rev-parse", "main") === sh(clone, "git", "rev-parse", "origin/main"), "a fallback card never merges", e2);
  // a commit that also touches other files fails the paths check; a wrong sha fails the sha check; a big diff fails size
  const base = sh(clone, "git", "rev-parse", "main");
  sh(clone, "git", "checkout", "-q", "-b", "wide");
  mkdirSync(join(clone, "assets")); writeFileSync(join(clone, "assets", "x.png"), PNG_A); writeFileSync(join(clone, "src", "app.js"), "2\n");
  writeFileSync(join(clone, "README.md"), "![b](assets/x.png)\n" + "line\n".repeat(30) + "# Demo\n");
  sh(clone, "git", "add", "-A"); sh(clone, "git", "commit", "-q", "-m", "wide");
  const wideCommit = sh(clone, "git", "rev-parse", "HEAD"); sh(clone, "git", "checkout", "-q", "main");
  const fake: any = { ...c, kind: "add", baseCommit: base, commit: wideCommit, asset: "assets/x.png", sha256: "0".repeat(64) };
  const checks = lane.check(lane.repo("r1")!, fake);
  ok(checks.find((x) => x.id === "paths")?.ok === false && /src\/app\.js/.test(checks.find((x) => x.id === "paths")!.detail), "a change outside README.md and assets/ fails the paths check");
  ok(checks.find((x) => x.id === "sha")?.ok === false, "an image that is not the approved version fails the sha check");
  ok(checks.find((x) => x.id === "size")?.ok === false, "a diff over the line budget fails the size check");
}

// ---------- 4. the server: web loop, video loop, lane over HTTP ----------
const PW_STATE = join(here, "fixture/state");
const tmp = checkedTempDir("crew-m3-http-");
const state = join(tmp, "state"); cpSync(PW_STATE, state, { recursive: true });
const data = join(tmp, "data"); mkdirSync(data);
// an org policy line: the lane card's asset path is sensitive for the whole org (fix-sb-nav-leftovers #21)
mkdirSync(join(data, "policies"), { recursive: true }); writeFileSync(join(data, "policies", "org.yaml"), JSON.stringify({ sensitive_paths: [{ glob: "assets/**", why: "brand assets need the org's review" }] }));
// legacy M2 Library entries: an HTML film with its source, and a plain MP4 without one
const films = join(tmp, "films"); mkdirSync(films);
sh(tmp, "ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x180:rate=10", "-pix_fmt", "yuv420p", join(films, "film.mp4"));
writeFileSync(join(data, "artifacts.json"), JSON.stringify([{ id: "A-film-v13", type: "video", title: "Tiny film", path: join(films, "film.mp4"), created: "2026-10-13T00:00:00Z" },
  { id: "A-proto-v6", type: "web", title: "A prototype link", url: "https://example.com/proto", created: "2026-10-14T00:00:00Z" },
  { id: "A-outside", type: "video", title: "Outside", path: "/etc/hosts", created: "2026-10-14T00:00:00Z" }]));
const port = await freePort();
const app = Bun.spawn(["bun", "src/server.ts"], { cwd: join(here, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1",
  CREW_DATA: data, CREW_FILE_ALLOW: films, CREW_CHAT_PROVIDER: "stub", CREW_RENDER_STUB: "1", CREW_FILM_SOURCE: join(here, "fixture/film"), CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1",
  CREW_GITHUB_TOKEN: "lane_token_1234567890abcdef", CREW_GITHUB_API: `http://127.0.0.1:${gapi.port}`, CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj") } });
let appLog = ""; (async () => { for await (const c of app.stderr as any) appLog += new TextDecoder().decode(c); })();
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const get = async (p: string) => (await fetch(base + p)).json() as any;
const post = async (p: string, b: unknown = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() as any }; };
const waitRun = async (id: string, until = (r: any) => !["running", "rendering"].includes(r.status)) => { for (let i = 0; i < 100; i++) { const r = await get(`/api/runs/${id}`); if (until(r)) return r; await Bun.sleep(150); } return get(`/api/runs/${id}`); };

try {
  // legacy import
  const all = await get("/api/artifacts");
  const film = all.artifacts.find((a: any) => a.id === "film"), proto = all.artifacts.find((a: any) => a.id === "proto");
  ok(!!film && film.source === "film" && film.versions[0]?.n === 1 && film.versions[0]?.status === "in-review", "the M2 film MP4 is registered as film v1 with its HTML source", JSON.stringify(all.artifacts.map((a: any) => a.id)));
  ok(!!proto && proto.source === "url" && proto.versions[0]?.url === "https://example.com/proto", "the prototype link is registered as v1 (link only)");
  const outside = all.artifacts.find((a: any) => a.id === "outside");
  ok(!!outside && outside.versions[0].fileCount === 0 && /outside the allowed folders/.test(outside.versions[0].summary) && !existsSync(join(data, "artifacts/outside/v1/files/render.mp4")), "a legacy file outside the allowed folders is listed but never copied");
  const fd = await get("/api/artifacts/film");
  ok(fd.versions[0].files.some((f: any) => f.path === "render.mp4") && fd.versions[0].files.some((f: any) => f.path === "film.html") && fd.versions[0].integrity.length === 0, "film v1 holds film.html and render.mp4, intact");
  ok(fd.scenes.map((s: any) => `${s.name}:${s.t0}-${s.t1}`).join(",") === "sceneOpen:0-2,sceneMiddle:2-3,sceneEnd:3-4", "scene windows are read from the film source in film time", JSON.stringify(fd.scenes));

  // web loop
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Landing</title></head><body><header><h1 id="hero">Crew Studio</h1><p class="sub">Your crew, in view.</p></header><a class="cta" href="#">Start</a></body></html>`;
  const made = await post("/api/artifacts", { id: "landing", title: "Crew Studio landing", type: "web", html });
  ok(made.status === 200 && made.body.version.n === 1, "a web artifact from posted HTML becomes v1", JSON.stringify(made.body));
  const af = await fetch(`${base}/af/landing/1/index.html`);
  ok(af.ok && /connect-src 'none'/.test(af.headers.get("content-security-policy") ?? "") && /frame-ancestors 'self'/.test(af.headers.get("content-security-policy") ?? ""), "artifact pages are served with no network and Studio-only framing");
  const interactive = await fetch(`${base}/af/landing/1/index.html?interactive=1`);
  const interactiveCsp = interactive.headers.get("content-security-policy") || "";
  ok(readFileSync(new URL("../public/m3.js", import.meta.url), "utf8").includes(`const PREVIEW_SANDBOX_FLAGS = "${PREVIEW_SANDBOX.replace(/^sandbox /, "")}";`), "the interactive dialog's iframe sandbox carries the same flags as the preview CSP's sandbox (the browser applies their intersection)");
  ok(interactive.ok && interactiveCsp.includes("sandbox allow-scripts allow-forms;") && !interactiveCsp.includes("allow-same-origin") && interactiveCsp.includes("connect-src 'none'") && interactiveCsp.includes("script-src 'unsafe-inline'") && !interactiveCsp.includes("script-src 'self'"), "interactive preview executes inline scripts in an opaque sandbox blocking fetch, external scripts and same-origin access");
  ok((await fetch(`${base}/af/landing/1/..%2F..%2F..%2Fartifacts.json`)).status === 404, "artifact file serving cannot leave the version folder");
  // a deliverable needs Studio's session or a per-version capability (architecture §10): the ids are guessable, so /af/ is not open
  const noSess = await fetch(`${base}/af/landing/1/index.html`, { headers: { "x-crew-session": "" } });
  ok(noSess.status === 401, "GET /af/ without the session or a capability is refused (401)", String(noSess.status));
  const capRes = await fetch(`${base}/af-cap/landing/1`); const cap = (await capRes.json()).cap;
  const withCap = await fetch(`${base}/af/landing/1/index.html?cap=${encodeURIComponent(cap)}`, { headers: { "x-crew-session": "" } });
  ok(capRes.ok && typeof cap === "string" && withCap.ok, "a session-authenticated page mints a per-version capability that serves /af/ without the cookie (the sandboxed preview iframe)", JSON.stringify([capRes.status, withCap.status]));
  const wrongCap = await fetch(`${base}/af/landing/1/index.html?cap=${encodeURIComponent(cap)}x`, { headers: { "x-crew-session": "" } });
  const otherVer = await fetch(`${base}/af/landing/2/index.html?cap=${encodeURIComponent(cap)}`, { headers: { "x-crew-session": "" } });
  ok(wrongCap.status === 401 && otherVer.status === 401, "a tampered capability, or one minted for another version, is refused", JSON.stringify([wrongCap.status, otherVer.status]));
  ok((await fetch(`${base}/af-cap/landing/1`, { headers: { "x-crew-session": "" } })).status === 401, "minting a capability itself requires the session", "");
  const pin = await post("/api/artifacts/landing/v/1/notes", { kind: "pin", selector: "#hero", bbox: { x: 8, y: 21, w: 300, h: 37 }, comment: "Make the title larger and add a tagline" });
  const pin2 = await post("/api/artifacts/landing/v/1/notes", { kind: "pin", selector: "a.cta", bbox: { x: 8, y: 120, w: 40, h: 18 }, comment: "Make the button stand out" });
  ok(pin.body.id === "P1" && pin2.body.id === "P2", "pins recorded with selector and box");
  let crop = ""; for (let i = 0; i < 30 && !crop; i++) { await Bun.sleep(100); crop = (await get("/api/artifacts/landing/v/1/notes"))[0].crop ?? ""; }
  ok(!!crop && (await fetch(base + crop)).ok, "each pin gets a screenshot crop", crop);
  const brief = await get("/api/artifacts/landing/v/1/brief");
  ok(/P1: element `#hero`/.test(brief.brief) && /P2: element `a\.cta`/.test(brief.brief) && brief.structured.length === 2, "the feedback brief lists every open pin with its element");
  const req = await post("/api/artifacts/landing/v/1/request", {});
  ok(req.status === 200 && req.body.status === "running" && req.body.provider === "stub", "Request changes starts a run", JSON.stringify(req.body));
  const busy = await post("/api/artifacts/landing/v/1/request", {});
  ok(busy.status === 400 && /already working/.test(busy.body.error), "one run per artifact at a time");
  const run = await waitRun(req.body.id);
  ok(run.status === "done" && run.version === 2 && run.changed.includes("index.html"), "the run produced v2 from the changed page", JSON.stringify({ s: run.status, e: run.error, v: run.version }));
  ok(run.claims.length === 2 && run.claims.every((c: any) => c.addressed) && run.cost?.inTokens === 10, "the agent's claims per note and its reported spend are kept");
  const ld = await get("/api/artifacts/landing");
  const v2 = ld.versions.find((v: any) => v.n === 2), n1 = ld.versions.find((v: any) => v.n === 1).notes;
  ok(v2.parent === 1 && v2.annotations.join() === "P1,P2" && v2.createdBy.kind === "agent" && v2.status === "in-review", "v2 records its parent, the notes behind it and who made it");
  ok(n1.every((n: any) => n.addressed?.claim === true && n.addressed.version === 2 && !n.verified), "v1's pins carry the agent's 'addressed?' claim, unverified");
  ok((await (await fetch(`${base}/af/landing/2/index.html`)).text()).includes("revised by the stub for P1, P2") && !(await (await fetch(`${base}/af/landing/1/index.html`)).text()).includes("revised"), "v2 has the change; v1 is unchanged");
  const ver = await post("/api/artifacts/landing/v/1/notes/P1", { verified: true, status: "resolved" });
  ok(ver.body.verified === true && ver.body.status === "resolved", "the captain marks a pin verified");
  const ap = await post("/api/artifacts/landing/v/2/approve");
  ok(ap.body.status === "approved" && ap.body.approvedBy === "captain", "Approve pins v2");
  // escape attempt inside a run: refused, no file written
  await post("/api/artifacts/landing/v/2/notes", { kind: "pin", selector: "h1", comment: "STUB_ESCAPE try" });
  const esc = await waitRun((await post("/api/artifacts/landing/v/2/request", {})).body.id);
  ok(esc.log.some((l: any) => /not allowed/.test(l.text)) && !existsSync(join(data, "escape.html")) && !existsSync(join(data, "work", "escape.html")), "a run that tries to write outside its folder is refused", JSON.stringify(esc.log.slice(-5)));
  await post("/api/artifacts/landing/v/3/notes", { kind: "pin", selector: "h1", comment: "STUB_NOCHANGE please" });
  const noop = await waitRun((await post("/api/artifacts/landing/v/3/request", {})).body.id);
  ok(noop.status === "failed" && /changed nothing/.test(noop.error), "a run that changes nothing makes no version");

  // video loop: notes on film v1, the brief maps times to scenes, the run edits film.html, a render attaches render.mp4
  const r1 = await post("/api/artifacts/film/v/1/notes", { kind: "range", t0: 3.0, t1: 4.0, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, comment: "hold the final tagline 0.5 s longer" });
  ok(r1.body.id === "R1" && r1.body.t0 === 3 && r1.body.box?.w === 0.5, "a timeline range note with a frame box");
  const fb = await get("/api/artifacts/film/v/1/brief");
  ok(/R1: 0:03\.0–0:04\.0 \(frame area x=10% y=20% w=50% h=30%\), scenes: sceneEnd \[3–4s\]/.test(fb.brief), "the brief maps the note's time to the film's scene functions", fb.brief);
  const fr = await waitRun((await post("/api/artifacts/film/v/1/request", {})).body.id);
  ok(fr.status === "done" && fr.version === 2 && fr.changed.join() === "film.html", "the film run edits film.html only", JSON.stringify({ s: fr.status, e: fr.error, c: fr.changed }));
  const fd2 = await get("/api/artifacts/film");
  const fv2 = fd2.versions.find((v: any) => v.n === 2);
  ok(fv2.render?.state === "done" && fv2.files.some((f: any) => f.path === "render.mp4"), "v2 is rendered to render.mp4 (stub renderer)", JSON.stringify(fv2.render));
  ok(existsSync(join(data, "artifacts/film/v2/files/cast")) && fv2.files.every((f: any) => !f.path.startsWith("cast/")), "v2 links the shared cast/ instead of copying it");
  ok((await fetch(`${base}/af/film/2/render.mp4`)).headers.get("content-type") === "video/mp4", "v2's MP4 is served for the A/B player");
  // a plain MP4 without source: notes and a brief, no regeneration
  cpSync(join(films, "film.mp4"), join(data, "clip.mp4"));
  const plain = await post("/api/artifacts", { id: "clip", title: "A clip", type: "video", path: join(data, "clip.mp4") });
  ok(plain.status === 200 && plain.body.artifact.source === "file", "a plain MP4 is an artifact without a source");
  await post("/api/artifacts/clip/v/1/notes", { kind: "range", t0: 0.2, t1: 0.6, comment: "too dark" });
  const pb = await get("/api/artifacts/clip/v/1/brief");
  const pr = await post("/api/artifacts/clip/v/1/request", {});
  ok(/R1: 0:00\.2–0:00\.6/.test(pb.brief) && pr.status === 400 && /no source/.test(pr.body.error), "plain MP4: notes export as a brief; regenerate is refused", JSON.stringify(pr.body));

  // the lane over HTTP: GitHub repo (mock REST), happy path, PR, CI, merge; then an update proposal
  const root = join(tmp, "repos"); mkdirSync(root);
  const { clone, bare } = mkRepo(root, "demo", "# Demo\n\nHello.\n");
  writeFileSync(join(data, "banner.png"), PNG_A);
  await post("/api/artifacts", { id: "banner", title: "Crew banner", type: "image", path: join(data, "banner.png") });
  const repoAdd = await post("/api/lane/repos", { path: clone, name: "demo", github: "acme/demo" });
  ok(repoAdd.body.id === "demo" && repoAdd.body.remote === "origin" && repoAdd.body.base === "main", "a local clone registers as a repo with its remote and base");
  const early = await post("/api/lane/run", { artifact: "banner", repo: "demo" });
  ok(early.status === 400 && /approve/.test(early.body.error), "Use in repo needs an approved version");
  await post("/api/artifacts/banner/v/1/approve");
  const card = (await post("/api/lane/run", { artifact: "banner", repo: "demo", name: "banner" })).body;
  { const lc = ((await get("/api/artifacts/banner")).cards ?? []).find((c: any) => c.id === card.id);
    ok(lc?.door?.door === "one-way" && lc.door.reasons.some((x: any) => x.list === "org" && x.glob === "assets/**"), "a lane card's door reads the org policy's sensitive paths (orgDefaults)", JSON.stringify(lc?.door)); }
  ok(card.state === "ready" && card.checks.filter((c: any) => c.ok === false).length === 0, "approved image → recipe → a ready card, all checks pass", JSON.stringify(card.checks));
  ok(sh(bare, "git", "rev-parse", "--verify", `refs/heads/${card.branch}`) === card.commit, "the branch is pushed to the remote");
  const files = sh(clone, "git", "diff", "--name-only", card.baseCommit, card.commit);
  ok(files === "README.md\nassets/banner.png", "the commit touches only README.md and assets/banner.png", files);
  ok(sh(clone, "git", "show", `${card.commit}:README.md`).startsWith("![Crew banner](assets/banner.png)"), "the image line is at the top of the README");
  const prev = (await get(`/api/lane/${card.id}/preview`)).html;
  ok(/<img alt="Crew banner" src="\/api\/lane\/L[\w]+\/blob\?path=assets%2Fbanner\.png">/.test(prev) && (await fetch(`${base}/api/lane/${card.id}/blob?path=assets/banner.png`)).ok, "the card renders the README with the image from the branch", prev.slice(0, 200));
  ok((await post(`/api/lane/${card.id}/merge`)).body.error === "open the PR first", "a GitHub repo merges only through its PR");
  const withPr = (await post(`/api/lane/${card.id}/pr`)).body;
  const prCall = gseen.find((g) => g.method === "POST" && g.path === "/repos/acme/demo/pulls");
  ok(withPr.pr?.number === 42 && prCall?.body?.head === card.branch && prCall?.body?.base === "main" && prCall.auth === "Bearer lane_token_1234567890abcdef", "the PR is opened through the REST API (mock)", JSON.stringify(prCall?.body));
  ciMode = "pending"; const pend = (await post(`/api/lane/${card.id}/ci`)).body;
  ok(pend.checks.find((c: any) => c.id === "ci").detail.startsWith("running") && pend.state === "ready", "CI running is shown and does not fail the card");
  ok(/still running/.test((await post(`/api/lane/${card.id}/merge`)).body.error), "no merge while CI runs");
  ciMode = "success"; const green = (await post(`/api/lane/${card.id}/ci`)).body;
  ok(green.checks.find((c: any) => c.id === "ci").ok === true, "CI green from the check runs");
  ok(!gseen.some((g) => g.method === "PUT"), "nothing merges before the captain's click");
  const merged = (await post(`/api/lane/${card.id}/merge`)).body;
  const put = gseen.find((g) => g.method === "PUT");
  ok(merged.state === "merged" && put?.path === "/repos/acme/demo/pulls/42/merge" && put.body.sha === card.commit && put.body.merge_method === "squash", "Merge goes through the REST API with the reviewed sha", JSON.stringify(put));
  // a CI failure on another card falls back
  const card2 = (await post("/api/lane/run", { artifact: "banner", repo: "demo", name: "banner2" })).body;
  await post(`/api/lane/${card2.id}/pr`); ciMode = "failure";
  const red = (await post(`/api/lane/${card2.id}/ci`)).body;
  ok(red.state === "fallback" && red.checks.find((c: any) => c.id === "ci").ok === false, "failing CI makes the card fall back to the normal path");
  ok(/two-way path/.test((await post(`/api/lane/${card2.id}/merge`)).body.error), "a fallback card refuses to merge");
  await post(`/api/lane/${card2.id}/close`); ciMode = "success";
  // a new approved version proposes an update for the repo holding the old one
  writeFileSync(join(data, "banner-v2.png"), PNG_B);
  const nv = (await post("/api/artifacts/banner/versions", { path: join(data, "banner-v2.png"), summary: "brighter" })).body;
  ok(nv.n === 2 && nv.createdBy.kind === "captain", "the captain adds banner v2");
  await post("/api/artifacts/banner/v/2/approve");
  const lanes = (await get("/api/lane")).cards;
  const draft = lanes.find((c: any) => c.kind === "update" && c.state === "draft");
  ok(!!draft && draft.repo === "demo" && draft.asset === "assets/banner.png" && draft.replaces?.version === 1 && draft.version === 2, "approving v2 proposes an update card (draft) for the repo that holds v1", JSON.stringify(lanes.map((c: any) => [c.kind, c.state])));
  const prepared = (await post(`/api/lane/${draft.id}/prepare`)).body;
  ok(prepared.state === "ready" && prepared.kind === "update" && prepared.checks.find((c: any) => c.id === "paths").ok && sh(clone, "git", "diff", "--name-only", prepared.baseCommit, prepared.commit) === "assets/banner.png", "Prepare runs the replace recipe: only the image changes", JSON.stringify(prepared.checks));
  ok(prepared.checks.find((c: any) => c.id === "sha").detail.includes("banner v2"), "the update carries v2's sha");
  // local repo without GitHub: merge fast-forwards the base
  const local = join(root, "local"); mkdirSync(local); sh(local, "git", "init", "-q", "-b", "main"); writeFileSync(join(local, "README.md"), "# Local\n"); sh(local, "git", "add", "-A"); sh(local, "git", "commit", "-q", "-m", "init");
  await post("/api/lane/repos", { path: local, name: "local" });
  const lc = (await post("/api/lane/run", { artifact: "banner", repo: "local" })).body;
  ok(lc.state === "ready" && lc.checks.find((c: any) => c.id === "ci").ok === null, "a local repo: ready, CI not available");
  const lm = (await post(`/api/lane/${lc.id}/merge`)).body;
  ok(lm.state === "merged" && sh(local, "git", "rev-parse", "main") === lc.commit && existsSync(join(local, "assets/banner.png")), "local merge fast-forwards main on the captain's click");
  ok(readFileSync(join(data, "repo-refs.jsonl"), "utf8").split("\n").filter(Boolean).length === 2, "each merge records what went where");
} catch (e: any) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-2000)}`); }
finally { app.kill(); gapi.stop(true); }
console.log(`\nm3: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
