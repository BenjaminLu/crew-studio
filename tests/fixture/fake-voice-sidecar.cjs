// A stand-in for src/voice/sidecar.cjs in tests: the same stdio JSON protocol, no model. It answers requests as they come
// (not one at a time), so a client that sent two at once would show it in "most"; "seen" lists the texts that reached it.
// Text "HANG" never gets an answer, "SLOW" takes 600 ms, "CRASH" stops the process, "PROBE" tries what the load
// config's probe names (a file to read, a program to run, a loopback port) and reports what happened.
"use strict";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let idleMs = 60_000, timer = null, inflight = 0, most = 0, loaded = null; const seen = [];
const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (inflight) return arm(); out({ bye: "idle" }); process.exit(0); }, idleMs); };
async function handle(m) {
  if (m.op === "ping") return { ok: true, argv: process.argv.slice(1), env: Object.keys(process.env).sort(), most, loaded, seen };
  if (m.op === "load") { if (Number(m.idleMs) > 0) idleMs = Number(m.idleMs); loaded = m.config; return { ok: true, sampleRate: 24000, speakers: 53, ms: 1 }; }
  if (m.op !== "tts") return { ok: false, error: "unknown op" };
  const text = String(m.text || ""); seen.push(text);
  if (text === "HANG") return new Promise(() => {});
  if (text === "CRASH") process.exit(5);
  if (text === "PROBE") {
    const p = (loaded && loaded.probe) || {}, r = { read: "allowed", exec: "allowed", net: "allowed" };
    try { require("node:fs").readFileSync(p.read || "/etc/hosts"); } catch (e) { r.read = String(e.code || e.message); }
    try { require("node:child_process").execFileSync(p.exec || "/bin/echo", ["hi"]); } catch (e) { r.exec = String(e.code || e.message); }
    try { await fetch(`http://127.0.0.1:${p.port || 9}/`); } catch (e) { r.net = String((e && e.cause && e.cause.code) || (e && e.message) || e); }
    try { require("node:fs").writeFileSync(require("node:path").join(require("node:os").tmpdir(), `fake-voice-${process.pid}`), "x"); r.write = "allowed"; } catch (e) { r.write = String(e.code || e.message); }
    return { ok: true, sampleRate: 24000, pcm: "", ms: 0, ...r };
  }
  await new Promise((r) => setTimeout(r, text === "SLOW" ? 600 : 25));
  // samples of 1000 + the speaker id: the test can tell which voice spoke which run
  const b = Buffer.alloc(text.length * 2 * 4); for (let i = 0; i < text.length * 4; i++) b.writeInt16LE(1000 + (Number(m.sid) || 0), i * 2);
  return { ok: true, sampleRate: 24000, pcm: b.toString("base64"), ms: 25, echo: text, sid: m.sid };
}
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); arm();
  inflight++; most = Math.max(most, inflight); handle(m).then((r) => { inflight--; out({ id: m.id, ...r }); arm(); }, (e) => { inflight--; out({ id: m.id, ok: false, error: String(e) }); }); } });
out({ ready: true, protocol: 1, sherpa: "fake" });
arm();
