// Board-to-board work, locally: two Studios on two ports (bun src/server.ts each, its own temporary CREW_DATA and HOME,
// a free main port, a free peer port on loopback, the OS sandbox and egress proxy on, the stub provider CLIs), introduced
// to each other and taken through the whole relay, printing every hand-off (docs/units/lan-relay.md).
//   bun scripts/lan-pair-demo.ts            LAN_DEMO_KEEP=1 keeps both Studios running until Ctrl-C (open them with the
//                                            printed session links), and keeps their temporary folders
// The short code is confirmed automatically in this script only; a real introduction is two people reading it aloud.
// It never reads or writes ./data and never talks to a Studio it did not start.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// the operator's .env never reaches the two Studios: what Bun loaded from it is dropped, and every child starts without one
for (const f of [join(process.cwd(), ".env"), join(import.meta.dir, "..", ".env")]) if (existsSync(f))
  for (const line of readFileSync(f, "utf8").split("\n")) { const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line); if (m) delete process.env[m[1]]; }
process.env.BUN_OPTIONS = `${(process.env.BUN_OPTIONS ?? "").replace(/--env-file(=|\s+)\S+/g, "")} --no-env-file`.trim();
for (const k of ["CREW_DATA", "CREW_PORT", "CREW_LOCAL_UNRESTRICTED", "CREW_LOCAL_DEPENDENCY_ROOT", "CREW_GH"]) delete process.env[k];
// the vendors' real CLIs are never reached (the Studios use the stub CLIs): a folder first on PATH answers for them and fails
{ const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const bin = mkdtempSync(join(tmpdir(), "crew-lan-demo-bin-"));
  for (const n of ["claude", "codex", "cursor-agent", "agent"]) { writeFileSync(join(bin, n), "#!/bin/sh\necho 'the LAN demo never runs a real vendor CLI' >&2\nexit 97\n"); chmodSync(join(bin, n), 0o755); }
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`; }
const { bootPair, codeRelay, introduce, relay } = await import("../tests/lan/flow");

const out = (s: string) => console.log(s);
out("兩台 Studio：各自的暫存資料夾、各自的主埠與 LAN 埠、OS sandbox 開啟、stub provider");
const p = await bootPair();
let code = 0;
try {
  out(`  Studio A  ${p.A.base}  LAN 127.0.0.1:${p.lanA}`);
  out(`  Studio B  ${p.B.base}  LAN 127.0.0.1:${p.lanB}`);
  out("");
  await introduce(p, out);
  out("");
  out("交接（每一步都要桌面上的人核准；本腳本代為按下）：");
  const r = await relay(p, out);
  out("");
  out(`完成：thread ${r.thread}，B 跑了 ${r.runs.join(" 與 ")}，A 已結案。`);
  out("");
  out("程式流程（B 用自己的 code-firstmate，在自己的 worktree；交回一份 patch，A 套用到自己的專案分支）：");
  const c = await codeRelay(p, out);
  out(`完成：thread ${c.thread}，B 的 ${c.run} 停在本機 lan-untrusted/ 分支（沒有 push、PR、merge），A 的分支 ${c.applied.branch}。`);
  if (process.env.LAN_DEMO_KEEP) {
    for (const s of [p.A, p.B]) out(`  ${s.name}: ${s.base}/session?t=${encodeURIComponent(`acceptance-${s.name}-session`)}#/lan`);
    out("兩台都還在跑；Ctrl-C 結束。"); await new Promise(() => {});
  }
} catch (e: any) { code = 1; console.error(`失敗：${e?.message ?? e}`); for (const s of [p.A, p.B]) console.error(`--- ${s.name} log (tail)\n${s.output().slice(-3000)}`); }
finally { if (!process.env.LAN_DEMO_KEEP) await p.close(); }
process.exit(code);
