import "../tests/lib/isolated-env.mjs"; // first: never the operator's .env, never the live data folder or port
// Board-to-board work, locally: two Studios on two ports (bun src/server.ts each, its own temporary CREW_DATA and HOME,
// a free main port, a free peer port on loopback, the OS sandbox and egress proxy on, the stub provider CLIs), introduced
// to each other and taken through the whole relay, printing every hand-off (docs/units/lan-relay.md).
//   bun scripts/lan-pair-demo.ts            LAN_DEMO_KEEP=1 keeps both Studios running until Ctrl-C (open them with the
//                                            printed session links), and keeps their temporary folders
// The short code is confirmed automatically in this script only; a real introduction is two people reading it aloud.
// It never reads or writes ./data and never talks to a Studio it did not start.
import { bootPair, introduce, relay } from "../tests/lan/flow";

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
  if (process.env.LAN_DEMO_KEEP) {
    for (const s of [p.A, p.B]) out(`  ${s.name}: ${s.base}/session?t=${encodeURIComponent(`acceptance-${s.name}-session`)}#/lan`);
    out("兩台都還在跑；Ctrl-C 結束。"); await new Promise(() => {});
  }
} catch (e: any) { code = 1; console.error(`失敗：${e?.message ?? e}`); for (const s of [p.A, p.B]) console.error(`--- ${s.name} log (tail)\n${s.output().slice(-3000)}`); }
finally { if (!process.env.LAN_DEMO_KEEP) await p.close(); }
process.exit(code);
