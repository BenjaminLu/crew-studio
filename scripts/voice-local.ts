// Opt-in, never in CI: speak a few sentences with this Mac's real local voice (Studio's sidecar, its pinned
// sherpa-onnx-node and the verified Kokoro model) and print the timings. It proves the integration end to end on a Mac
// where Doctor's voice rows are green; nothing leaves the Mac and nothing is written outside the output folder (and the
// verification memo in Studio's models folder).
//   bun scripts/voice-local.ts [out-dir]
//   CREW_VOICE_TOOLS / CREW_VOICE_MODELS / CREW_VOICE_WARDROBE  as in src/voice (default: Studio's own folders)
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findKokoro, kokoroConfig } from "../src/voice/models";
import { kokoroSpeaker } from "../src/voice/kokoro";
import { ensureScripts, runtimeState, voiceTools } from "../src/voice/runtime";
import { Sidecar, scriptIn } from "../src/voice/sidecar";
import { wavInfo } from "../src/voice/wav";

const out = process.argv[2] || mkdtempSync(join(tmpdir(), "crew-voice-local-")); mkdirSync(out, { recursive: true });
const rt = runtimeState(); if (!rt.ok) { console.error(`voice runtime not ready: ${rt.why} (Doctor → Voice)`); process.exit(2); }
let t = Date.now(); const m = findKokoro(true); const verifyMs = Date.now() - t;
if (!m.ok) { console.error(`no verified Kokoro model: ${m.tried.map((x) => (x.ok ? "" : `${x.source}: ${x.why}`)).join("; ")}`); process.exit(2); }
ensureScripts();
const sc = new Sidecar({ node: rt.node!, script: scriptIn(voiceTools()), config: kokoroConfig(m.dir), idleMs: 60_000 });
console.log(`model: ${m.source} (verified in ${verifyMs} ms); runtime: sherpa-onnx-node ${rt.version} under ${rt.node}`);
const cases: [string, "zh" | "en", "switch" | "same", string][] = [
  ["zh-switch", "zh", "switch", "這個 PR 修好了 GitHub 的 diff 引用，審查室現在用本機的神經語音。"],
  ["zh-same", "zh", "same", "這個 PR 修好了 GitHub 的 diff 引用，審查室現在用本機的神經語音。"],
  ["zh-plain", "zh", "switch", "這個改動把審查室的語音換成本機的神經語音。"],
  ["en", "en", "switch", "This change moves the review room to a local neural voice."]];
for (const [name, lang, mode, text] of cases) {
  t = Date.now(); const first = sc.starts === 0;
  const r = await kokoroSpeaker(sc, { lang, mode })(text, new AbortController().signal); const ms = Date.now() - t, info = wavInfo(r.bytes)!;
  writeFileSync(join(out, `${name}.wav`), r.bytes);
  console.log(`${name.padEnd(9)} ${String(ms).padStart(5)} ms${first ? ` (incl. start ${sc.info.loadMs} ms load)` : ""}  audio ${info.seconds.toFixed(2)} s  RTF ${(ms / 1000 / info.seconds).toFixed(2)}  ${r.voice}  ${text}`);
}
sc.stop();
console.log(`WAVs in ${out}`);
