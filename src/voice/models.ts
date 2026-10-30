// The review room's local neural voice: where its pinned model is, and whether a copy is the pinned one.
// Kokoro-82M v1.0 (Apache-2.0) as exported for sherpa-onnx, at one Hugging Face revision. A copy is used only when its
// .complete marker names that revision and every file the engine reads has the pinned size and SHA-256
// (kokoro-manifest.json). Two places are looked at, in order: Agent Wardrobe's copy, read only (Studio never writes
// into it, not even a cache), then Studio's own (~/.crew-studio/models), which only the captain's click in Doctor
// downloads. Hashing ~380 MB takes about a second; the result is remembered in Studio's models folder by each file's
// size and mtime, so a copy that changes is hashed again.
//   CREW_VOICE_MODELS    Studio's models folder (tests: a temp folder)
//   CREW_VOICE_WARDROBE  Agent Wardrobe's models folder, or "none" (tests)
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import manifest from "./kokoro-manifest.json";

export const KOKORO = {
  name: "kokoro-multi-lang-v1_0",
  repo: manifest.repo as string,
  revision: manifest.revision as string,
  files: manifest.files as [string, number, string][],
  licence: "Apache-2.0",
  /** the four largest files, pinned here too: the manifest and the code must agree */
  pins: {
    "model.onnx": "b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11",
    "voices.bin": "1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29",
    "lexicon-us-en.txt": "7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14",
    "lexicon-zh.txt": "902bc2d20ac7c449c5ecbbbb23c89d12119c03ed5b8ed27f114f0260c9e35229",
  } as Record<string, string>,
};
export const kokoroBytes = () => KOKORO.files.reduce((n, f) => n + f[1], 0);
export const fileUrl = (path: string) => `https://huggingface.co/${KOKORO.repo}/resolve/${KOKORO.revision}/${path.split("/").map(encodeURIComponent).join("/")}`;

export const studioModels = () => process.env.CREW_VOICE_MODELS || join(homedir(), ".crew-studio", "models");
/** Agent Wardrobe keeps its models in its Electron userData folder (macOS: ~/Library/Application Support/<app name>) */
export const wardrobeModels = () => process.env.CREW_VOICE_WARDROBE === "none" ? null
  : process.env.CREW_VOICE_WARDROBE || (process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Agent Wardrobe", "models") : null);

export type Verdict = { ok: true; dir: string } | { ok: false; dir: string; state: "missing" | "incomplete" | "corrupt"; why: string; bad?: string[] };
type Memo = Record<string, { revision: string; stamp: string }>;
const memoFile = () => join(studioModels(), ".verified.json");
const readMemo = (): Memo => { try { return JSON.parse(readFileSync(memoFile(), "utf8")); } catch { return {}; } };
function writeMemo(m: Memo) { try { mkdirSync(studioModels(), { recursive: true }); writeFileSync(memoFile() + ".tmp", JSON.stringify(m)); renameSync(memoFile() + ".tmp", memoFile()); } catch {} }

const inside = (dir: string, rel: string) => { const p = normalize(join(dir, rel)); return p.startsWith(normalize(dir) + sep) ? p : null; };
function sha256(file: string) {
  const h = createHash("sha256"), fd = openSync(file, "r"), buf = Buffer.allocUnsafe(1 << 22);
  try { let n; while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { closeSync(fd); }
  return h.digest("hex");
}

/** Is dir the pinned model? Reads only: never writes into dir (the memo lives in Studio's own models folder). */
export type Spec = { revision: string; files: [string, number, string][] };
export function verifyModel(dir: string, o: { memo?: boolean; spec?: Spec } = {}): Verdict {
  const spec = o.spec ?? KOKORO;
  if (!existsSync(dir)) return { ok: false, dir, state: "missing", why: "not found" };
  let mark = ""; try { mark = readFileSync(join(dir, ".complete"), "utf8").trim(); } catch {}
  if (!mark) return { ok: false, dir, state: "incomplete", why: "no .complete marker: the download did not finish" };
  if (mark !== spec.revision) return { ok: false, dir, state: "corrupt", why: `the .complete marker names another revision (${mark.slice(0, 12)})` };
  const stats: string[] = [], missing: string[] = [];
  for (const [rel, size] of spec.files) {
    const p = inside(dir, rel); if (!p) return { ok: false, dir, state: "corrupt", why: `a manifest path leaves the folder: ${rel}` };
    try { const s = statSync(p); if (!s.isFile() || s.size !== size) { missing.push(rel); continue; } stats.push(`${rel}:${s.size}:${s.mtimeMs}`); } catch { missing.push(rel); }
  }
  if (missing.length) return { ok: false, dir, state: "corrupt", why: `${missing.length} file(s) missing or of the wrong size (${missing.slice(0, 3).join(", ")})`, bad: missing };
  const stamp = createHash("sha256").update(stats.join("\n")).digest("hex"), memo = o.memo === false ? {} : readMemo();
  if (memo[dir]?.revision === spec.revision && memo[dir].stamp === stamp) return { ok: true, dir };
  const bad: string[] = [];
  for (const [rel, , want] of spec.files) if (sha256(join(dir, rel)) !== want) bad.push(rel);
  if (bad.length) return { ok: false, dir, state: "corrupt", why: `${bad.length} file(s) do not match the pinned SHA-256 (${bad.slice(0, 3).join(", ")})`, bad };
  if (o.memo !== false) writeMemo({ ...readMemo(), [dir]: { revision: spec.revision, stamp } });
  return { ok: true, dir };
}

export type Source = "agent-wardrobe" | "studio";
export type Found = { ok: true; dir: string; source: Source } | { ok: false; tried: (Verdict & { source: Source })[] };
let cached: { at: number; v: Found } | null = null;
/** The pinned model on this Mac: Agent Wardrobe's copy when it verifies, else Studio's own. Kept 60 s (fresh: look again). */
export function findKokoro(fresh = false, spec?: Spec): Found {
  if (!fresh && !spec && cached && Date.now() - cached.at < 60_000) return cached.v;
  const tried: (Verdict & { source: Source })[] = [], aw = wardrobeModels();
  const places: [string, Source][] = [...(aw ? [[join(aw, KOKORO.name), "agent-wardrobe"] as [string, Source]] : []), [join(studioModels(), KOKORO.name), "studio"]];
  let v: Found = { ok: false, tried };
  for (const [dir, source] of places) { const r = verifyModel(dir, { spec }); if (r.ok) { v = { ok: true, dir, source }; break; } tried.push({ ...r, source }); }
  if (!spec) cached = { at: Date.now(), v }; return v;
}
export const forgetFound = () => { cached = null; };

/** the engine's paths inside a verified folder (as agent-wardrobe and sherpa-onnx's own examples load it) */
export function kokoroConfig(dir: string, threads = 2) {
  const k = (n: string) => join(dir, n);
  return { model: { kokoro: { model: k("model.onnx"), voices: k("voices.bin"), tokens: k("tokens.txt"), dataDir: k("espeak-ng-data"), dictDir: k("dict"), lexicon: `${k("lexicon-us-en.txt")},${k("lexicon-zh.txt")}` }, numThreads: threads, provider: "cpu" },
    ruleFsts: `${k("date-zh.fst")},${k("phone-zh.fst")},${k("number-zh.fst")}`, maxNumSentences: 1 };
}
