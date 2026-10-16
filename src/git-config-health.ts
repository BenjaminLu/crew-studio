// The shared git config of a checkout (<repo>/.git/config) is read by the checkout and by
// every linked worktree, Studio's task worktrees under data/work/wt included. One bad key
// there breaks all of them at once, and git only says "must be run in a work tree"
// (2026-10-16: core.bare=true, written by a test fixture's `git init` that inherited
// GIT_DIR from `git bisect run`). This module reads that file directly, without git's
// repository discovery (which is what the bad key breaks), and names each problem:
//   core.bare      true in a repository that has a working tree
//   core.worktree  pointing anywhere but the checkout that owns the git folder
//   core.hooksPath pointing outside the repository
//   (unreadable)   a config file git cannot parse
// The decision to refuse a worktree parses the file(s) in this process, as written (no include.path); when
// extensions.worktreeConfig is on, the checkout's own config.worktree is read too. Only what makes git itself fail blocks a worktree
// (core.bare, a wrong core.worktree, an unreadable file or a bad boolean): a hooksPath outside the
// repository and keys that come only through include.path are reported, never refused (Studio's
// git overrides hooksPath anyway).
// It only reports. Studio never rewrites a repository's config: the fix is the captain's.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gitEnv } from "./git";
import { RoundBlocked } from "./round-blocked";

export type GitConfigProblem = { label: string; repo: string; config: string; key: "core.bare" | "core.worktree" | "core.hooksPath" | "config"; value: string; why: string; fix: string;
  /** true: git itself fails on it, so Studio refuses task worktrees; false: reported only (Doctor, startup) */
  blocking: boolean; /** git did not answer: the repository was not checked */ unchecked?: boolean };
type Layout = { gitDir: string; commonDir: string; config: string; tops: string[] };

/** the real path of p, or of its nearest existing ancestor plus the rest (/var and /private/var compare equal) */
const real = (p: string): string => { try { return realpathSync(p); } catch { const up = dirname(resolve(p)); return up === resolve(p) ? up : join(real(up), basename(p)); } };
const inside = (root: string, p: string) => { const r = relative(real(root), real(p)); return r === "" || (!!r && r !== ".." && !r.startsWith("../") && !isAbsolute(r)); };

/** Where a checkout's git folder and shared config are, read from the files git itself reads (no git process). Null: not a checkout. */
export function gitLayout(repo: string): Layout | null {
  if (typeof repo !== "string" || !repo || !isAbsolute(repo)) return null;
  const dot = join(repo, ".git"); let gitDir: string;
  try {
    const st = statSync(dot);
    if (st.isDirectory()) gitDir = dot;
    else if (st.isFile() && st.size < 4096) { const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dot, "utf8")); if (!m) return null; gitDir = resolve(repo, m[1]); }
    else return null;
  } catch { return null; }
  let commonDir = gitDir;
  try { const c = readFileSync(join(gitDir, "commondir"), "utf8").trim(); if (c) commonDir = resolve(gitDir, c); } catch {}
  // the checkouts allowed to own this git folder: the main checkout (<top>/.git), and this one when its git folder is the common one (a submodule)
  const tops = [...new Set([...(basename(commonDir) === ".git" ? [dirname(commonDir)] : []), ...(real(gitDir) === real(commonDir) ? [repo] : [])].map(real))];
  return { gitDir, commonDir, config: join(commonDir, "config"), tops };
}

/**
 * git's config file syntax (config.c), parsed in this process (no git spawn, no timeout, nothing that can hang
 * a round): a UTF-8 BOM only at the very start of the file; space, tab and CR as the only whitespace before a
 * line's content; [section] and [section "subsection"] headers with no other padding (a key may follow on the
 * same line), case-insensitive names, values with "quotes", \\ \" \n \t \b escapes, # and ; comments, a
 * trailing \ continuing the value on the next line. A key with no "=" is null (true as a boolean). Returns each
 * key's last value, or the error git would also stop on. Fails closed: a line it cannot classify (a form feed,
 * a no-break space, anything not a comment, header or key) makes the whole file unreadable, as git reports it.
 * include.path is not followed: blocking decisions read the file as written.
 */
export function parseGitConfig(text: string): { ok: true; values: Map<string, string | null> } | { ok: false; error: string } {
  const values = new Map<string, string | null>(); const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/); let section: string | null = null;
  const lead = /^[ \t\r]*/; // git's isspace: space, tab, CR (LF ends the line); never \f, \v or U+00A0
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n].replace(lead, "");
    const bad = (why: string) => ({ ok: false as const, error: `bad config line ${n + 1}: ${why}` });
    if (line.startsWith("[")) {
      // [name] or [name<space/tab/CR...>"sub"], nothing inside the brackets around them
      const h = /^\[([A-Za-z0-9.-]+)(?:[ \t\r]+"((?:[^"\\]|\\.)*)")?\]/.exec(line);
      if (!h) return bad("a section header git cannot read");
      section = h[2] !== undefined ? `${h[1].toLowerCase()}.${h[2].replace(/\\(.)/g, "$1")}` : h[1].toLowerCase();
      line = line.slice(h[0].length).replace(lead, "");
    }
    if (!line || line[0] === "#" || line[0] === ";") continue;
    const k = /^([A-Za-z][A-Za-z0-9-]*)[ \t]*/.exec(line); if (!k) return bad("a line that is not a comment, a section header or a key");
    if (section === null) return bad("a key outside any section");
    let rest = line.slice(k[0].length); const key = `${section}.${k[1].toLowerCase()}`;
    if (!rest) { values.set(key, null); continue; }
    if (rest[0] !== "=") return bad("a key followed by something other than =");
    rest = rest.slice(1);
    let out = "", pending = "", quoted = false;
    for (;;) {
      let i = 0, cont = false, done = false;
      for (; i < rest.length; i++) {
        const c = rest[i];
        if (!quoted && (c === "#" || c === ";")) { done = true; break; }
        if (!quoted && (c === " " || c === "\t" || c === "\r")) { if (out) pending += c; continue; }
        if (c === "\\") {
          if (i === rest.length - 1) { cont = true; break; }
          const e = rest[++i]; const m: Record<string, string> = { n: "\n", t: "\t", b: "\b", "\\": "\\", '"': '"' };
          if (!(e in m)) return bad(`an unknown escape \\${e}`);
          out += pending + m[e]; pending = ""; continue;
        }
        if (c === '"') { quoted = !quoted; continue; }
        out += pending + c; pending = "";
      }
      if (cont && n + 1 < lines.length) { rest = lines[++n]; continue; }
      if (quoted && !done) return bad("an unterminated quote");
      break;
    }
    if (quoted) return bad("an unterminated quote");
    values.set(key, out);
  }
  return { ok: true, values };
}
/** git's boolean: null (no "=") true; true/yes/on true; false/no/off/"" false; an integer (k/m/g suffix allowed) true unless 0; anything else is not a boolean */
export function gitBool(v: string | null): boolean | null {
  if (v === null) return true; const t = v.trim().toLowerCase();
  if (["true", "yes", "on"].includes(t)) return true; if (["false", "no", "off", ""].includes(t)) return false;
  const m = /^([-+]?\d+)([kmg]?)$/.exec(t); return m ? Number(m[1]) !== 0 : null;
}

/** The problems git itself would stop on, plus a hooksPath outside the repository (reported only), read in this process. */
export function gitConfigFileProblems(repo: string, label = repo): GitConfigProblem[] {
  const l = gitLayout(repo); if (!l || !existsSync(l.config)) return [];
  const out: GitConfigProblem[] = [];
  const read = (file: string, tops: string[], scope: string): Map<string, string | null> | null => {
    const p = (key: GitConfigProblem["key"], value: string, why: string, fix: string, blocking: boolean) => out.push({ label, repo, config: file, key, value, why, fix, blocking });
    let text: string; try { text = readFileSync(file, "utf8"); } catch (e: any) { p("config", "", `${file} cannot be read: ${e?.code ?? e}`, `Repair ${file} by hand`, true); return null; }
    const parsed = parseGitConfig(text);
    if (!parsed.ok) { p("config", "", `git cannot read ${file}: ${parsed.error}`, `Repair ${file} by hand`, true); return null; }
    const v = parsed.values;
    if (v.has("core.bare")) { const raw = v.get("core.bare")!, b = gitBool(raw);
      if (b === null) p("core.bare", String(raw), `core.bare in ${file}${scope} is not a boolean: git refuses to start in ${repo} and its linked worktrees`, `git config --file ${file} core.bare false`, true);
      else if (b) p("core.bare", raw ?? "true", `core.bare=true in ${file}${scope}, but ${repo} has a working tree: every git command there and in each linked worktree fails ("must be run in a work tree")`, `git config --file ${file} core.bare false`, true); }
    const wt = v.get("core.worktree");
    if (wt !== undefined && wt !== null) { const to = resolve(dirname(file), wt);
      if (!tops.includes(real(to))) p("core.worktree", wt, `core.worktree in ${file}${scope} points to ${to}, not to the checkout that owns it${tops.length ? ` (${tops.join(", ")})` : ""}: git works on the wrong folder`, `git config --file ${file} --unset core.worktree`, true); }
    const hp = v.get("core.hookspath");
    if (hp) { const expanded = hp.startsWith("~/") ? join(homedir(), hp.slice(2)) : hp; const to = isAbsolute(expanded) ? expanded : resolve(repo, expanded);
      if (![...l.tops, real(repo)].some((t) => inside(t, to))) p("core.hooksPath", hp, `core.hooksPath in ${file}${scope} points to ${to}, outside the repository: commits made outside Studio run hooks from a folder the repository does not own (Studio's own git overrides it)`, `git config --file ${file} --unset core.hooksPath`, false); }
    return v;
  };
  const shared = read(l.config, l.tops, "");
  // the checkout's own config.worktree, when the repository turned per-worktree config on
  if (shared && gitBool(shared.get("extensions.worktreeconfig") ?? "false")) { const w = join(l.gitDir, "config.worktree"); if (existsSync(w)) read(w, [real(repo)], " (per-worktree config)"); }
  return out;
}

/** report only: a git that hangs (a wrapper, a locked filesystem) never holds Studio's start */
export const GIT_CONFIG_READ_TIMEOUT_MS = 2000;
/** The file problems, plus the keys whose value comes through include.path (reported, never refused; read with git, bounded). */
export function sharedGitConfigProblems(repo: string, label = repo): GitConfigProblem[] {
  const out = gitConfigFileProblems(repo, label); const l = gitLayout(repo);
  if (!l || !existsSync(l.config) || out.some((p) => p.key === "config")) return out;
  const parsed = parseGitConfig(readFileSync(l.config, "utf8")); if (!parsed.ok) return out;
  const r = Bun.spawnSync(["git", "config", "--file", l.config, "--includes", "--null", "--list"], { cwd: "/", stdout: "pipe", stderr: "pipe", env: gitEnv(), timeout: GIT_CONFIG_READ_TIMEOUT_MS });
  if ((r as any).exitedDueToTimeout) { out.push({ label, repo, config: l.config, key: "config", value: "", why: `git did not answer within ${GIT_CONFIG_READ_TIMEOUT_MS} ms, so the files ${l.config} includes were not checked`, fix: "Check that git runs", blocking: false, unchecked: true }); return out; }
  if (!r.success) return out;
  const inc = new Map<string, string | null>(); for (const e of r.stdout.toString().split("\0").filter(Boolean)) { const i = e.indexOf("\n"); inc.set((i < 0 ? e : e.slice(0, i)).toLowerCase(), i < 0 ? null : e.slice(i + 1)); }
  for (const k of ["core.bare", "core.worktree", "core.hookspath"]) if (inc.has(k) && inc.get(k) !== parsed.values.get(k)) {
    const key = (k === "core.hookspath" ? "core.hooksPath" : k) as GitConfigProblem["key"]; const v = inc.get(k);
    if (k === "core.bare" && gitBool(v ?? null) === false) continue;
    out.push({ label, repo, config: l.config, key, value: v ?? "true", why: `${key}=${v ?? "true"} reaches ${l.config} through include.path; reported, not refused`, fix: `Check the files ${l.config} includes`, blocking: false }); }
  return out;
}

/** Every listed repository checked once (two paths sharing one git folder are one check), in order. */
export function gitConfigReport(targets: { label: string; path: string | null | undefined }[]): { checked: { label: string; path: string }[]; problems: GitConfigProblem[] } {
  const seen = new Set<string>(); const checked: { label: string; path: string }[] = []; const problems: GitConfigProblem[] = [];
  for (const t of targets) {
    if (!t.path) continue; const l = gitLayout(t.path); if (!l) continue;
    const key = real(l.commonDir); if (seen.has(key)) continue; seen.add(key);
    checked.push({ label: t.label, path: t.path }); problems.push(...sharedGitConfigProblems(t.path, t.label));
  }
  return { checked, problems };
}

/** Refused before Studio makes or uses a worktree on a repository whose shared config breaks git: a typed BLOCKED reason, never a cascade of git errors or a retried node error. */
export class SharedGitConfigBroken extends RoundBlocked {
  readonly code = "shared_git_config_broken";
  constructor(readonly problems: GitConfigProblem[]) {
    super(`BLOCKED: the shared git config of ${problems[0].repo} is broken (${problems.map((x) => `${x.key}=${x.value}`).join(", ")}): ${problems[0].why}. Studio does not change it; fix it by hand (${problems.map((x) => x.fix).join("; ")}) and retry`);
  }
}
/** In-process only (no git spawn, no timeout): what makes git itself fail refuses; report-only findings never block. */
export function assertSharedGitConfig(repo: string) { const p = gitConfigFileProblems(repo).filter((x) => x.blocking); if (p.length) throw new SharedGitConfigBroken(p); }
