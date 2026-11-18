// What a terminal shows, read by the same emulator the page draws it with (xterm.js, headless): Terminals.tail gives
// studio_logs this text when the captain asks for a terminal's output (docs/units/terminals.md). The output is fed at the
// terminal's own size, so cursor moves, scroll regions, insert/delete, wide characters and the alternate screen land where
// the page shows them. A full-screen program (the alternate screen) is its rows; a line-mode program is its lines, the
// scrollback included and each line a program's terminal wrapped put back together.
//
// A program's output is not trusted to be cheap to draw. The emulator runs in one long-lived Worker
// (src/terminal-screen-worker.ts), so Studio's server never waits on it. The worker feeds the output in chunks and gives
// up after SCREEN_BUDGET_MS, answering "plain"; then the plain text of the output comes back instead (still redacted by
// Terminals.tail). A worker is only stopped when it does not answer within SCREEN_TIMEOUT_MS: a stopped Worker's memory is
// not given back, so stopping is the last resort, never the way a read ends. Before drawing, what makes a sequence
// expensive is cut down: a run of one repeated clear is drawn once, and a cursor or edit sequence's count (insert 9999
// lines, repeat 65535 times) is clamped to what the screen can hold.
import { Terminal } from "@xterm/headless";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { screenLines } from "./terminal-state";

/** At most this much of a terminal's latest output is read (Terminals.tail cuts its ring to it). */
export const SCREEN_INPUT_MAX = 64_000;
/** Scrollback kept while reading: more than the 200 lines a tail may ask for. */
export const SCREEN_SCROLLBACK = 1000;
/** How long the worker draws before it gives up and the plain text is used. */
export const SCREEN_BUDGET_MS = 1000;
/** How long a worker may stay silent before it is stopped (and a new one started for the next read). */
export const SCREEN_TIMEOUT_MS = 3000;
/** The output is fed to the emulator in pieces this long, so its budget is checked between them. */
const CHUNK = 2048;
export type Screen = { lines: string[]; alternate: boolean; plain?: boolean };

// The same clear sent again and again changes nothing after the first, but each one costs a pass over the whole grid.
const collapse = (s: string) => s.replace(/(\x1b\[[0-3]?[JK])\1+/g, "$1");
// Cursor and edit sequences whose count is a number of lines, cells or repeats. Modes (h, l), SGR (m), clears (J, K: their
// parameter is a mode) and private sequences are left as they are.
const LINES = new Set("ABEFLMSTde"), CELLS = new Set("@CDGIPXZ`a"), POSITION = new Set("Hf"), REGION = new Set("r");
/** A count past what the screen holds does nothing more, but can cost a pass per unit: it is clamped to the screen's rows
 *  (lines), its columns (cells), both (a position: row; column), or its cells (a repeat). */
export function clampCounts(s: string, cols: number, rows: number): string {
  const cap = (n: string, max: number) => (Number(n) > max ? String(max) : n);
  return s.replace(/\x1b\[([0-9;:]*)([\x20-\x2f]*)([\x40-\x7e])/g, (all, p: string, mid: string, fin: string) => {
    if (!p || mid) return all;
    if (LINES.has(fin) || REGION.has(fin)) return `\x1b[${p.replace(/\d+/g, (n) => cap(n, rows))}${fin}`;
    if (CELLS.has(fin)) return `\x1b[${p.replace(/\d+/g, (n) => cap(n, cols))}${fin}`;
    if (fin === "b") return `\x1b[${p.replace(/\d+/g, (n) => cap(n, cols * rows))}${fin}`;
    if (POSITION.has(fin)) { const [r, c, ...rest] = p.split(";"); return `\x1b[${[cap(r ?? "", rows), ...(c !== undefined ? [cap(c, cols)] : []), ...rest].join(";")}${fin}`; }
    return all;
  });
}
export const prepare = (raw: string, cols: number, rows: number) => clampCounts(collapse(raw.slice(-SCREEN_INPUT_MAX)), cols, rows);
const size = (cols: number, rows: number) => ({ cols: Math.max(2, Math.min(500, cols | 0)), rows: Math.max(1, Math.min(200, rows | 0)) });

/** Draw `raw` in this thread (the worker's job; tests), within `budgetMs`: past it, the answer is "plain". */
export async function drawScreen(raw: string, cols0: number, rows0: number, budgetMs = SCREEN_BUDGET_MS): Promise<Screen> {
  const { cols, rows } = size(cols0, rows0);
  const term = new Terminal({ cols, rows, scrollback: SCREEN_SCROLLBACK, allowProposedApi: true, logLevel: "off" });
  try {
    // wide characters take the two cells they take on the page (public/terminals.js loads the same addon)
    try { term.loadAddon(new Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
    const input = prepare(raw, cols, rows), t0 = performance.now();
    for (let i = 0; i < input.length; i += CHUNK) {
      if (budgetMs <= 0 || performance.now() - t0 > budgetMs) return { lines: [], alternate: false, plain: true };
      await new Promise<void>((done) => term.write(input.slice(i, i + CHUNK), () => done()));
    }
    const b = term.buffer.active, alternate = b.type === "alternate", lines: string[] = [];
    for (let i = 0; i < b.length; i++) {
      const l = b.getLine(i); if (!l) continue;
      const text = l.translateToString(true);
      // a line the terminal wrapped at its width is one line of the program's output again (not on a full-screen program)
      if (!alternate && l.isWrapped && lines.length) lines[lines.length - 1] += text; else lines.push(text);
    }
    return { lines, alternate };
  } finally { term.dispose(); }
}
/** The plain text of the output, as Studio read a terminal before it drew screens: escapes dropped, carriage returns applied. */
export const plainScreen = (raw: string): Screen => ({ lines: screenLines(raw.slice(-SCREEN_INPUT_MAX)), alternate: false, plain: true });

// the worker's module: next to this one from source; inside the binary, the entry point scripts/build.ts adds (a binary's
// workers are named as built, relative, not by their $bunfs URL)
const WORKER = /\$bunfs|~BUN/.test(import.meta.url) ? "./terminal-screen-worker.ts" : new URL("./terminal-screen-worker.ts", import.meta.url).href;
// One worker for every read, its answers matched to the reads by id; started on the first read, not keeping Studio alive.
let worker: Worker | null = null, next = 0;
const waiting = new Map<number, (s: Screen | null) => void>();
function stopWorker() { const w = worker; worker = null; for (const r of waiting.values()) r(null); waiting.clear(); if (w) { w.onmessage = null; w.onerror = null; try { w.terminate(); } catch {} } }
function theWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(WORKER, { smol: true } as any); (w as any).unref?.();
  w.onmessage = (e: MessageEvent) => { const { id, screen } = (e.data ?? {}) as { id: number; screen: Screen | null }; const r = waiting.get(id); if (r) { waiting.delete(id); r(screen); } };
  w.onerror = () => { if (worker === w) stopWorker(); };
  return (worker = w);
}
/** How many workers were stopped for not answering (tests: a read ends by its budget, not by a stop). */
export let workersStopped = 0;
// An output a worker was stopped on is never sent to a worker again (its plain text is the answer), so a stuck render costs
// one stopped worker, not one per read; the next read of another output starts a new worker.
const stuck = new Set<string>();
const keyOf = (raw: string, cols: number, rows: number) => `${cols}x${rows}:${raw.length}:${Bun.hash(raw).toString(36)}`;
/** The text the terminal shows after `raw`, at cols × rows: drawn by the worker within its budget, else the plain text. */
export function readScreen(raw: string, cols: number, rows: number, o: { budgetMs?: number; timeoutMs?: number } = {}): Promise<Screen> {
  const key = keyOf(raw, cols, rows);
  if (stuck.has(key)) return Promise.resolve(plainScreen(raw));
  return new Promise<Screen>((done) => {
    let w: Worker; try { w = theWorker(); } catch { done(plainScreen(raw)); return; }
    const id = ++next;
    const timer = setTimeout(() => { if (waiting.has(id)) { workersStopped++; if (stuck.size > 256) stuck.clear(); stuck.add(key); stopWorker(); } }, o.timeoutMs ?? SCREEN_TIMEOUT_MS);
    waiting.set(id, (s) => { clearTimeout(timer); done(s && Array.isArray(s.lines) && !s.plain ? s : plainScreen(raw)); });
    w.postMessage({ id, raw, cols, rows, budgetMs: o.budgetMs ?? SCREEN_BUDGET_MS });
  });
}
