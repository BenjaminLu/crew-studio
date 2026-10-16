// Static lint over the test tree (run by tests/git-config-guard.ts): a test file that runs git config,
// git init, --bare or names GIT_DIR / GIT_WORK_TREE, or that spawns git itself, imports
// tests/lib/git-hygiene.mjs (which scrubs inherited GIT_* before anything runs); one that runs git config,
// git init or --bare also builds its repositories under checkedTempDir() or checks them with
// assertTempRepo(). The patterns read minified one-line tests too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RULES = {
  spawn: /(?:spawnSync|spawn|execFileSync|execFile|execSync)\(\s*\[?\s*['"`]git['"`\s]|\b(?:sh|run)\(\s*[\w.$]+\s*,\s*\[?\s*['"]git['"]|\[\s*['"]git['"]\s*,\s*(?:\.\.\.|['"]-C['"])/,
  config: /(?:\[\s*|['"]-C['"]\s*,\s*[^,\]\n]+,\s*|['"]git['"]\s*,\s*)['"]config['"]|\bgit\s+(?:-C\s+\S+\s+)?config\s+(?:-|[a-z]+\.[a-z])/,
  init: /\[\s*['"]init['"]|['"]git['"]\s*,\s*['"]init['"]|\bgit\s+init\b/,
  bare: /['"](?:init|clone)['"][^\n\]]{0,80}?['"]--bare['"]|\bgit\s+(?:init|clone)\b[^\n'"]*--bare/,
  env: /\bGIT_(?:DIR|WORK_TREE|COMMON_DIR)\b/,
};
const IMPORTS = /(?:from\s*|import\s*\(?\s*)['"](?:\.\.?\/)+(?:lib\/)?git-hygiene\.mjs['"]/;
const CHECKED = /\b(?:checkedTempDir|assertTempRepo)\(/;
const SELF = new Set(["lib/git-hygiene.mjs", "lib/git-hygiene-lint.mjs"]);

/** Findings for one file's text: [] when it follows the rules. */
export function lintGitHygieneText(path, text) {
  const hit = Object.fromEntries(Object.entries(RULES).map(([k, re]) => [k, re.test(text)]));
  const out = [];
  if (Object.values(hit).some(Boolean) && !IMPORTS.test(text))
    out.push({ path, rule: "imports-hygiene", why: `runs git (${Object.keys(hit).filter((k) => hit[k]).join(", ")}) without importing tests/lib/git-hygiene.mjs, so an inherited GIT_DIR reaches its git` });
  if ((hit.config || hit.init || hit.bare) && !CHECKED.test(text))
    out.push({ path, rule: "checked-temp-repo", why: `runs git ${["config", "init", "bare"].filter((k) => hit[k]).join("/")} without a checked temp repo (checkedTempDir or assertTempRepo)` });
  return out;
}
/** Every test source under dir (fixture data and node_modules aside). */
export function lintGitHygiene(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (e === "node_modules" || e.startsWith(".")) continue;
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|mjs|cjs|js)$/.test(e)) continue; const rel = relative(dir, p); if (SELF.has(rel)) continue;
    out.push(...lintGitHygieneText(rel, readFileSync(p, "utf8"))); } };
  walk(dir); return out;
}
