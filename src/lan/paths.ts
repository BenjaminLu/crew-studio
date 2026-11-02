// The paths work from a peer may never write (docs/units/lan-relay.md): anything a later, unsandboxed checkout, tool or
// agent would execute or obey. Matched case-insensitively (macOS volumes are case-insensitive), on every path segment
// where a file can sit anywhere in a tree. Enforced when a round writes (src/lan/profile.ts), when the result is handed
// back (src/lan/runner.ts) and when the dispatcher applies a patch (src/lan/apply.ts).
const ANY = String.raw`(^|.*/)`;
export const PROTECTED: RegExp[] = [
  // CI and automation
  /^\.github\//, /^\.gitlab-ci\.ya?ml$/, /^\.gitlab\//, /^\.circleci\//, /^\.buildkite\//, /^\.travis\.ya?ml$/, /^azure-pipelines\.ya?ml$/, /^\.azure-pipelines\//,
  /^bitbucket-pipelines\.ya?ml$/, new RegExp(`${ANY}jenkinsfile$`), /^\.drone\.ya?ml$/, /^\.woodpecker(\/|\.ya?ml$)/, /^\.teamcity\//, /^appveyor\.ya?ml$/, /^\.semaphore\//,
  // git itself and its hooks, attributes (filter drivers) and submodules
  new RegExp(`${ANY}\\.git(/|$)`), /^\.husky\//, /^\.githooks\//, /^\.?lefthook(-local)?\.ya?ml$/, /^\.pre-commit-config\.ya?ml$/, /^\.pre-commit-hooks\.ya?ml$/,
  new RegExp(`${ANY}\\.gitattributes$`), new RegExp(`${ANY}\\.gitmodules$`), /^\.git-blame-ignore-revs$/,
  // package managers' install behaviour
  new RegExp(`${ANY}\\.npmrc$`), new RegExp(`${ANY}\\.yarnrc(\\.ya?ml)?$`), new RegExp(`${ANY}bunfig\\.toml$`), new RegExp(`${ANY}\\.pnpmfile\\.c?js$`), /^\.yarn\/plugins\//,
  // agents' and editors' instructions and settings, shells' and environments' hooks
  new RegExp(`${ANY}\\.claude(/|$)`), new RegExp(`${ANY}\\.mcp\\.json$`), new RegExp(`${ANY}claude\\.md$`), new RegExp(`${ANY}agents\\.md$`), new RegExp(`${ANY}\\.cursor(/|$)`), new RegExp(`${ANY}\\.cursorrules$`),
  new RegExp(`${ANY}\\.codex(/|$)`), new RegExp(`${ANY}\\.vscode/`), new RegExp(`${ANY}\\.idea/`), new RegExp(`${ANY}\\.devcontainer(/|\\.json$)`), new RegExp(`${ANY}\\.envrc$`), new RegExp(`${ANY}\\.tool-versions$`),
  new RegExp(`${ANY}\\.nvmrc$`), new RegExp(`${ANY}\\.python-version$`),
  // build and test runners that run code on their own
  new RegExp(`${ANY}makefile$`), new RegExp(`${ANY}gnumakefile$`), new RegExp(`${ANY}conftest\\.py$`), new RegExp(`${ANY}build\\.rs$`), new RegExp(`${ANY}setup\\.py$`), new RegExp(`${ANY}pytest\\.ini$`),
  new RegExp(`${ANY}tox\\.ini$`), new RegExp(`${ANY}noxfile\\.py$`), new RegExp(`${ANY}justfile$`), new RegExp(`${ANY}rakefile$`), new RegExp(`${ANY}dockerfile$`), new RegExp(`${ANY}docker-compose\\.ya?ml$`),
  new RegExp(`${ANY}\\.cargo/config(\\.toml)?$`), new RegExp(`${ANY}gradle\\.properties$`), new RegExp(`${ANY}gradlew$`),
];
/** package.json keys that run code: scripts and every git-hook manager's key */
export const SCRIPT_KEYS = ["scripts", "husky", "simple-git-hooks", "lint-staged", "pre-commit", "gitHooks", "config"];
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/").toLowerCase();
/** The reason a changed path is refused (it, plus why), or null. package.json counts when its script or hook keys differ
 *  from the base (with no base: when it has any). A file whose bytes are unknown (deleted, binary) counts by its path alone. */
export function protectedHit(path: string, after: string | null, before: string | null): string | null {
  const p = norm(path);
  if (PROTECTED.some((re) => re.test(p))) return path;
  if (/(^|\/)package\.json$/.test(p)) {
    const keys = (t: string | null) => { if (t === null) return "null"; try { const j = JSON.parse(t); return JSON.stringify(SCRIPT_KEYS.map((k) => j?.[k] ?? null)); } catch { return "unparsable"; } };
    const none = JSON.stringify(SCRIPT_KEYS.map(() => null)), a = keys(after), b = keys(before);
    if (a !== b && !(before === null && (a === none || a === "null"))) return `${path} (scripts or git hooks)`;
  }
  return null;
}
/** A path a round may not write at all (the write-time gate): protected, or any package.json (its keys are checked at hand-back). */
export const writeRefused = (path: string) => { const p = norm(path); return PROTECTED.some((re) => re.test(p)); };
