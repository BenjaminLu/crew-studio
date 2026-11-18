import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Doctor's "Install the CLI" (src/cli-install.ts) in a temporary HOME: ~/.local/bin/crew-studio becomes a symlink to the
// binary, or (from a checkout or a release) a shim that finds bun and the live Studio when it runs; the row says whether
// ~/.local/bin is on PATH and, when not, the line to add; a file or a link there that Studio did not write is never
// overwritten (and no Install button is offered then); installing again is idempotent. The shim, run, is the real CLI, and
// neither it nor Studio's own helpers read a bunfig.toml or .env of the folder they run in. `crew-studio skill install`
// writes only where it is told, never over a foreign file or one edited since. A grant's name used again keeps its file.
//      bun tests/cli-install.ts
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliDoctorItem, cliInstallState, installCli } from "../src/cli-install";
import { skillTargets, writeSkill, SKILL_MARK } from "../src/cli-skill";
import { helperCommand } from "../src/self";
import { CliGrants } from "../src/cli-grants";

const REPO = join(import.meta.dir, "..");
let failed = false;
const step = (name: string, f: () => void) => { try { f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
const fresh = () => mkdtempSync(join(tmpdir(), "crew-cli-install-home-"));
const src = (home: string, path: string, srcRoot = REPO) => ({ home, path, shell: "/bin/zsh", compiled: false, execPath: process.execPath, srcRoot });
/** a stand-in Studio checkout whose src/main.ts prints `label`, its arguments and what the environment says about the grant */
const fakeStudio = (dir: string, label: string) => { mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "main.ts"), `console.log(JSON.stringify({ label: ${JSON.stringify(label)}, args: process.argv.slice(2), grant: process.env.CREW_STUDIO_GRANT ?? null }));\n`); return dir; };
const run = (bin: string, args: string[], o: { cwd?: string; env?: Record<string, string> } = {}) => { const r = Bun.spawnSync([bin, ...args], { cwd: o.cwd, env: { ...process.env, ...o.env } as any });
  const out = r.stdout.toString(); let json: any = null; try { json = JSON.parse(out); } catch {} return { code: r.exitCode, out, err: r.stderr.toString(), json }; };
/** a folder an agent may run the CLI in: its bunfig.toml preloads code that leaves a mark, its .env names a grant */
const hostile = () => { const d = mkdtempSync(join(tmpdir(), "crew-cli-hostile-repo-")), mark = join(d, "PRELOAD-RAN");
  writeFileSync(join(d, "bunfig.toml"), `preload = ["./p.ts"]\n`); writeFileSync(join(d, "p.ts"), `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "1");\n`);
  writeFileSync(join(d, ".env"), "CREW_STUDIO_GRANT=from-dotenv\n"); return { d, mark }; };

step("not installed: the row offers to install", () => { const h = fresh(), it = cliDoctorItem(cliInstallState(src(h, "/usr/bin:/bin")));
  assert.equal(it.status, "info"); assert.equal(it.action.kind, "cli-install"); assert.equal(it.detail, "not installed"); });
step("from a checkout, ~/.local/bin not on PATH: a shim is written, and the row says the line to add to ~/.zprofile", () => {
  const h = fresh(), st = installCli(src(h, "/usr/bin:/bin")), bin = join(h, ".local", "bin", "crew-studio");
  assert.ok(st.current && !st.onPath && (lstatSync(bin).mode & 0o111) !== 0, JSON.stringify(st));
  const text = readFileSync(bin, "utf8"); assert.match(text, /command -v bun/); assert.match(text, /exec "\$bun" --no-env-file --config=\/dev\/null "\$root\/src\/main\.ts" "\$@"/);
  const it = cliDoctorItem(st); assert.equal(it.status, "degraded"); assert.match(it.fix, /~\/\.zprofile.*export PATH="\$HOME\/\.local\/bin:\$PATH"/); assert.equal(it.action.kind, "none");
  // the shim is the real CLI
  const r = run(bin, ["help", "--json"], { env: { HOME: h } }); assert.equal(r.code, 0, r.err); assert.ok(r.json.commands.length > 5);
  assert.equal(installCli(src(h, "/usr/bin:/bin")).current, true, "installing again is fine");
});
step("~/.local/bin on PATH: the row is ok; a literal $HOME/.local/bin in PATH is not the folder", () => { const h = fresh(); const st = installCli(src(h, `${join(h, ".local", "bin")}:/usr/bin`)); const it = cliDoctorItem(st);
  assert.equal(it.status, "ok"); assert.equal(it.fix, ""); assert.ok(st.onPath); assert.equal(cliInstallState(src(h, "$HOME/.local/bin:/usr/bin")).onPath, false); });
step("a binary: a symlink to it", () => { const h = fresh(), fake = join(h, "crew-studio-bin"); writeFileSync(fake, "#!/bin/sh\necho bin\n"); chmodSync(fake, 0o755);
  const st = installCli({ home: h, path: "/usr/bin", compiled: true, execPath: fake, srcRoot: REPO }); assert.ok(st.current); assert.equal(readlinkSync(st.bin), fake); });
step("a file there Studio did not write is refused, never overwritten, and no Install button is offered", () => { const h = fresh(), d = join(h, ".local", "bin"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "crew-studio"), "#!/bin/sh\necho mine\n");
  assert.throws(() => installCli(src(h, "/usr/bin")), /not Studio's/); assert.equal(readFileSync(join(d, "crew-studio"), "utf8"), "#!/bin/sh\necho mine\n");
  const it = cliDoctorItem(cliInstallState(src(h, "/usr/bin"))); assert.match(it.fix, /Move .* away/); assert.equal(it.action.kind, "none"); });
step("a link there to another tool is refused the same way: it is not taken for Studio's", () => { const h = fresh(), d = join(h, ".local", "bin"), other = join(h, "othertool"); mkdirSync(d, { recursive: true });
  writeFileSync(other, "#!/bin/sh\necho other\n"); chmodSync(other, 0o755); symlinkSync(other, join(d, "crew-studio"));
  assert.throws(() => installCli(src(h, "/usr/bin")), /a link to .*othertool, not Studio's/); assert.equal(readlinkSync(join(d, "crew-studio")), other);
  const it = cliDoctorItem(cliInstallState(src(h, "/usr/bin"))); assert.match(it.detail, /a link to .*othertool, not Studio's/); assert.equal(it.action.kind, "none");
  assert.throws(() => installCli({ home: h, path: "/usr/bin", compiled: true, execPath: join(h, "studio-bin"), srcRoot: REPO }), /not Studio's/, "the app too"); });
step("the shim quotes its paths: $ and backticks in a folder name are not run", () => { const h = fresh(), root = fakeStudio(join(h, "a$(touch PWNED)`id`b"), "quoted");
  const st = installCli(src(h, "/usr/bin", root)); const r = run(st.bin, ["x", "y z"], { cwd: h, env: { HOME: h } });
  assert.equal(r.code, 0, r.err); assert.deepEqual(r.json, { label: "quoted", args: ["x", "y z"], grant: null }); assert.ok(!existsSync(join(h, "PWNED"))); });
step("a release: the shim runs the one live.json names now (a deploy needs no reinstall); a pruned one is an exit-6 reinstall", () => {
  const h = fresh(), rel = join(h, "releases"), a = fakeStudio(join(rel, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "old"), b = fakeStudio(join(rel, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "new");
  const st = installCli(src(h, "/usr/bin", a)); assert.equal(run(st.bin, [], { env: { HOME: h } }).json.label, "old", "no live.json: the release it was installed from");
  writeFileSync(join(rel, "live.json"), JSON.stringify({ schema: 1, live: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", pid: 1, port: 4210 }, history: [] }, null, 2));
  assert.equal(run(st.bin, [], { env: { HOME: h } }).json.label, "new", "after a deploy: the live one");
  rmSync(b, { recursive: true }); rmSync(a, { recursive: true });
  const gone = run(st.bin, ["now"], { env: { HOME: h } }); assert.equal(gone.code, 6); assert.equal(gone.json.exit, 6); assert.match(gone.json.error, /install it again from Studio's Doctor/); });
step("bun is found when the shim runs (PATH first, then the usual places), not where it was at install", () => { const h = fresh(), root = fakeStudio(join(h, "studio"), "found");
  const st = installCli({ ...src(h, "/usr/bin", root), execPath: join(h, "no-such-bun") }); const dir = join(process.execPath, "..");
  const r = run(st.bin, [], { env: { HOME: h, PATH: `${dir}:/usr/bin:/bin` } }); assert.equal(r.code, 0, r.err + r.out); assert.equal(r.json.label, "found"); });
step("an untrusted folder's bunfig.toml and .env are never read: by the shim, by the real CLI, by Studio's MCP helper", () => {
  const h = fresh(), { d, mark } = hostile(), root = fakeStudio(join(h, "studio"), "isolated"), st = installCli(src(h, "/usr/bin", root));
  const r = run(st.bin, [], { cwd: d, env: { HOME: h } }); assert.equal(r.code, 0, r.err); assert.equal(r.json.grant, null, ".env set CREW_STUDIO_GRANT"); assert.ok(!existsSync(mark), "bunfig preload ran");
  const real = installCli(src(fresh(), "/usr/bin")); const w = run(real.bin, ["whoami"], { cwd: d, env: { HOME: h, CREW_STUDIO_HOME: join(h, "no-home") } });
  assert.equal(w.code, 7); assert.ok(!/from-dotenv/.test(w.out), w.out); assert.ok(!existsSync(mark), "bunfig preload ran in the real CLI");
  const m = Bun.spawnSync(helperCommand("mcp"), { cwd: d, stdin: "ignore", env: { ...process.env, HOME: h, CREW_STUDIO_HOME: join(h, "no-home") } as any });
  assert.ok(!existsSync(mark), "bunfig preload ran in the MCP helper"); assert.ok(!/from-dotenv/.test(m.stderr.toString()), m.stderr.toString()); });
step("bash and fish get their own profile line", () => { const h = fresh();
  assert.equal(cliInstallState({ ...src(h, "/usr/bin"), shell: "/bin/bash" }).profile, "~/.bash_profile"); assert.equal(cliInstallState({ ...src(h, "/usr/bin"), shell: "/usr/local/bin/fish" }).pathLine, "fish_add_path ~/.local/bin"); });
step("skill install: user scope for both agents by default; one agent or one project when asked", () => { const h = fresh();
  assert.deepEqual(skillTargets({ claude: false, codex: false, project: null, home: h }).map((t) => t.file), [join(h, ".claude/skills/crew-studio/SKILL.md"), join(h, ".agents/skills/crew-studio/SKILL.md")]);
  assert.deepEqual(skillTargets({ claude: false, codex: true, project: "/p", home: h }).map((t) => t.file), ["/p/.agents/skills/crew-studio/SKILL.md"]); });
step("skill install writes its own file again and again, never over one it did not write, nor over one edited since (--force does)", () => { const h = fresh(), t = skillTargets({ claude: true, codex: false, project: null, home: h });
  assert.deepEqual(writeSkill(t, `x\n${SKILL_MARK}\n`).written, [t[0].file]); assert.deepEqual(writeSkill(t, `y\n${SKILL_MARK}\n`).written, [t[0].file]);
  writeFileSync(t[0].file, readFileSync(t[0].file, "utf8").replace("y\n", "y, and my own note\n"));
  const e = writeSkill(t, `z\n${SKILL_MARK}\n`); assert.deepEqual(e.edited, [t[0].file]); assert.match(readFileSync(t[0].file, "utf8"), /my own note/);
  assert.deepEqual(writeSkill(t, `z\n${SKILL_MARK}\n`, { force: true }).written, [t[0].file]); assert.ok(!/my own note/.test(readFileSync(t[0].file, "utf8")));
  writeFileSync(t[0].file, "the captain's own skill\n"); const b = writeSkill(t, `z\n${SKILL_MARK}\n`, { force: true }); assert.deepEqual(b.refused, [t[0].file]); assert.equal(readFileSync(t[0].file, "utf8"), "the captain's own skill\n");
  const r = run("bun", [join(REPO, "src", "main.ts"), "skill", "install", "--claude"], { env: { HOME: h } }); assert.equal(r.code, 2, "piped, without --yes, it writes nothing"); assert.ok(!existsSync(join(h, ".agents")));
  const p = run("bun", [join(REPO, "src", "main.ts"), "skill", "install", "--project", join(h, "no-such-folder"), "--yes"], { env: { HOME: h } });
  assert.equal(p.code, 2); assert.match(p.json.error, /no such folder/); assert.ok(!existsSync(join(h, "no-such-folder"))); });
step("a grant's name used again after a revoke or an expiry keeps the new grant's file; a name shaped like an id is refused", () => {
  const d = fresh(), dir = join(d, "grants-cli"), g = new CliGrants(join(d, "data"), () => {}, { dir, url: () => "http://127.0.0.1:1" });
  const a = g.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h", name: "review-bot" }, "captain").grant; g.revoke(a.id, "captain");
  const b = g.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h", name: "review-bot" }, "captain").grant; g.list();
  assert.equal(JSON.parse(readFileSync(join(dir, "review-bot.json"), "utf8")).id, b.id, "after a revoke");
  // the first grant of the name expires (its record says so), a third takes the name; listing keeps the third's file
  const file = join(d, "data", "cli-grants.json"), all = JSON.parse(readFileSync(file, "utf8")); g.revoke(b.id, "captain");
  const c = g.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h", name: "review-bot" }, "captain").grant;
  const recs = JSON.parse(readFileSync(file, "utf8")); for (const r of recs) if (r.id === a.id) r.expiresAt = new Date(Date.now() - 1000).toISOString(); writeFileSync(file, JSON.stringify(recs)); g.list();
  assert.equal(JSON.parse(readFileSync(join(dir, "review-bot.json"), "utf8")).id, c.id, "after an expiry"); void all;
  assert.throws(() => g.issue({ scopes: ["observe"], observe: { preset: "review" }, ttl: "1h", name: "g-0123abcd" }, "captain"), /may not look like a grant id/); });
console.log(failed ? "\ncli-install: FAILED" : "\ncli-install: all passed");
process.exit(failed ? 1 : 0);
