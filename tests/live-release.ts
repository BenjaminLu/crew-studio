// Live release: scripts/live-release.ts deploys an exact commit into its own
// worktree, starts it detached with a release-local env file, and stops only the
// Studio process it owns. Offline: a temp bare "origin", a temp dev checkout with
// dirty files, a temp data dir and a stub server (src/main.ts in the temp repo)
// that answers /api/instance like Studio does.      bun tests/live-release.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const SCRIPT = join(import.meta.dir, "..", "scripts", "live-release.ts");
const tmp = mkdtempSync(join(tmpdir(), "crew-live-release-"));
const SECRET = "sentinel-" + createHash("sha256").update(tmp).digest("hex").slice(0, 24);
const sh = (cwd: string, ...cmd: string[]) => { const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } }); if (!r.success) throw new Error(`${cmd.join(" ")}: ${r.stderr}`); return r.stdout.toString().trim(); };
const freePort = () => { const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") }); const p = s.port; s.stop(true); return p; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (f: () => boolean | Promise<boolean>, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await Bun.sleep(100); } return false; };
const instance = async (port: number) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/instance`, { signal: AbortSignal.timeout(1000) }); return r.ok ? await r.json() as any : null; } catch { return null; } };

// The stub stands in for src/main.ts: `open` leaves a marker, `--version` prints,
// otherwise it serves like Studio (GET /api/instance -> {pid, boot}) and writes a
// private launch record {schema, boot, pid, origin, data} into CREW_RUNTIME_DIR.
const stub = (version: string) => `import {createHash,createHmac,randomBytes} from "node:crypto";import {existsSync,mkdirSync,writeFileSync,unlinkSync,chmodSync} from "node:fs";import {join,resolve} from "node:path";
const VERSION=${JSON.stringify(version)};const sub=process.argv[2];const data=resolve(process.env.CREW_DATA||"data");
if(sub==="--version"){console.log("stub "+VERSION);process.exit(0);}
if(sub==="open"){mkdirSync(data,{recursive:true});writeFileSync(join(data,"opened-"+VERSION),String(Date.now()));console.log("open requested");process.exit(0);}
mkdirSync(data,{recursive:true});
if(existsSync(join(data,"fail-start-"+VERSION))){console.error("stub "+VERSION+" refuses to start");process.exit(3);}
if(existsSync(join(data,"slow-start-"+VERSION)))await Bun.sleep(60000);
writeFileSync(join(data,"seen-"+VERSION+".json"),JSON.stringify({cwd:process.cwd(),secret:createHash("sha256").update(process.env.STUB_SECRET||"").digest("hex"),dep:process.env.CREW_LOCAL_DEPENDENCY_ROOT||null}));
const boot=randomBytes(24).toString("hex"),token=randomBytes(32).toString("hex");const port=Number(process.env.CREW_PORT||4210);
const server=Bun.serve({port,hostname:"127.0.0.1",fetch(req){const u=new URL(req.url);if(u.pathname==="/api/instance"){const c=u.searchParams.get("challenge");return Response.json({pid:process.pid,boot,version:VERSION,...(c&&/^[a-f0-9]{48}$/.test(c)?{proof:createHmac("sha256",token).update("crew-launch-v1\\0"+boot+"\\0"+c).digest("hex")}:{})});}return new Response("ok "+VERSION);}});
const rt=process.env.CREW_RUNTIME_DIR;let rec=null;if(rt){mkdirSync(rt,{recursive:true,mode:0o700});chmodSync(rt,0o700);rec=join(rt,boot+".json");writeFileSync(rec,JSON.stringify({schema:1,boot,pid:process.pid,origin:"http://127.0.0.1:"+server.port,data}),{mode:0o600});writeFileSync(join(rt,boot+".key"),token,{mode:0o600});}
console.log("stub "+VERSION+" listening on "+server.port);
for(const s of ["SIGTERM","SIGINT"])process.once(s,()=>{if(rec){try{unlinkSync(rec)}catch{}try{unlinkSync(rec.replace(/\\.json$/,".key"))}catch{}}process.exit(0);});
`;

const origin = join(tmp, "origin.git"), dev = join(tmp, "dev"), data = join(tmp, "data"), runtime = join(tmp, "runtime"), root = join(tmp, "releases");
const port = freePort(), otherPort = freePort();
sh(tmp, "git", "init", "-q", "--bare", "-b", "main", origin);
sh(tmp, "git", "clone", "-q", origin, dev);
const commit = (version: string) => { writeFileSync(join(dev, "src", "main.ts"), stub(version)); sh(dev, "git", "add", "src/main.ts", "package.json", ".gitignore"); sh(dev, "git", "commit", "-q", "-m", `stub ${version}`); sh(dev, "git", "push", "-q", "origin", "HEAD:main"); return sh(dev, "git", "rev-parse", "HEAD"); };
mkdirSync(join(dev, "src"), { recursive: true });
writeFileSync(join(dev, "package.json"), JSON.stringify({ name: "stub-studio", private: true }));
writeFileSync(join(dev, ".gitignore"), ".env\ndata/\nnode_modules/\n");
const A = commit("A"), B = commit("B");
// the operator's .env in the dev checkout: the release gets a private copy of it
writeFileSync(join(dev, ".env"), `# operator settings\nCREW_PORT=${port}\nCREW_DATA=${data}\nCREW_RUNTIME_DIR=${runtime}\nCREW_LOCAL_DEPENDENCY_ROOT=${dev}\nSTUB_SECRET=${SECRET}\n`, { mode: 0o600 });
// dirty dev-checkout work that must never reach a release
writeFileSync(join(dev, "src", "main.ts"), stub("DIRTY"));
writeFileSync(join(dev, "src", "dirty-untracked.ts"), "export const DIRTY = true;\n");

const children: number[] = [];
const handles: ReturnType<typeof Bun.spawn>[] = [];
const outputs: string[] = [];
const run = (...args: string[]) => {
  const r = Bun.spawnSync(["bun", SCRIPT, ...args, "--repo", dev, "--root", root, "--timeout", "20"], { cwd: tmp, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  const out = r.stdout.toString() + r.stderr.toString(); outputs.push(out); return { code: r.exitCode, out };
};
const live = () => { try { return JSON.parse(readFileSync(join(root, "live.json"), "utf8")); } catch { return null; } };
const spawnStub = (cwd: string, env: Record<string, string>) => { const p = Bun.spawn(["bun", "src/main.ts"], { cwd, env: { ...process.env, ...env }, stdout: "ignore", stderr: "ignore" }); children.push(p.pid); handles.push(p); return p; };
/** A test child has really ended (reaped, exit code known), not just been signalled: a zombie still passes kill(pid, 0). */
const ended = async (p: ReturnType<typeof Bun.spawn>, ms = 5000) => (await Promise.race([p.exited.then(() => true), Bun.sleep(ms).then(() => false)])) && (p.exitCode !== null || p.signalCode !== null);
const serving = async (port: number) => !!(await instance(port));
const listenerPid = (port: number) => Number(Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { stdout: "pipe" }).stdout.toString().trim().split("\n")[0]) || 0;

try {
  ok(existsSync(SCRIPT), "scripts/live-release.ts exists");

  // 1. something unowned holds the live port: deploy refuses and kills nothing
  const squatter = Bun.spawn(["bun", "-e", `Bun.serve({port:${port},hostname:"127.0.0.1",fetch:()=>new Response("not studio")});setInterval(()=>{},1e6)`], { stdout: "ignore", stderr: "ignore" });
  children.push(squatter.pid);
  await wait(async () => (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok, () => false)));
  let r = run("deploy", "--ref", A, "--no-fetch");
  ok(r.code !== 0, "deploy refuses when an unowned process holds the port", r.out.slice(-400));
  ok(squatter.exitCode === null && squatter.signalCode === null && await fetch(`http://127.0.0.1:${port}/`).then((x) => x.text(), () => "") === "not studio", "the unowned process on the live port is not stopped and still serves");
  squatter.kill(); await squatter.exited;

  // 2. a legacy dev-checkout instance (bun src/main.ts, live data dir) is adopted and stopped;
  //    a second Studio-like process on another port and another data dir is left alone
  const legacyP = spawnStub(dev, { CREW_PORT: String(port), CREW_DATA: data, CREW_RUNTIME_DIR: runtime, STUB_SECRET: "" });
  const otherDir = join(tmp, "other"); mkdirSync(join(otherDir, "src"), { recursive: true }); writeFileSync(join(otherDir, "src", "main.ts"), stub("OTHER"));
  const otherP = spawnStub(otherDir, { CREW_PORT: String(otherPort), CREW_DATA: join(tmp, "other-data"), CREW_RUNTIME_DIR: runtime });
  await wait(async () => !!(await instance(port)) && !!(await instance(otherPort)));
  ok((await instance(port))?.version === "DIRTY", "legacy dev-checkout instance is up before the first deploy");

  r = run("deploy", "--ref", A, "--no-fetch");
  ok(r.code === 0, "deploy of an exact SHA succeeds", r.out.slice(-600));
  const relA = join(root, A);
  ok(existsSync(relA) && sh(relA, "git", "rev-parse", "HEAD") === A, "release A is a worktree at exactly A");
  ok(live()?.live?.sha === A, "live.json records A");
  ok((await instance(port))?.version === "A", "the server on the live port is release A");
  ok(await ended(legacyP), "the legacy dev-checkout instance was stopped (exited, not just signalled)");
  ok(otherP.exitCode === null && (await instance(otherPort))?.version === "OTHER", "a Studio process with another data dir and port is not stopped");
  ok(!existsSync(join(relA, "src", "dirty-untracked.ts")) && !readFileSync(join(relA, "src", "main.ts"), "utf8").includes("DIRTY"), "dirty dev-checkout files never reach the release");
  const envA = join(relA, ".env");
  ok(existsSync(envA) && (statSync(envA).mode & 0o777) === 0o600, "release env file exists with mode 0600", existsSync(envA) ? (statSync(envA).mode & 0o777).toString(8) : "missing");
  ok(readFileSync(envA, "utf8").includes(SECRET), "release env file carries the operator's settings");
  const seenA = JSON.parse(readFileSync(join(data, "seen-A.json"), "utf8"));
  ok(seenA.secret === createHash("sha256").update(SECRET).digest("hex") && seenA.cwd.endsWith(A), "release A read its settings from the release-local env file");
  ok(seenA.dep === dev, "CREW_LOCAL_DEPENDENCY_ROOT keeps the operator's dev checkout, never the release", String(seenA.dep));
  ok(existsSync(join(data, "opened-A")), "deploy ran `open` for the captain's browser session");
  ok(existsSync(join(data, "logs")) && readdirSync(join(data, "logs")).some((f) => f.includes(A.slice(0, 12))), "server log is under data/logs");
  ok(sh(dev, "git", "status", "--porcelain").includes("src/main.ts"), "the dev checkout's dirty work is untouched");

  // 2b. a releases/<sha> symlink to another worktree of the same repo is never a release:
  //     prune never unlocks/removes it, deploy never installs into it or writes the .env into it
  const otherWt = join(tmp, "other-worktree");
  sh(dev, "git", "worktree", "add", "-q", "--detach", otherWt, A);
  writeFileSync(join(otherWt, "src", "main.ts"), stub("OTHER-WT-DIRTY"));
  writeFileSync(join(otherWt, "precious.txt"), "uncommitted work\n");
  sh(otherWt, "git", "worktree", "lock", "--reason", "someone else's", otherWt);
  const X = (() => { writeFileSync(join(otherWt, "x.txt"), "x"); sh(otherWt, "git", "add", "x.txt"); sh(otherWt, "git", "commit", "-q", "-m", "x"); return sh(otherWt, "git", "rev-parse", "HEAD"); })();
  symlinkSync(otherWt, join(root, X));
  r = run("prune", "--keep", "1");
  ok(existsSync(join(otherWt, "precious.txt")) && readFileSync(join(otherWt, "src", "main.ts"), "utf8").includes("OTHER-WT-DIRTY") && sh(dev, "git", "worktree", "list", "--porcelain").includes("locked someone else's"), "prune never follows a releases/<sha> symlink into another worktree", r.out.slice(-300));
  r = run("deploy", "--ref", X, "--no-fetch");
  ok(r.code !== 0 && !existsSync(join(otherWt, ".env")) && !existsSync(join(otherWt, "node_modules")) && live()?.live?.sha === A && (await instance(port))?.version === "A", "deploy refuses a releases/<sha> symlink and writes no .env into its target", r.out.slice(-300));
  unlinkSync(join(root, X));
  mkdirSync(join(root, X)); writeFileSync(join(root, X, "keep.txt"), "not a worktree");
  r = run("prune", "--keep", "1");
  ok(existsSync(join(root, X, "keep.txt")), "prune leaves a releases/<sha> folder that is not a registered worktree", r.out.slice(-300));
  r = run("deploy", "--ref", X, "--no-fetch");
  ok(r.code !== 0 && !existsSync(join(root, X, ".env")) && live()?.live?.sha === A, "deploy refuses a releases/<sha> folder that is not a registered worktree", r.out.slice(-300));
  rmSync(join(root, X), { recursive: true, force: true });

  // 2c. an active Task blocks deploy, rollback and stop unless --force
  const runDir = join(data, "runs", "R-901"); mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ id: "R-901", workflow: "code-firstmate", title: "Ship the onboarding page", status: "running", nodes: { build: { state: "running", waiting: null } } }));
  mkdirSync(join(data, "runs", "R-902"), { recursive: true });
  writeFileSync(join(data, "runs", "R-902", "run.json"), JSON.stringify({ id: "R-902", workflow: "code-firstmate", title: "Waits for the captain", status: "waiting", nodes: { review: { state: "running", waiting: "card" } } }));
  for (const verb of ["deploy", "rollback", "stop"]) {
    r = run(verb, ...(verb === "deploy" ? ["--ref", B, "--no-fetch"] : []));
    ok(r.code !== 0 && r.out.includes("R-901") && r.out.includes("Ship the onboarding page") && !r.out.includes("R-902") && live()?.live?.sha === A && (await instance(port))?.version === "A", `${verb} refuses while a Task is running and names it`, r.out.slice(-300));
  }
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ id: "R-901", workflow: "code-firstmate", title: "Ship the onboarding page", status: "succeeded", nodes: {} }));

  // 3. deploy origin/main resolves to B; status matches origin/main
  r = run("deploy", "--ref", "origin/main");
  ok(r.code === 0 && live()?.live?.sha === B && (await instance(port))?.version === "B", "deploy origin/main resolves and runs B", r.out.slice(-600));
  r = run("status");
  const pidB = (await instance(port))?.pid;
  ok(r.code === 0 && r.out.includes(B) && r.out.includes(String(port)) && r.out.includes(data) && r.out.includes(String(pidB)), "status shows live SHA, pid, port and data dir", r.out);
  ok(/origin\/main:.*matches/.test(r.out), "status says live matches origin/main", r.out);

  // 4. rollback returns to A
  r = run("rollback");
  ok(r.code === 0 && live()?.live?.sha === A && (await instance(port))?.version === "A", "rollback switches back to A", r.out.slice(-600));
  ok(!alive(pidB) && listenerPid(port) !== pidB, "rollback stopped release B's process");
  r = run("status");
  ok(/origin\/main:.*(behind|differs)/.test(r.out), "status says live no longer matches origin/main", r.out);

  // 5. pruning keeps the last N releases
  const C = commit("C"), D = commit("D");
  writeFileSync(join(dev, "src", "main.ts"), stub("DIRTY")); // dirty again: still never deployed
  r = run("deploy", "--ref", C, "--no-fetch", "--keep", "2");
  ok(r.code === 0 && live()?.live?.sha === C, "deploy C", r.out.slice(-600));
  r = run("deploy", "--ref", D, "--no-fetch", "--keep", "2");
  ok(r.code === 0 && live()?.live?.sha === D, "deploy D", r.out.slice(-600));
  const kept = readdirSync(root).filter((f) => /^[0-9a-f]{40}$/.test(f)).sort();
  ok(JSON.stringify(kept) === JSON.stringify([C, D].sort()), "only the last 2 releases are kept", kept.join(","));
  ok(!sh(dev, "git", "worktree", "list", "--porcelain").includes(A) && !sh(dev, "git", "worktree", "list", "--porcelain").includes(B), "pruned releases are removed as git worktrees too");
  r = run("rollback");
  ok(r.code === 0 && live()?.live?.sha === C && (await instance(port))?.version === "C", "rollback after pruning returns to C", r.out.slice(-600));
  r = run("rollback");
  ok(r.code !== 0 && live()?.live?.sha === C && !!(await instance(port)), "rollback with no older release refuses and keeps C live", r.out.slice(-300));

  // 5b. redeploying the same SHA that then fails to start: says nothing serves, and how to restart
  writeFileSync(join(data, "fail-start-C"), "1");
  let t0 = Date.now();
  r = run("deploy", "--ref", C, "--no-fetch", "--timeout", "30");
  ok(r.code !== 0 && Date.now() - t0 < 15000, "a release that exits at once fails at once, not after --timeout", `${Date.now() - t0}ms`);
  ok(r.out.includes(`nothing serves port ${port}`) && r.out.includes(`previous was release ${C}`) && r.out.includes(`restart with: cd ${join(root, C)} && `), "a failed same-SHA redeploy says nothing serves and gives the restart command", r.out.slice(-500));
  unlinkSync(join(data, "fail-start-C"));
  r = run("deploy", "--ref", C, "--no-fetch");
  ok(r.code === 0 && (await instance(port))?.version === "C", "C deploys again once it can start", r.out.slice(-300));

  // 5c. Ctrl-C after the old release stopped and before the new one answers: the old one is started again
  writeFileSync(join(data, "slow-start-D"), "1");
  const bg = Bun.spawn(["bun", SCRIPT, "deploy", "--ref", D, "--no-fetch", "--repo", dev, "--root", root, "--timeout", "40"], { cwd: tmp, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  const cStopped = await wait(async () => !(await serving(port)), 30000);
  await Bun.sleep(500);
  bg.kill("SIGINT");
  const bgCode = await bg.exited; const bgOut = await new Response(bg.stdout).text() + await new Response(bg.stderr).text(); outputs.push(bgOut);
  ok(cStopped && bgCode === 130 && (await instance(port))?.version === "C" && live()?.live?.sha === C && bgOut.includes("started the previous release"), "Ctrl-C between stop and start restores the previous release", `${bgCode} ${bgOut.slice(-400)}`);
  unlinkSync(join(data, "slow-start-D"));

  // 6. stop: only the owned live process
  r = run("stop");
  ok(r.code === 0 && !(await instance(port)) && otherP.exitCode === null && await serving(otherPort), "stop ends only the live release", r.out.slice(-300));

  // 7. first deploy (no previous release) that fails: the stopped dev instance is started again
  const legacy2 = spawnStub(dev, { CREW_PORT: String(port), CREW_DATA: data, CREW_RUNTIME_DIR: runtime });
  await wait(() => serving(port));
  writeFileSync(join(data, "fail-start-A"), "1");
  t0 = Date.now();
  r = run("deploy", "--ref", A, "--no-fetch", "--root", join(tmp, "releases-fresh"), "--timeout", "30");
  ok(r.code !== 0 && Date.now() - t0 < 20000, "a failed first deploy fails fast", `${Date.now() - t0}ms ${r.out.slice(-300)}`);
  ok(await ended(legacy2) && (await instance(port))?.version === "DIRTY" && r.out.includes("started the previous instance again"), "a failed first deploy restarts the stopped dev instance with its command and cwd", r.out.slice(-500));
  unlinkSync(join(data, "fail-start-A"));

  ok(outputs.every((o) => !o.includes(SECRET)), "no command ever printed the env file's contents");
} catch (e) {
  ok(false, "unexpected error", String((e as Error)?.stack ?? e));
} finally {
  const st = live(); if (st?.live?.pid && alive(st.live.pid)) try { process.kill(st.live.pid, "SIGTERM"); } catch {}
  for (const pid of children) if (alive(pid)) try { process.kill(pid, "SIGTERM"); } catch {}
  const restored = listenerPid(port); if (restored) try { process.kill(restored, "SIGTERM"); } catch {}
  await Bun.sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nlive-release: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
