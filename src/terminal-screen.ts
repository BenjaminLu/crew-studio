// What a terminal shows, read by the same emulator the page draws it with (xterm.js, headless): Terminals.tail gives
// studio_logs this text when the captain asks for a terminal's output (docs/units/terminals.md). The output is fed at the
// terminal's own size, so cursor moves, scroll regions, insert/delete, wide characters and the alternate screen land where
// the page shows them. A full-screen program (the alternate screen) is its rows; a line-mode program is its lines, the
// scrollback included and each line a program's terminal wrapped put back together.
import { Terminal } from "@xterm/headless";
import { Unicode11Addon } from "@xterm/addon-unicode11";

/** At most this much of a terminal's latest output is read (Terminals.tail cuts its ring to it). */
export const SCREEN_INPUT_MAX = 64_000;
/** Scrollback kept while reading: more than the 200 lines a tail may ask for. */
export const SCREEN_SCROLLBACK = 1000;
export type Screen = { lines: string[]; alternate: boolean };

// The same clear sent again and again changes nothing after the first, but each one costs a pass over the whole grid: a run
// of one clear (ESC[J, ESC[2J, ESC[K …) is drawn once, which bounds what output made of nothing but clears can cost.
const collapse = (s: string) => s.replace(/(\x1b\[[0-3]?[JK])\1+/g, "$1");
/** The text the terminal shows after `raw`, at cols × rows. */
export async function readScreen(raw: string, cols: number, rows: number): Promise<Screen> {
  const term = new Terminal({ cols: Math.max(2, Math.min(500, cols | 0)), rows: Math.max(1, Math.min(200, rows | 0)), scrollback: SCREEN_SCROLLBACK, allowProposedApi: true, logLevel: "off" });
  try {
    // wide characters take the two cells they take on the page (public/terminals.js loads the same addon)
    try { term.loadAddon(new Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
    await new Promise<void>((done) => term.write(collapse(raw.slice(-SCREEN_INPUT_MAX)), () => done()));
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
