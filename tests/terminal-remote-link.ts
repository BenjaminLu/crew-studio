import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Remote Control link the Mac's page shows (src/terminals.ts learnLink, SHOWN_LINK): the first link of a Remote Control
// link's shape the Claude terminal prints once Remote Control is on. A program in the terminal printing another claude.ai
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
printf 'Remote Control active: ${REAL}\\r\\n'
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
