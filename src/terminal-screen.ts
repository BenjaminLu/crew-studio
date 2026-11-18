// What a terminal shows, read by the same emulator the page draws it with (xterm.js, headless): Terminals.tail gives
// studio_logs this text when the captain asks for a terminal's output (docs/units/terminals.md). The output is fed at the
// terminal's own size, so cursor moves, scroll regions, insert/delete, wide characters and the alternate screen land where
// the page shows them. A full-screen program (the alternate screen) is its rows; a line-mode program is its lines, the
// scrollback included and each line a program's terminal wrapped put back together.
//
// A program's output is not trusted to be cheap to draw: the emulator runs in a Worker (src/terminal-screen-worker.ts)
// that is stopped after SCREEN_TIMEOUT_MS, so Studio's server never waits on it; past that the plain text of the output
// comes back instead (still redacted by Terminals.tail). Before drawing, what makes a sequence expensive is cut down: a
// run of one repeated clear is drawn once, and a cursor or edit sequence's count (insert 9999 lines, repeat 65535 times)
// is clamped to what the screen can hold.
import { Terminal } from "@xterm/headless";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { screenLines } from "./terminal-state";

/** At most this much of a terminal's latest output is read (Terminals.tail cuts its ring to it). */
export const SCREEN_INPUT_MAX = 64_000;
/** Scrollback kept while reading: more than the 200 lines a tail may ask for. */
export const SCREEN_SCROLLBACK = 1000;
/** How long the emulator may take before its worker is stopped and the plain text is used. */
export const SCREEN_TIMEOUT_MS = 1500;
export type Screen = { lines: string[]; alternate: boolean; plain?: boolean };

// The same clear sent again and again changes nothing after the first, but each one costs a pass over the whole grid.
const collapse = (s: string) => s.replace(/(\x1b\[[0-3]?[JK])\1+/g, "$1");
// Cursor and edit sequences whose count is a number of cells, lines or repeats: ICH CUU CUD CUF CUB CNL CPL CHA CUP CHT ED
// EL IL DL DCH SU SD ECH CBT HPA HPR REP VPA VPR HVP DECSTBM. Modes (h, l), SGR (m) and private sequences are left as they are.
const COUNTED = new Set("@ABCDEFGHIJKLMPSTXZ`abdefr");
/** A count past what the screen holds does nothing more, but can cost a pass per unit: it is clamped. */
export function clampCounts(s: string, cols: number, rows: number): string {
  const most = Math.max(cols, rows), rep = cols * rows;
  return s.replace(/\x1b\[([0-9;:]*)([\x20-\x2f]*)([\x40-\x7e])/g, (all, p: string, mid: string, fin: string) => {
    if (!p || mid || !COUNTED.has(fin)) return all;
    const cap = fin === "b" ? rep : most;
    return `\x1b[${p.replace(/\d+/g, (n) => (Number(n) > cap ? String(cap) : n))}${fin}`;
  });
}
export const prepare = (raw: string, cols: number, rows: number) => clampCounts(collapse(raw.slice(-SCREEN_INPUT_MAX)), cols, rows);
const size = (cols: number, rows: number) => ({ cols: Math.max(2, Math.min(500, cols | 0)), rows: Math.max(1, Math.min(200, rows | 0)) });

/** Draw `raw` in this thread (the worker's job; tests). */
export async function drawScreen(raw: string, cols0: number, rows0: number): Promise<Screen> {
  const { cols, rows } = size(cols0, rows0);
  const term = new Terminal({ cols, rows, scrollback: SCREEN_SCROLLBACK, allowProposedApi: true, logLevel: "off" });
  try {
    // wide characters take the two cells they take on the page (public/terminals.js loads the same addon)
    try { term.loadAddon(new Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
    await new Promise<void>((done) => term.write(prepare(raw, cols, rows), () => done()));
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
/** The text the terminal shows after `raw`, at cols × rows: drawn in a worker, stopped after `timeoutMs`. */
export function readScreen(raw: string, cols: number, rows: number, o: { timeoutMs?: number } = {}): Promise<Screen> {
  return new Promise<Screen>((done) => {
    let w: Worker;
    try { w = new Worker(WORKER); } catch { done(plainScreen(raw)); return; }
    let over = false;
    const finish = (s: Screen) => { if (over) return; over = true; clearTimeout(timer); try { w.terminate(); } catch {} done(s); };
    const timer = setTimeout(() => finish(plainScreen(raw)), o.timeoutMs ?? SCREEN_TIMEOUT_MS);
    w.onmessage = (e: MessageEvent) => { const s = e.data as Screen; finish(s && Array.isArray(s.lines) ? s : plainScreen(raw)); };
    w.onerror = () => finish(plainScreen(raw));
    w.postMessage({ raw, cols, rows });
  });
}
