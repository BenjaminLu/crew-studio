import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Remote Control link the Mac's page shows (src/terminals.ts pageLink, bannerLink, SHOWN_LINK): the link on the Claude
// CLI's own Remote Control banner, once Remote Control is on (the flag at start, or /remote-control sent). A program in the terminal printing another claude.ai
// or claude.com code link later (a phishing link, a link with a redirect parameter or another path) never replaces it; it
// is only hidden. And a link wrapped inside a box drawn with heavy, double or full-width bars is learned and hidden whole,
// with the box's borders kept where the program drew them.
//      bun tests/terminal-remote-link.ts
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Terminals, SHOWN_LINK } from "../src/terminals";

let pass = 0, fail = 0; const ok = (c: unknown, n: string, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${c ? "" : `  ${x.slice(0, 500)}`}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => any, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(50); } return null; };
const d = mkdtempSync(join(tmpdir(), "crew-remote-link-")), pr = join(d, "p"), bin = join(d, "bin"); mkdirSync(pr); mkdirSync(bin);
// session links built at run time (none of this shape is committed)
const code = "https://claude.ai/code/", REAL = code + "ses" + "sion_01REALREALREALREALREALREAL", FAKE = code + "ses" + "sion_01ATTACKERATTACKERATTACKER";
const ODD = "https://claude.com/code/x-phish?next=https://evil.example/login", PATHY = code + "rc-OTHER123/../login";
writeFileSync(join(bin, "claude"), `#!/bin/sh
case "$1" in --help) echo "  --remote-control  start remote"; exit 0;; esac
printf '/remote-control is active \\302\\267 Continue here, on your phone, or at ${REAL}\\r\\n'
sleep 1
printf 'tool output: open ${FAKE} to continue\\r\\n'
sleep 1
printf '\\033[5;1Hsee ${ODD}\\r\\n'
printf 'and ${PATHY}\\r\\n'
sleep 30
`); chmodSync(join(bin, "claude"), 0o755);
const svc = new Terminals({ dataDir: d, projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: d } } as any);
try {
  ok(SHOWN_LINK.test(REAL) && SHOWN_LINK.test(code + "rc-FAKEFLAG123?env=x") && !SHOWN_LINK.test(ODD) && !SHOWN_LINK.test(PATHY) && !SHOWN_LINK.test(code + "rc-X12345?env=x&next=https://evil.example") && !SHOWN_LINK.test("https://claude.ai.evil.example/code/rc-123456"),
    "the shape a shown link must have: claude.ai or claude.com, /code/<one id>, at most an env parameter");
  const v = await svc.create({ project: "p", preset: "claude" } as any);
  const url = () => (svc.list(true) as any[]).find((x) => x.id === v.id)?.remote?.url;
  ok(await until(() => url() === REAL, 5000), "the Claude CLI's own Remote Control link is the one the page shows", String(url()));
  await sleep(3200);
  ok(url() === REAL, "a link another program prints later (an attacker's session link, a claude.com link with a redirect, another path) never replaces it", String(url()));
  const tail = ((await svc.tail(v.id, 20)) ?? []).join("\n");
  ok(!tail.includes("ATTACKER") && !tail.includes("REALREAL") && !tail.includes("evil.example"), "every one of them is still hidden from studio_logs", tail);
  try { svc.kill(v.id); } catch {}

  // which link the page takes, and when (review round 7): only the one on the Claude CLI's own banner, once Remote Control
  // is on; a new banner replaces it; a disconnect or the process ending clears it. Each case its own stand-in CLI.
  const BANNER = (u: string) => `/remote-control is active \u00b7 Continue here, on your phone, or at ${u}`; // Claude Code 2.1.327's wording
  const P = (x: string) => `printf '%s\\r\\n' '${x}'`;
  const race = async (name: string, script: string, spec: Record<string, unknown>, want: string | null, o: { help?: string; wait?: number } = {}) => {
    const b2 = join(d, `bin-${name.replace(/\W/g, "")}`); mkdirSync(b2, { recursive: true });
    writeFileSync(join(b2, "claude"), `#!/bin/sh\ncase "$1" in --help) echo "${o.help ?? "  --remote-control  start remote"}"; exit 0;; esac\n${script}\nsleep 30\n`); chmodSync(join(b2, "claude"), 0o755);
    const s2 = new Terminals({ dataDir: join(d, `data-${name.replace(/\W/g, "")}`), projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: `${b2}:/usr/bin:/bin`, HOME: d }, idleMs: 300 } as any);
    const t = await s2.create({ project: "p", preset: "claude", ...spec } as any);
    const at = () => (s2.list(true) as any[]).find((x) => x.id === t.id)?.remote?.url ?? null;
    if (want) await until(() => at() === want, o.wait ?? 8000); else await sleep(o.wait ?? 3000);
    const got = at(); try { s2.kill(t.id); } catch {}
    ok(got === want, name, `page shows ${got}`); return { s2, id: t.id };
  };
  await race("the banner's link, not one a program prints after it", `${P(BANNER(REAL))}\nsleep 1\n${P("tool output: open " + FAKE)}`, {}, REAL);
  await race("not a link printed before the banner (resumed history, a MOTD)", `${P("history: " + FAKE)}\nsleep 1\n${P(BANNER(REAL))}`, {}, REAL);
  await race("with Remote Control off, no link is shown at all", `${P(BANNER(FAKE))}`, { remoteControl: false }, null);
  await race("slash mode: nothing before Studio sends /remote-control, then the banner's link", `${P("history: " + FAKE)}\n${P(BANNER(FAKE))}\nsleep 1\nprintf '> '\nread x\n${P(BANNER(REAL))}`, {}, REAL, { help: "no flag here", wait: 9000 });
  await race("Remote Control off and on: the new banner's link replaces the old", `${P(BANNER(REAL))}\nsleep 1\n${P("Remote Control disconnected.")}\n${P(BANNER(FAKE))}`, {}, FAKE);
  await race("a disconnect clears the link", `${P(BANNER(REAL))}\nsleep 1\n${P("Remote Control disconnected: this terminal is moving to another conversation.")}`, {}, null, { wait: 3500 });
  { const r = await race("the shorter banner other versions print", `${P("Remote Control active: " + REAL)}`, {}, REAL); void r; }
  { // the process ends: the link goes
    const b3 = join(d, "bin-exit"); mkdirSync(b3, { recursive: true });
    writeFileSync(join(b3, "claude"), `#!/bin/sh\ncase "$1" in --help) echo "  --remote-control  start remote"; exit 0;; esac\n${P(BANNER(REAL))}\nsleep 2\n`); chmodSync(join(b3, "claude"), 0o755);
    const s3 = new Terminals({ dataDir: join(d, "data-exit"), projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: `${b3}:/usr/bin:/bin`, HOME: d }, idleMs: 300 } as any);
    const t = await s3.create({ project: "p", preset: "claude" } as any); const at = () => (s3.list(true) as any[]).find((x) => x.id === t.id)?.remote?.url ?? null;
    const before = await until(() => at() === REAL, 6000); await until(() => s3.get(t.id)?.running === false, 8000);
    ok(before && at() === null, "when the Claude CLI ends, the page shows no link", String(at())); }

  // a link wrapped inside a box drawn with heavy, double or full-width bars
  const E = "\x1b", L = code + "rc-01QRSTUVWXYZABCDEFGHIJKLMNOP";
  for (const [name, bar] of [["heavy ┃", "┃"], ["double ║", "║"], ["full-width ｜", "｜"]] as const) {
    const f = join(d, `box-${bar.charCodeAt(0)}`); writeFileSync(f, `${E}[2J${E}[1;1H${bar} ${L.slice(0, 40)} ${bar}${E}[2;1H${bar} ${L.slice(40).padEnd(40)} ${bar}${E}[4;1Hlast`);
    const b = await svc.create({ project: "p", command: `cat '${f}'; sleep 5`, cols: 100, rows: 30 } as any);
    await until(async () => ((await svc.tail(b.id, 20)) ?? []).some((l) => l.includes("last")), 5000);
    const lines = (await svc.tail(b.id, 20)) ?? [];
    ok(!lines.join("\n").includes(L.slice(40)) && !lines.join("\n").includes(L.slice(26, 40)), `a link in a box of ${name} bars is hidden whole`, JSON.stringify(lines));
    try { svc.kill(b.id); } catch {}
  }
  // boxes side by side: the rest of a link in the left box is hidden, and the right box's border stays in its column
  { const f = join(d, "side"), right = "normal words".padEnd(20);
    writeFileSync(f, `${E}[2J${E}[1;1H│ ${L.slice(0, 40)} │ │ ${"left alone".padEnd(20)} │${E}[2;1H│ ${L.slice(40).padEnd(40)} │ │ ${right} │${E}[4;1Hlast`);
    const b = await svc.create({ project: "p", command: `cat '${f}'; sleep 5`, cols: 100, rows: 30 } as any);
    await until(async () => ((await svc.tail(b.id, 20)) ?? []).some((l) => l.includes("last")), 5000);
    const lines = (await svc.tail(b.id, 20)) ?? [], row = lines.find((l) => l.includes("normal words")) ?? "";
    const drawn = `│ ${L.slice(40).padEnd(40)} │ │ ${right} │`;
    ok(!lines.join("\n").includes(L.slice(40)) && row.length === drawn.length && row.endsWith(`│ ${right} │`), "boxes side by side: the link's rest hidden, the right box's border kept in its column", JSON.stringify(lines));
    try { svc.kill(b.id); } catch {} }
} finally { for (const t of svc.list() as any[]) if (t.running) { try { svc.kill(t.id); } catch {} } rmSync(d, { recursive: true, force: true }); }
console.log(`\nterminal-remote-link: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
