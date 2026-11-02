// The paths work from a peer may never write (docs/units/lan-relay.md): anything a later, unsandboxed checkout, tool or
// agent would execute or obey. Matched case-insensitively (macOS volumes are case-insensitive), on every path segment
// where a file can sit anywhere in a tree. Enforced when a round writes (src/lan/profile.ts), when the result is handed
// back (src/lan/runner.ts) and when the dispatcher applies a patch (src/lan/apply.ts).
/** Each entry is a path (a folder ends with "/", a regex-escaped file name otherwise) that is protected at any depth: a
 *  monorepo's packages/app/.github/ is as live as the root's. */
const AT_ANY_DEPTH = [
  // CI and automation
  ".github/", "\\.gitlab-ci\\.ya?ml", ".gitlab/", ".circleci/", ".buildkite/", "\\.travis\\.ya?ml", "azure-pipelines\\.ya?ml", ".azure-pipelines/",
  "bitbucket-pipelines\\.ya?ml", "jenkinsfile", "\\.drone\\.ya?ml", ".woodpecker/", "\\.woodpecker\\.ya?ml", ".teamcity/", "appveyor\\.ya?ml", ".semaphore/",
  // git itself and its hooks, attributes (filter drivers) and submodules
  ".git/", "\\.git", ".husky/", ".githooks/", "\\.?lefthook(-local)?\\.ya?ml", "\\.pre-commit-config\\.ya?ml", "\\.pre-commit-hooks\\.ya?ml",
  "\\.gitattributes", "\\.gitmodules", "\\.git-blame-ignore-revs",
  // package managers: what an install runs or fetches (settings, lockfiles, Python's build config)
  "\\.npmrc", "\\.yarnrc(\\.ya?ml)?", "bunfig\\.toml", "\\.pnpmfile\\.c?js", ".yarn/plugins/", "package-lock\\.json", "npm-shrinkwrap\\.json", "yarn\\.lock",
  "pnpm-lock\\.ya?ml", "pnpm-workspace\\.ya?ml", "bun\\.lockb?", "cargo\\.lock", "poetry\\.lock", "pipfile(\\.lock)?", "uv\\.lock", "pyproject\\.toml", "setup\\.cfg",
  "gemfile(\\.lock)?", "go\\.sum", "composer\\.(json|lock)",
  // agents' and editors' instructions and settings, shells' and environments' hooks
  ".claude/", "\\.claude", "\\.mcp\\.json", "claude\\.md", "agents\\.md", ".cursor/", "\\.cursorrules", ".codex/", ".vscode/", ".idea/", ".devcontainer/",
  "\\.devcontainer\\.json", "\\.envrc", "\\.tool-versions", "\\.nvmrc", "\\.python-version",
  // build and test runners that run code on their own
  "makefile", "gnumakefile", "conftest\\.py", "build\\.rs", "setup\\.py", "pytest\\.ini", "tox\\.ini", "noxfile\\.py", "justfile", "rakefile", "dockerfile",
  "docker-compose\\.ya?ml", ".cargo/", "gradle\\.properties", "gradlew",
];
export const PROTECTED: RegExp[] = AT_ANY_DEPTH.map((e) => e.endsWith("/") ? new RegExp(`(^|/)${e.slice(0, -1).replace(/\./g, "\\.")}/`) : new RegExp(`(^|/)${e}$`));
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
