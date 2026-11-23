// Web terminals (docs/units/web-terminal.md): any CLI agent (Claude Code, Codex, cursor-agent, aider, opencode, gemini,
// amp), a shell or a free command, run in a real PTY in a registered project's folder, streamed to the page.
//   NOT SANDBOXED, by the captain's decision: the process runs as this user, with this user's permissions, in the project's
//   folder, as if the captain had opened Terminal there. Its environment is the user's own minus Studio's internals
//   (every CREW_* and FM_* variable, and any variable holding Studio's session token or ledger key).
//   PTY: Bun's own (Bun.spawn `terminal`, POSIX): no native module, no dependency; it carries full-screen TUIs, resize,
//   UTF-8 and colour. The page renders it with xterm.js (public/vendor).
//   Wire: server-sent events out (GET …/stream, the replay first), JSON POSTs in. Both go through the server's one guard
//   (src/server.ts handle → guardWrite), on the loopback listener (or the LAN one, which only phones reach).
//   Who: every write here (create, input, resize, kill, restart, dismiss) needs the desktop page's own session COOKIE on
//   loopback with Origin and Sec-Fetch-Site same-origin; x-crew-session (a script) and a paired phone's token are refused.
//   Not a boundary against local processes (they can read data/session-token). A phone may list and watch: the output with
//   the generic link rule, and none at all once a terminal has shown a Claude Code session link (states only), never the
//   link itself. Studio never turns Remote Control on: the captain does, by hand, when they want it.
//   Bounds: a scrollback ring per terminal (CREW_TERMINAL_SCROLLBACK bytes, default 2 MiB), at most CREW_TERMINAL_MAX
//   running (default 8), a transcript file per terminal capped at CREW_TERMINAL_TRANSCRIPT bytes (default 5 MiB), the 100
//   newest records kept. Studio stopping kills every terminal (the process group, SIGHUP then SIGKILL); nothing is
//   re-attached on restart: a record left open is closed as `studio-stopped` on the next start, and the ended terminals
//   (the 20 newest, not removed: a shell that ended well with nothing to review removes itself) are listed again from their records
//   (`restored`), so Send for review still works on them.
//   Record: data/terminals/<id>.json (who, project, command, start, end, exit code) and <id>.log (the transcript), and a
//   `terminal.start` / `terminal.exit` line in Studio's activity log. A log only: never evidence for a merge or a gate.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { detectState, screenLines, stripAnsi, DEFAULT_IDLE_MS, type AgentKind, type StateReason, type TermState } from "./terminal-state";
import { git } from "./git";
import { cliEnv } from "./providers/no-self-update";
import { REDACTED, SECRET_VALUE, redactText } from "./secure";
/** A secret that starts on one line and ends on the next, read as one text. When the first line was cut where it is (it
 *  fills the terminal's width, or a box's), a match running over is a secret in two pieces; when not, a secret that ends
 *  the first line whole only runs into the next line's first word, and the first line's own redaction already took it. */
function spansSecret(a: string, b: string, cut: boolean): boolean {
  const joined = a + b;
  for (const re of [...SECRET_VALUE, REMOTE_URL]) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of joined.matchAll(g)) { const at = m.index ?? 0; if (!(at < a.length && at + m[0].length > a.length)) continue;
      if (cut) return true; const own = new RegExp(`^(?:${re.source})$`, re.flags.replace("g", "")); if (!own.test(a.slice(at))) return true; }
  }
  return false;
}
import { readScreen, SCREEN_INPUT_MAX } from "./terminal-screen";
import { rowBreaks } from "./terminal-rows";
/** A line as text only: no C0 or C1 control (a tab stays) and no bidi control, which could show it in another order. */
const plainText = (l: string) => l.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");

export type Preset = { id: string; label: string; bin: string; kind: AgentKind };
export const PRESETS: Preset[] = [
  { id: "claude", label: "Claude Code", bin: "claude", kind: "claude" },
  { id: "codex", label: "Codex", bin: "codex", kind: "codex" },
  { id: "cursor-agent", label: "Cursor Agent", bin: "cursor-agent", kind: "cursor" },
  { id: "aider", label: "aider", bin: "aider", kind: "aider" },
  { id: "opencode", label: "opencode", bin: "opencode", kind: "opencode" },
  { id: "gemini", label: "Gemini CLI", bin: "gemini", kind: "gemini" },
  { id: "amp", label: "Amp", bin: "amp", kind: "amp" },
];
export type TermProject = { id: string; name: string; path: string; base?: string };
/** Where the project's checkout stood (its branch and head), and how many commits that head has beyond the project's base. */
export type TermGit = { branch: string | null; head: string; commits: number | null; base: string | null };
/** Send for review (docs/units/branch-intake.md): what the terminal hands to code-firstmate's "From existing branch". */
export type ReviewRequest = { terminal: string; project: string; commit: string; branch: string | null; label: string; command: string; by: string };
export type TermView = { id: string; project: TermProject; preset: string | null; kind: AgentKind; label: string; command: string; by: string;
  startedAt: string; endedAt: string | null; exitCode: number | null; signal: string | null; state: TermState; reason: StateReason; ask: string | null;
  cols: number; rows: number; running: boolean; git: { start: TermGit | null; end: TermGit | null }; review: { run: string; at: string } | null; transcriptTruncated: boolean;
  /** listed from its record after Studio restarted (it ended before, or Studio stopped it); `stopped`: Studio stopped it */
  restored: boolean; stopped: string | null };

// Claude Code's Remote Control link: whoever holds it can drive the session from the Claude app, so it is a secret here.
// Studio never turns Remote Control on; the captain may, by hand, in any terminal, and its link is removed wherever Studio
// shows or keeps the output (studio_logs, the transcript, a phone).
export const REMOTE_URL = /https:\/\/(?:[a-z0-9-]+\.)*claude\.(?:ai|com)\/code[^\s\x00-\x1f\x7f"'<>`\\│|║┃｜]*/gi;
/** The characters a box's side is drawn with: light, ASCII, double, heavy and full-width (CJK) bars. */
const BORDER = "│|║┃｜";
export const REMOTE_REMOVED = "[remote-control link removed]";
const ENV_INTERNAL = /^(?:CREW_|FM_)/;
const MIB = 1024 * 1024;
const envNum = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };

/** The child's environment: the user's own, minus Studio's internals; a terminal type xterm.js speaks. */
export function terminalEnv(base: Record<string, string | undefined>, secrets: (string | null | undefined)[] = []): Record<string, string> {
  const bad = new Set(secrets.map((s) => (s ?? "").trim()).filter((s) => s.length >= 8));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) { if (v === undefined || ENV_INTERNAL.test(k) || bad.has(v.trim())) continue; out[k] = v; }
  out.TERM = "xterm-256color"; out.COLORTERM = "truecolor"; out.TERM_PROGRAM = "CrewStudio";
  // xterm.js speaks UTF-8. A Studio started without a locale (launchd, an app, a bare environment) gave the shell none, and
  // zsh then echoed 中文 typed at its prompt as <00ad><0096><0087>. With no locale set, only the character encoding is
  // made UTF-8 (LC_CTYPE, as ssh from a Mac sets it): messages and dates stay as they were. A locale the user chose (LANG,
  // LC_ALL or LC_CTYPE) is left as it is.
  if (!out.LANG && !out.LC_ALL && !out.LC_CTYPE) out.LC_CTYPE = process.platform === "darwin" ? "UTF-8" : "C.UTF-8";
  return out;
}

/** Bytes kept for replay: the newest `cap`, whole chunks dropped from the front, the oldest one cut when needed. */
export class Ring {
  private chunks: Uint8Array[] = []; size = 0; dropped = 0;
  constructor(readonly cap: number) {}
  push(b: Uint8Array) {
    if (b.length >= this.cap) { this.dropped += this.size + b.length - this.cap; this.chunks = [b.slice(b.length - this.cap)]; this.size = this.cap; return; }
    this.chunks.push(b); this.size += b.length;
    while (this.size > this.cap) { const f = this.chunks[0], over = this.size - this.cap;
      if (f.length <= over) { this.chunks.shift(); this.size -= f.length; this.dropped += f.length; } else { this.chunks[0] = f.slice(over); this.size -= over; this.dropped += over; } }
  }
  bytes() { const o = new Uint8Array(this.size); let i = 0; for (const c of this.chunks) { o.set(c, i); i += c.length; } return o; }
  /** Where the output stands: every byte ever written, kept or dropped. A replay ends here; a page that already has the
   * bytes up to some position writes only what follows, so a stream opened again never resets a terminal it shows. */
  get total() { return this.size + this.dropped; }
}

/** Removes the Remote Control link from text that arrives in pieces: a piece that may be the start of a link waits for the rest. */
export class LinkRedactor {
  private held = ""; constructor(private extra: string[] = []) {}
  private scrub(s: string) { let t = s.replace(REMOTE_URL, REMOTE_REMOVED); for (const v of this.extra) if (v) t = t.split(v).join(REMOTE_REMOVED); return t; }
  push(s: string): string {
    const all = this.held + s; this.held = "";
    // an unfinished link at the end (no terminator yet), or the end being a prefix of "https://"
    const m = /https?:\/\/[^\s\x00-\x1f\x7f"'<>`\\]*$/i.exec(all); let cut = m ? m.index : -1;
    if (cut < 0) for (let k = Math.min(8, all.length); k > 0; k--) if ("https://".startsWith(all.slice(-k).toLowerCase())) { cut = all.length - k; break; }
    if (cut >= 0 && all.length - cut <= 4096) { this.held = all.slice(cut); return this.scrub(all.slice(0, cut)); }
    return this.scrub(all);
  }
  flush() { const h = this.held; this.held = ""; return this.scrub(h); }
  whole(s: string) { return this.scrub(s); }
}

// Between any two characters of a known link a terminal may put an escape (colour, cursor move), a line break and the
// indentation Ink wraps with, or a box border; a character may also come percent-encoded. A known link and its session id
// are matched through all of that, in any letter case.
const GAP = "(?:\\x1b\\[[0-?]*[ -\\/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b[@-Z\\\\-_]|[\\s│|║┃｜╭╮╰╯─═━╔╗╚╝┏┓┗┛])*";
export function fuzzy(secret: string): RegExp {
  const one = (c: string) => { const e = c.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&"), n = c.charCodeAt(0); return n < 128 ? `(?:${e}|%${n.toString(16).padStart(2, "0")})` : `(?:${e})`; };
  return new RegExp([...secret].map(one).join(GAP), "gi");
}
/** What must never be shown once a link is known: the link, the link without its scheme, and each long path segment (the session id). */
export function linkSecrets(url: string): string[] {
  const out = new Set<string>([url, url.replace(/^https:\/\//i, "")]);
  try { const u = new URL(url); for (const seg of u.pathname.split("/")) if (seg.length >= 10) out.add(seg); for (const v of u.searchParams.values()) if (v.length >= 10) out.add(v); } catch {}
  return [...out].sort((a, b) => b.length - a.length);
}
/**
 * The transcript's and the phone's view of a terminal's output: the generic link rule (LinkRedactor), and once the session's
 * own link is known, that link and its session id matched through escapes, wraps and encodings. A window at the end is held
 * back so a match that is still arriving is never cut in two. `holdUntilKnown`: nothing is let out before a link is known,
 * so a link printed wrapped, coloured or encoded before Studio recognised it is still removed. If the link never comes, the
 * end flushes with the generic rule only.
 */
export class SecretWindow {
  private buf = ""; private pats: RegExp[] = []; private W = 0; private link = new LinkRedactor(); private secrets = new Set<string>();
  constructor(private holdUntilKnown = false, private cap = 8 * MIB) {}
  get known() { return this.pats.length > 0; }
  // every link known so far stays known: a shorter one read later (a link a box cut) never drops the whole one
  know(url: string) { for (const x of linkSecrets(url)) this.secrets.add(x); const sec = [...this.secrets].sort((a, b) => b.length - a.length);
    this.pats = sec.map(fuzzy); this.W = Math.min(32768, Math.max(...sec.map((x) => x.length)) * 24); }
  scrub(s: string) { let t = s; for (const p of this.pats) t = t.replace(p, REMOTE_REMOVED); return this.link.whole(t); }
  /** A drawn screen's words that are a piece of a known link's secret: the start or the end of it, 8 characters or more.
   *  Boxes side by side put other text between a link's two rows, so the link's rest is a word of its own there. */
  pieces(s: string) {
    const secrets = [...this.secrets].filter((x) => x.length >= 12);
    // the mark takes the word's own width where it can, so the box's borders stay where the program drew them
    const fit = (n: number) => (n >= REMOTE_REMOVED.length ? REMOTE_REMOVED.padEnd(n) : n >= 14 ? "[link removed]".padEnd(n) : "[…]".padEnd(n));
    return s.replace(/[A-Za-z0-9_-]{8,}/g, (w) => (secrets.some((x) => x.startsWith(w) || x.endsWith(w)) ? fit(w.length) : w));
  }
  push(s: string): string {
    this.buf += s;
    if (this.holdUntilKnown && !this.known) { if (this.buf.length > this.cap) this.buf = this.buf.slice(-this.cap); return ""; }
    let t = this.buf; for (const p of this.pats) t = t.replace(p, REMOTE_REMOVED);
    const cut = Math.max(0, t.length - this.W); this.buf = t.slice(cut);
    return this.link.push(t.slice(0, cut));
  }
  flush() { let t = this.buf; this.buf = ""; for (const p of this.pats) t = t.replace(p, REMOTE_REMOVED); return this.link.push(t) + this.link.flush(); }
}
/**
 * The newest Remote Control link in raw terminal output, rejoined when the terminal wrapped it at its width (Ink breaks a long
 * link over lines, each continuation indented or inside a box border). `trailing`: a link at the very end counts too.
 */
export function findLink(raw: string, cols: number, trailing = true): string | null {
  const lines = linkLines(raw);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = [...lines[i].matchAll(REMOTE_URL)].at(-1); if (!m) continue;
    const { url, j } = linkFrom(lines, i, m, cols);
    if (!trailing && j === lines.length - 1 && !/\n\s*$/.test(raw.slice(-4)) && !new RegExp(`[\\s${BORDER}]$`).test(raw)) return null;
    return url;
  }
  return null;
}
/** Every Remote Control link the output shows, each rejoined where it was wrapped (Terminals.tail learns them all). */
export function findLinks(raw: string, cols: number): string[] {
  const lines = linkLines(raw), out: string[] = [];
  for (let i = 0; i < lines.length; i++) for (const m of lines[i].matchAll(REMOTE_URL)) out.push(linkFrom(lines, i, m, cols).url);
  return [...new Set(out)];
}
// A cursor move to another row (CUP, HVP, VPA) starts a new line: a box whose rows a program placed that way (ratatui,
// Codex) is read row by row like one drawn with line breaks.
const linkLines = (raw: string) => screenLines(rowBreaks(raw));
/** A link of the session shape Studio knows is whole already: it is never joined with the next row. */
const wholeSession = (u: string) => /\/session_[0-9A-Za-z]{26}$/.test(u);
/** The link that starts with match `m` on line `i`, rejoined over the lines the terminal or a box wrapped it on. */
function linkFrom(lines: string[], i: number, m: RegExpMatchArray, cols: number): { url: string; j: number } {
  const edge = (l: string) => l.replace(new RegExp(`[\\s${BORDER}]+$`), "");
  // a wrapped line is one the terminal filled to its width: within [cols - 4, cols] (a box border or padding may take
  // the last columns); a longer line was not wrapped by the terminal, and a shorter one ended where the link ends
  const full = (l: string) => { const n = [...edge(l)].length; return n >= cols - 4 && n <= cols; };
  // a box narrower than the terminal (Ink) wraps at its own border: the link reaches it, a single space before the border
  const boxFull = (l: string) => new RegExp(`\\S ?[${BORDER}]\\s*$`).test(l) && !new RegExp(`\\s{2,}[${BORDER}]\\s*$`).test(l);
  let url = m[0]; const at = m.index ?? 0, end = at + url.length;
  // the box the link sits in, from the border before it to the one right after it: boxes side by side share their rows,
  // so the next row is read in the same columns only
  const before = Math.max(...[...BORDER].map((b) => lines[i].lastIndexOf(b, at))), after = new RegExp(`^ ?[${BORDER}]`).exec(lines[i].slice(end));
  const seg: [number, number] | null = before >= 0 && after ? [before, end + after[0].length] : null;
  const cell = (l: string) => (seg ? l.slice(seg[0], seg[1]) : l);
  const wraps = (l: string) => (seg ? boxFull(cell(l)) : full(l) || boxFull(l));
  let j = i, wrapped = !wholeSession(url) && (seg ? true : end >= edge(lines[i]).length && wraps(lines[i]));
  while (wrapped && j + 1 < lines.length) {
    const row = cell(lines[j + 1]), next = row.replace(new RegExp(`^[\\s${BORDER}]+`), ""), c = new RegExp(`^[^\\s"'<>\`\\\\${BORDER}]+`).exec(next); if (!c) break;
    // the rest of a wrapped link stands alone on its line (or fills that line too); a word followed by more text is prose
    if (c[0].length < edge(next).length && !wraps(lines[j + 1])) break;
    url += c[0]; j++; wrapped = !wholeSession(url) && c[0].length >= edge(next).length && wraps(lines[j]);
  }
  return { url: url.replace(/[?.,);:!'"\]]+$/, ""), j };
}

/** A view of a terminal's output. mux: one of several terminals on one stream (GET /api/terminals/mux), each event naming its terminal. */
type Sub = { phone: boolean; ctl: ReadableStreamDefaultController<Uint8Array>; device?: string; mux?: boolean };
type Term = TermView & { proc: any; ring: Ring; tail: string; rawTail: string; lastChunk: string; lastOutAt: number; sawOutput: boolean; subs: Set<Sub>;
  decoder: TextDecoder; redactor: SecretWindow; tFile: string | null; tBytes: number; timer: any; spec: CreateSpec | null; killTimer?: any; userStopped?: boolean; dismissedAtShutdown?: boolean; seen: Set<string>; linkSeen: boolean;
  line: string; lineAt: { state: TermState; reason: StateReason } | null; inputs: string[];
  /** the transcript's file name in the record: kept for a terminal listed after a restart (it writes no more to it) */
  transcriptName: string | null; reviewing?: boolean };
export type CreateSpec = { project: string; preset?: string | null; command?: string | null; args?: string[]; cols?: number; rows?: number };
export class TermError extends Error { constructor(readonly status: number, message: string, readonly code: string) { super(message); } }

export type TerminalsOpts = {
  dataDir: string;
  projects: () => TermProject[];
  /** CREW_TERMINAL_TRANSCRIPTS=0 turns transcripts off (the record still keeps who, what, when and the exit) */
  transcripts?: boolean;
  /** Studio's own secret values that must never reach a child under any name (its session token, its ledger key). */
  secrets?: () => (string | null | undefined)[];
  log?: (type: "terminal.start" | "terminal.exit" | "terminal.review", summary: string, data: Record<string, unknown>) => void;
  /** a terminal's summary changed (state, exit, a new one): the page's live stream carries it */
  changed?: (list: TermView[]) => void;
  env?: Record<string, string | undefined>;
  shell?: string;
  /** Send for review: start code-firstmate from the terminal's branch; answers the run's id */
  review?: (r: ReviewRequest) => Promise<{ run: string }>;
  /** "Open in a Studio window": Studio's authenticated launch as an app window (src/open.ts); answers what opened it, or false */
  openWindow?: () => Promise<string | false> | string | false;
};
/** The project's checkout: its branch, head and commits beyond base (Studio's own git: no hooks, no user config). */
export function gitFacts(path: string, base?: string | null): TermGit | null {
  // a project folder that is gone (moved, deleted) has no checkout to read: git cannot even start there
  try { if (!statSync(path).isDirectory()) return null; } catch { return null; }
  const head = git(path, ["rev-parse", "--verify", "HEAD^{commit}"]); if (!head.ok || !/^[0-9a-f]{40,64}$/.test(head.out)) return null;
  const br = git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  let commits: number | null = null;
  if (base && git(path, ["rev-parse", "--verify", `${base}^{commit}`]).ok) { const c = git(path, ["rev-list", "--count", `${base}..${head.out}`]); if (c.ok) commits = Number(c.out) || 0; }
  return { branch: br.ok && br.out ? br.out : null, head: head.out, commits, base: base ?? null };
}
/**
 * Git shows there is nothing in the checkout to send for review: a folder that is no git checkout at all, or a clean tree
 * (no change, staged, unstaged or untracked) with no commits beyond a base that resolves. Whenever git cannot show it (the
 * tree unreadable, a base that does not resolve, so the count is unknown) there may be work: the shell stays.
 */
function nothingToReview(t: { project: TermProject; git: { end: TermGit | null } }): boolean {
  const inside = git(t.project.path, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") return true;
  // the tree is read even without a HEAD (a repository with no commit yet): a new file there is work
  const st = git(t.project.path, ["status", "--porcelain"]); if (!st.ok || st.out.trim()) return false;
  const g = t.git.end; if (!g) return true; // a clean repository with no commit yet
  return g.commits === 0;
}
const AGENT_KINDS = new Set<AgentKind>(["claude", "codex", "cursor", "aider", "opencode", "gemini", "amp"]);

export class Terminals {
  private terms = new Map<string, Term>();
  readonly keepTranscripts: boolean; readonly maxSubs = 4;
  /** when the page last asked for a Studio window (POST /api/terminals/app-window), for its rate limit */
  appWindowAt = 0; appWindowBusy = false;
  /** This run of Studio: the page compares it with the one it saw last, to say once that a restart ended its terminals */
  readonly boot = randomBytes(6).toString("hex");
  /** The terminals a Studio stop ended (their records say studio-stopped, removed ones included): a page tells these from
   * terminals that had ended on their own before the restart */
  restartEnded = new Set<string>();
  readonly dir: string; readonly cap: number; readonly max: number; readonly tMax: number; readonly idleMs: number;
  constructor(readonly o: TerminalsOpts) {
    this.dir = join(o.dataDir, "terminals"); mkdirSync(this.dir, { recursive: true, mode: 0o700 }); try { chmodSync(this.dir, 0o700); } catch {}
    this.keepTranscripts = o.transcripts ?? process.env.CREW_TERMINAL_TRANSCRIPTS !== "0";
    this.cap = envNum("CREW_TERMINAL_SCROLLBACK", 2 * MIB); this.max = envNum("CREW_TERMINAL_MAX", 8);
    this.tMax = envNum("CREW_TERMINAL_TRANSCRIPT", 5 * MIB); this.idleMs = envNum("CREW_TERMINAL_IDLE_MS", DEFAULT_IDLE_MS);
    this.closeLeftovers(); this.prune(); this.restore();
  }
  private env() { return this.o.env ?? process.env; }
  private shell() { return this.o.shell ?? this.env().SHELL ?? "/bin/sh"; }
  /** The presets whose CLI is on PATH, plus the shell. */
  presets(): (Preset & { path: string })[] {
    const PATH = this.env().PATH ?? "";
    const found = PRESETS.flatMap((p) => { const path = Bun.which(p.bin, { PATH }); return path ? [{ ...p, path }] : []; });
    return [...found, { id: "shell", label: "Shell", bin: this.shell(), kind: "shell" as AgentKind, path: this.shell() }];
  }
  view(t: Term, _desktop = true): TermView {
    const { id, project, preset, kind, label, command, by, startedAt, endedAt, exitCode, signal, state, reason, ask, cols, rows, running, transcriptTruncated, git, review, restored, stopped } = t;
    return { id, project, preset, kind, label, command, by, startedAt, endedAt, exitCode, signal, state, reason, ask, cols, rows, running, transcriptTruncated, git, review, restored, stopped };
  }
  list(desktop = true): TermView[] { return [...this.terms.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((t) => this.view(t, desktop)); }
  get(id: string) { return this.terms.get(id) ?? null; }
  /** The last screen drawn for each terminal, by its size and output (Terminals.tail). */
  private screens = new Map<string, { key: string; rows: string[]; plain: boolean }>();
  /** The last `n` non-empty lines of a terminal's screen as plain text, the remote-control link and secrets removed: what
   *  studio_logs gives Firstmate when the captain asks for a terminal's output (src/observe/kinds/terminal.ts).
   *  1. The known link and secrets go from the raw output first, matched through escapes, wraps and box borders (SecretWindow).
   *  2. What is left is drawn by the page's own emulator at the terminal's size (src/terminal-screen.ts).
   *  3. Each line is redacted again, and so is every pair of neighbouring lines read as one (a secret a program drew over two
   *     rows, or inside a box narrower than the terminal): when the pair gives away more than its lines do, both go.
   *  4. No control or bidi character is left in what comes back. */
  async tail(id: string, n: number): Promise<string[] | null> {
    const t = this.terms.get(id); if (!t) return null;
    // the size and output as they are now: the terminal may be resized while the screen is drawn
    const cols = t.cols, rows0 = t.rows, bytes = t.ring.bytes();
    // one drawing per output: studio_logs asks again with fewer lines when an answer is over its size budget
    const key = `${cols}x${rows0}:${bytes.length}:${t.lastOutAt}`, hit = this.screens.get(id);
    let rows: string[], plain = false;
    if (hit && hit.key === key) { rows = hit.rows; plain = hit.plain; }
    else { if (this.screens.size > 64) this.screens.clear(); const raw = t.redactor.scrub(new TextDecoder().decode(bytes).slice(-SCREEN_INPUT_MAX)); const sc = await readScreen(raw, cols, rows0); rows = sc.lines; plain = !!sc.plain; this.screens.set(id, { key, rows, plain }); }
    // a link the screen shows: a box whose rows a program placed with cursor moves (ratatui, Codex) joins its rows only
    // here, so the link is read from the drawn rows too, learned whole, and removed from them through the box's borders
    for (const u of findLinks(rows.join("\n") + "\n", cols)) this.learnLink(t, u);
    if (t.redactor.known) rows = t.redactor.scrub(rows.join("\n")).split("\n").map((l) => t.redactor.pieces(l));
    const lines = rows.map((l) => redactText(l));
    const edgeR = (l: string) => l.replace(/[\s│|║┃｜]+$/, ""), edgeL = (l: string) => l.replace(/^[\s│|║┃｜]+/, "");
    for (let k = 0; k + 1 < rows.length; k++) {
      if (!rows[k].trim() || !rows[k + 1].trim()) continue;
      const atWidth = [...rows[k].trimEnd()].length >= cols - 1 - (rows[k].match(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/g)?.length ?? 0);
      const atBorder = /\S ?[│|║┃｜]\s*$/.test(rows[k]) && !/\s{2,}[│|║┃｜]\s*$/.test(rows[k]);
      // the plain text (the worker out of budget) places rows less surely than a drawn screen: any secret running from one
      // line into the next takes both
      if (spansSecret(rows[k], rows[k + 1], atWidth || plain) || spansSecret(edgeR(rows[k]), edgeL(rows[k + 1]), atBorder || plain)) lines[k] = lines[k + 1] = REDACTED;
    }
    return lines.map(plainText).filter((l) => l.trim()).slice(-Math.max(1, Math.min(200, n))).map((l) => l.slice(0, 400));
  }
  projects(): TermProject[] { return this.o.projects().map((p) => ({ id: p.id, name: p.name, path: p.path, base: p.base })); }
  private changed() { try { this.o.changed?.(this.list(false)); } catch {} }

  async create(spec: CreateSpec, by = "desktop"): Promise<TermView> {
    if ([...this.terms.values()].filter((t) => t.running).length >= this.max) throw new TermError(429, `at most ${this.max} terminals run at once: stop one first`, "tooMany");
    const project = this.o.projects().find((p) => p.id === spec?.project);
    if (!project) throw new TermError(404, "choose a registered, enabled project", "project");
    try { if (!statSync(project.path).isDirectory()) throw 0; } catch { throw new TermError(409, `the project's folder is missing: ${project.path}`, "folder"); }
    const cols = Math.max(20, Math.min(500, Math.floor(Number(spec.cols) || 100))), rows = Math.max(5, Math.min(200, Math.floor(Number(spec.rows) || 30)));
    let argv: string[], kind: AgentKind, label: string, preset: string | null = null;
    const args = spec.args ?? [];
    if (!Array.isArray(args) || args.length > 32 || args.some((a) => typeof a !== "string" || a.length > 1000 || a.includes("\0"))) throw new TermError(400, "args: at most 32 strings", "args");
    if (spec.preset) {
      const p = this.presets().find((x) => x.id === spec.preset); if (!p) throw new TermError(404, `${spec.preset} is not installed on this Mac's PATH`, "preset");
      // the Claude preset starts as `claude` does: Studio never adds --remote-control (an older page may still send
      // remoteControl in its request, which is ignored)
      preset = p.id; kind = p.kind; label = p.label; argv = p.id === "shell" ? [p.path, "-l", ...args] : [p.path, ...args];
    } else {
      const c = typeof spec.command === "string" ? spec.command.trim() : "";
      if (!c || c.length > 2000 || c.includes("\0")) throw new TermError(400, "give a preset or a command (at most 2000 characters)", "command");
      if (args.length) throw new TermError(400, "a custom command carries its own arguments", "args");
      kind = "custom"; label = c.split(/\s+/)[0].split("/").pop() || "command"; argv = [this.shell(), "-lc", c];
    }
    if ([...this.terms.values()].filter((t) => t.running).length >= this.max) throw new TermError(429, `at most ${this.max} terminals run at once: stop one first`, "tooMany");
    const id = `T-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const command = spec.preset ? [preset === "shell" ? this.shell() : PRESETS.find((p) => p.id === preset)!.bin, ...argv.slice(1)].join(" ") : String(spec.command).trim();
    const shown = new LinkRedactor().whole(command);
    const t: Term = { id, project, preset, kind, label, command: shown, by, startedAt: new Date().toISOString(), endedAt: null, exitCode: null, signal: null,
      state: "working", reason: "starting", ask: null, cols, rows, running: true, transcriptTruncated: false, restored: false, stopped: null, git: { start: gitFacts(project.path, project.base), end: null }, review: null, line: "", lineAt: null, inputs: [],
      proc: null, ring: new Ring(this.cap), tail: "", rawTail: "", lastChunk: "", lastOutAt: Date.now(), sawOutput: false, subs: new Set(),
      decoder: new TextDecoder(), redactor: new SecretWindow(false), tFile: this.keepTranscripts ? join(this.dir, `${id}.log`) : null, tBytes: 0, timer: null, spec: { ...spec, cols, rows }, seen: new Set(), linkSeen: false, transcriptName: null };
    if (t.tFile) writeFileSync(t.tFile, "", { mode: 0o600 });
    try {
      // the Claude preset never updates the installed CLI under the captain's other sessions (src/providers/no-self-update.ts)
      const env = terminalEnv(this.env(), this.o.secrets?.() ?? []);
      t.proc = Bun.spawn(argv, { cwd: project.path, env: kind === "claude" ? cliEnv(env) : env,
        terminal: { cols, rows, data: (_term: any, d: Uint8Array) => this.onData(t, d) } } as any);
    } catch (e: any) { if (t.tFile) rmSync(t.tFile, { force: true }); throw new TermError(500, `could not start ${label}: ${e?.message ?? e}`, "spawn"); }
    this.terms.set(id, t); this.saveMeta(t);
    this.o.log?.("terminal.start", `terminal ${id} started ${label} in ${project.name}`, { id, project: project.id, preset, command: shown, by, unsandboxed: true });
    t.proc.exited.then((code: number) => setTimeout(() => this.onExit(t, code), 60));
    this.trimEnded(); this.changed();
    return this.view(t, true);
  }

  private onData(t: Term, d: Uint8Array) {
    t.ring.push(d); t.lastOutAt = Date.now(); t.sawOutput = true;
    const text = t.decoder.decode(d, { stream: true });
    t.lastChunk = text; t.tail = (t.tail + stripAnsi(text)).slice(-8000);
    // a Remote Control link may arrive split: look in the raw text that ends here
    t.rawTail = (t.rawTail + text).slice(-4096);
    this.scanLink(t, false);
    const safe = t.redactor.push(text);
    this.writeTranscript(t, safe);
    const b64 = JSON.stringify({ b64: Buffer.from(d).toString("base64"), end: t.ring.total });
    // a terminal that has shown a session link: a phone gets states only, never output
    const ph = safe && !this.phoneHidden(t) ? JSON.stringify({ text: safe }) : null;
    for (const s of t.subs) { if (s.phone) { if (ph) this.emit(t, s, this.ev(s, t, "out", ph)); } else this.emit(t, s, this.ev(s, t, "out", b64)); }
    this.evaluate(t);
    clearTimeout(t.timer); t.timer = setTimeout(() => this.evaluate(t), this.idleMs + 50);
  }
  /** Every Remote Control link in the recent output is learned, to be removed; one still at the very end counts once the
   *  output pauses (the newest, then the others on the screen: boxes side by side). */
  private scanLink(t: Term, trailing: boolean) {
    const u = findLink(t.rawTail, t.cols, trailing);
    if (u) { for (const o of findLinks(t.rawTail, t.cols)) if (o !== u && !o.startsWith(u) && !u.startsWith(o)) this.learnLink(t, o); this.learnLink(t, u); }
  }
  /** A Remote Control link read from the terminal's output (its raw stream, or the screen Terminals.tail drew). */
  private learnLink(t: Term, u: string) {
    if (t.seen.has(u)) return;
    // any terminal that prints a Remote Control link (Remote Control turned on by hand, a shell running claude): its link is
    // redacted from then on and a phone gets no more of its output
    t.seen.add(u); t.linkSeen = true; t.redactor.know(u); if (t.ask) t.ask = this.scrubAsk(t, t.ask);
    this.writeTranscript(t, t.redactor.push("")); this.pushMeta(t); this.changed();
  }
  private phoneHidden(t: Term) { return t.linkSeen; }
  /** A question shown in lists and to phones: the known link and anything link-like are removed first. */
  private scrubAsk(t: Term, ask: string) { let a = t.redactor.scrub(ask); if (t.linkSeen) a = a.replace(/\S*(?:claude\.(?:ai|com)|https?:\/\/)\S*/gi, REMOTE_REMOVED); return a; }
  /** One event for one view: on a shared stream it names its terminal ({"id": …} first in its data). */
  private ev(s: Sub, t: Term, event: string, json: string) {
    return enc.encode(`event: ${event}\ndata: ${s.mux ? `{"id":${JSON.stringify(t.id)}${json === "{}" ? "" : ","}${json.slice(1)}` : json}\n\n`);
  }
  private emit(t: Term, s: Sub, chunk: Uint8Array) {
    // a reader that stopped reading (backpressure past 8 MiB) is cut; it can attach again and gets the replay. A shared
    // stream is cut whole: every terminal's view on it goes, or a closed stream would keep holding view slots
    try { if ((s.ctl.desiredSize ?? 0) < -8 * MIB) { this.cut(s.ctl); return; } s.ctl.enqueue(chunk); } catch { this.cut(s.ctl); }
  }
  /** Ends one stream: its views of every terminal go, and the stream closes. */
  cut(ctl: ReadableStreamDefaultController<Uint8Array>) {
    for (const t of this.terms.values()) for (const s of t.subs) if (s.ctl === ctl) t.subs.delete(s);
    try { ctl.close(); } catch {}
  }
  /** Views of a terminal open now (tests, the view limit). */
  views(id: string) { return this.terms.get(id)?.subs.size ?? 0; }
  private evaluate(t: Term) {
    const before = `${t.state}/${t.reason}/${t.ask}`;
    if (Date.now() - t.lastOutAt >= 300) this.scanLink(t, true);
    const d = detectState({ kind: t.kind, tail: t.tail, lastChunk: t.lastChunk, quietMs: Date.now() - t.lastOutAt, idleMs: this.idleMs, sawOutput: t.sawOutput, exited: !t.running, exitCode: t.exitCode });
    t.state = d.state; t.reason = d.reason; t.ask = d.ask ? this.scrubAsk(t, d.ask) : null;
    if (`${t.state}/${t.reason}/${t.ask}` !== before) { this.pushMeta(t); this.changed(); }
    if (t.running && d.state === "working") { clearTimeout(t.timer); t.timer = setTimeout(() => this.evaluate(t), Math.max(250, this.idleMs / 2)); }
  }
  private pushMeta(t: Term) {
    for (const s of t.subs) this.emit(t, s, this.ev(s, t, "meta", JSON.stringify(this.view(t, !s.phone))));
  }
  private writeTranscript(t: Term, s: string) {
    if (!s || t.transcriptTruncated || !t.tFile) return;
    let b = Buffer.from(s, "utf8");
    if (t.tBytes + b.length > this.tMax) { b = b.subarray(0, Math.max(0, this.tMax - t.tBytes)); t.transcriptTruncated = true; }
    try { const fd = openSync(t.tFile, "a", 0o600); try { writeSync(fd, b); if (t.transcriptTruncated) writeSync(fd, `\n[transcript stopped at ${this.tMax} bytes]\n`); } finally { closeSync(fd); } t.tBytes += b.length; } catch {}
  }
  private onExit(t: Term, code: number) {
    if (!t.running) return;
    t.running = false; clearTimeout(t.timer); clearTimeout(t.killTimer);
    this.writeTranscript(t, t.redactor.push(t.decoder.decode()) + t.redactor.flush());
    const sig = t.proc?.signalCode ?? null;
    t.exitCode = sig ? null : (typeof code === "number" ? code : null); t.signal = sig; t.endedAt = new Date().toISOString();
    t.git.end = gitFacts(t.project.path, t.project.base);
    try { t.proc.terminal?.close?.(); } catch {}
    this.evaluate(t); this.saveMeta(t);
    for (const s of t.subs) this.emit(t, s, this.ev(s, t, "exit", JSON.stringify({ exitCode: t.exitCode, signal: t.signal })));
    this.o.log?.("terminal.exit", `terminal ${t.id} (${t.label}) ended: ${t.signal ? `signal ${t.signal}` : `exit ${t.exitCode}`}`, { id: t.id, project: t.project.id, exitCode: t.exitCode, signal: t.signal });
    // a shell that ended well (exit 0, or the captain's Stop) with nothing to send for review leaves the list (and the
    // page's tabs) on its own, as a Terminal window closes on exit; its record and transcript stay. One that failed (an
    // exit code, a signal: a broken rc file) or left work to review stays, with its last output, until removed.
    if (t.kind === "shell" && (t.userStopped || (t.exitCode === 0 && !t.signal)) && nothingToReview(t)) { this.saveMeta(t, { dismissed: true }); if (this.terms.get(t.id) === t) this.terms.delete(t.id); }
    this.changed();
  }
  private saveMeta(t: Term, extra: Record<string, unknown> = {}) {
    const { id, project, preset, kind, label, command, by, startedAt, endedAt, exitCode, signal, cols, rows, transcriptTruncated, git, review } = t;
    try { writeFileSync(join(this.dir, `${id}.json`), JSON.stringify({ id, project, preset, kind, label, command, by, startedAt, endedAt, exitCode, signal, cols, rows, git, review,
      transcript: t.tFile ? `${id}.log` : t.transcriptName, transcriptBytes: t.tBytes, transcriptTruncated,
      sandboxed: false, evidence: false, ...(t.stopped ? { reason: t.stopped } : {}), ...(t.dismissedAtShutdown ? { dismissed: true } : {}), ...extra }, null, 1), { mode: 0o600 }); } catch {}
  }
  /** The terminals' own records (data/terminals/<id>.json), not their input files. */
  private records() { return readdirSync(this.dir).filter((f) => RECORD.test(f)); }
  private closeLeftovers() {
    for (const f of this.records()) {
      try { const m = JSON.parse(readFileSync(join(this.dir, f), "utf8")); if (m && !m.endedAt) { m.endedAt = new Date().toISOString(); m.reason = "studio-stopped"; writeFileSync(join(this.dir, f), JSON.stringify(m, null, 1), { mode: 0o600 }); } } catch {}
    }
  }
  private prune(keep = 100) {
    const metas = this.records().sort();
    for (const f of metas.slice(0, Math.max(0, metas.length - keep))) { const id = f.slice(0, -5); if (this.terms.has(id)) continue; for (const x of [f, `${id}.log`, `${id}.inputs.json`]) rmSync(join(this.dir, x), { force: true }); }
  }
  /**
   * After a restart: the ended terminals (the 20 newest, not removed) are listed again from their records, marked `restored`,
   * with their git end, review state and transcript as their replay. Nothing is re-attached: no process, no input; a terminal
   * Studio stopped while it ran is `studio-stopped`. Send for review works on them, under the same guards (moved, sent).
   */
  private restore() {
    const recs: any[] = [];
    for (const f of this.records()) { try { const m = JSON.parse(readFileSync(join(this.dir, f), "utf8")); if (m && f === `${m.id}.json` && m.reason === "studio-stopped") this.restartEnded.add(m.id); if (m && f === `${m.id}.json` && typeof m.endedAt === "string" && !m.dismissed && m.project && typeof m.project.id === "string") recs.push(m); } catch {} }
    recs.sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt)));
    for (const m of recs.slice(-20)) {
      const now = this.o.projects().find((p) => p.id === m.project.id);
      const project: TermProject = now ? { id: now.id, name: now.name, path: now.path, base: now.base } : { id: m.project.id, name: String(m.project.name ?? m.project.id), path: String(m.project.path ?? ""), base: m.project.base };
      const stopped = m.reason === "studio-stopped" ? "studio-stopped" : null, ring = new Ring(this.cap);
      let text = "";
      if (m.transcript) { try { const b = readFileSync(join(this.dir, `${m.id}.log`)); const tail = b.subarray(Math.max(0, b.length - this.cap)); ring.push(new Uint8Array(tail)); ring.dropped = b.length - tail.length; text = tail.toString("utf8"); } catch {} }
      let inputs: string[] = []; try { const j = JSON.parse(readFileSync(join(this.dir, `${m.id}.inputs.json`), "utf8")); if (Array.isArray(j?.lines)) inputs = j.lines.map(String).slice(-40); } catch {}
      // a record written while Studio still turned Remote Control on carries remoteControl: it is ignored
      const t: Term = { id: m.id, project, preset: m.preset ?? null, kind: m.kind ?? "custom", label: String(m.label ?? "terminal"), command: String(m.command ?? ""), by: String(m.by ?? "desktop"),
        startedAt: String(m.startedAt ?? m.endedAt), endedAt: m.endedAt, exitCode: typeof m.exitCode === "number" ? m.exitCode : null, signal: m.signal ?? null,
        state: m.exitCode === 0 && !stopped ? "done" : "exited", reason: "exit", ask: null, cols: Number(m.cols) || 100, rows: Number(m.rows) || 30, running: false,
        transcriptTruncated: !!m.transcriptTruncated, git: { start: facts(m.git?.start), end: facts(m.git?.end) }, review: m.review ?? null, restored: true, stopped, line: "", lineAt: null, inputs,
        transcriptName: m.transcript === `${m.id}.log` ? m.transcript : null,
        proc: null, ring, tail: "", rawTail: "", lastChunk: "", lastOutAt: Date.now(), sawOutput: !!text, subs: new Set(), decoder: new TextDecoder(), redactor: new SecretWindow(false),
        tFile: null, tBytes: Number(m.transcriptBytes) || 0, timer: null, spec: null, seen: new Set(),
        // the transcript is already redacted; a phone still gets no output from one that ever showed a Remote Control link
        linkSeen: text.includes(REMOTE_REMOVED) };
      this.terms.set(t.id, t);
    }
  }
  /** Ended terminals stay listed (their replay too) until dismissed; at most 20, the oldest go first. */
  private trimEnded() { const ended = [...this.terms.values()].filter((t) => !t.running).sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? "")); for (const t of ended.slice(0, Math.max(0, ended.length - 20))) this.terms.delete(t.id); this.prune(); }

  private need(id: string) { const t = this.terms.get(id); if (!t) throw new TermError(404, "no such terminal", "missing"); return t; }
  input(id: string, data: unknown) {
    const t = this.need(id); if (!t.running) throw new TermError(409, "this terminal has ended", "ended");
    if (typeof data !== "string" || !data || data.length > 65536) throw new TermError(400, "input: a string of at most 64 KiB", "input");
    t.proc.terminal.write(data);
    this.recordInput(t, data);
  }
  /**
   * The lines the captain types to an agent at its own prompt (not at a question, never in a shell or a custom command,
   * where a password may be typed): Send for review hands them to the spec writer as data. Redacted, 40 lines kept.
   */
  private recordInput(t: Term, data: string) {
    if (!AGENT_KINDS.has(t.kind)) return;
    const text = data.replace(/\x1b\[20[01]~/g, "").replace(/\x1b(?:\[[0-?]*[ -\/]*[@-~]|O.|.)/g, "");
    for (const ch of text) {
      if (ch === "\r" || ch === "\n") {
        const line = t.line.trim(), at = t.lineAt; t.line = ""; t.lineAt = null;
        if (line && at?.state === "waiting" && at.reason !== "question") {
          t.inputs = [...t.inputs, redactText(t.redactor.scrub(line)).slice(0, 2000)].slice(-40);
          try { writeFileSync(join(this.dir, `${t.id}.inputs.json`), JSON.stringify({ version: 1, terminal: t.id, lines: t.inputs }), { mode: 0o600 }); } catch {}
        }
        continue;
      }
      if (ch === "\x7f" || ch === "\b") { t.line = t.line.slice(0, -1); continue; }
      if (ch < " ") continue;
      if (!t.lineAt) t.lineAt = { state: t.state, reason: t.reason };
      if (t.line.length < 4000) t.line += ch;
    }
  }
  /** Send for review: a finished terminal whose checkout is a branch with commits beyond the project's base. */
  async sendForReview(id: string, by = "desktop"): Promise<TermView> {
    const t = this.need(id);
    if (!this.o.review) throw new TermError(501, "Send for review is not available here", "noReview");
    if (t.running) throw new TermError(409, "the agent is still running: send it for review once it has finished", "running");
    if (t.review) throw new TermError(409, `already sent for review as ${t.review.run}`, "sent");
    // one send at a time: t.review is set only once the Task exists (after the staffing step), so a second click waits out
    if (t.reviewing) throw new TermError(409, "Send for review is already in progress for this terminal", "pending");
    // the head this terminal ended on: the checkout may have moved since (another terminal, the captain's own Terminal), and
    // Send for review on this terminal must not hand that other work over under this terminal's intent
    const end = t.git.end, live = gitFacts(t.project.path, t.project.base);
    if (!end && t.stopped) throw new TermError(409, "Studio stopped while this terminal ran and did not record where its checkout ended: start a new terminal for the work there", "noEnd");
    if (!end || !live) throw new TermError(409, "the project's folder is not a git checkout with a commit", "noGit");
    if (live.head !== end.head) throw new TermError(409, `the project's checkout moved since this terminal ended (it ended on ${end.head.slice(0, 10)}, it is now on ${live.head.slice(0, 10)}): start a new terminal for the work now there`, "moved");
    if (!end.commits) throw new TermError(409, `no commits beyond ${t.project.base ?? "the base"}: commit the work on a branch first`, "noCommits");
    t.reviewing = true; let run: string;
    try { ({ run } = await this.o.review({ terminal: t.id, project: t.project.id, commit: end.head, branch: end.branch, label: t.label, command: t.command, by })); } finally { t.reviewing = false; }
    t.review = { run, at: new Date().toISOString() }; this.saveMeta(t); this.changed();
    this.o.log?.("terminal.review", `terminal ${t.id} (${t.label}) sent for review as ${run}`, { id: t.id, project: t.project.id, run, commit: end.head, branch: end.branch });
    return this.view(t, true);
  }
  resize(id: string, cols: unknown, rows: unknown) {
    const t = this.need(id); if (!t.running) return this.view(t, true);
    const c = Math.floor(Number(cols)), r = Math.floor(Number(rows));
    if (!(c >= 2 && c <= 500 && r >= 2 && r <= 200)) throw new TermError(400, "cols 2–500, rows 2–200", "size");
    t.proc.terminal.resize(c, r); t.cols = c; t.rows = r; return this.view(t, true);
  }
  /** SIGHUP to the process group (what closing a terminal window does), SIGKILL two seconds later if it is still there. */
  kill(id: string) {
    const t = this.need(id); if (!t.running) return this.view(t, true);
    t.userStopped = true; const pid = t.proc.pid; const sig = (s: NodeJS.Signals) => { try { process.kill(-pid, s); } catch { try { t.proc.kill(s); } catch {} } };
    sig("SIGHUP"); t.killTimer = setTimeout(() => { if (t.running) sig("SIGKILL"); }, 2000);
    return this.view(t, true);
  }
  async restart(id: string, by = "desktop") { const t = this.need(id); if (!t.spec) throw new TermError(409, "this terminal is from before Studio restarted: start a new one", "restored"); if (t.running) { this.kill(id); await Promise.race([t.proc.exited, Bun.sleep(2500)]); } this.terms.delete(id); return this.create(t.spec, by); }
  /** Off the list, and off it after a restart too (its record says so); the record and the transcript stay. */
  dismiss(id: string) { const t = this.need(id); if (t.running) throw new TermError(409, "stop it first", "running"); this.saveMeta(t, { dismissed: true }); this.terms.delete(id); this.changed(); }
  /** Studio is stopping: every terminal's process group goes, at once (sync, so it also runs from an exit handler). */
  // Its record gets its end and where the checkout stood (Studio's own git, sync), so after the restart it is listed as
  // studio-stopped and Send for review's guard (the checkout moved since) has a head to compare with.
  shutdown() { for (const t of this.terms.values()) if (t.running) { for (const s of ["SIGHUP", "SIGKILL"] as const) { try { process.kill(-t.proc.pid, s); } catch { try { t.proc.kill(s); } catch {} } }
    t.stopped = "studio-stopped"; t.endedAt ??= new Date().toISOString(); try { t.git.end = gitFacts(t.project.path, t.project.base); } catch {}
    // a shell with nothing to send for review is not listed again after the restart (the page says once that it ended)
    // (kept on the terminal: its own exit, seen after this while Studio finishes stopping, writes the record again)
    if (t.kind === "shell" && nothingToReview(t)) t.dismissedAtShutdown = true;
    this.saveMeta(t); } }

  /** The output stream: a replay of the ring first (the phone's with the link removed), then live output, state, exit. */
  attach(id: string, phone: boolean, device?: string): Response {
    const t = this.need(id); this.admit(t, phone); let sub: Sub;
    const stream = new ReadableStream<Uint8Array>({
      start: (ctl) => { sub = { phone, ctl, device }; this.hello(t, sub); t.subs.add(sub); },
      cancel: () => { t.subs.delete(sub); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
  }
  /**
   * Several terminals on one stream, each event naming its terminal: the page shows many panes, and a browser keeps at most
   * six connections to Studio, so one stream per pane would leave none for typing. A terminal it may not view (the view
   * limit) or that is gone gets a "gone" event; the others behave as attach.
   */
  attachMany(ids: string[], phone: boolean, device?: string): Response {
    const subs: [Term, Sub][] = [];
    const stream = new ReadableStream<Uint8Array>({
      start: (ctl) => {
        for (const id of [...new Set(ids)].slice(0, 64)) {
          const t = this.terms.get(id); const sub: Sub = { phone, ctl, device, mux: true };
          try { if (!t) throw new TermError(404, "no such terminal", "gone"); this.admit(t, phone); }
          catch (e: any) { ctl.enqueue(enc.encode(`event: gone\ndata: ${JSON.stringify({ id, code: e?.code ?? "gone" })}\n\n`)); continue; }
          this.hello(t, sub); t.subs.add(sub); subs.push([t, sub]);
        }
      },
      cancel: () => { for (const [t, s] of subs) t.subs.delete(s); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
  }
  /** One slot is always the Mac's: phones share the others, and when all are taken the Mac's page takes the oldest phone's. */
  private admit(t: Term, phone: boolean) {
    const phones = [...t.subs].filter((x) => x.phone);
    if (phone && (phones.length >= this.maxSubs - 1 || t.subs.size >= this.maxSubs)) throw new TermError(429, `at most ${this.maxSubs - 1} phone views of one terminal at once`, "tooManyViews");
    if (!phone && t.subs.size >= this.maxSubs) { const old = phones[0]; if (!old) throw new TermError(429, `at most ${this.maxSubs} views of one terminal at once`, "tooManyViews"); t.subs.delete(old); try { if (old.mux) old.ctl.enqueue(enc.encode(`event: gone\ndata: ${JSON.stringify({ id: t.id, code: "tooManyViews" })}\n\n`)); else old.ctl.close(); } catch {} }
  }
  /** What a new view gets first: the summary, the replay, and the exit of one that ended. */
  private hello(t: Term, sub: Sub) {
    const phone = sub.phone, hidden = phone && this.phoneHidden(t), bytes = t.ring.bytes();
    sub.ctl.enqueue(this.ev(sub, t, "meta", JSON.stringify(this.view(t, !phone))));
    sub.ctl.enqueue(this.ev(sub, t, "replay", JSON.stringify(phone ? (hidden ? { text: "", hidden: "remote-control" } : { text: t.redactor.scrub(new TextDecoder().decode(bytes)), dropped: t.ring.dropped }) : { b64: Buffer.from(bytes).toString("base64"), dropped: t.ring.dropped, end: t.ring.total })));
    if (!t.running) sub.ctl.enqueue(this.ev(sub, t, "exit", JSON.stringify({ exitCode: t.exitCode, signal: t.signal })));
  }
  /** A revoked phone's streams end. */
  cutDevice(device: string) { for (const t of this.terms.values()) for (const s of t.subs) if (s.device === device) { t.subs.delete(s); try { s.ctl.close(); } catch {} } }
}
const enc = new TextEncoder();
const APP_WINDOW_GAP_MS = 5000;
const RECORD = /^T-[\w-]{1,60}\.json$/;
/** A record's git facts, read back: a commit id as head, else none (a hand-edited or damaged record never reaches git or the page). */
const facts = (g: any): TermGit | null => g && typeof g.head === "string" && /^[0-9a-f]{40,64}$/.test(g.head)
  ? { head: g.head, branch: typeof g.branch === "string" ? g.branch : null, commits: Number.isInteger(g.commits) && g.commits >= 0 ? g.commits : null, base: typeof g.base === "string" ? g.base : null } : null;

/**
 * The routes. `who` is the server's (src/remote/pairing.ts); `cookie` says the request carries the desktop page's own session
 * cookie. The server's guard has already checked Origin, the session and JSON on every POST.
 */
export async function terminalRoutes(svc: Terminals, req: Request, url: URL, who: { kind: string; device?: { id: string } }, writing: boolean, cookie: boolean): Promise<Response | null> {
  const p = url.pathname; if (p !== "/api/terminals" && !p.startsWith("/api/terminals/")) return null;
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const desktop = who.kind === "desktop";
  try {
    if (writing) {
      if (!desktop) return json({ error: "a phone can watch terminals but not type, start or stop them: do this on the Mac", code: "desktopOnly" }, 403);
      // the page's own request: its cookie, sent by a browser that says it is same-origin (Origin and Sec-Fetch-Site present
      // and Studio's own). Not a boundary against a local process (an unsandboxed terminal can read data/session-token); it
      // keeps a script's x-crew-session and other sites from typing into a terminal
      if (!cookie || req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") !== "same-origin") return json({ error: "terminals take input only from Studio's own page on this Mac (its session cookie, same origin); a script's x-crew-session is not enough", code: "pageOnly" }, 403);
    }
    if (p === "/api/terminals" && !writing) {
      return json({ terminals: svc.list(desktop), canWrite: desktop && cookie, idleMs: svc.idleMs, boot: svc.boot, restartEnded: [...svc.restartEnded],
        ...(desktop ? { presets: svc.presets().map(({ id, label, kind, path }) => ({ id, label, kind, path })), projects: svc.projects() } : {}) });
    }
    if (p === "/api/terminals" && writing) { const b = await req.json().catch(() => null); return json({ terminal: await svc.create(b ?? {}, "desktop") }); }
    // the page opens Studio again as an app window, where the browser keeps no key for itself (the new-tab, close and
    // new-window chords reach the terminal): the desktop page's own request only (the guard above), the same launch as
    // crew-studio launch
    if (p === "/api/terminals/app-window") {
      if (!writing) return json({ error: "POST" }, 405);
      // one launch every few seconds: each opens a window and writes a private redirect file
      // counted from a window that opened: a launch that failed may be tried again at once; one in flight holds the next
      if (svc.appWindowBusy || Date.now() - svc.appWindowAt < APP_WINDOW_GAP_MS) return json({ error: "A Studio window was just opened: look for it, or try again in a few seconds.", code: "tooSoon" }, 429);
      svc.appWindowBusy = true; let used: string | false = false;
      try { used = svc.o.openWindow ? await svc.o.openWindow() : false; } finally { svc.appWindowBusy = false; }
      if (used) svc.appWindowAt = Date.now();
      return used ? json({ ok: true, used }) : json({ error: "No browser accepted the Studio window. Studio is still here, in this tab.", code: "noWindow" }, 502);
    }
    if (p === "/api/terminals/mux" && !writing) return svc.attachMany((url.searchParams.get("ids") ?? "").split(",").filter((x) => /^[\w-]{1,64}$/.test(x)), !desktop, who.device?.id);
    const m = /^\/api\/terminals\/([\w-]{1,64})\/(stream|input|resize|kill|restart|dismiss|review)$/.exec(p);
    if (!m) return json({ error: "not found" }, 404);
    const [, id, op] = m;
    if (op === "stream" && !writing) return svc.attach(id, !desktop, who.device?.id);
    if (!writing) return json({ error: "POST" }, 405);
    const b: any = await req.json().catch(() => ({}));
    if (op === "input") { svc.input(id, b?.data); return json({ ok: true }); }
    if (op === "resize") return json({ terminal: svc.resize(id, b?.cols, b?.rows) });
    if (op === "kill") return json({ terminal: svc.kill(id) });
    if (op === "restart") return json({ terminal: await svc.restart(id, "desktop") });
    if (op === "dismiss") { svc.dismiss(id); return json({ ok: true }); }
    if (op === "review") return json({ terminal: await svc.sendForReview(id, "desktop") });
    return json({ error: "not found" }, 404);
  } catch (e: any) {
    if (e instanceof TermError) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: String(e?.message ?? e) }, 500);
  }
}
