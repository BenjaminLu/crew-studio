// What a web terminal is doing, from its output and its process (docs/units/web-terminal.md, "State").
// A heuristic, the way herdr reads its panes: Studio does not emulate the screen, it reads the text the program wrote.
//   working   output arrived in the last `idleMs`, or the last chunk showed the agent's own busy line (a spinner with
//             "esc to interrupt") and the pause is still short
//   waiting   output stopped: a question on screen ("Do you want to…", y/n, a numbered Yes/No menu) is `question`; the
//             agent's own input prompt is `prompt`; anything else that went quiet is `quiet`
//   done      the process ended with exit code 0
//   exited    the process ended otherwise (non-zero, a signal, killed)
// An agent that streams keeps writing (its spinner repaints several times a second), so a pause longer than `idleMs`
// means it stopped, whatever older frames still sit in the text.

export type TermState = "working" | "waiting" | "done" | "exited";
export type StateReason = "starting" | "output" | "busy" | "question" | "prompt" | "quiet" | "exit";
export type AgentKind = "claude" | "codex" | "cursor" | "aider" | "opencode" | "gemini" | "amp" | "shell" | "custom";
export type Detected = { state: TermState; reason: StateReason; ask: string | null };

// CSI, OSC (BEL or ST terminated), other two-byte escapes, then the C0 controls except \n and \r
const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");
/** The text as a terminal leaves it line by line: a carriage return rewrites its line from the start. */
export const screenLines = (s: string) => stripAnsi(s).split("\n").map((l) => { const i = l.replace(/\r+$/, "").lastIndexOf("\r"); return (i >= 0 ? l.slice(i + 1) : l).replace(/\r+$/, ""); });

const BUSY = /esc to interrupt|ctrl\+c to (?:interrupt|cancel|stop)|\bWorking \(\d|\(\d+s\s*[•·]/i;
const QUESTION: RegExp[] = [
  /\bDo you want to\b[^\n]*/i, /\bWould you like to\b[^\n]*/i, /\bAllow (?:this|once|always|command|edit|tool)\b[^\n]*/i,
  /[^\n]*\((?:y\/n|yes\/no)\)[^\n]*/i, /[^\n]*\[(?:y\/n|Y\/n|y\/N)\][^\n]*/, /[^\n]*Press (?:enter|return) to continue[^\n]*/i,
  /[^\n]*\(Y\)es\/\(N\)o[^\n]*/, /[^\n]*\bApprove\b[^\n]*\?/, /[^\n]*\bProceed\?[^\n]*/i,
];
// a numbered Yes/No menu marks a question too; the sentence above it, when there is one, is what it asks
const MENU = /[^\n]*[❯>]\s*1\.\s*(?:Yes|Allow|Approve)\b[^\n]*/i;
const PROMPT: Partial<Record<AgentKind, RegExp>> = {
  claude: /\? for shortcuts|^\s*[│|]?\s*[>❯]\s*(?:[│|]\s*)?$/m,
  codex: /⏎ send|send\s*⏎|Ctrl\+J newline|^\s*▌/m,
  cursor: /→\s*Add a follow-up|Add a follow-up|^\s*[>❯]\s*$/m,
  aider: /^[\w\-. /]*>\s?$/m,
  opencode: /enter send|ctrl\+p commands|^\s*[>❯]\s*$/m,
  gemini: /Type your message|^\s*[>❯]\s*$/m,
  amp: /^\s*[>❯]\s*$/m,
  shell: /[$#%>❯]\s?$/,
  custom: /[$#%>❯]\s?$/,
};
const clean = (s: string) => s.replace(/[│|╭╮╰╯─]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
export const DEFAULT_IDLE_MS = 2500;

export function detectState(o: { kind: AgentKind; tail: string; lastChunk?: string; quietMs: number; idleMs?: number; sawOutput?: boolean; exited?: boolean; exitCode?: number | null }): Detected {
  const idle = o.idleMs ?? DEFAULT_IDLE_MS;
  if (o.exited) return { state: o.exitCode === 0 ? "done" : "exited", reason: "exit", ask: null };
  if (!o.sawOutput) return { state: "working", reason: "starting", ask: null };
  const lines = screenLines(o.tail.slice(-6000)).filter((l) => l.trim());
  const recent = lines.slice(-14).join("\n");
  // a question waits as soon as the output stops for a moment: it is the last thing the program drew
  if (o.quietMs >= Math.min(600, idle)) {
    let ask: string | null = null, at = -1;
    for (const re of QUESTION) { const all = [...recent.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))]; const m = all.at(-1); if (m && (m.index ?? 0) >= at) { at = m.index ?? 0; ask = clean(m[0]); } }
    if (!ask) { const m = [...recent.matchAll(new RegExp(MENU.source, "gi"))].at(-1); if (m) ask = clean(m[0]); }
    if (ask) return { state: "waiting", reason: "question", ask };
  }
  if (o.quietMs < idle) return { state: "working", reason: "output", ask: null };
  if (o.lastChunk && BUSY.test(screenLines(o.lastChunk).filter((l) => l.trim()).slice(-3).join("\n")) && o.quietMs < idle * 4) return { state: "working", reason: "busy", ask: null };
  const last = lines.slice(-6).join("\n"), pr = PROMPT[o.kind];
  if (pr && pr.test(last)) return { state: "waiting", reason: "prompt", ask: null };
  return { state: "waiting", reason: "quiet", ask: null };
}
