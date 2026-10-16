// Static lint over the test tree (run by tests/git-config-guard.ts): a tripwire for the usual mistakes, not a
// security boundary. Regular expressions over source text (minified one-line tests included) can be fooled;
// the protection is tests/lib/isolated-env.mjs, which every test entry imports on line 1 (tests/env-isolation.ts
// enforces that) and which removes inherited GIT_* before any test code runs.
// The rule: each git init / git config call names where it runs, and that place is checked: a variable bound to
// checkedTempDir(...), to join(<checked>, ...), or passed to assertTempRepo(...). A call that runs in
// process.cwd(), "", "." or an unchecked variable fails. A call whose place cannot be read (a property, a
// spread of arguments), and any --bare, needs at least one checkedTempDir/assertTempRepo in the file.
// A line marked `git-hygiene-lint: allow` is a deliberate unsafe sample; only the files in ALLOW may have
// them, each with its pinned count.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GIT_ARG = `['"]git['"]\\s*,\\s*`;
// git subcommands as they appear in an argument list: ["init", "-q"...], ["init"], ["init", dir], ["config", "--unset"...], ["config", "user.name"...]
const INIT = `['"]init['"]\\s*(?:,\\s*(?:['"]-|[\\w.$]+\\s*[\\]),])|\\])`;
const CONFIG = `['"]config['"]\\s*,\\s*(?:['"](?:-|[A-Za-z][\\w-]*\\.)|\`[\\w-]+\\.)`;
const RULES = {
  config: new RegExp(`(?:\\[\\s*|['"]-C['"]\\s*,\\s*[^,\\]\\n]+,\\s*|${GIT_ARG})${CONFIG}|\\bgit\\s+(?:-C\\s+\\S+\\s+)?config\\s+(?:-|[a-z]+\\.[a-z])`),
  init: new RegExp(`\\[\\s*${INIT}|${GIT_ARG}${INIT}|\\bgit\\s+init\\b`),
  bare: /['"](?:init|clone)['"][^\n\]]{0,80}?['"]--bare['"]|\bgit\s+(?:init|clone)\b[^\n'"]*--bare/,
};
/** files that may hold deliberate unsafe samples, and how many marked lines each has */
export const ALLOW = { "git-config-guard.ts": 5 };
const CHECKED = /\b(?:checkedTempDir|assertTempRepo)\(/;
const SELF = new Set(["lib/git-hygiene.mjs", "lib/git-hygiene-lint.mjs"]);

/** the places git init / git config run in, as written: [where, the call text] */
function writePlaces(text) {
  const out = [];
  const sub = `(?:(?:\\[\\s*)?(?:${GIT_ARG})?(?:${INIT}|${CONFIG}))`;
  // must(X, ["init"...]) / git(X, [...]) / sh(X, "git", "init") / run(X, ["git", "config", ...])
  for (const m of text.matchAll(new RegExp(`\\b(?:must|git|sh|run)\\(\\s*((?:[^,()]|\\([^()]*\\))+?)\\s*,\\s*\\[?\\s*${sub}`, "g"))) out.push([m[1].trim(), m[0]]);
  // ["-C", X, "config", ...]
  for (const m of text.matchAll(new RegExp(`['"]-C['"]\\s*,\\s*([^,\\]]+?)\\s*,\\s*(?:${INIT}|${CONFIG})`, "g"))) out.push([m[1].trim(), m[0]]);
  // spawnSync(["git", "init", ...], { cwd: X }) / spawnSync("git", ["config", ...], { cwd: X }); no cwd: process.cwd()
  for (const m of text.matchAll(new RegExp(`(?:spawnSync|spawn|execFileSync|execFile)\\(\\s*\\[?\\s*${GIT_ARG}\\[?\\s*(?:${INIT}|${CONFIG})[^\\n]*?\\)`, "g"))) {
    // git init <dir>: the folder it names (or the first argument of a join that builds it); otherwise its cwd, or the current folder
    const cwd = /\bcwd\s*:\s*([^,}]+)/.exec(m[0]); const pathArg = /['"]init['"](?:\s*,\s*['"][^'"]*['"])*\s*,\s*(?:([A-Za-z_$][\w$]*)\s*[\])]|(?:join|resolve)\(\s*([A-Za-z_$][\w$]*))/.exec(m[0]);
    out.push([pathArg ? (pathArg[1] ?? pathArg[2]) : cwd ? cwd[1].trim() : "process.cwd()", m[0]]); }
  return out;
}
/** variables bound to a checked place: checkedTempDir(...), realpathSync(checkedTempDir(...)), join(<checked>, ...), an alias, or assertTempRepo(v) */
function checkedVars(text) {
  const ok = new Set();
  for (const m of text.matchAll(/\bassertTempRepo\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) ok.add(m[1]);
  const binds = [...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=(?![=>])\s*([^;,\n=]*)/g)].map((m) => [m[1], m[2].trim()]);
  for (let changed = true; changed;) { changed = false;
    for (const [v, e] of binds) { if (ok.has(v)) continue;
      const base = /^(?:realpathSync\(\s*)?(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)/.exec(e) ?? /^([A-Za-z_$][\w$]*)\s*$/.exec(e);
      if (/^(?:realpathSync\(\s*)?checkedTempDir\(/.test(e) || (base && ok.has(base[1]))) { ok.add(v); changed = true; } } }
  return ok;
}
/** Findings for one file's text: [] when it follows the rules. */
export function lintGitHygieneText(path, fullText) {
  // a line marked `git-hygiene-lint: allow` is a deliberate unsafe sample: not linted, and only where ALLOW says, as many as it says
  const marked = fullText.split("\n").filter((l) => l.includes("git-hygiene-lint: allow")).length;
  const text = fullText.split("\n").filter((l) => !l.includes("git-hygiene-lint: allow")).join("\n");
  const hit = Object.fromEntries(Object.entries(RULES).map(([k, re]) => [k, re.test(text)]));
  const out = [];
  if (marked && ALLOW[path] !== marked) out.push({ path, rule: "allow-marker", why: `${marked} lines marked git-hygiene-lint: allow; ${path in ALLOW ? `pinned at ${ALLOW[path]}` : "this file may have none"}` });
  if (hit.config || hit.init || hit.bare) {
    const ok = checkedVars(text), places = writePlaces(text); let unread = !places.length;
    for (const [where, call] of places) {
      const what = /config/.test(call) ? "config" : "init", ident = /^[A-Za-z_$][\w$]*$/.test(where);
      if (/^(?:process\.cwd\(\)|['"`]\.?['"`]|undefined|null)$/.test(where)) out.push({ path, rule: "checked-temp-repo", why: `git ${what} runs in ${where === "process.cwd()" ? "the current folder" : `the path ${where}`}: ${call.slice(0, 120)}` });
      else if (ident && !ok.has(where)) out.push({ path, rule: "checked-temp-repo", why: `git ${what} runs in ${where}, which is not a checked temp repo (checkedTempDir, a join of one, or assertTempRepo): ${call.slice(0, 120)}` });
      else if (!ident) unread = true;
    }
    if ((unread || hit.bare) && !CHECKED.test(text)) out.push({ path, rule: "checked-temp-repo", why: `runs git ${["config", "init", "bare"].filter((k) => hit[k]).join("/")} without a checked temp repo (checkedTempDir or assertTempRepo)` });
  }
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
