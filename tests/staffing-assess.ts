// Projects.staffingAssess is an extraction of the checks staffingIdentity has always run (src/doors.ts): the
// refactored staffingIdentity must return the same identity or throw the same error as the verbatim pre-refactor copy
// (tests/fixtures/staffing-identity-reference.ts) for every registration shape below, including the reviewer's attack
// cases, with one change the captain decided (2026-10-16): another registration whose root folder does not exist is
// skipped instead of refusing. staffingAssess must name the reason and the registration at fault.
//   bun tests/staffing-assess.ts
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Projects } from "../src/doors";
import { prepareSandbox, registerSandbox } from "../src/sandbox-repo";
import { referenceStaffingIdentity } from "./fixtures/staffing-identity-reference";
import { suite } from "./rt-harness";
const { ok, end } = suite("staffing-assess");

const DATA = mkdtempSync(join(tmpdir(), "crew-sa-data-")), repos = mkdtempSync(join(tmpdir(), "crew-sa-repos-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).toString().trim();
const mkRepo = (name: string, at = repos) => { const d = join(at, name); mkdirSync(d); git(d, "init", "-q", "-b", "main"); writeFileSync(join(d, "R"), name); git(d, "add", "R"); git(d, "commit", "-q", "-m", "s"); return d; };
const rec = (id: string, path: string | null, extra: any = {}) => ({ id, name: id, path, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, ...extra });
prepareSandbox(DATA); registerSandbox(DATA);
const sandboxReg = JSON.parse(readFileSync(join(DATA, "projects.json"), "utf8"));
const harbor = mkRepo("harbor");
const healthy = [...sandboxReg, rec("harbor", harbor)];
const projects = new Projects(DATA);
const outcome = (f: () => any) => { try { const v = f(); return { ok: true, v: JSON.stringify(v) }; } catch (e: any) { return { ok: false, v: `${e?.constructor?.name}:${e?.code ?? ""}:${e?.message}` }; } };

// the shapes (the reviewer's attack cases and the plain ones)
const nr = join(repos, "nonrepo"); mkdirSync(nr);
const g1 = join(repos, "g1"); mkdirSync(g1); writeFileSync(join(g1, ".git"), `gitdir: ${nr}\n`);
const g2 = mkRepo("g2"); writeFileSync(join(g2, ".git", "commondir"), nr + "\n");
const g2b = mkRepo("g2b"); writeFileSync(join(g2b, ".git", "commondir"), "/nonexistent/zzz\n");
const outGit = join(repos, "outgitfile"); writeFileSync(outGit, `gitdir: ${join(harbor, ".git")}\n`);
const g3 = join(repos, "g3"); mkdirSync(g3); symlinkSync(outGit, join(g3, ".git"));
const g4 = mkRepo("g4"); const cdf = join(repos, "cd"); writeFileSync(cdf, join(g4, ".git") + "\n"); symlinkSync(cdf, join(g4, ".git", "commondir"));
const realRepo = mkRepo("real"), ln = join(repos, "link"); symlinkSync(realRepo, ln);
const junk = join(repos, "junk"); mkdirSync(junk); writeFileSync(join(junk, ".git"), "not a pointer\n");
const ghost = join(repos, "ghost"); mkdirSync(ghost); writeFileSync(join(ghost, ".git"), `gitdir: ${join(repos, "gone-gitdir")}\n`);
const s7 = join(repos, "s7"); mkdirSync(s7); symlinkSync(outGit, join(s7, ".git"));
const wt = join(repos, "harbor-wt"); git(harbor, "worktree", "add", "-q", "-b", "side", wt);
const g10 = mkRepo("g10"); writeFileSync(join(g10, ".git", "commondir"), "\n");
const inData = mkRepo("inside", DATA);
const nb = mkRepo("nb");
// [label, extra registrations, targets, targets whose outcome changes by the captain's skip rule]
const cases: [string, any[], string[], string[]?][] = [
  ["healthy", [], ["harbor", "sandbox"]],
  ["other: gitdir -> existing non-repo dir", [rec("g1", g1)], ["harbor", "g1"]],
  ["other: commondir -> existing outside dir", [rec("g2", g2)], ["harbor", "g2"]],
  ["other: commondir -> missing dir", [rec("g2b", g2b)], ["harbor", "g2b"]],
  ["other: .git is a symlinked file pointing outside its root", [rec("g3", g3)], ["harbor", "g3"]],
  ["other: commondir file is a symlink outside .git", [rec("g4", g4)], ["harbor", "g4"]],
  ["other: symlinked root to a healthy repo", [rec("g5", ln)], ["harbor", "g5"]],
  ["other: folder missing", [rec("gone", join(repos, "missing"))], ["harbor", "gone"], ["harbor"]],
  ["other: disabled, folder missing", [rec("gone-off", join(repos, "missing2"), { enabled: false })], ["harbor", "gone-off"], ["harbor"]],
  ["other: garbage .git file", [rec("junk", junk)], ["harbor", "junk"]],
  ["other: gitdir gone", [rec("ghost", ghost)], ["harbor", "ghost"]],
  ["two missing roots", [rec("bA", join(repos, "missA")), rec("bB", g1 + "nope")], ["harbor", "bA", "bB"], ["harbor"]],
  ["self broken + other missing", [rec("self7", s7), rec("m7", join(repos, "miss7"))], ["self7", "harbor"]],
  ["alias: a worktree of harbor", [rec("harbor-wt", wt)], ["harbor", "harbor-wt"]],
  ["alias: same path twice", [rec("harbor2", harbor)], ["harbor", "harbor2"]],
  ["self base missing", [rec("nobase", nb, { base: "nope" })], ["nobase"]],
  ["self base invalid", [rec("badbase", nb, { base: "a..b" })], ["badbase"]],
  ["other: empty commondir", [rec("g10", g10)], ["harbor", "g10"]],
  ["self inside the data dir", [rec("priv", inData)], ["priv", "harbor"]],
  ["external grant", [rec("ext", nb, { github: { repository: "a/b" } })], ["ext"]],
  ["no path", [rec("nopath", null)], ["nopath", "harbor"]],
  ["unknown id", [], ["nope", ""]],
];
writeFileSync(join(DATA, "projects.json"), JSON.stringify(healthy));
const healthyHarbor = JSON.stringify(projects.staffingIdentity("harbor"));
for (const [label, extra, targets, changed = []] of cases) {
  writeFileSync(join(DATA, "projects.json"), JSON.stringify([...healthy, ...extra]));
  for (const id of targets) {
    const ref = outcome(() => referenceStaffingIdentity.call(projects, id)), now = outcome(() => projects.staffingIdentity(id));
    const a = projects.staffingAssess(id);
    if (changed.includes(id)) { ok(!ref.ok && now.ok && now.v === healthyHarbor && a.ok, `${label} · ${id}: the missing root is now skipped (was refused), same identity as with a healthy registry`, `${ref.v} | ${now.v}`); continue; }
    ok(ref.ok === now.ok && ref.v === now.v && a.ok === now.ok && (a.ok ? JSON.stringify(a.identity) === now.v : `${(a.error as any)?.constructor?.name}:${(a.error as any)?.code ?? ""}:${(a.error as any)?.message}` === now.v),
      `${label} · ${id || "(empty)"}: same outcome as before the extraction`, `${ref.v} | ${now.v}`);
  }
}
// the reasons and the registration at fault
const reason = (extra: any[], id: string) => { writeFileSync(join(DATA, "projects.json"), JSON.stringify([...healthy, ...extra])); const a = projects.staffingAssess(id); return a.ok ? { reason: "ok", record: id, aliases: [] as string[] } : { reason: a.reason, record: a.record, aliases: a.aliases }; };
const want = (got: any, r: string, rec: string, label: string) => ok(got.reason === r && got.record === rec, label, JSON.stringify(got));
want(reason([], "harbor"), "ok", "harbor", "healthy: ok");
want(reason([rec("gone", join(repos, "missing"))], "harbor"), "ok", "harbor", "another registration's root is missing: skipped, harbor can start");
want(reason([rec("gone", join(repos, "missing"))], "gone"), "folder_missing", "gone", "a registration whose own root is missing is refused itself");
want(reason([rec("ghost", ghost)], "harbor"), "git_invalid", "ghost", "a gone gitdir: git_invalid, named");
want(reason([rec("junk", junk)], "harbor"), "git_invalid", "junk", "a garbage .git file: git_invalid, named");
want(reason([rec("g1", g1)], "harbor"), "ok", "harbor", "a gitdir that is a plain directory passes the check (as it always has)");
want(reason([rec("g3", g3)], "harbor"), "git_escapes_container", "g3", "a symlinked .git file out of its root: git_escapes_container");
want(reason([rec("g4", g4)], "harbor"), "git_escapes_container", "g4", "a symlinked commondir out of .git: git_escapes_container");
want(reason([rec("g2b", g2b)], "harbor"), "git_invalid", "g2b", "a commondir to a missing directory: git_invalid");
{ const g = reason([rec("harbor-wt", wt)], "harbor"); ok(g.reason === "ambiguous_alias" && g.record === "harbor" && g.aliases.join() === "harbor-wt", "a worktree registered under another id: ambiguous_alias with the alias named", JSON.stringify(g)); }
{ const g = reason([rec("harbor2", harbor)], "harbor"); ok(g.reason === "ambiguous_alias" && g.aliases.join() === "harbor2", "the same path twice: ambiguous_alias", JSON.stringify(g)); }
want(reason([rec("priv", inData)], "priv"), "private_overlap", "priv", "a repository inside the data dir: private_overlap");
want(reason([rec("nobase", nb, { base: "nope" })], "nobase"), "base_missing", "nobase", "a base branch that does not exist: base_missing");
want(reason([rec("badbase", nb, { base: "a..b" })], "badbase"), "base_invalid", "badbase", "an invalid base name: base_invalid");
want(reason([rec("ext", nb, { github: { repository: "a/b" } })], "ext"), "external_unverified", "ext", "an external grant on this build: external_unverified");
want(reason([rec("off", nb, { enabled: false })], "off"), "missing_or_disabled", "off", "a disabled project: missing_or_disabled");
{ writeFileSync(join(DATA, "projects.json"), JSON.stringify([...healthy, rec("off2", join(repos, "missing3"), { enabled: false })])); const a = projects.staffingAssess("off2", [], { includeDisabled: true });
  ok(!a.ok && a.reason === "folder_missing" && a.record === "off2", "includeDisabled (display only) checks a disabled registration's own folder", JSON.stringify(a)); }
// ---- the captain's skip rule, edge by edge ----
{ const f = join(repos, "now-a-file"); writeFileSync(f, "x");
  want(reason([rec("filed", f)], "harbor"), "folder_unusable", "filed", "a root replaced by a file still refuses (it exists)"); }
want(reason([rec("bA", join(repos, "missA")), rec("junk", junk)], "harbor"), "git_invalid", "junk", "a missing root is skipped, the garbage .git beside it still refuses and is named");
{ const locked = join(repos, "locked"); mkdirSync(locked); const inner = mkRepo("inner", locked); chmodSync(locked, 0o000);
  try { const g = reason([rec("noaccess", inner)], "harbor"); ok(g.reason === "folder_unusable" && g.record === "noaccess" && !(() => { try { projects.staffingIdentity("harbor"); return true; } catch { return false; } })(), "a root behind EACCES still refuses", JSON.stringify(g)); }
  finally { chmodSync(locked, 0o755); } }
{ const back = join(repos, "comes-back");
  want(reason([rec("back", back)], "harbor"), "ok", "harbor", "a missing root is skipped");
  git(harbor, "worktree", "add", "-q", "-b", "back-branch", back);
  const g = reason([rec("back", back)], "harbor"); ok(g.reason === "ambiguous_alias" && g.aliases.join() === "back", "the same root reappearing (a worktree of harbor) is counted again", JSON.stringify(g)); }
{ const dangling = join(repos, "dangling"); symlinkSync(join(repos, "nowhere"), dangling);
  want(reason([rec("dl", dangling)], "harbor"), "folder_unusable", "dl", "a dangling symlink root exists (lstat finds it): not skipped, refuses others as folder_unusable");
  want(reason([rec("dl", dangling)], "dl"), "folder_unusable", "dl", "a dangling symlink root refuses itself as folder_unusable, not folder_missing"); }
{ const f = join(repos, "a-file"); writeFileSync(f, "x"); const under = join(f, "sub");
  want(reason([rec("nd", under)], "harbor"), "folder_unusable", "nd", "a root below a file (ENOTDIR) is not skipped: refuses others as folder_unusable");
  want(reason([rec("nd", under)], "nd"), "folder_unusable", "nd", "a root below a file refuses itself as folder_unusable"); }
want(reason([rec("gone", join(repos, "missing"))], "gone"), "folder_missing", "gone", "only a root that lstat cannot find is folder_missing");
{ writeFileSync(join(DATA, "projects.json"), "{bad"); const a = projects.staffingAssess("harbor"); ok(!a.ok && a.reason === "registry_unreadable", "a malformed registry: registry_unreadable"); }
end();
