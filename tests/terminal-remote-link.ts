import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Remote Control link the Mac's page shows (src/terminals.ts pageLink, bannerLink, SHOWN_LINK): the link on the Claude
// CLI's own Remote Control banner, once Remote Control is on (the flag at start, or /remote-control sent). A program in the terminal printing another claude.ai
// or claude.com code link later (a phishing link, a link with a redirect parameter or another path) never replaces it; it
// is only hidden. And a link wrapped inside a box drawn with heavy, double or full-width bars is learned and hidden whole,
// with the box's borders kept where the program drew them.
//      bun tests/terminal-remote-link.ts
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
printf '  project \\302\\267 /rc\\r\\n'
printf '  /remote-control is active \\302\\267 Continue here, on your phone, or at ${REAL}\\r\\n'
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
  // Claude Code draws its banner right below its header, which ends "· /rc" while Remote Control is on
  const HB = (u: string) => `${P("  project \u00b7 /rc")}\n${P("  " + BANNER(u))}`;
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
  await race("the banner's link, not one a program prints after it", `${HB(REAL)}\nsleep 1\n${P("tool output: open " + FAKE)}`, {}, REAL);
  await race("not a link printed before the banner (resumed history, a MOTD)", `${P("history: " + FAKE)}\nsleep 1\n${HB(REAL)}`, {}, REAL);
  await race("with Remote Control off, no link is shown at all", `${HB(FAKE)}`, { remoteControl: false }, null);
  await race("slash mode: nothing before Studio sends /remote-control, then the banner's link", `${P("history: " + FAKE)}\n${HB(FAKE)}\nsleep 1\nprintf '> '\nread x\n${HB(REAL)}`, {}, REAL, { help: "no flag here", wait: 9000 });
  await race("Remote Control off and on: the new banner's link replaces the old", `${HB(REAL)}\nsleep 1\n${P("Remote Control disconnected.")}\n${HB(FAKE)}`, {}, FAKE);
  await race("a disconnect clears the link", `${HB(REAL)}\nsleep 1\n${P("Remote Control disconnected: this terminal is moving to another conversation.")}`, {}, null, { wait: 3500 });
  // review round 8: a line only saying Remote Control is on is no banner; banner or disconnect lines under Claude's tool
  // output mark (⎿) are a program's output shown by Claude
  await race("a line only saying Remote Control is on (a README) is no banner", `${P("README: Remote Control enabled: " + FAKE)}`, {}, null, { wait: 3000 });
  await race("F: a full banner under the tool-output mark after the real one changes nothing", `${HB(REAL)}\nsleep 1\n${P("  ⎿  " + BANNER(FAKE))}`, {}, REAL, { wait: 3500 });
  await race("G: a short form under the tool-output mark after the real one changes nothing", `${HB(REAL)}\nsleep 1\n${P("  ⎿  Remote Control active: " + FAKE)}`, {}, REAL, { wait: 3500 });
  await race("H: a forged 'disconnected' under the tool-output mark does not clear it", `${HB(REAL)}\nsleep 2\n${P("  ⎿  Remote Control disconnected")}\nsleep 1`, {}, REAL, { wait: 4000 });
  await race("K: 'Remote Control enabled: <link>' in ordinary text after the real banner changes nothing", `${HB(REAL)}\nsleep 1\n${P("README: Remote Control enabled: " + FAKE)}`, {}, REAL, { wait: 3500 });
  { // the process ends: the link goes
    const b3 = join(d, "bin-exit"); mkdirSync(b3, { recursive: true });
    writeFileSync(join(b3, "claude"), `#!/bin/sh\ncase "$1" in --help) echo "  --remote-control  start remote"; exit 0;; esac\n${HB(REAL)}\nsleep 2\n`); chmodSync(join(b3, "claude"), 0o755);
    const s3 = new Terminals({ dataDir: join(d, "data-exit"), projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: `${b3}:/usr/bin:/bin`, HOME: d }, idleMs: 300 } as any);
    const t = await s3.create({ project: "p", preset: "claude" } as any); const at = () => (s3.list(true) as any[]).find((x) => x.id === t.id)?.remote?.url ?? null;
    const before = await until(() => at() === REAL, 6000); await until(() => s3.get(t.id)?.running === false, 8000);
    ok(before && at() === null, "when the Claude CLI ends, the page shows no link", String(at())); }

  // what a signed-in Claude Code 2.1.327 really drew (tests/fixtures/terminal/claude-2.1.327-remote-control.raw: captured
  // once in a Studio terminal with the captain's consent, session ids, user and paths replaced): its banner placed by
  // cursor moves, the link on the next row; /remote-control → Disconnect ("⎿  Remote Control disconnected." below the
  // command); /remote-control again (a new banner and link); the model asked to print a fake banner and "Remote Control
  // disconnected." (it echoed both in its answer, under ⏺); /exit. Replayed piece by piece through a stand-in CLI.
  { const raw = readFileSync(join(import.meta.dir, "fixtures", "terminal", "claude-2.1.327-remote-control.raw"), "utf8");
    // the session ids were replaced by rc-… ids of the same length (no session-shaped link is committed)
    const FIRST = "https://claude.ai/code/rc-0000001FIRSTSESSIONLIVECHECKX", SECOND = "https://claude.ai/code/rc-0000001SECONDSESSIONLIVECHECK";
    const d1 = raw.indexOf("Remote Control disconnected."), s2 = raw.lastIndexOf("SECONDSESSION") + 40, echo = raw.lastIndexOf("Remote Control disconnected.") + 40;
    const cuts = [0, d1 - 1, d1 + 40, s2, echo, raw.length], b4 = join(d, "bin-replay"), parts = join(d, "replay"); mkdirSync(b4, { recursive: true }); mkdirSync(parts, { recursive: true });
    for (let k = 0; k + 1 < cuts.length; k++) writeFileSync(join(parts, `p${k}`), raw.slice(cuts[k], cuts[k + 1]));
    writeFileSync(join(b4, "claude"), `#!/bin/sh\ncase "$1" in --help) echo "  --remote-control  start remote"; exit 0;; esac\nfor k in 0 1 2 3 4; do cat '${parts}'/p$k; sleep 2; done\n`); chmodSync(join(b4, "claude"), 0o755);
    const s4 = new Terminals({ dataDir: join(d, "data-replay"), projects: () => [{ id: "p", name: "P", path: pr }], transcripts: false, shell: "/bin/sh", env: { PATH: `${b4}:/usr/bin:/bin`, HOME: d }, idleMs: 300 } as any);
    const t = await s4.create({ project: "p", preset: "claude", cols: 120, rows: 40 } as any), at = () => (s4.list(true) as any[]).find((x) => x.id === t.id)?.remote?.url ?? null;
    const seen: (string | null)[] = []; const t0 = Date.now();
    while (Date.now() - t0 < 13_000) { const u = at(); if (seen.at(-1) !== u) seen.push(u); if (s4.get(t.id)?.running === false && Date.now() - t0 > 11_000) break; await sleep(100); }
    ok(JSON.stringify(seen) === JSON.stringify([null, FIRST, null, SECOND, null]), "the real CLI's output: its banner's link, cleared on Disconnect, the new banner's link, untouched by the model echoing a fake banner and \"disconnected\", cleared when it exits", JSON.stringify(seen)); }

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
