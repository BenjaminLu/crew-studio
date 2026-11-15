// The review room's local voice engine: a Node child process Studio starts (src/voice/sidecar.ts) with sherpa-onnx-node
// from its own folder (~/.crew-studio/tools/voice/node_modules, pinned in Doctor's install). Studio writes this file there.
// Protocol: one JSON object per line on stdin and stdout, no port. The room's text arrives on stdin only, never on argv.
//   start   → {"ready":true,"protocol":1,"sherpa":"<version>"}  (or {"ready":false,"error"} and exit 3)
//   {"id","op":"load","config":{…},"idleMs"}  → {"id","ok":true,"sampleRate","speakers","ms"}
//   {"id","op":"tts","text","sid","speed"}    → {"id","ok":true,"sampleRate","pcm":"<16-bit mono PCM, base64>","ms"}
//   {"id","op":"ping"}                         → {"id","ok":true}
// One request at a time, in order. Idle for idleMs (default 10 min) with nothing to do: {"bye":"idle"} and exit 0.
"use strict";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let sherpa, version = null;
try { sherpa = require("sherpa-onnx-node"); try { version = require("sherpa-onnx-node/package.json").version; } catch {} }
catch (e) { out({ ready: false, error: `sherpa-onnx-node could not load: ${String((e && e.message) || e).slice(0, 300)}` }); process.exit(3); }

let tts = null, loadedKey = null, idleMs = 10 * 60_000, timer = null, busy = false, chain = Promise.resolve();
const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (busy) return arm(); out({ bye: "idle" }); process.exit(0); }, idleMs); };

function pcm16(samples) {
  const b = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) { let s = samples[i]; s = s > 1 ? 1 : s < -1 ? -1 : s; b.writeInt16LE(Math.round(s * 32767), i * 2); }
  return b;
}
async function handle(m) {
  const t0 = Date.now();
  if (m.op === "ping") return { ok: true };
  if (m.op === "load") {
    if (Number(m.idleMs) > 0) idleMs = Number(m.idleMs);
    const key = JSON.stringify(m.config);
    if (!tts || loadedKey !== key) { tts = new sherpa.OfflineTts(m.config); loadedKey = key; }
    return { ok: true, sampleRate: tts.sampleRate, speakers: tts.numSpeakers, ms: Date.now() - t0 };
  }
  if (m.op === "tts") {
    if (!tts) return { ok: false, error: "no model loaded" };
    const text = String(m.text || "");
    if (!text || text.length > 2000) return { ok: false, error: "text is empty or longer than 2000 characters" };
    const sid = Number(m.sid) | 0, speed = Number(m.speed) > 0 ? Number(m.speed) : 1;
    if (sid < 0 || sid >= tts.numSpeakers) return { ok: false, error: `no speaker ${sid}` };
    const a = await tts.generateAsync({ text, sid, speed, enableExternalBuffer: false });
    return { ok: true, sampleRate: a.sampleRate, pcm: pcm16(a.samples).toString("base64"), ms: Date.now() - t0 };
  }
  return { ok: false, error: `unknown op ${String(m.op).slice(0, 20)}` };
}
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { out({ ok: false, error: "not JSON" }); continue; }
    arm();
    chain = chain.then(async () => { busy = true; try { out({ id: m.id, ...(await handle(m)) }); } catch (e) { out({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 300) }); } finally { busy = false; arm(); } });
  }
});
process.stdin.on("end", () => chain.then(() => process.exit(0)));
out({ ready: true, protocol: 1, sherpa: version });
arm();
