// The sandbox repository (data/demo-repo): a small Bun + TypeScript library with
// GitHub conventions (templates, CONTRIBUTING, CODEOWNERS, a CI workflow) that the
// coding workflow runs on, and that the captain can publish as a GitHub sandbox
// (README_SANDBOX.md). Its files come from templates/sandbox-repo (embedded in the
// binary); Studio registers it as project "sandbox" with its policies.
//   data/demo-repo                       the repository (standalone git, no remote until the captain publishes it)
//   data/policies/project-sandbox.yaml   sensitive_paths, round_cap, branch_prefix
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bundledBytes, bundledList } from "./bundled";
import { Projects } from "./doors";
import { addPaths, git, must } from "./git";
import { Policies } from "./runtime/checks";

const TEMPLATE = "templates/sandbox-repo/";
const SETUP = "chore: set up money-kit as the sandbox repository";
export const SANDBOX_POLICY = { sensitive_paths: [{ glob: ".github/**", why: "CI and repository settings" }], round_cap: 3, branch_prefix: "feature/" };

/**
 * Make data/demo-repo the sandbox repository, once. After the setup commit the
 * repository belongs to the captain and to the coding workflow: Studio never
 * writes the template again, never reverts a commit, and commits only the files it
 * wrote (data/demo-repo/.git/crew-sandbox marks a repository already set up).
 */
export function prepareSandbox(dataDir: string): { path: string; committed: string | null } {
  const dir = join(dataDir, "demo-repo"); mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".git"))) must(dir, ["init", "-q", "-b", "main"]);
  const mark = join(dir, ".git", "crew-sandbox");
  if (existsSync(mark)) return { path: dir, committed: null };
  const head = git(dir, ["rev-parse", "--verify", "HEAD"]).ok;
  // a repository set up before the mark existed: its setup commit is in the history
  if (head && git(dir, ["log", "-1", "--format=%H", "--fixed-strings", `--grep=${SETUP}`]).out) { writeFileSync(mark, `set up before ${new Date().toISOString()}\n`); return { path: dir, committed: null }; }
  const branch = head ? must(dir, ["symbolic-ref", "--short", "HEAD"]) : "main";
  if (head && branch !== "main") return { path: dir, committed: null }; // never rewrite a repo the captain has checked out elsewhere
  const written: string[] = [];
  for (const rel of bundledList(TEMPLATE)) {
    const name = rel.slice(TEMPLATE.length); const to = join(dir, name); const bytes = bundledBytes(rel)!;
    if (existsSync(to) && readFileSync(to).equals(bytes)) continue;
    mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, bytes); written.push(name);
  }
  if (!existsSync(join(dir, ".gitignore"))) { writeFileSync(join(dir, ".gitignore"), "node_modules/\n.DS_Store\n"); written.push(".gitignore"); } // dotfiles are not embedded
  let committed: string | null = null;
  if (written.length) {
    addPaths(dir, written); // only the template's files: the captain's other work stays out of Studio's commit
    if (git(dir, ["diff", "--cached", "--name-only", "--", ...written]).out) {
      must(dir, ["commit", "-q", "-m", `${SETUP}\n\nA Bun + TypeScript library with tests, a lint, GitHub templates, CONTRIBUTING, CODEOWNERS and a CI workflow.`, "--", ...written]);
      committed = must(dir, ["rev-parse", "HEAD"]);
    }
  }
  writeFileSync(mark, `set up ${new Date().toISOString()}\n`);
  return { path: dir, committed };
}
/** Register the sandbox as project "sandbox" with its policies (kept if the captain changed them). */
export function registerSandbox(dataDir: string): { project: string } {
  const p = new Projects(dataDir); const path = join(dataDir, "demo-repo");
  if (!p.get("sandbox")) p.add({ id: "sandbox", name: "money-kit (sandbox)", path, base: "main" });
  const pol = new Policies(dataDir);
  if (!existsSync(join(dataDir, "policies", "project-sandbox.yaml"))) pol.setProject("sandbox", SANDBOX_POLICY);
  return { project: "sandbox" };
}

/**
 * Additions to the sandbox repository after its setup, each applied once as a normal
 * commit on main (data/demo-repo/.git/crew-sandbox-addons.json lists the ones done).
 * Like the setup: Studio only adds files that are not there (a file the captain has
 * is kept as it is), adds missing package.json scripts only when package.json has no
 * uncommitted change, commits only what it wrote, and never resets or reverts.
 * Held while a run works on the repository (its branch fast-forwards onto main only
 * if main does not move under it); the next start applies it.
 */
export const SANDBOX_ADDONS = [{
  id: "corner-shop", dir: "templates/sandbox-app/",
  message: "feat(app): Corner Shop, a page that shows money-kit on screen\n\nA small shop page (product grid, basket, total, a dollar/yen switch) whose prices all go through format(); `bun run dev` serves it, `bun app/build.ts` writes it as static pages, and .crew/app.json tells Crew Studio how to capture it before and after a change.",
  scripts: { dev: "bun app/server.ts", "build:app": "bun app/build.ts" } as Record<string, string>,
}];
export function applySandboxAddons(dataDir: string, o: { live?: () => string[]; log?: (m: string) => void } = {}): { applied: string[]; held: string[]; committed: string | null; kept: string[] } {
  const dir = join(dataDir, "demo-repo"); const log = o.log ?? (() => {});
  const res = { applied: [] as string[], held: [] as string[], committed: null as string | null, kept: [] as string[] };
  if (!existsSync(join(dir, ".git", "crew-sandbox"))) return res; // not set up (or not ours)
  const doneFile = join(dir, ".git", "crew-sandbox-addons.json");
  let done: string[] = []; try { done = JSON.parse(readFileSync(doneFile, "utf8")); } catch {}
  const todo = SANDBOX_ADDONS.filter((a) => !done.includes(a.id)); if (!todo.length) return res;
  if (git(dir, ["symbolic-ref", "--short", "HEAD"]).out !== "main") { log(`sandbox additions held: the repository is not on main`); res.held = todo.map((a) => a.id); return res; }
  const live = o.live?.() ?? [];
  if (live.length) { log(`sandbox additions (${todo.map((a) => a.id).join(", ")}) held while ${live.join(", ")} work on the repository`); res.held = todo.map((a) => a.id); return res; }
  for (const a of todo) {
    const written: string[] = [];
    for (const rel of bundledList(a.dir)) {
      const name = rel.slice(a.dir.length); const to = join(dir, name); const bytes = bundledBytes(rel)!;
      if (existsSync(to)) { if (!readFileSync(to).equals(bytes)) res.kept.push(name); continue; }
      mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, bytes); written.push(name);
    }
    const pj = join(dir, "package.json");
    if (Object.keys(a.scripts).length && existsSync(pj)) {
      if (!git(dir, ["diff", "--quiet", "HEAD", "--", "package.json"]).ok) res.kept.push("package.json (it has uncommitted changes)");
      else { try { const doc = JSON.parse(readFileSync(pj, "utf8")); doc.scripts ??= {}; let changed = false;
        for (const [k, v] of Object.entries(a.scripts)) if (!(k in doc.scripts)) { doc.scripts[k] = v; changed = true; }
        if (changed) { writeFileSync(pj, JSON.stringify(doc, null, 2) + "\n"); written.push("package.json"); } } catch { res.kept.push("package.json (it does not read as JSON)"); } }
    }
    if (written.length) {
      addPaths(dir, written);
      if (git(dir, ["diff", "--cached", "--name-only", "--", ...written]).out) { must(dir, ["commit", "-q", "-m", a.message, "--", ...written]); res.committed = must(dir, ["rev-parse", "HEAD"]); }
    }
    done.push(a.id); res.applied.push(a.id); writeFileSync(doneFile, JSON.stringify(done));
    log(`sandbox addition ${a.id} applied${res.committed ? ` as ${res.committed.slice(0, 8)}` : " (nothing to add)"}${res.kept.length ? `; kept as the captain has them: ${res.kept.join(", ")}` : ""}`);
  }
  return res;
}
