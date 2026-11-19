import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Claude Code session links in a terminal's output (src/terminals.ts): Studio never turns Remote Control on, and a link
// the captain's own Remote Control prints, or any program prints, is removed from what Studio gives out or keeps: the
// screen studio_logs reads (Terminals.tail) and the transcript. Each form: the link plain, the session id alone, the
// banner Ink places with cursor moves (the link on the next row, inside an OSC 8 hyperlink), a link wrapped inside a box
// of heavy, double or full-width bars, and boxes side by side (the box's borders kept where the program drew them).
//      bun tests/terminal-link-redaction.ts
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Terminals } from "../src/terminals";

let pass = 0, fail = 0; const ok = (c: unknown, n: string, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${c ? "" : `  ${x.slice(0, 500)}`}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => any, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(50); } return null; };
const d = mkdtempSync(join(tmpdir(), "crew-link-redaction-")), pr = join(d, "p"), bin = join(d, "bin"), data = join(d, "data"); mkdirSync(pr); mkdirSync(bin); mkdirSync(data);
// session links built at run time (none of this shape is committed)
const code = "https://claude.ai/code/", ID = "ses" + "sion_01REALREALREALREALREALREAL", REAL = code + ID, FAKE = code + "ses" + "sion_01ATTACKERATTACKERATTACKER";
const ODD = "https://claude.com/code/x-phish?next=https://evil.example/login", PATHY = code + "rc-OTHER123/../login";
const E = "\x1b";
// a stand-in Claude Code: it logs its arguments, then prints what Claude Code 2.1.327 drew when the captain turned Remote
// Control on (its words placed with cursor moves, the link on the next row in an OSC 8 hyperlink), then other links
writeFileSync(join(bin, "claude"), `#!/bin/sh
echo "args:[$*]" > '${join(d, "args")}'
printf '  /remote-control${E}[19Gis${E}[22Gactive \\302\\267 Continue here, on your phone, or at \\r${E}[2C${E}[1B${E}]8;id=x;${REAL}\\007${REAL}${E}]8;;\\007\\r\\n'
sleep 1
printf 'session id: ${ID}\\r\\n'
printf 'tool output: open ${FAKE} to continue\\r\\n'
printf '${E}[9;1Hsee ${ODD}\\r\\n'
printf 'and ${PATHY}\\r\\n'
printf 'done-printing\\r\\n'
sleep 30
`); chmodSync(join(bin, "claude"), 0o755);
const svc = new Terminals({ dataDir: data, projects: () => [{ id: "p", name: "P", path: pr }], transcripts: true, shell: "/bin/sh", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: d } } as any);
const leak = (s: string) => ["REALREAL", "ATTACKER", "evil.example", "rc-OTHER123"].filter((x) => s.includes(x));
try {
  // an older page may still send remoteControl: true; Studio adds no flag either way
  const v = await svc.create({ project: "p", preset: "claude", remoteControl: true, cols: 100, rows: 30 } as any);
  ok(await until(() => { try { return readFileSync(join(d, "args"), "utf8").trim() === "args:[]"; } catch { return false; } }, 5000) && !v.command.includes("--remote-control") && !("remote" in v),
    "the Claude preset starts with no Remote Control flag (an older page's remoteControl: true is ignored)", JSON.stringify(v));
  await until(async () => ((await svc.tail(v.id, 30)) ?? []).some((l) => l.includes("done-printing")), 6000);
  const tail = ((await svc.tail(v.id, 30)) ?? []).join("\n");
  ok(tail.includes("done-printing") && !leak(tail).length && !tail.includes("REALREALREAL"), "studio_logs: the banner's link (cursor-placed, OSC 8), the session id alone and every other link are removed", tail);
  ok(/remote-control +is +active/.test(tail), "the banner's words themselves stay", tail);
  ok(!("remote" in (svc.list(true).find((x) => x.id === v.id) as any)), "no Remote Control link or state in the terminal's view");
  svc.kill(v.id); await until(() => svc.get(v.id)?.running === false, 5000); await sleep(200);
  const log = readFileSync(join(data, "terminals", `${v.id}.log`), "utf8");
  ok(log.includes("done-printing") && !leak(log).length, "the transcript: every one of them removed", JSON.stringify(log.slice(0, 600)));
  ok(!readFileSync(join(data, "terminals", `${v.id}.json`), "utf8").includes("REALREAL") && !readFileSync(join(data, "terminals", `${v.id}.json`), "utf8").includes("remoteControl"), "the record holds no link and no Remote Control setting");

  // a link wrapped inside a box drawn with heavy, double or full-width bars
  const L = code + "rc-01QRSTUVWXYZABCDEFGHIJKLMNOP";
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
console.log(`\nterminal-link-redaction: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
