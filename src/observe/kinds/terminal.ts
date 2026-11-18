// Web terminals (terminal:T-…): the Terminals page's list (src/terminals.ts list(), what GET /api/terminals returns), as
// state only: which program runs where, whether it works, waits for input or ended. A terminal's screen is someone else's
// output (a program, a model, a shell): studio_get and studio_list never carry it, not even the question a program asks.
// studio_logs gives the last lines of the screen only when the captain asked for them in this turn, wrapped as untrusted.
// No grant ever reaches a terminal. Nothing here types into one, resizes, stops or starts it.
import { registerKind, type Entity, type Sources } from "../registry";

const termsOf = (s: Sources) => { try { return s.terminals?.() ?? null; } catch { return null; } };
/** A terminal as an agent reads it: the Terminals page's row without its screen (no ask, no remote-control link). */
export function terminalRow(t: any) {
  return { id: t.id, project: t.project?.id ?? null, preset: t.preset ?? null, kind: t.kind, label: t.label, command: t.command, by: t.by, startedAt: t.startedAt, endedAt: t.endedAt ?? null,
    exitCode: t.exitCode ?? null, signal: t.signal ?? null, state: t.state, reason: t.reason, waitsForInput: t.state === "waiting" && (t.reason === "question" || t.reason === "prompt"), running: !!t.running,
    git: t.git ? { start: t.git.start ? { branch: t.git.start.branch, head: t.git.start.head } : null, end: t.git.end ? { branch: t.git.end.branch, head: t.git.end.head, commits: t.git.end.commits } : null } : null,
    review: t.review ?? null, restored: !!t.restored, stopped: t.stopped ?? null, remoteControl: !!t.remote?.enabled };
}
const entity = (t: any): Entity => ({ id: t.id, title: `${t.id} ${t.preset ?? t.kind} (${t.state})`, updatedAt: t.endedAt ?? t.startedAt ?? null, project: t.project?.id ?? null, data: terminalRow(t) });
const rows = (s: Sources): any[] => { try { return termsOf(s)?.list(true) ?? []; } catch { return []; } };
const TAIL_MAX = 80;
/** Did the captain's own message ask to see a terminal's output? It names a terminal and its output or screen. Studio
 *  decides this from the captain's words, never from the tool's arguments (a model could put anything there). */
export function captainAskedForScreen(words: string): boolean {
  const t = String(words ?? "");
  return /\bterminals?\b|終端|T-[a-z0-9]{1,16}-[0-9a-f]{6}/i.test(t) && /\b(output|screen|tail|log|logs|shows?|print(ed)?|says?)\b|輸出|畫面|螢幕|內容|印了|顯示|寫了什麼|說什麼/i.test(t);
}

registerKind({
  kind: "terminal", route: "#/terminals", listRoute: "#/terminals", idPattern: /^T-[a-z0-9]{1,16}-[0-9a-f]{6}$/, idExample: "T-mf3k2a-1b2c3d",
  pages: ["takeover"],
  about: "A web terminal: the program, its project and branch, and whether it works, waits for the captain's input or ended. State only; its screen only in studio_logs when the captain asks for it.",
  scope: (e) => e.project ?? null, grantable: false, viewer: "desktop",
  filters: { waiting: { type: "boolean", description: "true: only terminals waiting for input" }, running: { type: "boolean", description: "true: only running terminals" } },
  fields: [
    ...["id", "project", "preset", "kind", "by", "startedAt", "endedAt", "exitCode", "signal", "state", "reason", "waitsForInput", "running", "git", "review", "restored", "stopped", "remoteControl"].map((path) => ({ path, trust: "studio" as const })),
    { path: "label", trust: "captain" }, { path: "command", trust: "captain" },
  ],
  list: (s, filter) => rows(s).map(entity).filter((e) => (filter.waiting !== true || (e.data as any).waitsForInput) && (filter.running !== true || (e.data as any).running)),
  get: (s, id) => { const t = rows(s).find((x) => x.id === id); return t ? entity(t) : null; },
  logs: (s, id, o) => {
    const t = rows(s).find((x) => x.id === id); if (!t) return null;
    const state = terminalRow(t);
    if (!o.ctx.captainAskedTail || o.tail <= 0) return { cursor: null, updatedAt: state.endedAt ?? state.startedAt, data: { state, screen: { shown: false, why: "A terminal's screen is given only when the captain asks for it in this turn (\"show me the terminal's output\"); its state is above." } } };
    let lines: string[] = []; try { lines = termsOf(s)?.tail?.(id, Math.min(TAIL_MAX, o.tail)) ?? []; } catch { lines = []; }
    return { cursor: null, updatedAt: state.endedAt ?? state.startedAt, data: { state, screen: { shown: true, lines: lines.length, text: lines.join("\n"), ask: t.ask ?? null } } };
  },
  logFields: [
    { path: "state", trust: "studio" }, { path: "screen.shown", trust: "studio" }, { path: "screen.why", trust: "studio" }, { path: "screen.lines", trust: "studio" },
    { path: "screen.text", trust: "untrusted", source: "the terminal's screen (a program's output)" },
    { path: "screen.ask", trust: "untrusted", source: "the question the terminal's program shows (its output)" },
  ],
});
