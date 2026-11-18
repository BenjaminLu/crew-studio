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
import { readScreen } from "../src/terminal-screen";
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
  r = await shown("F2", box(42, ["key " + TOK.slice(0, 30), TOK.slice(30) + " end"]));
  ok(!leaks(r.lines).length, "F2: a token wrapped inside a box goes too", JSON.stringify(r.lines));
  r = await shown("glued", `prefix${TOK} and xoxb${"-12345678901"}AKIAABCDEFGHIJKLMNOP\r\n`);
  ok(!leaks(r.lines).length && !/AKIAABCD/.test(r.lines.join("")), "a token glued to the word before it (xxxghp_…) is removed", JSON.stringify(r.lines));
  ok(redactText(`xxx${TOK}`) === "xxx[credential removed]" && redactText("task-1234567890abcdefghij") === "task-1234567890abcdefghij", "redactText: glued prefixed tokens go, a long word ending in sk- stays");

  // ---------- a shell after clear ----------
  r = await shown("H", `${E}[H${E}[2J${Array.from({ length: 82 }, (_, i) => `line ${i + 1}`).join("\r\n")}\r\n`, { n: 200 });
  ok(r.lines.length === 82 && r.lines[0] === "line 1" && r.lines.at(-1) === "line 82", "H: a shell after clear gives every line asked for (the scrollback too)", `${r.lines.length} ${JSON.stringify(r.lines.slice(0, 3))}`);

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
