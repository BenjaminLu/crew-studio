import "../lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Two Studios for tests/lan-ui.mjs (a Node suite with Playwright): booted here with the same settings as the relay suite,
// described on stdout as one JSON line, stopped when stdin closes. LAN_UI_PAIRED=1 introduces them first (through the API).
import { bootPair, introduce } from "./flow";

const p = await bootPair();
if (process.env.LAN_UI_PAIRED === "1") await introduce(p);
console.log(JSON.stringify({ A: { base: p.A.base, token: "acceptance-lan-a-session", data: p.A.data }, B: { base: p.B.base, token: "acceptance-lan-b-session", data: p.B.data }, lanA: p.lanA, lanB: p.lanB, keyA: p.keyA, keyB: p.keyB }));
process.stdin.resume();
const stop = async () => { await p.close(); process.exit(0); };
process.stdin.on("end", stop); process.stdin.on("close", stop); process.on("SIGTERM", stop);
