import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The visual sandbox (unit visual-sandbox): the sandbox repository gains Corner Shop, a
// shop page built on money-kit (a normal commit on main, held while a run works on the
// repository, never over the captain's files), and code-firstmate captures the app on
// the base and the head of a change that touches it: the PNGs, the visible text that
// changed, and the head's build ("Open the app") on the merge card.
//   bun tests/visual-sandbox.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort } from "./boot.mjs";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("visual-sandbox");
const root = join(import.meta.dir, "..");
const sh = (cwd: string, ...argv: string[]) => { const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "c", GIT_AUTHOR_EMAIL: "c@c", GIT_COMMITTER_NAME: "c", GIT_COMMITTER_EMAIL: "c@c" } }); return { code: r.exitCode, out: (r.stdout.toString() + r.stderr.toString()).trim() }; };
const { prepareSandbox, registerSandbox, applySandboxAddons } = await import("../src/sandbox-repo");
// R-002's change to format(), as it was built: yen have no cents
const YEN_MONEY = readFileSync(join(root, "templates/sandbox-repo/src/money.ts"), "utf8")
  .replace('/** "$12.34" from 1234. */\nexport function format(amount: number): string {', '/** Currencies format() knows. */\nexport type Currency = "USD" | "JPY";\n\n/** "$12.34" from 1234 (USD); "¥1,234" from (1234, "JPY"). */\nexport function format(amount: number, currency: Currency = "USD"): string {')
  .replace("  const abs = Math.abs(amount);\n", '  const abs = Math.abs(amount);\n  if (currency === "JPY") {\n    return `${sign}¥${abs.toLocaleString("en-US")}`;\n  }\n');

// ---------- the addition: a normal commit on main, held while a run works on the repository ----------
const d1 = checkedTempDir("crew-vis-"); const repo1 = join(d1, "demo-repo"); mkdirSync(repo1);
sh(repo1, "git", "init", "-q", "-b", "main"); writeFileSync(join(repo1, "NOTES.md"), "Notes.\n"); sh(repo1, "git", "add", "NOTES.md"); sh(repo1, "git", "commit", "-q", "-m", "Demo repository");
prepareSandbox(d1); const setupHead = sh(repo1, "git", "rev-parse", "HEAD").out;
const held = applySandboxAddons(d1, { live: () => ["R-002"] });
ok(JSON.stringify(held.held) === '["corner-shop"]' && !held.committed && sh(repo1, "git", "rev-parse", "HEAD").out === setupHead && !existsSync(join(repo1, "app")),
  "while a run works on the repository the addition is held: main does not move under its branch", JSON.stringify(held));
const a1 = applySandboxAddons(d1);
ok(JSON.stringify(a1.applied) === '["corner-shop"]' && !!a1.committed && sh(repo1, "git", "rev-parse", "HEAD~1").out === setupHead && sh(repo1, "git", "rev-list", "--count", "HEAD").out === "3" && /^feat\(app\): Corner Shop/.test(sh(repo1, "git", "log", "-1", "--format=%s").out),
  "then it lands as one normal commit on top of main: the history (the captain's first commit, the setup) is kept", JSON.stringify(a1));
const pkg = JSON.parse(readFileSync(join(repo1, "package.json"), "utf8"));
ok(["app/shop.ts", "app/server.ts", "app/build.ts", "test/shop.test.ts", ".crew/app.json"].every((f) => existsSync(join(repo1, f))) && pkg.scripts.dev === "bun app/server.ts" && pkg.scripts.test === "bun test" && sh(repo1, "git", "status", "--porcelain").out === "",
  "it adds the app under app/, its tests, .crew/app.json and the dev script, and leaves nothing uncommitted", JSON.stringify(pkg.scripts));
const t1 = sh(repo1, "bun", "test");
ok(t1.code === 0 && /across 3 files/.test(t1.out) && /0 fail/.test(t1.out), "the library's tests and the app's tests pass", t1.out.slice(-200));
ok(sh(repo1, "bun", "run", "lint").code === 0, "the lint still passes");
ok(JSON.stringify(applySandboxAddons(d1).applied) === "[]", "an addition is applied once");

// ---------- the app renders ----------
const out1 = join(d1, "build-base"); const b1 = sh(repo1, "bun", "app/build.ts", out1);
const usd = readFileSync(join(out1, "index.html"), "utf8"), jpy0 = readFileSync(join(out1, "jpy.html"), "utf8");
ok(b1.code === 0 && /Corner Shop/.test(usd) && /data-product="plant"/.test(usd) && usd.includes("<b data-total>$37.25</b>") && jpy0.includes("<b data-total>$55.88</b>"),
  "the app builds its pages: the product grid, the basket and the total in dollars; today the yen page shows yen as cents (the bug R-002 fixes)", jpy0.match(/data-total>[^<]*/)?.[0] ?? b1.out);
{ const port = await freePort(); const dev = Bun.spawn(["bun", "app/server.ts"], { cwd: repo1, env: { ...process.env, PORT: String(port) }, stdout: "pipe", stderr: "pipe" });
  let page = ""; for (let i = 0; i < 50 && !page; i++) { try { page = await (await fetch(`http://127.0.0.1:${port}/?currency=USD&cart=tea:2`)).text(); } catch { await Bun.sleep(100); } }
  dev.kill(); ok(/Corner Shop/.test(page) && page.includes("<b data-total>$17.00</b>") && page.includes('href="/?currency=JPY&amp;cart=tea%3A2"'), "`bun run dev` serves it, the basket and the currency in the link", page.slice(0, 200)); }
// with R-002's change the yen page shows yen
writeFileSync(join(repo1, "src/money.ts"), YEN_MONEY); const out2 = join(d1, "build-head"); sh(repo1, "bun", "app/build.ts", out2); sh(repo1, "git", "checkout", "--", "src/money.ts");
const jpy1 = readFileSync(join(out2, "jpy.html"), "utf8");
ok(jpy1.includes("<b data-total>¥5,588</b>") && jpy1.includes('data-price="tea">¥1,275<') && readFileSync(join(out2, "index.html"), "utf8").includes("<b data-total>$37.25</b>"), "with R-002's change applied, the yen switch shows ¥ formatting (¥5,588) and dollars stay as they were", jpy1.match(/data-total>[^<]*/)?.[0] ?? "");

// ---------- the captain's files are never overwritten ----------
{ const d2 = checkedTempDir("crew-vis2-"); const r2 = join(d2, "demo-repo"); mkdirSync(r2); sh(r2, "git", "init", "-q", "-b", "main"); prepareSandbox(d2);
  mkdirSync(join(r2, "app")); writeFileSync(join(r2, "app/shop.ts"), "// the captain's own shop\n"); sh(r2, "git", "add", "app/shop.ts"); sh(r2, "git", "commit", "-q", "-m", "my shop");
  const pj = readFileSync(join(r2, "package.json"), "utf8"); writeFileSync(join(r2, "package.json"), pj.replace('"lint"', '"fmt": "x",\n    "lint"'));
  const a2 = applySandboxAddons(d2);
  ok(readFileSync(join(r2, "app/shop.ts"), "utf8") === "// the captain's own shop\n" && a2.kept.includes("app/shop.ts") && a2.kept.some((k) => k.startsWith("package.json")) && /"fmt": "x"/.test(readFileSync(join(r2, "package.json"), "utf8"))
    && !/"dev"/.test(readFileSync(join(r2, "package.json"), "utf8")) && sh(r2, "git", "diff", "--name-only").out === "package.json",
    "a file the captain has is kept as it is, and a package.json with uncommitted changes is not touched (the addition commits only what it wrote)", JSON.stringify(a2)); }

// ---------- what an untrusted build wrote is copied with links refused, never followed ----------
{ const { copyUntrusted } = await import("../src/secure"); const fs = await import("node:fs");
  const src = checkedTempDir("crew-vis-out-"), dst = checkedTempDir("crew-vis-copy-"), sec = checkedTempDir("crew-vis-key-");
  writeFileSync(join(sec, "key"), "SECRET-KEY-MATERIAL-1\n"); writeFileSync(join(src, "index.html"), "<h1>ok</h1>"); mkdirSync(join(src, "css")); writeFileSync(join(src, "css", "a.css"), "h1{}");
  fs.symlinkSync(join(sec, "key"), join(src, "link.html")); fs.symlinkSync(sec, join(src, "dir")); fs.linkSync(join(sec, "key"), join(src, "hard.html"));
  Bun.spawnSync(["mkfifo", join(src, "pipe")]);
  const r = copyUntrusted(src, dst); const all = (fs.readdirSync(dst, { recursive: true }) as string[]).sort();
  ok(JSON.stringify(all) === '["css","css/a.css","index.html"]' && ["link.html: a symlink", "dir: a symlink", "hard.html: a hard link", "pipe: not a regular file"].every((x) => r.refused.includes(x)),
    "copying a build's output keeps regular files and folders only: a symlink (to a file or a folder), a hard link and a fifo are refused", JSON.stringify([all, r.refused]));
  for (const x of [src, dst, sec]) rmSync(x, { recursive: true, force: true }); }
// the descriptor copy reads macOS arm64's struct layouts: elsewhere (x86_64 macOS, Linux) the copy falls back to the path walk, which refuses links too
{ const { copyUntrusted } = await import("../src/secure"); const { canCopyByDescriptor } = await import("../src/untrusted-copy"); const fs = await import("node:fs");
  const src = checkedTempDir("crew-vis-out-"), sec = checkedTempDir("crew-vis-key-"); writeFileSync(join(sec, "k"), "SECRET-KEY-MATERIAL-4"); writeFileSync(join(src, "ok.html"), "ok"); fs.symlinkSync(join(sec, "k"), join(src, "l.html"));
  const runs = [["darwin", "x64"], ["linux", "x64"], ["linux", "arm64"]].map(([platform, arch]) => { const d = checkedTempDir("crew-vis-copy-"); const r = copyUntrusted(src, d, { platform, arch }); return { platform, arch, r, files: fs.readdirSync(d) }; });
  ok(!canCopyByDescriptor("darwin", "x64") && !canCopyByDescriptor("linux", "arm64") && canCopyByDescriptor("darwin", "arm64") && runs.every((x) => x.r.method === "path" && JSON.stringify(x.files) === '["ok.html"]' && x.r.refused.includes("l.html: a symlink")),
    "off macOS arm64 the copy never uses the arm64 struct layout: it falls back to the path walk, which still refuses a link", JSON.stringify(runs.map((x) => [x.platform, x.arch, x.r.method, x.files])));
  if (process.platform === "darwin" && process.arch === "arm64") { const d = checkedTempDir("crew-vis-copy-"); ok(copyUntrusted(src, d).method === "descriptor", "on macOS arm64 the copy is by descriptor"); }
  for (const x of [src, sec]) rmSync(x, { recursive: true, force: true }); }
{ const { copyUntrusted } = await import("../src/secure"); const fs = await import("node:fs");
  const src = checkedTempDir("crew-vis-out-"), sec = checkedTempDir("crew-vis-key-");
  mkdirSync(join(sec, "deep")); writeFileSync(join(sec, "deep", "page.html"), "SECRET-KEY-MATERIAL-2"); writeFileSync(join(sec, "page.html"), "SECRET-KEY-MATERIAL-3");
  // a link one level down: a/ is a real folder, a/b is a link to a folder outside
  mkdirSync(join(src, "a")); writeFileSync(join(src, "a", "ok.html"), "ok"); fs.symlinkSync(sec, join(src, "a", "b"));
  const d1 = checkedTempDir("crew-vis-copy-"); const r1 = copyUntrusted(src, d1); const got1 = (fs.readdirSync(d1, { recursive: true }) as string[]).sort();
  ok(JSON.stringify(got1) === '["a","a/ok.html"]' && r1.refused.includes("a/b: a symlink"), "a link at an inner level (a/b → a folder outside) is refused, never walked into", JSON.stringify([got1, r1.refused]));
  // a process that swaps a folder for a link while the copy runs: whatever the timing, nothing from outside is copied
  mkdirSync(join(src, "d")); writeFileSync(join(src, "d", "page.html"), "fine"); rmSync(join(src, "a"), { recursive: true, force: true });
  const swapper = Bun.spawn(["/bin/sh", "-c", `cd "${src}" && while true; do mv d d.real && ln -s "${sec}" d && rm d && mv d.real d; done`], { stdout: "ignore", stderr: "ignore" });
  let leaks = 0, sawLink = 0, sawDir = 0;
  for (let i = 0; i < 300; i++) { const d = checkedTempDir("crew-vis-race-"); const r = copyUntrusted(src, d);
    const files = (fs.readdirSync(d, { recursive: true }) as string[]).map(String); if (files.some((f) => { try { return fs.readFileSync(join(d, f), "utf8").includes("SECRET"); } catch { return false; } })) leaks++;
    if (r.refused.some((x) => x.startsWith("d: "))) sawLink++; if (files.includes("d/page.html")) sawDir++; rmSync(d, { recursive: true, force: true }); }
  swapper.kill();
  ok(leaks === 0 && sawLink + sawDir > 0, "with a folder swapped for a link during the copy (300 copies under a racing process), nothing from outside is ever copied", JSON.stringify({ leaks, sawLink, sawDir }));
  for (const x of [src, sec]) rmSync(x, { recursive: true, force: true }); }

// ---------- captures in code-firstmate ----------
// A: a change to the library the app uses, with no headless browser: the pages are built and compared as text only
process.env.CREW_NODE_BIN = "/nonexistent/node"; delete process.env.CREW_RENDER_STUB;
let data = checkedTempDir("crew-vis-run-"); const scenarioData=[data]; prepareSandbox(data); applySandboxAddons(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
let H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data, checkRoots: [] });
// the late writer (test seam): once the build has exited it still holds the path of the build's output folder, as a process that
// escaped the build would, and writes a page there and swaps sub/ for a link to the secret (it acts in run C only)
const late = { on: false, dir: "", tried: 0 };
let E = H.engine; const installVisual=()=>installCode(E, { dataDir: data, projects: new Projects(data), seams: { afterBuildExit: (raw, side) => { if (!late.on || side !== "after") return; late.tried++; const fs = require("node:fs") as typeof import("node:fs");
  try { fs.writeFileSync(join(raw, "late.html"), "<h1>late SECRET-KEY-MATERIAL-late</h1>"); } catch {}
  try { fs.rmSync(join(raw, "sub"), { recursive: true, force: true }); fs.symlinkSync(late.dir, join(raw, "sub")); } catch {} } } });
installVisual();
const esc = (s: string) => { if (s.includes("\\")) throw new Error("the stub writes \\n only: no backslashes in a STUB_FILE"); return s.replace(/\n/g, "\\n"); };
const waitCard = async (id: string, kind: string) => { await until(() => E.cards.list({ run: id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(id)!.status), 180000); return E.cards.list({ run: id, open: true }).find((c) => c.kind === kind); };
const toMerge = async (text: string) => {
  // Each independent capture scenario owns a different actual native project;
  // cancelled unmerged work in the previous scenario retains its scope.
  if(E.list().length){H.stop();data=checkedTempDir("crew-vis-run-");scenarioData.push(data);prepareSandbox(data);applySandboxAddons(data);registerSandbox(data);H=await harness([readFileSync(join(root,"packs/firstmate/workflows/code-firstmate.wf.yaml"),"utf8")],{data,checkRoots:[]});E=H.engine;installVisual();}
  const r = E.start({ workflow: "code-firstmate", params: {}, text }); const d = await waitCard(r.id, "dispatch"); if (d) await E.answer(d.id, { choice: "dispatch", by: "captain" });
  // a UI change whose app pages are not all captured stops at Firstmate's capture gap (the designer round), never at the merge card
  await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === "merge" || c.node === "design-gap-card") || ["succeeded", "failed"].includes(E.get(r.id)!.status), 180000);
  const m = E.cards.list({ run: r.id, open: true }).find((c) => c.kind === "merge"); const gap = E.cards.list({ run: r.id, open: true }).find((c) => c.node === "design-gap-card"); const g = E.get(r.id)!;
  if (!m && !gap) console.log("no merge card:", JSON.stringify(Object.fromEntries(Object.entries(g.nodes).filter(([, n]: any) => n.state !== "pending").map(([k, n]: any) => [k, `${n.state}:${n.outcome}:${n.error ?? ""}`]))), JSON.stringify(E.ledger(r.id).filter((e) => e.verdict !== "pass").map((e) => [e.check, e.findings.slice(0, 2).map((f: any) => f.message)])).slice(0, 800));
  return { r, m, gap, cap: E.ledger(r.id).filter((e) => e.check === "firstmate/ui-captures").at(-1) as any }; };
const filesUnder = (d: string): string[] => { const fs = require("node:fs") as typeof import("node:fs"); if (!fs.existsSync(d)) return []; return fs.readdirSync(d, { recursive: true }).map(String).map((f) => join(d, f)); };
// (the app and the README call format(): caller coverage puts them in the scope, as R-002's spec did)
const A = await toMerge(["Let format() handle currencies without cents, like JPY", "STUB_SCOPE app/", "STUB_SCOPE README.md", "STUB_SCOPE test/",
  `STUB_FILE src/money.ts :: ${esc(YEN_MONEY)}`,
  `STUB_FILE test/yen.test.ts :: ${esc('import { expect, test } from "bun:test";\nimport { format } from "../src/money";\n\ntest("yen have no cents", () => expect(format(1235, "JPY")).toBe("¥1,235"));\n')}`].join("\n"));
ok(!!A.gap && A.cap?.verdict === "warn" && A.cap.findings.some((f: any) => f.class === "renderer-missing") && A.cap.data?.captures?.length === 2 && A.cap.data.captures.every((c: any) => c.before === null && c.after === null),
  "with no headless browser the capture check warns (renderer-missing), and before / after are empty", JSON.stringify([A.cap?.verdict, A.cap?.findings, A.cap?.data?.captures]).slice(0, 500));
const yen = A.cap?.data?.captures?.find((c: any) => c.label === "Shop in yen");
ok(!!yen && yen.changed.removed.includes("$55.88") && yen.changed.added.includes("¥5,588"), "the visible text that changed is recorded all the same: the yen total went from $55.88 to ¥5,588", JSON.stringify(yen?.changed));
// the app is declared but its pages have no pictures: the designer round does not judge it from the diff; Firstmate gets the env gap first
ok(!A.m && !!A.gap && /env\.design-captures/.test(A.gap.body) && /not shot: no headless browser/.test(A.gap.body) && !(E.get(A.r.id)!.ctx.designs ?? []).length,
  "with no pictures of a declared app there is no diff-only design verdict and no merge card: the capture gap goes to Firstmate, then the captain", JSON.stringify([A.gap?.body, A.m?.id]).slice(0, 700));
ok(/^\/api\/wruns\/R-\d+\/captures\/[0-9a-f]{12}\/after\/index\.html$/.test(E.get(A.r.id)!.ctx.captures?.app ?? ""), "the run records the head's build link (the run page's Open the app)", JSON.stringify(E.get(A.r.id)!.ctx.captures?.app));
if (A.gap) E.cancel(A.r.id, "captain");

// B: a change that does not touch the app: nothing captured, nothing on the card
const B = await toMerge(["Say in the README that yen are supported",
  `STUB_FILE README.md :: ${esc("# money-kit\n\nAmounts in cents; yen are whole yen.\n")}`,
  `STUB_FILE test/readme.test.ts :: ${esc('import { expect, test } from "bun:test";\nimport { readFileSync } from "node:fs";\n\ntest("the README mentions yen", () => expect(readFileSync("README.md", "utf8")).toContain("yen"));\n')}`].join("\n"));
ok(!!B.m && B.cap?.verdict === "pass" && B.cap.data?.skipped === "no app path changed" && !B.m.captures && !B.m.links.some((l) => l.label === "Open the app") && !existsSync(join(E.rdir(B.r.id), "captures")),
  "a docs change is not captured: the check passes with 'no app path changed', the card has no captures and no Open the app", JSON.stringify([B.cap?.data, B.m?.captures]).slice(0, 400));
if (B.m) E.cancel(B.r.id, "captain");

// C: a hostile build: it writes a symlink to a secret, tries a hard link, and a page that loads file:// and another host
// the real renderer: the Playwright the suite uses (PLAYWRIGHT_MODULE, else the package); without it this test fails, it never passes vacuously
delete process.env.CREW_NODE_BIN;
const PW = process.env.PLAYWRIGHT_MODULE || (() => { try { return Bun.fileURLToPath(import.meta.resolve("playwright")); } catch { return ""; } })();
ok(!!PW && existsSync(PW), "Playwright is found (PLAYWRIGHT_MODULE, else the playwright package): the renderer checks below need it", PW || "set PLAYWRIGHT_MODULE to playwright's index.mjs, or install playwright");
process.env.CREW_PLAYWRIGHT_MODULE = PW;
{ const { runRender } = await import("../src/render"); const pd = checkedTempDir("crew-vis-probe-"); writeFileSync(join(pd, "p.html"), "<h1>probe</h1>");
  const res = await runRender(pd, "page", { root: pd, page: "p.html", out: join(pd, "p.png"), width: "400" }).done;
  ok(res.ok && existsSync(join(pd, "p.png")), "the renderer works with this Playwright (its browser is installed)", `${PW}: ${res.error ?? ""}`); rmSync(pd, { recursive: true, force: true }); }
const LINGER = `61.${process.pid}${Date.now() % 100000}`; // this run's own marker: parallel runs (other worktrees) never cross
const secretDir = checkedTempDir("crew-vis-secret-"); const SECRET = join(secretDir, "id_ed25519"); writeFileSync(SECRET, "SECRET-KEY-MATERIAL-7c41\n");
const hostile = [
  'import { linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";', 'import { join } from "node:path";',
  'const out = process.argv[2] ?? "out/app";', "mkdirSync(out, { recursive: true });",
  `writeFileSync(join(out, "index.html"), '<!doctype html><title>hostile</title><h1>hostile page</h1><img src="file:///etc/passwd"><iframe src="file://${SECRET}"></iframe><link rel="stylesheet" href="http://example.invalid/x.css">');`,
  `symlinkSync("${SECRET}", join(out, "jpy.html"));`, `try { linkSync("${SECRET}", join(out, "hard.html")); } catch {}`,
  // a child left behind: it says it started (so the test knows it ran), then lingers; the build waits for that and exits
  `Bun.spawn(["/bin/sh", "-c", "echo up > " + join(out, "started.txt") + "; exec /bin/sleep ${LINGER}"]);`,
  'for (let i = 0; i < 100 && !require("node:fs").existsSync(join(out, "started.txt")); i++) Bun.sleepSync(20);', ""].join("\n");
late.on = true; late.dir = secretDir;
const C = await toMerge(["Make the shop build hostile", "STUB_SCOPE app/", "STUB_SCOPE test/", `STUB_FILE app/build.ts :: ${esc(hostile)}`,
  `STUB_FILE test/hostile.test.ts :: ${esc('import { expect, test } from "bun:test";\nimport { readFileSync } from "node:fs";\n\ntest("the build is the hostile one", () => expect(readFileSync("app/build.ts", "utf8")).toContain("hostile"));\n')}`].join("\n"));
late.on = false;
const cdir = join(E.rdir(C.r.id), "captures"); const leaked = filesUnder(cdir).filter((f) => { try { const st = (require("node:fs") as typeof import("node:fs")).lstatSync(f); return st.isSymbolicLink() || (st.isFile() && readFileSync(f, "utf8").includes("SECRET-KEY-MATERIAL")); } catch { return false; } });
ok(!!C.cap && C.cap.data?.refusedFiles?.some((f: string) => f === "after: jpy.html: a symlink") && leaked.length === 0 && C.cap.data.captures.find((c: any) => c.label === "Shop in yen")?.after === null,
  "a build's symlink to a secret is refused, never followed: no capture file is a link or holds the secret, and that page has no capture", JSON.stringify([C.cap?.data?.refusedFiles, leaked, C.cap?.findings?.map((f: any) => f.message)]).slice(0, 600));
{ const { captureResponse } = await import("../src/runtime/captures"); const h12 = String(C.cap?.data?.head ?? "").slice(0, 12);
  const page = captureResponse(E.rdir(C.r.id), h12, "after", "index.html"); const body = await page.text(); const link = captureResponse(E.rdir(C.r.id), h12, "after", "jpy.html");
  ok(page.status === 200 && /^sandbox;/.test(page.headers.get("content-security-policy") ?? "") && /default-src 'none'/.test(page.headers.get("content-security-policy") ?? "") && body.includes("hostile page") && !body.includes("SECRET-KEY") && link.status === 404,
    "Open the app serves the head's page sandboxed (no script, no request out), and never the refused link", JSON.stringify([page.status, page.headers.get("content-security-policy"), link.status])); }
{ const all = filesUnder(cdir); const fs = require("node:fs") as typeof import("node:fs");
  const bad = all.filter((f) => /late\.html/.test(f) || (() => { try { return fs.statSync(f).isFile() && fs.readFileSync(f, "utf8").includes("SECRET-KEY-MATERIAL"); } catch { return false; } })());
  ok(late.tried >= 1 && !bad.length && !(C.cap?.data?.refusedFiles ?? []).some((f: string) => /late\.html/.test(f)),
    "output written to the build's folder after the build exits never reaches Studio (no late page, no secret, not even as a refusal)", JSON.stringify([late.tried, bad, C.cap?.data?.refusedFiles])); }
{ const h12 = String(C.cap?.data?.head ?? "").slice(0, 12);
  ok(["before/index.html.png", "before/jpy.html.png", "after/index.html.png"].every((f) => existsSync(join(cdir, h12, f))) && !existsSync(join(cdir, h12, "after", "jpy.html.png")),
    "the base and the head were each built (in the check sandbox) and shot; the refused page was not", JSON.stringify(filesUnder(join(cdir, h12)).map((f) => f.slice(cdir.length))));
  // the refused page has no picture, so the run stops at the capture gap (no merge card); the run's captures carry the URLs the card shows
  const caps: any[] = C.cap?.data?.captures ?? [];
  ok(!C.m && !!C.gap && caps.every((c) => c.before === null || new RegExp(`^/api/wruns/${C.r.id}/captures/${h12}/before/.+\\.png$`).test(c.before)) && caps.some((c) => !!c.before) && caps.find((c) => c.label === "Shop in dollars")?.after === `/api/wruns/${C.r.id}/captures/${h12}/after/index.html.png`,
    "each capture is linked by its own URL (/api/wruns/<run>/captures/<head>/before|after/<page>.png); the refused page is a capture gap, not a merge", JSON.stringify(caps));
  ok(filesUnder(join(cdir, h12)).some((f) => f.endsWith("after/started.txt")) && !Bun.spawnSync(["/usr/bin/pgrep", "-f", `sleep ${LINGER}`]).stdout.toString().trim(),
    "a process the build left behind ran (it wrote started.txt) and is gone before Studio reads the output (the build's process group is killed)"); }
{
  const reqs: string[] = C.cap?.data?.refusedRequests ?? []; const png = join(cdir, String(C.cap?.data?.head ?? "").slice(0, 12), "after", "index.html.png");
  const frames: string[] = C.cap?.data?.frames ?? [];
  ok(existsSync(png) && reqs.some((u) => u.includes("file:///etc/passwd")) && reqs.some((u) => u.includes("example.invalid")) && frames.length >= 1 && frames.every((u) => /: (http:\/\/127\.0\.0\.1:\d+\/|about:blank|chrome-error:|$)/.test(u)) && !frames.some((u) => u.includes(SECRET)),
    "the renderer serves the page from its copy over a local origin and refuses every other request (file:///etc/passwd, another host); no frame shows the secret file", JSON.stringify([reqs, frames]));
}
if (C.m || C.gap) E.cancel(C.r.id, "captain");
H.stop();
if (process.env.VIS_REAL) console.log(`kept ${data}`); else for (const x of [d1, ...scenarioData, secretDir]) try { Bun.spawnSync(["chmod", "-R", "u+w", x]); rmSync(x, { recursive: true, force: true }); } catch {}
end();
