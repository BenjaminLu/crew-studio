// The review room's local neural voice ("kokoro"): Kokoro-82M through Studio's sidecar, behind the room's Speaker seam.
// Nothing leaves this Mac (a child process, stdio only, no network), so unlike the vendor voice it is not tied to the
// tutor's vendor: any tutor's points can be spoken with it. A point is one clip; mixed Chinese and English is cut into
// runs (runs.ts), each spoken by its language's voice, and the runs are joined into one WAV.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findKokoro, KOKORO, kokoroBytes, kokoroConfig } from "./models";
import { DEFAULT_VOICE, MIXES, SPEAKERS, splitRuns, type Mix } from "./runs";
import { ensureScripts, runtimeState, SHERPA_VERSION, SIDECAR_PROTOCOL, voiceTools, type RuntimeState } from "./runtime";
import { Sidecar, scriptIn } from "./sidecar";
import { trimSilence, wav } from "./wav";

import type { Speaker } from "../domain/review-room";
export type Synth = { tts(text: string, sid: number, speed?: number): Promise<{ pcm: Buffer; sampleRate: number }> };
export type Voices = { zh: string; en: string };
/** what a clip depends on besides its text and voices: the model's revision, the runtime's version, Studio's rules */
export const ENGINE_VERSION = `kokoro-multi-lang-v1_0@${KOKORO.revision.slice(0, 12)}/sherpa-onnx-node@${SHERPA_VERSION}/studio-${SIDECAR_PROTOCOL}`;
export const MAX_POINT = 1200;

/** A Speaker for one room language and mix mode: each run by its voice, joined with a short breath between voices. */
export function kokoroSpeaker(synth: Synth, o: { lang: "zh" | "en"; mode: Mix; voices?: Voices }): Speaker {
  const voices = { ...DEFAULT_VOICE, ...(o.voices ?? {}) };
  return async (text, signal) => {
    const runs = splitRuns(text, o.mode, o.lang); if (!runs.length) throw new Error("nothing to say");
    const chunks: Buffer[] = []; let rate = 24000;
    for (const r of runs) {
      if (signal.aborted) throw new Error("stopped");
      const sid = SPEAKERS[voices[r.lang]]; if (sid == null) throw new Error(`no such voice ${voices[r.lang]}`);
      const out = await synth.tts(r.text, sid); rate = out.sampleRate; chunks.push(runs.length > 1 ? trimSilence(out.pcm, out.sampleRate) : out.pcm);
    }
    const used = [...new Set(runs.map((r) => voices[r.lang]))];
    return { bytes: wav(chunks, rate, runs.length > 1 ? 60 : 0), model: KOKORO.name, voice: used.join("+") };
  };
}

/** a clip's file name: its text, voices, mix mode, room language and engine version, hashed */
export function clipName(text: string, o: { lang: "zh" | "en"; mode: Mix; voices: Voices; engine?: string }) {
  const key = JSON.stringify([o.engine ?? ENGINE_VERSION, o.lang, o.mode, o.voices.zh, o.voices.en, text]);
  return `kvoice-${createHash("sha256").update(key).digest("hex").slice(0, 16)}.wav`;
}
export const CLIP_NAME = /^kvoice-[0-9a-f]{16}\.wav$/;
/** clips a room keeps at most; the oldest go first */
export const MAX_CLIPS = 400;

const inflight = new Map<string, Promise<{ name: string; cached: boolean; voice: string }>>();
/** One point's clip in a room folder: made once (two requests at once make one), then served from the folder. */
export async function roomClip(dir: string, text: string, o: { lang: "zh" | "en"; mode: Mix; voices?: Voices; speaker: Speaker; engine?: string; timeoutMs?: number; alive?: () => boolean }) {
  const voices = { ...DEFAULT_VOICE, ...(o.voices ?? {}) }, t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_POINT);
  if (!MIXES.includes(o.mode)) throw new Error("unknown mix mode");
  const name = clipName(t, { lang: o.lang, mode: o.mode, voices, engine: o.engine }), f = join(dir, name), key = f;
  if (existsSync(f)) return { name, cached: true, voice: "" };
  const running = inflight.get(key); if (running) return running;
  const job = (async () => {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 120_000);
    try { const out = await o.speaker(t, ac.signal);
      if (o.alive && !o.alive()) throw Object.assign(new Error("The room was started over"), { code: "reset" });
      if (out.bytes.length < 64 || out.bytes.length > 50_000_000) throw new Error("the voice came back empty or too large");
      mkdirSync(dir, { recursive: true }); writeFileSync(f + ".tmp", out.bytes); renameSync(f + ".tmp", f); prune(dir);
      return { name, cached: false, voice: out.voice }; }
    finally { clearTimeout(timer); }
  })();
  inflight.set(key, job); try { return await job; } finally { inflight.delete(key); }
}
function prune(dir: string) {
  try { const all = readdirSync(dir).filter((n) => CLIP_NAME.test(n)); if (all.length <= MAX_CLIPS) return;
    all.map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(0, all.length - MAX_CLIPS).forEach((x) => { try { unlinkSync(join(dir, x.n)); } catch {} }); } catch {}
}
export function readClip(dir: string, name: string): Buffer | null { if (!CLIP_NAME.test(name)) return null; const f = join(dir, name); return existsSync(f) ? readFileSync(f) : null; }

// ---------- this Mac's engine: the sidecar, started on the first clip, one synthesis at a time ----------
export type VoiceStatus = { ready: boolean; engine: string; voices: Voices; runtime: RuntimeState; model: { ok: boolean; source: string | null; why: string | null }; licence: string };
let engine: { sidecar: Sidecar; dir: string } | null = null;
export function voiceStatus(fresh = false): VoiceStatus {
  const runtime = runtimeState(), m = findKokoro(fresh);
  return { ready: runtime.ok && m.ok, engine: ENGINE_VERSION, voices: { ...DEFAULT_VOICE }, runtime, licence: "Kokoro-82M Apache-2.0; sherpa-onnx Apache-2.0",
    model: m.ok ? { ok: true, source: m.source, why: null } : { ok: false, source: null, why: m.tried.map((t) => `${t.source === "agent-wardrobe" ? "Agent Wardrobe" : "Studio"}: ${t.ok ? "" : t.why}`).join("; ") } };
}
/** the local engine as a Synth, or why it cannot speak */
export function localSynth(): Synth {
  const runtime = runtimeState(), m = findKokoro();
  if (!runtime.ok) throw Object.assign(new Error(`The local voice is not installed: ${runtime.why} (Doctor → Voice)`), { code: "no_voice" });
  if (!m.ok) throw Object.assign(new Error("The local voice model is not on this Mac (Doctor → Voice)"), { code: "no_voice" });
  if (!engine || engine.dir !== m.dir) {
    engine?.sidecar.stop(); ensureScripts();
    engine = { dir: m.dir, sidecar: new Sidecar({ node: runtime.node!, script: scriptIn(voiceTools()), config: kokoroConfig(m.dir), idleMs: 10 * 60_000 }) };
  }
  return engine.sidecar;
}
export const stopLocal = () => { engine?.sidecar.stop(); engine = null; };

/** what Doctor shows for the local voice (src/doctor.ts voiceItems); Studio's own scripts are put in place first, so the
 *  download Doctor offers can run */
export function voiceDoctorInput(mac: import("./mac").MacVoice[] | null) {
  ensureScripts();
  const runtime = runtimeState(), m = findKokoro(true);
  const state = m.ok ? null : m.tried.some((t) => !t.ok && t.state === "corrupt") ? "corrupt" : m.tried.some((t) => !t.ok && t.state === "incomplete") ? "incomplete" : "missing";
  const why = m.ok ? null : m.tried.filter((t) => !t.ok && t.state !== "missing").map((t) => `${t.source === "agent-wardrobe" ? "Agent Wardrobe's copy" : "Studio's copy"}: ${t.ok ? "" : t.why}`).join("; ") || null;
  return { runtime, model: { ok: m.ok, source: m.ok ? m.source : null, state, why }, bytes: kokoroBytes(), voices: { ...DEFAULT_VOICE }, mac };
}
