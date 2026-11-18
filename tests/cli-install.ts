import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Doctor's "Install the CLI" (src/cli-install.ts) in a temporary HOME: ~/.local/bin/crew-studio becomes a symlink to the
// binary, or (from a checkout) a shim that runs bun <checkout>/src/main.ts; the row says whether ~/.local/bin is on PATH and,
// when not, the line to add; a file there that Studio did not write is never overwritten; installing again is idempotent.
// The shim, run, is the real CLI. `crew-studio skill install` writes only where it is told, never over a foreign file.
//      bun tests/cli-install.ts
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliDoctorItem, cliInstallState, installCli } from "../src/cli-install";
import { skillTargets, writeSkill, SKILL_MARK } from "../src/cli-skill";

const REPO = join(import.meta.dir, "..");
let failed = false;
const step = (name: string, f: () => void) => { try { f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
const fresh = () => mkdtempSync(join(tmpdir(), "crew-cli-install-home-"));
const src = (home: string, path: string) => ({ home, path, shell: "/bin/zsh", compiled: false, execPath: process.execPath, srcRoot: REPO });

step("not installed: the row offers to install", () => { const h = fresh(), it = cliDoctorItem(cliInstallState(src(h, "/usr/bin:/bin")));
  assert.equal(it.status, "info"); assert.equal(it.action.kind, "cli-install"); assert.equal(it.detail, "not installed"); });
step("from a checkout, ~/.local/bin not on PATH: a shim is written, and the row says the line to add to ~/.zprofile", () => {
  const h = fresh(), st = installCli(src(h, "/usr/bin:/bin")), bin = join(h, ".local", "bin", "crew-studio");
  assert.ok(st.current && !st.onPath && (lstatSync(bin).mode & 0o111) !== 0, JSON.stringify(st));
  assert.match(readFileSync(bin, "utf8"), /exec .*bun.* .*src\/main\.ts" "\$@"/);
  const it = cliDoctorItem(st); assert.equal(it.status, "degraded"); assert.match(it.fix, /~\/\.zprofile.*export PATH="\$HOME\/\.local\/bin:\$PATH"/); assert.equal(it.action.kind, "none");
  // the shim is the real CLI
  const r = Bun.spawnSync([bin, "help", "--json"], { env: { ...process.env, HOME: h } as any }); assert.equal(r.exitCode, 0, r.stderr.toString()); assert.ok(JSON.parse(r.stdout.toString()).commands.length > 5);
  assert.equal(installCli(src(h, "/usr/bin:/bin")).current, true, "installing again is fine");
});
step("~/.local/bin on PATH: the row is ok, with nothing to fix", () => { const h = fresh(); const st = installCli(src(h, `${join(h, ".local", "bin")}:/usr/bin`)); const it = cliDoctorItem(st);
  assert.equal(it.status, "ok"); assert.equal(it.fix, ""); assert.ok(st.onPath); });
step("a binary: a symlink to it", () => { const h = fresh(), fake = join(h, "crew-studio-bin"); writeFileSync(fake, "#!/bin/sh\necho bin\n"); chmodSync(fake, 0o755);
  const st = installCli({ home: h, path: "/usr/bin", compiled: true, execPath: fake, srcRoot: REPO }); assert.ok(st.current); assert.equal(readlinkSync(st.bin), fake); });
step("a file there Studio did not write is refused, never overwritten", () => { const h = fresh(), d = join(h, ".local", "bin"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "crew-studio"), "#!/bin/sh\necho mine\n");
  assert.throws(() => installCli(src(h, "/usr/bin")), /is not Studio's/); assert.equal(readFileSync(join(d, "crew-studio"), "utf8"), "#!/bin/sh\necho mine\n");
  assert.match(cliDoctorItem(cliInstallState(src(h, "/usr/bin"))).fix, /Move .* away/); });
step("bash and fish get their own profile line", () => { const h = fresh();
  assert.equal(cliInstallState({ ...src(h, "/usr/bin"), shell: "/bin/bash" }).profile, "~/.bash_profile"); assert.equal(cliInstallState({ ...src(h, "/usr/bin"), shell: "/usr/local/bin/fish" }).pathLine, "fish_add_path ~/.local/bin"); });
step("skill install: user scope for both agents by default; one agent or one project when asked", () => { const h = fresh();
  assert.deepEqual(skillTargets({ claude: false, codex: false, project: null, home: h }).map((t) => t.file), [join(h, ".claude/skills/crew-studio/SKILL.md"), join(h, ".agents/skills/crew-studio/SKILL.md")]);
  assert.deepEqual(skillTargets({ claude: false, codex: true, project: "/p", home: h }).map((t) => t.file), ["/p/.agents/skills/crew-studio/SKILL.md"]); });
step("skill install writes its own file, again and again, and never over one it did not write", () => { const h = fresh(), t = skillTargets({ claude: true, codex: false, project: null, home: h });
  const a = writeSkill(t, `x\n${SKILL_MARK}\n`); assert.deepEqual(a.written, [t[0].file]); assert.deepEqual(writeSkill(t, `y\n${SKILL_MARK}\n`).written, [t[0].file]);
  writeFileSync(t[0].file, "the captain's own skill\n"); const b = writeSkill(t, `z\n${SKILL_MARK}\n`); assert.deepEqual(b.refused, [t[0].file]); assert.equal(readFileSync(t[0].file, "utf8"), "the captain's own skill\n");
  const r = Bun.spawnSync(["bun", join(REPO, "src", "main.ts"), "skill", "install", "--claude"], { env: { ...process.env, HOME: h } as any });
  assert.equal(r.exitCode, 2, "piped, without --yes, it writes nothing"); assert.ok(!existsSync(join(h, ".agents"))); });
console.log(failed ? "\ncli-install: FAILED" : "\ncli-install: all passed");
process.exit(failed ? 1 : 0);
