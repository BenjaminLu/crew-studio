// The web terminal's colours (docs/units/web-terminal.md, "Colours"): every ANSI colour a program writes text in, and its
// dim (faint, SGR 2) form, reads at WCAG AA (4.5:1 or more) against the terminal's background, in Studio's light theme and
// its dark one. xterm.js 5.5.0's own palette (Tango) was made for a black background: on Studio's dark surface its black,
// bright black (the colour of hints and autosuggestions), blue and magenta fell to 1.3–3.5:1, and on the light one its
// yellow, cyan and whites under 2:1; dim text is drawn at half opacity, which halves the contrast again.
// Pure: no DOM (tests/terminal-theme.ts runs it under Bun). Loaded before terminals.js.
(() => {
const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
// black and white swap roles with the background: on a dark surface black is a grey you can read, on a light one white is
const DARK = ["#8b93a5", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#d2a8ff", "#39c5cf", "#c9d1d9",
  "#a3abbd", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#e2c5ff", "#56d4dd", "#f0f6fc"];
const LIGHT = ["#24292f", "#b3261e", "#116329", "#7a4d00", "#0550ae", "#8250df", "#0b6670", "#4b535d",
  "#57606a", "#a40e26", "#1a7f37", "#6b4500", "#0a58c2", "#6639ba", "#0a5c63", "#353c44"];
const AA = 4.5;
const rgb = (hex) => { const h = String(hex).trim().replace(/^#/, ""); const f = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(f) ? [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) : null; };
const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast ratio of two colours ("#rrggbb"). */
function contrast(a, b) { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
/** A colour's dim form: as far toward the background as half-opacity would take it, but never under AA (a colour already at AA stays). */
function dimOf(c, bg) { let lo = 0, hi = 0.5; if (contrast(mix(c, bg, hi), bg) >= AA) return mix(c, bg, hi);
  for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (contrast(mix(c, bg, m), bg) >= AA) lo = m; else hi = m; } return mix(c, bg, lo); }
/** Dark when the background is darker than mid grey. */
const isDark = (bg) => lum(rgb(bg) || [0, 0, 0]) < 0.18;
/**
 * The xterm theme for a background and a foreground (Studio's --surface-2 and --text): the 16 ANSI colours for that side,
 * the foreground raised to AA when a theme's own falls short, and each colour's dim form (dim, for terminals.js's CSS).
 */
function themeFor(bg, fg, cursor) {
  const b = rgb(bg) ? hex(rgb(bg)) : "#111111", dark = isDark(b), pal = dark ? DARK : LIGHT;
  let f = rgb(fg) ? hex(rgb(fg)) : dark ? "#e8ebf1" : "#171a21";
  if (contrast(f, b) < AA) f = dark ? "#e8ebf1" : "#171a21";
  const theme = { background: b, foreground: f, cursor: rgb(cursor) ? hex(rgb(cursor)) : f, cursorAccent: b };
  NAMES.forEach((n, i) => { theme[n] = pal[i]; });
  const dim = { foreground: dimOf(f, b), ansi: pal.map((c) => dimOf(c, b)) };
  return { theme, dim, dark };
}
/** The CSS that draws dim text in those dim forms (xterm's own is half opacity), scoped to a terminal's host. */
function dimCss(scope, dim) {
  // the default colour's dim cells only: one in a truecolor or 256-colour carries its own colour (inline, or a class above 15)
  return `${scope} .xterm-rows .xterm-dim:not([class*="xterm-fg-"]):not([style*="color"]){color:${dim.foreground}!important}` + dim.ansi.map((c, i) => `${scope} .xterm-rows .xterm-fg-${i}.xterm-dim{color:${c}!important}`).join("");
}
globalThis.crewTermTheme = { NAMES, DARK, LIGHT, AA, contrast, dimOf, themeFor, dimCss, isDark };
})();
