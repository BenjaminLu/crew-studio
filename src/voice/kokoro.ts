// The review room's local neural voice ("kokoro"): Kokoro-82M through Studio's sidecar, behind the room's Speaker seam.
// Nothing leaves this Mac (a child process, stdio only, no network), so unlike the vendor voice it is not tied to the
// tutor's vendor: any tutor's points can be spoken with it. A point is one clip; mixed Chinese and English is cut into
// runs (runs.ts), each spoken by its language's voice, and the runs are joined into one WAV. Clips are bounded: by
// bytes per room and across every room, the least recently played going first.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findKokoro, KOKORO, kokoroBytes, kokoroConfig, type Found } from "./models";
import { DEFAULT_VOICE, MIXES, SPEAKERS, splitRuns, type Mix } from "./runs";
import { ensureScripts, runtimeState, SHERPA_VERSION, SIDECAR_PROTOCOL, voiceTools, type RuntimeState } from "./runtime";
import { Sidecar, scriptIn } from "./sidecar";
import { trimSilence, wav } from "./wav";

import type { Speaker } from "../domain/review-room";
export type Synth = { tts(text: string, sid: number, speed?: number, signal?: AbortSignal): Promise<{ pcm: Buffer; sampleRate: number }> };
export type Voices = { zh: string; en: string };
/** what a clip depends on besides its text and voices: the model's revision, the runtime's version, Studio's rules */
export const ENGINE_VERSION = `kokoro-multi-lang-v1_0@${KOKORO.revision.slice(0, 12)}/sherpa-onnx-node@${SHERPA_VERSION}/studio-${SIDECAR_PROTOCOL}`;
/** the longest point the voice takes (a point on the board is a sentence or two; the room's own limit is far lower) */
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
      const out = await synth.tts(r.text, sid, 1, signal); rate = out.sampleRate; chunks.push(runs.length > 1 ? trimSilence(out.pcm, out.sampleRate) : out.pcm);
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

// ---------- the clips' bounds: bytes per room and across rooms, least recently used first ----------
export const CLIP_LIMITS = { room: 50 * 1024 ** 2, total: 200 * 1024 ** 2 };
type Entry = { size: number; at: number };
/** Every clip Studio made, by its file, with its size and when it was last made or played; kept in Studio's data folder. */
export class ClipStore {
  private all: Record<string, Entry>;
  constructor(readonly file: string, readonly limits = CLIP_LIMITS) { try { this.all = JSON.parse(readFileSync(file, "utf8")); } catch { this.all = {}; } }
  private save() { try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file + ".tmp", JSON.stringify(this.all)); renameSync(this.file + ".tmp", this.file); } catch {} }
  private drop(f: string) { try { unlinkSync(f); } catch {} delete this.all[f]; }
  get bytes() { return Object.values(this.all).reduce((n, e) => n + e.size, 0); }
  add(f: string, size: number) { this.all[f] = { size, at: Date.now() }; this.enforce(f); this.save(); }
  touch(f: string) { const e = this.all[f]; if (e) { e.at = Date.now(); this.save(); } }
  /** a room's clips go with it (started over): deleted, never archived */
  dropDir(dir: string) { for (const n of (() => { try { return readdirSync(dir); } catch { return []; } })()) if (CLIP_NAME.test(n)) this.drop(join(dir, n)); for (const f of Object.keys(this.all)) if (dirname(f) === dir) delete this.all[f]; this.save(); }
  private enforce(keep: string) {
    for (const f of Object.keys(this.all)) if (!existsSync(f)) delete this.all[f];
    const old = () => Object.entries(this.all).filter(([f]) => f !== keep).sort((a, b) => a[1].at - b[1].at);
    const room = dirname(keep), inRoom = () => Object.entries(this.all).filter(([f]) => dirname(f) === room).reduce((n, [, e]) => n + e.size, 0);
    for (const [f] of old().filter(([f]) => dirname(f) === room)) { if (inRoom() <= this.limits.room) break; this.drop(f); }
    for (const [f] of old()) { if (this.bytes <= this.limits.total) break; this.drop(f); }
  }
  has(f: string) { return !!this.all[f]; }
}
let defaultStore: ClipStore | null = null;
export const clipStore = (dataDir: string) => (defaultStore && defaultStore.file === join(dataDir, "voice-clips.json") ? defaultStore : (defaultStore = new ClipStore(join(dataDir, "voice-clips.json"))));

const inflight = new Map<string, Promise<{ name: string; cached: boolean; voice: string }>>();
/** One point's clip in a room folder: made once (two requests at once make one), then served from the folder. */
export async function roomClip(dir: string, text: string, o: { lang: "zh" | "en"; mode: Mix; voices?: Voices; speaker: Speaker; store: ClipStore; engine?: string; timeoutMs?: number; alive?: () => boolean; signal?: AbortSignal }) {
  const voices = { ...DEFAULT_VOICE, ...(o.voices ?? {}) }, t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!MIXES.includes(o.mode)) throw new Error("unknown mix mode");
  if (t.length > MAX_POINT) throw Object.assign(new Error(`A point to speak is at most ${MAX_POINT} characters`), { code: "too_long" });
  const name = clipName(t, { lang: o.lang, mode: o.mode, voices, engine: o.engine }), f = join(dir, name), key = f;
  if (existsSync(f)) { o.store.touch(f); return { name, cached: true, voice: "" }; }
  const running = inflight.get(key); if (running) return running;
  const job = (async () => {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 120_000), stop = () => ac.abort();
    o.signal?.addEventListener("abort", stop);
    try { const out = await o.speaker(t, ac.signal);
      if (o.alive && !o.alive()) throw Object.assign(new Error("The room was started over"), { code: "reset" });
      if (out.bytes.length < 64 || out.bytes.length > 50_000_000) throw new Error("the voice came back empty or too large");
      mkdirSync(dir, { recursive: true }); writeFileSync(f + ".tmp", out.bytes); renameSync(f + ".tmp", f); o.store.add(f, out.bytes.length);
      return { name, cached: false, voice: out.voice }; }
    finally { clearTimeout(timer); o.signal?.removeEventListener("abort", stop); }
  })();
  inflight.set(key, job); try { return await job; } finally { inflight.delete(key); }
}
export function readClip(dir: string, name: string, store?: ClipStore): Buffer | null {
  if (!CLIP_NAME.test(name)) return null; const f = join(dir, name); if (!existsSync(f)) return null; store?.touch(f); return readFileSync(f);
}

// ---------- this Mac's engine: the sidecar, started on the first clip, one synthesis at a time ----------
let engine: { sidecar: Sidecar; dir: string } | null = null;
const modelWhy = (m: Found) => m.ok ? null : m.tried.filter((t) => !t.ok && t.state !== "missing").map((t) => `${t.source === "agent-wardrobe" ? "Agent Wardrobe's copy" : "Studio's copy"}: ${t.ok ? "" : t.why}`).join("; ") || null;
/** Can the room speak with it? Only booleans, versions and voice names: no path of this Mac. */
export async function voiceStatus(fresh = false) {
  const runtime = runtimeState(), m = await findKokoro(fresh);
  return { ready: runtime.ok && m.ok, engine: ENGINE_VERSION, voices: { ...DEFAULT_VOICE }, licence: "Kokoro-82M Apache-2.0; sherpa-onnx Apache-2.0",
    runtime: { ok: runtime.ok, version: runtime.version }, model: { ok: m.ok, source: m.ok ? m.source : null }, crashing: !!engine?.sidecar.crashing };
}
/** the local engine as a Synth, or why it cannot speak; Studio's own scripts are put in place now (a captain's action) */
export async function localSynth(): Promise<Synth> {
  const runtime = runtimeState(), m = await findKokoro();
  if (!runtime.ok) throw Object.assign(new Error(`The local voice is not installed: ${runtime.why} (Doctor → Voice)`), { code: "no_voice" });
  if (!m.ok) throw Object.assign(new Error("The local voice model is not on this Mac (Doctor → Voice)"), { code: "no_voice" });
  if (!engine || engine.dir !== m.dir) {
    engine?.sidecar.stop(); ensureScripts();
    engine = { dir: m.dir, sidecar: new Sidecar({ node: runtime.node!, script: scriptIn(voiceTools()), config: kokoroConfig(m.dir), reads: [m.dir], idleMs: 10 * 60_000 }) };
  }
  return engine.sidecar;
}
/** Studio is stopping: the engine goes with it */
export const stopLocal = () => { engine?.sidecar.stop(); engine = null; };

/** what Doctor shows for the local voice (src/doctor.ts voiceItems); reads only */
export async function voiceDoctorInput(mac: import("./mac").MacVoice[] | null) {
  const runtime = runtimeState(), m = await findKokoro(true);
  const state = m.ok ? null : m.tried.some((t) => !t.ok && t.state === "corrupt") ? "corrupt" : m.tried.some((t) => !t.ok && t.state === "incomplete") ? "incomplete" : "missing";
  return { runtime, model: { ok: m.ok, source: m.ok ? m.source : null, state, why: modelWhy(m) }, bytes: kokoroBytes(), voices: { ...DEFAULT_VOICE }, mac, crashing: !!engine?.sidecar.crashing };
}
