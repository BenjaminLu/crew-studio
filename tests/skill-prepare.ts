import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Skill packages, the prepare step (docs/units/skill-packages.md §4): once the captain approved a script skill version,
// Studio installs its lockfiles by itself into data/envs/<key>/, inside the round sandbox: npm ci --ignore-scripts and
// pip --require-hashes (wheels only), writing only the env and its cache, reaching only the hosts its lockfiles resolve
// to through a strict egress credential. The env is content-addressed (two skills with the same locks share one), the
// packages with install scripts are recorded and their scripts never run, and an env nothing in use names is removed.
// The registry and the wheel index are local fixtures behind the proxy (no internet).   bun tests/skill-prepare.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGISTRY, PYPI, skillFolder, startRegistry } from "./lib/skill-fixtures";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const { Skills } = await import("../src/skills");
const { SkillPackages } = await import("../src/skillpkg/index");
const { Egress } = await import("../src/egress");
const { prepareExec, prepareEnv, npmPlan, envKey } = await import("../src/skillpkg/prepare");

const tmp = mkdtempSync(join(tmpdir(), "crew-prepare-")); const data = join(tmp, "data"); mkdirSync(data);
const fx = startRegistry();
const egress = new Egress(join(data, "egress.log")); await egress.start();
for (const h of [REGISTRY, PYPI, "other.fixture.test"]) egress.testUpstreams.set(h, { address: "127.0.0.1", port: fx.port });
const skills = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null } as any);
const inUse = new Set<string>();
const pk = new SkillPackages({ dataDir: data, skills, egress: () => egress, brew: false, uv: false, inUse: () => inUse });

// ---------- the plan read from the lockfile ----------
{ const plan = npmPlan(fx.lock);
  ok(JSON.stringify(plan.hosts) === JSON.stringify([REGISTRY]) && JSON.stringify(plan.installScripts) === JSON.stringify(["fixture-scripted"]),
    "the hosts a prepare may reach come from the lockfile (each package's resolved URL), and the packages with an install script are named", JSON.stringify(plan));
  let refused = ""; try { npmPlan(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": { resolved: "git+ssh://git@github.com/x/x.git", integrity: "sha512-x" } } })); } catch (e: any) { refused = e.message; }
  ok(/only registry tarballs/.test(refused), "a lock entry that is not a registry tarball (git, file) is refused", refused);
  try { npmPlan(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": { resolved: "https://registry.npmjs.org/x/-/x-1.tgz" } } })); refused = ""; } catch (e: any) { refused = e.message; }
  ok(/no integrity hash/.test(refused), "a lock entry with no integrity hash is refused", refused);
  for (const entry of [{ version: "1.0.0", hasInstallScript: true }, { link: true, resolved: "../local" }]) {
    refused = ""; try { npmPlan(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/x": entry } })); } catch (e: any) { refused = e.message; }
    ok(/registry tarball/.test(refused), "a missing resolved URL or linked dependency cannot bypass the pinned registry-only plan", refused);
  } }

// ---------- the prepare sandbox ----------
{ const env = join(data, "envs", "probe"), cache = join(data, "envs", ".cache-probe"); mkdirSync(join(cache, "tmp"), { recursive: true }); mkdirSync(env, { recursive: true });
  const secret = join(process.env.HOME!, ".ssh", "id_probe"); mkdirSync(join(secret, ".."), { recursive: true }); writeFileSync(secret, "SECRET-KEY");
  const r = await prepareExec(["/bin/sh", "-c", `echo y > ${env}/inside; echo x > ${data}/outside 2>/dev/null; echo z > ${tmp}/outside2 2>/dev/null; cat ${secret} 2>/dev/null || echo no-secret; cat ${data}/ledger.key 2>/dev/null || echo no-key`],
    { dataDir: data, egress, cwd: env, writes: [env, cache], tmp: join(cache, "tmp"), hosts: [REGISTRY] });
  ok(existsSync(join(env, "inside")) && !existsSync(join(data, "outside")) && !existsSync(join(tmp, "outside2")), "a prepare writes only its env folder and its cache: nothing else in Studio's data, nothing outside it", r.stderr);
  ok(/no-secret/.test(r.stdout) && !/SECRET-KEY/.test(r.stdout), "a prepare reads none of the user's secrets (~/.ssh)", r.stdout);
  const runtime = join(data, "runtimes", "python", "cpython-fixture"); mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "stdlib.txt"), "managed-runtime"); writeFileSync(join(data, "runtime-secret"), "NEVER-READ");
  const managed = await prepareExec(["/bin/sh", "-c", `cat ${runtime}/stdlib.txt; echo changed > ${runtime}/stdlib.txt 2>/dev/null; cat ${data}/runtime-secret 2>/dev/null || echo data-closed`],
    { dataDir: data, egress, cwd: env, writes: [env, cache], tmp: join(cache, "tmp"), hosts: [], reads: [runtime] });
  ok(managed.stdout.includes("managed-runtime") && managed.stdout.includes("data-closed") && !managed.stdout.includes("NEVER-READ") && readFileSync(join(runtime, "stdlib.txt"), "utf8") === "managed-runtime",
    "a runtime installed under data is readable during prepare, remains read-only, and does not expose sibling data", JSON.stringify(managed));
  const curl = (url: string, hosts: string[]) => prepareExec(["/usr/bin/curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", url], { dataDir: data, egress, cwd: env, writes: [env, cache], tmp: join(cache, "tmp"), hosts });
  const okHost = await curl(`http://${REGISTRY}/fixture-dep`, [REGISTRY]), other = await curl("http://other.fixture.test/fixture-dep", [REGISTRY]);
  const direct = await prepareExec(["/usr/bin/curl", "-s", "--noproxy", "*", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", `http://127.0.0.1:${fx.port}/fixture-dep`], { dataDir: data, egress, cwd: env, writes: [env, cache], tmp: join(cache, "tmp"), hosts: [REGISTRY] });
  ok(okHost.stdout === "200" && other.stdout === "403" && direct.stdout !== "200", "a prepare reaches only the hosts its lockfile names, through the proxy: another host is refused (403), a direct connection fails", JSON.stringify([okHost.stdout, other.stdout, direct.stdout]));
  const log = readFileSync(join(data, "egress.log"), "utf8");
  ok(/other\.fixture\.test.*"purpose":"prepare"/.test(log), "the refused prepare connection is logged as a prepare's", log.slice(-300));
  egress.lookup = ((host: string, _o: any, cb: any) => cb(null, host === "meta.fixture.test" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "10.1.2.3", family: 4 }])) as any;
  const meta = await curl("http://meta.fixture.test/", ["meta.fixture.test"]), lan = await curl("http://lan.fixture.test/", ["lan.fixture.test"]), lit = await curl("http://10.1.2.3/", ["10.1.2.3"]);
  ok(meta.stdout === "403" && lan.stdout === "403" && lit.stdout === "403", "a prepare's credential is strict: a listed name resolving to a metadata or private address is refused, and an IP literal is refused even when listed", JSON.stringify([meta.stdout, lan.stdout, lit.stdout]));
  egress.lookup = (await import("node:dns")).lookup; }

// ---------- prepare one approved skill ----------
const src = mkdtempSync(join(tmpdir(), "skill-src-"));
const a = skills.importFolder(skillFolder(src, fx, { name: "pkg-a" }), "captain");
ok(a.created && !!a.version.pkg && a.version.pkg.npm?.files[1] === "package-lock.json" && a.version.pkg.python?.kind === "requirements" && a.version.pkg.scripts.length >= 4,
  "the import reads what the version needs: its scripts, its package-lock.json and its hash-pinned requirements", JSON.stringify(a.version.pkg));
{ const s0 = pk.status("pkg-a", 1);
  ok(s0.state === "needs-approval" && s0.blocking, "before the captain decides, a script skill is not approved and its scripts are blocked", JSON.stringify(s0.reasons));
  fx.hits.length = 0;
  pk.decide("pkg-a", 1, "approved", "captain", "test");
  const s = await pk.ensure("pkg-a", 1);
  const dir = join(data, "envs", s.envKey ?? "none");
  ok(s.state === "ready" && !!s.envKey && existsSync(join(dir, "env.json")) && existsSync(join(dir, "node", "node_modules", "fixture-dep", "index.js")) && existsSync(join(dir, "py", "venv", "bin", "python")),
    "an approved version is prepared by itself: node_modules from its lock and a venv from its requirements, under data/envs/<key>", JSON.stringify(s));
  ok(!existsSync(join(dir, "node", "node_modules", "fixture-scripted", "POSTINSTALL_RAN")) && !existsSync(join(dir, "node", "POSTINSTALL_RAN")), "npm ci ran with --ignore-scripts: the package's postinstall never ran");
  ok(JSON.stringify(s.env?.installScripts) === JSON.stringify(["fixture-scripted"]) && s.warnings.some((w) => /fixture-scripted ships an install script, which did not run/.test(w)),
    "the package with an install script is recorded on the env and shown as a warning, with why it did not run", JSON.stringify(s.warnings));
  const py = Bun.spawnSync([join(dir, "py", "venv", "bin", "python"), "-c", "import fixture_py; print(fixture_py.shout('x'))"], { stdout: "pipe" });
  ok(py.stdout.toString().trim() === "py:X", "the venv has the hash-pinned wheel from the local index", py.stdout.toString());
  ok(fx.hits.some((h) => h.startsWith(`${REGISTRY}/fixture-dep/-/`)) && fx.hits.some((h) => h.startsWith(`${PYPI}/files/`)) && fx.hits.every((h) => h.startsWith(REGISTRY) || h.startsWith(PYPI)),
    "the downloads came through the proxy under the lockfiles' own host names, and no other host", JSON.stringify(fx.hits));
  ok(!readdirSync(join(data, "envs")).some((d) => d.startsWith(".cache-") && d !== ".cache-probe"), "the prepare's own cache is removed after it");
  const st = JSON.parse(readFileSync(join(data, "skillpkg", "status", "pkg-a@v1.json"), "utf8"));
  ok(st.state === "ready" && st.envKey === s.envKey, "the outcome is recorded in Studio's status file for the version"); }

// The managed-runtime path must work for real venv/pip preparation too, not only a profile string.
{ const st = pk.status("pkg-a", 1), lv = skills.libVersion("pkg-a", 1)!, pkg = skills.pkg("pkg-a", 1)!;
  const runtime = join(data, "runtimes", "python", "cpython-wrapper"), bin = join(runtime, "bin", "python3"); mkdirSync(join(runtime, "bin"), { recursive: true });
  writeFileSync(join(runtime, "ready"), "ready");
  writeFileSync(bin, `#!/bin/sh\ncat '${runtime}/ready' >/dev/null || exit 91\nexec '${st.runtimes.python!.bin}' "$@"\n`, { mode: 0o755 });
  const prepared = await prepareEnv({ ...pkg, npm: null }, join(lv.dir, "files"), { python: { ...st.runtimes.python!, bin, dir: runtime, version: "managed-fixture" } }, "managed-python@v1", { dataDir: data, egress, timeoutS: 60 });
  ok(prepared.python && existsSync(join(data, "envs", prepared.key, "py", "venv", "bin", "python")),
    "a Python entrypoint under data/runtimes can read its runtime files and create a real venv with pinned wheel dependencies"); }

// ---------- content-addressed: same locks, same env; the key moves with the lock ----------
{ const b = skills.importFolder(skillFolder(src, fx, { name: "pkg-b" }), "captain");
  pk.decide("pkg-b", 1, "approved", "captain", "test"); fx.hits.length = 0;
  const sa = pk.status("pkg-a", 1), sb = await pk.ensure("pkg-b", 1);
  const rec = JSON.parse(readFileSync(join(data, "envs", sb.envKey!, "env.json"), "utf8"));
  ok(b.created && sb.state === "ready" && sb.envKey === sa.envKey && fx.hits.length === 0 && JSON.stringify(rec.refs) === JSON.stringify(["pkg-a@v1", "pkg-b@v1"]),
    "a second skill with the same lockfiles reuses the env (no download), and the env names both", JSON.stringify([sb.envKey === sa.envKey, fx.hits, rec.refs]));
  const lv = skills.libVersion("pkg-a", 1)!, pkg = skills.pkg("pkg-a", 1)!;
  const k1 = envKey(pkg, join(lv.dir, "files"), sa.runtimes), k2 = envKey(pkg, join(lv.dir, "files"), { ...sa.runtimes, node: { ...sa.runtimes.node!, version: "99.0.0" } });
  ok(k1 === sa.envKey && k2 !== k1, "the env key is the lockfiles plus platform and runtime versions: another node version is another env"); }

// An install-script approval changes the env; its effects cannot reach a skill that did not approve it.
{ const lv = skills.libVersion("pkg-a", 1)!, pkg = skills.pkg("pkg-a", 1)!, rt = pk.status("pkg-a", 1).runtimes;
  const approved = await prepareEnv(pkg, join(lv.dir, "files"), rt, "pkg-script-approved@v1", { dataDir: data, egress, allowScripts: ["fixture-scripted"] });
  const ordinary = await prepareEnv(pkg, join(lv.dir, "files"), rt, "pkg-no-scripts@v1", { dataDir: data, egress });
  ok(approved.key !== ordinary.key && approved.ranScripts.includes("fixture-scripted") && existsSync(join(data, "envs", approved.key, "node", "node_modules", "fixture-scripted", "POSTINSTALL_RAN")),
    "approved install scripts run in a separate env from the same locks without that approval");
  ok(!ordinary.ranScripts.length && !existsSync(join(data, "envs", ordinary.key, "node", "node_modules", "fixture-scripted", "POSTINSTALL_RAN")),
    "reusing ordinary locks never inherits another version's install-script side effects");
  ok(envKey(pkg, join(lv.dir, "files"), rt, process.platform, process.arch, ["b", "a", "a"]) === envKey(pkg, join(lv.dir, "files"), rt, process.platform, process.arch, ["a", "b"]),
    "install-script approval ordering and duplicates do not change the env key");
}

// ---------- gc ----------
{ inUse.clear(); inUse.add("pkg-b@v1"); const keep = pk.gc();
  const key = pk.status("pkg-b", 1).envKey!;
  ok(keep.kept.includes(key) && existsSync(join(data, "envs", key)), "gc keeps an env an in-use version names", JSON.stringify(keep));
  inUse.clear(); const gone = pk.gc();
  ok(gone.removed.includes(key) && !existsSync(join(data, "envs", key)), "gc removes an env no in-use version names", JSON.stringify(gone));
  const again = pk.status("pkg-b", 1);
  ok(again.state === "preparing", "a removed env is prepared again when the version is used next", JSON.stringify(again.reasons)); }

// ---------- a failed prepare says why ----------
{ const d = skillFolder(src, fx, { name: "pkg-bad", python: false });
  writeFileSync(join(d, "package-lock.json"), fx.lock.replace(`http://${REGISTRY}/fixture-dep/-/fixture-dep-1.0.0.tgz`, "http://other.fixture.test/fixture-dep/-/fixture-dep-1.0.0.tgz").replace(/"integrity": "sha512-[^"]+"/, '"integrity": "sha512-AAAA"'));
  skills.importFolder(d, "captain"); pk.decide("pkg-bad", 1, "approved", "captain", "test");
  const s = await pk.ensure("pkg-bad", 1);
  ok(s.state === "not-ready" && s.blocking && /npm ci failed/.test(s.reasons.map((r) => r.en).join(" ")) && !readdirSync(join(data, "envs")).some((x) => /^[a-f0-9]{64}$/.test(x) && !existsSync(join(data, "envs", x, "env.json"))),
    "a prepare that fails (a tampered tarball hash) leaves no half env and the version is not ready, with the reason", JSON.stringify(s.reasons)); }

egress.stop(); fx.stop();
console.log(`\nskill-prepare: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
