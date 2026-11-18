import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A terminal's screen as studio_logs gives it (Terminals.tail, src/terminal-screen.ts): drawn by the page's own emulator
// (xterm.js headless) at the terminal's size, the known link and secrets removed from the raw output first and from the
// drawn text again (each line, and every pair of neighbouring lines read as one), no control or bidi character left.
//   - real vim (when installed): open, Ctrl-E scrolled, Ctrl-D, :set number + gg, with a token, a wide-character line, a
//     remote-control link and a long line the screen wraps
//   - output crafted against the reader (A–J): a token drawn in two pieces, after wide characters, ESC ( B, C1 controls,
//     a half-overwritten emoji, colon SGR and long CSI, DCS, a known link in a box narrower than the terminal
//   - a shell after `clear` keeps the lines asked for; the reader's cost stays bounded (time and memory)
//      bun tests/terminal-screen.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Terminals } from "../src/terminals";
import * as screen from "../src/terminal-screen";
import { clampCounts, drawScreen, readScreen, SCREEN_TIMEOUT_MS } from "../src/terminal-screen";
import { redactText } from "../src/secure";

let pass = 0, fail = 0; const ok = (c: unknown, n: string, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${c ? "" : `  ${x.slice(0, 600)}`}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => any, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(50); } return null; };
const d = mkdtempSync(join(tmpdir(), "crew-term-screen-")), pr = join(d, "p"); mkdirSync(pr);
const svc = new Terminals({ dataDir: d, projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: "/usr/bin:/bin", HOME: d, TERM: "xterm-256color", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" } } as any);
const E = "\x1b", TOK = "ghp_" + "Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8", LINK = "https://claude.ai/code/" + "rc-01ABCDEFGHIJKLMNOPQRSTUV";
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
const leaks = (lines: string[]) => { const t = lines.join("\n"); return [TOK.slice(4, 14), TOK.slice(-12), "ABCDEFGHIJ", "KLMNOPQRSTUV"].filter((p) => t.includes(p)); };
/** A terminal that prints `payload` and stays open; its tail once drawn. */
async function shown(name: string, payload: string, o: { cols?: number; rows?: number; know?: string; n?: number } = {}) {
  const f = join(d, name.replace(/\W/g, "_")); writeFileSync(f, payload);
  const v = await svc.create({ project: "p", command: `cat '${f}'; sleep 5`, cols: o.cols ?? 80, rows: o.rows ?? 24 } as any);
  if (o.know) (svc as any).terms.get(v.id).redactor.know(o.know);
  await until(async () => ((svc as any).terms.get(v.id).ring.bytes().length >= Buffer.byteLength(payload) * 0.9), 5000); await sleep(150);
  const t0 = performance.now(), lines = (await svc.tail(v.id, o.n ?? 200)) ?? [], ms = performance.now() - t0;
  try { svc.kill(v.id); } catch {}
  return { lines, ms, id: v.id };
}

try {
  // ---------- crafted output (A–J) ----------
  let r = await shown("A", `${E}[2J${E}[1;1Hkey ${TOK.slice(0, 18)}${E}[2;1Hother${E}[1;23H${TOK.slice(18)} end`);
  ok(!leaks(r.lines).length && r.lines[0].includes("[credential removed]"), "A: a token drawn in two pieces on one row is removed", JSON.stringify(r.lines));
  r = await shown("A2", `${E}[2J${E}[1;23H${TOK.slice(18)} end${E}[1;1Hkey ${TOK.slice(0, 18)}`);
  ok(!leaks(r.lines).length, "A2: the second piece drawn first", JSON.stringify(r.lines));
  r = await shown("B", `${E}[2J${E}[1;1H中文key ${TOK.slice(0, 18)}${E}[1;27H${TOK.slice(18)} end`);
  ok(!leaks(r.lines).length && r.lines[0].startsWith("中文key "), "B: a token split after wide characters (two cells each) is one token again, and removed", JSON.stringify(r.lines));
  r = await shown("C", `${E}[2J${E}[1;1H${E}[1mPID${E}(B${E}[m USER${E}(B${E}[m CMD`);
  ok(r.lines[0] === "PID USER CMD", "C: ESC ( B (as top and vim send it) is a charset, not text", JSON.stringify(r.lines));
  r = await shown("D", `${E}[2J${E}[1;1Hab\u009b31mcd\u0085ef\u009d0;title\u0007gh ‮evil‬`);
  ok(!CONTROL.test(r.lines.join("")) && r.lines[0].startsWith("ab"), "D: no C1 control and no bidi control comes back", JSON.stringify(r.lines));
  r = await shown("G", `${E}[2J${E}[1;1Hx😀y${E}[1;3Hz`);
  ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?:[^\ud800-\udbff]|^)[\udc00-\udfff]/.test(r.lines.join("")), "G: a wide emoji half overwritten leaves no half character", JSON.stringify(r.lines));
  r = await shown("I", `${E}[2J${E}[1;1H${E}[4:3mund${E}[38:2:255:0:0mred${E}[${"1;".repeat(40)}mX`);
  ok(r.lines[0] === "undredX", "I: colon SGR and a long CSI are parsed, not printed", JSON.stringify(r.lines));
  r = await shown("J", `${E}[2J${E}[1;1Hok${E}P1$r0m${E}\\ after${E}_apc${E}\\${E}^pm${E}\\${E}Xsos${E}\\.`);
  ok(r.lines[0] === "ok after.", "J: DCS, APC, PM and SOS payloads are never text", JSON.stringify(r.lines));
  const box = (w: number, parts: string[]) => [`╭${"─".repeat(w)}╮`, ...parts.map((p) => `│ ${p.padEnd(w - 2)} │`), `╰${"─".repeat(w)}╯`].join("\r\n") + "\r\n";
  r = await shown("F", box(42, [LINK.slice(0, 40), LINK.slice(40)]), { know: LINK });
  ok(!leaks(r.lines).length, "F: a known remote-control link wrapped inside a box narrower than the terminal is removed whole", JSON.stringify(r.lines));
  // a link Studio was never told, in a box: drawn with line breaks (Ink), or with its rows placed by cursor moves (ratatui,
  // Codex). Studio learns it from the drawn rows, whole, and removes it through the box's borders, in both ways
  const UNKNOWN = "https://claude.ai/code/" + "rc-01QRSTUVWXYZABCDEFGHIJKLMNOP";
  const cupBox = (w: number, parts: string[]) => `${E}[2J` + parts.map((p, i) => `${E}[${i + 1};1H│ ${p.padEnd(w - 2)} │`).join("") + `${E}[${parts.length + 2};1Hlast`;
  const unknownLeaks = (l: string[]) => [UNKNOWN.slice(26, 40), UNKNOWN.slice(40)].filter((x) => l.join("\n").includes(x));
  for (const [style, payload] of [["line breaks (Ink)", box(42, [UNKNOWN.slice(0, 40), UNKNOWN.slice(40)]) + "last\r\n"], ["cursor moves (ratatui)", cupBox(42, [UNKNOWN.slice(0, 40), UNKNOWN.slice(40)])]] as const) {
    r = await shown(`unknown-${style}`, payload);
    ok(!unknownLeaks(r.lines).length && r.lines.some((l) => l.includes("last")), `a link Studio was not told, in a box drawn by ${style}, is removed whole`, JSON.stringify(r.lines)); }
  // review round 5: boxes side by side, two links, a full-width link with a word below it, a token split on one row
  // while the screen is read as plain text. Session links of the real shape (built at run time: none is committed)
  const S1 = "https://claude.ai/code/" + "ses" + "sion_01ABCDEFGHIJKLMNOPQRSTUVWX", S2 = "https://claude.ai/code/" + "ses" + "sion_02ZYXWVUTSRQPONMLKJIHGFEDC";
  const padTo = (x: string, n: number) => x + " ".repeat(Math.max(0, n - x.length)), heavy = `${E}[200S${E}[200T`.repeat(5500);
  const r5: [string, string, number, number, (l: string[]) => boolean][] = [
    ["two boxes side by side, the link in the left one", `${E}[2J${E}[1;1H│ ${S1.slice(0, 40)} │ │ ${padTo("left alone", 20)} │${E}[2;1H│ ${padTo(S1.slice(40), 40)} │ │ ${padTo("normal words", 20)} │${E}[4;1Hlast`, 100, 30,
      (l) => !l.join("\n").includes(S1.slice(40)) && l.join("\n").includes("normal words") && l.join("\n").includes("left alone")],
    ["two links in two boxes side by side", `${E}[2J${E}[1;1H│ ${S1.slice(0, 40)} │ │ ${S2.slice(0, 40)} │${E}[2;1H│ ${padTo(S1.slice(40), 40)} │ │ ${padTo(S2.slice(40), 40)} │${E}[4;1Hlast`, 100, 30,
      (l) => !l.join("\n").includes(S1.slice(40)) && !l.join("\n").includes(S2.slice(40))],
    ["a full-width link with a word alone on the row below (the word is no part of it)", `${E}[2J${E}[1;1H${"y".repeat(100 - S1.length - 1)} ${S1}${E}[2;1Hstandalone${E}[3;1Hother line`, 100, 30,
      (l) => l.includes("standalone") && !l.join("\n").includes("ABCDEFGHIJ")],
    ["a token in two pieces on one row, read as plain text (the worker out of budget)", heavy + `${E}[2J${E}[4;1Hkey ${TOK.slice(0, 28)}${E}[4;33H${TOK.slice(28)} end${E}[6;1Hlast`, 500, 200,
      (l) => !l.join("\n").includes(TOK.slice(28)) && !l.join("\n").includes(TOK.slice(4, 20))],
  ];
  for (const [name, payload, c, rr, good] of r5) { r = await shown(`r5-${name}`, payload, { cols: c, rows: rr }); ok(good(r.lines), name, JSON.stringify(r.lines).slice(0, 400)); }
  { const { findLink, findLinks } = await import("../src/terminals"), { rowBreaks } = await import("../src/terminal-rows");
    ok(findLink(`${"y".repeat(100 - S1.length - 1)} ${S1}\r\nstandalone\r\n`, 100) === S1, "findLink: a whole session link is never joined with the word below it");
    ok(JSON.stringify(findLinks(`│ ${S1.slice(0, 40)} │ │ ${S2.slice(0, 40)} │\r\n│ ${padTo(S1.slice(40), 40)} │ │ ${padTo(S2.slice(40), 40)} │\r\n`, 100).sort()) === JSON.stringify([S1, S2].sort()), "findLinks: two links in boxes side by side, each rejoined in its own box's columns");
    ok(rowBreaks(`a${E}[1;5Hb${E}[2;1Hc${E}[Ad`) === "ab\r\nc\r\nd", "rowBreaks: a move along the row joins, a move to another row breaks"); }
  // the same through the plain-text fallback (the worker out of budget): cursor-placed rows are still rows there
  { const plain = (await import("../src/terminal-screen")).plainScreen(cupBox(42, [UNKNOWN.slice(0, 40), UNKNOWN.slice(40)]));
    ok(plain.lines.length >= 2 && plain.lines.some((l) => l.includes(UNKNOWN.slice(0, 40))) && plain.lines.some((l) => l.includes(UNKNOWN.slice(40))), "the plain fallback keeps cursor-placed rows apart, so the same link reading applies", JSON.stringify(plain.lines)); }
  r = await shown("F2", box(42, ["key " + TOK.slice(0, 30), TOK.slice(30) + " end"]));
  ok(!leaks(r.lines).length, "F2: a token wrapped inside a box goes too", JSON.stringify(r.lines));
  r = await shown("glued", `prefix${TOK} and xoxb${"-12345678901"}AKIAABCDEFGHIJKLMNOP\r\n`);
  ok(!leaks(r.lines).length && !/AKIAABCD/.test(r.lines.join("")), "a token glued to the word before it (xxxghp_…) is removed", JSON.stringify(r.lines));
  ok(redactText(`xxx${TOK}`) === "xxx[credential removed]" && redactText("task-1234567890abcdefghij") === "task-1234567890abcdefghij", "redactText: glued prefixed tokens go, a long word ending in sk- stays");

  // ---------- one drawing per output ----------
  { const f = join(d, "once"); writeFileSync(f, "one\r\ntwo\r\n");
    const v = await svc.create({ project: "p", command: `cat '${f}'; sleep 5`, cols: 80, rows: 24 } as any); await until(async () => ((await svc.tail(v.id, 10)) ?? []).includes("two"), 5000);
    const k1 = (svc as any).screens.get(v.id)?.key, a = await svc.tail(v.id, 2), b = await svc.tail(v.id, 1), k2 = (svc as any).screens.get(v.id)?.key;
    ok(k1 && k1 === k2 && JSON.stringify(a) === JSON.stringify(["one", "two"]) && JSON.stringify(b) === JSON.stringify(["two"]), "a tail asked again with fewer lines reuses the screen drawn for this output", `${k1} ${k2} ${JSON.stringify([a, b])}`);
    try { svc.kill(v.id); } catch {} }

  // ---------- a shell after clear ----------
  r = await shown("H", `${E}[H${E}[2J${Array.from({ length: 82 }, (_, i) => `line ${i + 1}`).join("\r\n")}\r\n`, { n: 200 });
  ok(r.lines.length === 82 && r.lines[0] === "line 1" && r.lines.at(-1) === "line 82", "H: a shell after clear gives every line asked for (the scrollback too)", `${r.lines.length} ${JSON.stringify(r.lines.slice(0, 3))}`);

  // ---------- a costly output never holds Studio's event loop ----------
  // each sequence repeated to 64 kB, at a small and the largest terminal: the server keeps answering (a 10 ms timer never
  // waits 200 ms), and the read ends within the worker's timeout with a bounded result
  const stall = async (f: () => Promise<unknown>) => { let worst = 0, last = performance.now(); const t = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 10); last = now; }, 10);
    const t0 = performance.now(); const out = await f(); const ms = performance.now() - t0; clearInterval(t); return { out, ms, worst }; };
  const costly: [string, string][] = [["insert lines ESC[9999L", `${E}[9999L`], ["delete lines ESC[9999M", `${E}[9999M`], ["scroll up ESC[9999S", `${E}[9999S`], ["repeat x ESC[65535b", `x${E}[65535b`], ["2J and H alternating", `${E}[2J${E}[H`], ["alternate screen on and off", `${E}[?1049h${E}[?1049l`]];
  for (const [name, seq] of costly) for (const [cols, rows] of [[100, 30], [500, 200]]) {
    const payload = seq.repeat(Math.ceil(64_000 / seq.length)).slice(0, 64_000);
    const r = await stall(() => readScreen(payload, cols, rows)); const sc = r.out as any;
    ok(r.worst < 200 && r.ms < SCREEN_TIMEOUT_MS + 700 && sc.lines.length <= 1300 && (sc.plain || sc.lines.join("").length <= (1000 + rows) * cols * 2), `${name} ×64 kB at ${cols}×${rows}: the event loop waited at most ${r.worst.toFixed(0)} ms, the read took ${r.ms.toFixed(0)} ms${sc.plain ? " (plain text past its budget)" : ""}`, `${r.worst} ${r.ms} ${sc.lines.length}`);
  }
  ok(clampCounts(`${E}[9999L${E}[9999;9999H${E}[9999@${E}[65535b${E}[1;9999r${E}[?1049h${E}[38;2;255;0;0m${E}[2J`, 100, 30) === `${E}[30L${E}[30;100H${E}[100@${E}[3000b${E}[1;30r${E}[?1049h${E}[38;2;255;0;0m${E}[2J`, "counts are clamped to the screen: lines to its rows, cells to its columns, a position to both, a repeat to its cells; modes, colours and clears stay as they are");
  ok(screen.workersStopped === 0, "every costly read above ended by the worker's own budget: no worker was stopped", String(screen.workersStopped));
  // a stopped Worker's memory is never given back: fifty costly reads on the one worker leave memory where it was
  { const heavy = `${E}[9999L`.repeat(9000), rss = () => process.memoryUsage().rss / 1e6; await readScreen(heavy, 500, 200); Bun.gc(true); const r0 = rss();
    for (let i = 0; i < 50; i++) await readScreen(heavy, 500, 200);
    Bun.gc(true); await sleep(500); const r1 = rss();
    ok(r1 - r0 < 150 && screen.workersStopped === 0, `fifty costly reads: memory ${r0.toFixed(0)} -> ${r1.toFixed(0)} MB, no worker stopped`, `${r0} ${r1} ${screen.workersStopped}`); }
  // reads queue behind costly ones without the worker being stopped: its silence timer runs from when it begins a read
  { const heavy = `${E}[9999L`.repeat(9000), h0 = screen.workersStopped, t0 = performance.now();
    const [a1, a2, a3, light] = await Promise.all([readScreen(heavy + "1", 500, 200), readScreen(heavy + "2", 500, 200), readScreen(heavy + "3", 500, 200), readScreen(`${E}[?1049h${E}[2;3Hbehind`, 40, 6)]);
    ok(light.alternate && !light.plain && light.lines[1] === "  behind" && screen.workersStopped === h0 && [a1, a2, a3].every((x) => x.plain), `a light read behind three costly ones is drawn (${(performance.now() - t0).toFixed(0)} ms), and no worker is stopped`, `${screen.workersStopped - h0} ${JSON.stringify(light)}`);
    const five = await Promise.all([1, 2, 3, 4, 5].map((i) => readScreen(heavy + String(i * 7), 500, 200)));
    ok(screen.workersStopped === h0 && five.every((x) => x.plain), "five costly reads at once: four wait their turn (each ends by its budget), the fifth is plain at once; no worker is stopped", String(screen.workersStopped - h0)); }
  // a worker that does not answer in time is stopped once for that output, and a new one draws the next read
  { const heavy = `${E}[200S${E}[200T`.repeat(3000), h0 = screen.workersStopped;
    const a = await readScreen(heavy, 500, 200, { timeoutMs: 1 }), b = await readScreen(heavy, 500, 200, { timeoutMs: 1 }), c = await readScreen(heavy, 500, 200, { timeoutMs: 1 });
    const fresh = await readScreen(`${E}[?1049h${E}[2;3Hafter`, 40, 6);
    ok(a.plain && b.plain && c.plain && screen.workersStopped - h0 === 1 && fresh.alternate && fresh.lines[1] === "  after", "a stuck render stops one worker, once for that output (later reads of it are plain at once); a new worker draws the next output", `${screen.workersStopped - h0} ${JSON.stringify(fresh)}`); }
  { const r = await readScreen("hello\r\nworld\r\n", 80, 24, { budgetMs: 0 }); ok(r.plain === true && r.lines.includes("hello") && r.lines.includes("world"), "past its budget: the plain text of the output comes back (the worker is not stopped)", JSON.stringify(r)); }
  { const a = await drawScreen(`${E}[?1049h${E}[2;3Hdrawn here`, 40, 6); ok(a.alternate && a.lines[1] === "  drawn here", "drawScreen (the worker's job) draws the same screen in this thread"); }

  // ---------- bounded cost ----------
  const big: [string, string, number, number][] = [["E1 ESC[2J ×16k", `${E}[2J`.repeat(16_000), 500, 200], ["E2 ESC[J ×21k", `${E}[J`.repeat(21_000), 500, 200],
    ["E3 newline ×64k", "a\r\n".repeat(21_000), 80, 24], ["E4 OSC spam", `${E}]0;${"x".repeat(60)}\x07`.repeat(900), 120, 40], ["E5 unterminated CSI", `${E}[`.repeat(30_000), 120, 40]];
  for (const [name, payload, cols, rows] of big) {
    const h0 = process.memoryUsage().heapUsed, t0 = performance.now(); const s = await readScreen(payload, cols, rows); const ms = performance.now() - t0, mb = (process.memoryUsage().heapUsed - h0) / 1e6;
    ok(ms < 1500 && mb < 150 && s.lines.every((l) => !CONTROL.test(l.replace(/\t/g, ""))), `${name} at ${cols}×${rows}: read in ${ms.toFixed(0)} ms, heap +${mb.toFixed(0)} MB`, `${ms} ms ${mb} MB`);
  }
  const t0 = performance.now(); const s = await readScreen("x".repeat(1_000_000), 80, 24); ok(performance.now() - t0 < 1500 && s.lines.length <= 1024, "input past the bound is cut to its last 64 kB", `${s.lines.length}`);

  // ---------- real vim ----------
  const vim = Bun.which("vim");
  if (!vim) console.log("  skip  real vim: not installed");
  else {
    const long = "x".repeat(70) + TOK + " tail-of-long";
    writeFileSync(join(pr, "f.txt"), ["line one", `token=${TOK}`, `中文註解 with 寬字元 then key ${TOK}`, `remote ${LINK}`, long, ...Array.from({ length: 60 }, (_, i) => `row ${i + 6}`), "last line"].join("\n") + "\n");
    const v = await svc.create({ project: "p", command: `${vim} -u NONE -N -i NONE f.txt`, cols: 80, rows: 24 } as any);
    const screen = async (want: (l: string[]) => boolean) => (await until(async () => { const l = (await svc.tail(v.id, 200)) ?? []; return want(l) ? l : null; }, 6000)) ?? ((await svc.tail(v.id, 200)) ?? []);
    let l = await screen((x) => x.some((y) => y.startsWith("row 6")));
    ok(l[0] === "line one" && l[1].startsWith("token=[credential removed]") && l[4] === "[credential removed]" && l[5] === "[credential removed]" && l[2].startsWith("中文註解 with 寬字元 then key [credential removed]") && !leaks(l).length && /f\.txt/.test(l.at(-1) ?? ""), "vim: opened: the file's first rows, the token, the link and the token vim wrapped over two rows removed, the status line", JSON.stringify(l.slice(0, 7)));
    svc.input(v.id, "4G\x05\x05\x05"); l = await screen((x) => x[0]?.startsWith("remote") || x[0] === "row 6" || /tail-of-long/.test(x[0] ?? ""));
    ok(!/^line one|^token=/.test(l[0] ?? "") && !leaks(l).length, "vim: after Ctrl-E three times the screen starts further down (a scroll the reader must follow)", JSON.stringify(l.slice(0, 4)));
    svc.input(v.id, "\x04"); l = await screen((x) => !!x[0] && /^row (1\d|[2-9]\d)/.test(x[0]));
    ok(/^row \d+$/.test(l[0] ?? "") && !leaks(l).length, "vim: Ctrl-D scrolls half a screen", JSON.stringify(l.slice(0, 3)));
    svc.input(v.id, ":set number\rgg"); l = await screen((x) => /^\s+1 line one/.test(x[0] ?? ""));
    ok(/^\s+1 line one$/.test(l[0] ?? "") && /^\s+2 token=\[credential removed\]/.test(l[1] ?? "") && !leaks(l).length, "vim: :set number and gg, numbered rows from the top, secrets removed", JSON.stringify(l.slice(0, 6)));
    svc.input(v.id, ":q!\r"); await until(() => svc.get(v.id)?.running === false, 5000);
  }
} finally { for (const t of svc.list()) if (t.running) { try { svc.kill(t.id); } catch {} } rmSync(d, { recursive: true, force: true }); }
console.log(`\nterminal-screen: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
