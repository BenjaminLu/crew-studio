import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The web terminal's colours (public/term-theme.js, docs/units/web-terminal.md "Colours"): against the background Studio
// gives the terminal (--surface-2, read from public/styles.css) in its light theme and its dark one, the foreground, all 16
// ANSI colours and the dim form of each reach WCAG AA (4.5:1); the page builds xterm with that theme and asks xterm to
// keep any other colour (256-colour, truecolor) at 4.5:1 too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
await import("../public/term-theme.js");
const TT = (globalThis as any).crewTermTheme;
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); } };
const root = join(import.meta.dir, "..");
const css = readFileSync(join(root, "public/styles.css"), "utf8");
// a theme's block in styles.css: :root (light), the dark media query's, and [data-theme="dark"]'s
const vars = (block: string) => { const v = (n: string) => block.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1]; return { bg: v("surface-2"), fg: v("text"), accent: v("accent") }; };
const lightBlock = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const darkAt = css.indexOf('[data-theme="dark"]'), darkBlock = css.slice(darkAt, css.indexOf("}", darkAt));
const sides = { light: vars(lightBlock), dark: vars(darkBlock) };
ok(sides.light.bg && sides.light.fg && sides.dark.bg && sides.dark.fg && sides.light.bg !== sides.dark.bg, "styles.css gives the terminal a background and a text colour in both themes", JSON.stringify(sides));

const fmt = (n: number) => n.toFixed(2);
for (const [side, v] of Object.entries(sides)) {
  const { theme, dim, dark } = TT.themeFor(v.bg, v.fg, v.accent);
  ok(dark === (side === "dark"), `${side}: the palette for a ${side} background is chosen`);
  ok(theme.background === v.bg.toLowerCase(), `${side}: the terminal's background is Studio's --surface-2 (${v.bg})`);
  const fgc = TT.contrast(theme.foreground, theme.background);
  ok(fgc >= TT.AA, `${side}: the foreground ${theme.foreground} is ${fmt(fgc)}:1`);
  const dfc = TT.contrast(dim.foreground, theme.background);
  ok(dfc >= TT.AA, `${side}: dim text in the default colour ${dim.foreground} is ${fmt(dfc)}:1`);
  TT.NAMES.forEach((n: string, i: number) => {
    const c = TT.contrast(theme[n], theme.background), d = TT.contrast(dim.ansi[i], theme.background);
    ok(c >= TT.AA, `${side}: ${n} ${theme[n]} is ${fmt(c)}:1`);
    ok(d >= TT.AA, `${side}: dim ${n} ${dim.ansi[i]} is ${fmt(d)}:1`);
  });
  // dim still looks dimmer where there is room: a colour well above AA moves toward the background
  const roomy = TT.NAMES.filter((n: string, i: number) => TT.contrast(theme[n], theme.background) >= 7 && dim.ansi[i] === theme[n]);
  ok(!roomy.length, `${side}: a colour with room above AA has a dimmer dim form`, roomy.join(","));
  ok(TT.contrast(dim.foreground, theme.background) < fgc, `${side}: dim default text is dimmer than the foreground`);
}
// what xterm 5.5.0 drew before (its built-in Tango palette, dim at half opacity) fails on Studio's dark surface: the check bites
{
  const tango = ["#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf", "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"];
  const low = tango.filter((c) => TT.contrast(c, sides.dark.bg!) < TT.AA);
  ok(low.length >= 4 && low.includes("#555753") && low.includes("#3465a4"), "xterm's own palette has colours under AA on the dark surface (bright black, blue among them)", low.join(","));
}
// the CSS for dim: each ANSI colour's dim form, and the default colour's, scoped to the terminal; not truecolor cells
{
  const { dim } = TT.themeFor(sides.dark.bg, sides.dark.fg, sides.dark.accent), s = TT.dimCss(".wt-xterm", dim);
  ok(s.includes(`.wt-xterm .xterm .xterm-rows .xterm-fg-8.xterm-dim:not([class*="xterm-bg-"]):not([style*="background"]){color:${dim.ansi[8]}}`) && s.includes(`:not([style*="color"]):not([class*="xterm-bg-"]):not([style*="background"]){color:${dim.foreground}}`), "the dim CSS draws each colour's dim form on the terminal's own background only, and leaves a cell with its own colour alone");
  // dim text on each ANSI background: where the colour reads at AA on that background, its dim form there still does
  for (const [side, v] of Object.entries(sides)) {
    const { theme, dim } = TT.themeFor(v.bg, v.fg, v.accent), fgs = [...TT.NAMES.map((n: string) => theme[n]), theme.foreground], bad: string[] = [];
    fgs.forEach((c: string, i: number) => TT.NAMES.forEach((bn: string, j: number) => { const full = TT.contrast(c, theme[bn]), d = TT.contrast(dim.on[i][j], theme[bn]);
      if (d + 1e-9 < Math.min(TT.AA, full)) bad.push(`${i}/${bn}:${d.toFixed(2)}<${Math.min(TT.AA, full).toFixed(2)}`); }));
    ok(dim.on.length === 17 && dim.on.every((r: string[]) => r.length === 16) && !bad.length, `${side}: dim text on each ANSI background keeps AA where the colour has it there (else stays the colour itself)`, bad.join(" "));
  }
  ok(!s.includes("!important"), "the dim CSS never overrides a colour xterm sets on a cell itself (no !important)");
}
// the page uses it: terminals.js builds xterm from themeFor, with minimumContrastRatio 4.5 for every other colour
{
  const js = readFileSync(join(root, "public/terminals.js"), "utf8"), html = readFileSync(join(root, "public/index.html"), "utf8");
  ok(/window\.crewTermTheme/.test(js) && /TT\.themeFor\(/.test(js) && /minimumContrastRatio:\s*TT\.AA|minimumContrastRatio:\s*4\.5/.test(js) && /dimCss\(/.test(js), "terminals.js builds xterm from themeFor, with a minimum contrast of 4.5 and the dim CSS");
  ok(html.indexOf(`src="/term-theme.js"`) > 0 && html.indexOf(`src="/term-theme.js"`) < html.indexOf(`src="/terminals.js"`), "index.html loads term-theme.js before terminals.js");
}
console.log(`terminal-theme: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
