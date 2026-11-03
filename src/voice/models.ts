// The review room's local neural voice: where its pinned model is, and whether a copy is the pinned one.
// Kokoro-82M v1.0 (Apache-2.0) as exported for sherpa-onnx, at one Hugging Face revision. A copy is used only when its
// .complete marker names that revision and every file the engine reads has the pinned size and SHA-256
// (kokoro-manifest.json). Two places are looked at, in order: Agent Wardrobe's copy, read only (Studio never writes
// into it, not even a cache), then Studio's own (~/.crew-studio/models), which only the captain's click in Doctor
// downloads. Another app's folder is not trusted to be well formed: the folder must be a real directory, every file
// in it a regular file (no symlink, FIFO or device; lstat first, then opened without following links and without
// blocking), the marker small; files are hashed streamed and asynchronously, so a check never stalls Studio.
// The verdict, good or bad, is remembered in Studio's models folder by each file's size, mtime, inode and ctime, so an
// unchanged copy is not hashed again and a changed one always is.
//   CREW_VOICE_MODELS    Studio's models folder (tests: a temp folder)
//   CREW_VOICE_WARDROBE  Agent Wardrobe's models folder, or "none" (tests)
import { createHash } from "node:crypto";
import { constants, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
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

export const studioModels = () => process.env.CREW_VOICE_MODELS || join(homedir(), ".crew-studio", "models");
/** Agent Wardrobe keeps its models in its Electron userData folder (macOS: ~/Library/Application Support/<app name>) */
export const wardrobeModels = () => process.env.CREW_VOICE_WARDROBE === "none" ? null
  : process.env.CREW_VOICE_WARDROBE || (process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Agent Wardrobe", "models") : null);

export type State = "missing" | "incomplete" | "corrupt";
export type Verdict = { ok: true; dir: string } | { ok: false; dir: string; state: State; why: string; bad?: string[] };
type Memo = Record<string, { revision: string; stamp: string; ok: boolean; state?: State; why?: string; bad?: string[] }>;
const memoFile = () => join(studioModels(), ".verified.json");
const readMemo = (): Memo => { try { return JSON.parse(readFileSync(memoFile(), "utf8")); } catch { return {}; } };
function remember(dir: string, v: Memo[string]) { try { const m = readMemo(); m[dir] = v; mkdirSync(studioModels(), { recursive: true }); writeFileSync(memoFile() + ".tmp", JSON.stringify(m)); renameSync(memoFile() + ".tmp", memoFile()); } catch {} }

/** the marker is a revision and a newline: anything larger is not one */
export const MARK_MAX = 256;
const NOFOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const inside = (dir: string, rel: string) => { const p = normalize(join(dir, rel)); return p.startsWith(normalize(dir) + sep) ? p : null; };
const stampOf = (s: { size: number; mtimeMs: number; ino: number; ctimeMs: number }) => `${s.size}:${s.mtimeMs}:${s.ino}:${s.ctimeMs}`;
/** open a file that lstat said is regular, without following a link or blocking, and check it is still that file */
async function openRegular(p: string, ino: number) {
  const fh = await open(p, NOFOLLOW); const s = await fh.stat();
  if (!s.isFile() || s.ino !== ino) { await fh.close(); throw new Error("changed while being read"); }
  return fh;
}
/** how many files were hashed (tests: an unchanged copy, good or bad, is not hashed again) */
export const verifyStats = { hashed: 0 };
async function sha256(p: string, ino: number) {
  verifyStats.hashed++;
  const fh = await openRegular(p, ino), h = createHash("sha256"), buf = Buffer.allocUnsafe(1 << 22);
  try { for (;;) { const { bytesRead } = await fh.read(buf, 0, buf.length, null); if (!bytesRead) break; h.update(buf.subarray(0, bytesRead)); } } finally { await fh.close(); }
  return h.digest("hex");
}

export type Spec = { revision: string; files: [string, number, string][] };
const verifying = new Map<string, Promise<Verdict>>();
/** Is dir the pinned model? Reads only: never writes into dir (the memo lives in Studio's own models folder). */
export function verifyModel(dir: string, o: { memo?: boolean; spec?: Spec } = {}): Promise<Verdict> {
  const key = `${dir}\n${o.spec ? "spec" : ""}\n${o.memo}`, running = verifying.get(key); if (running) return running;
  const job = check(dir, o).finally(() => verifying.delete(key)); verifying.set(key, job); return job;
}
async function check(dir: string, o: { memo?: boolean; spec?: Spec }): Promise<Verdict> {
  const spec = o.spec ?? KOKORO, bad = (state: State, why: string, list?: string[]): Verdict => ({ ok: false, dir, state, why, ...(list ? { bad: list } : {}) });
  // the folder: it must resolve to a real directory; from here on only its real path is read
  let root: string; try { root = await realpath(dir); if (!(await lstat(root)).isDirectory()) return bad("corrupt", "not a directory"); } catch { return bad("missing", "not found"); }
  // the marker: a small regular file, read without following a link or blocking
  let markStat; try { markStat = await lstat(join(root, ".complete")); } catch { return bad("incomplete", "no .complete marker: the download did not finish"); }
  if (!markStat.isFile()) return bad("corrupt", "the .complete marker is not a regular file");
  if (markStat.size > MARK_MAX) return bad("corrupt", "the .complete marker is too large to be one");
  let mark = ""; try { const fh = await openRegular(join(root, ".complete"), markStat.ino); try { const b = Buffer.alloc(MARK_MAX); const { bytesRead } = await fh.read(b, 0, MARK_MAX, 0); mark = b.subarray(0, bytesRead).toString("utf8").trim(); } finally { await fh.close(); } }
  catch { return bad("corrupt", "the .complete marker could not be read safely"); }
  if (!mark) return bad("incomplete", "the .complete marker is empty: the download did not finish");
  if (mark !== spec.revision) return bad("corrupt", `the .complete marker names another revision (${mark.slice(0, 12)})`);
  // every folder on the way is a real folder inside it (no link out)
  for (const d of new Set(spec.files.map(([rel]) => dirname(rel)).filter((d) => d !== "."))) {
    const want = inside(root, d); if (!want) return bad("corrupt", `a manifest path leaves the folder: ${d}`);
    try { if ((await realpath(want)) !== want) return bad("corrupt", `${d} is a link`); } catch { /* missing: reported with its files */ }
  }
  const stats: string[] = [`.complete:${stampOf(markStat)}`], wrong: string[] = [], inos = new Map<string, number>();
  for (const [rel, size] of spec.files) {
    const p = inside(root, rel); if (!p) return bad("corrupt", `a manifest path leaves the folder: ${rel}`);
    try { const s = await lstat(p); if (!s.isFile() || s.size !== size) { wrong.push(rel); continue; } inos.set(rel, s.ino); stats.push(`${rel}:${stampOf(s)}`); } catch { wrong.push(rel); }
  }
  if (wrong.length) return bad("corrupt", `${wrong.length} file(s) missing, of the wrong size or not regular files (${wrong.slice(0, 3).join(", ")})`, wrong);
  const stamp = createHash("sha256").update(`${root}\n${stats.join("\n")}`).digest("hex"), memo = o.memo === false ? {} : readMemo(), seen = memo[dir];
  if (seen?.revision === spec.revision && seen.stamp === stamp) return seen.ok ? { ok: true, dir } : bad(seen.state ?? "corrupt", seen.why ?? "refused before", seen.bad);
  const mismatch: string[] = [];
  for (const [rel, , want] of spec.files) { try { if ((await sha256(join(root, rel), inos.get(rel)!)) !== want) mismatch.push(rel); } catch { mismatch.push(rel); } }
  const v: Verdict = mismatch.length ? bad("corrupt", `${mismatch.length} file(s) do not match the pinned SHA-256 (${mismatch.slice(0, 3).join(", ")})`, mismatch) : { ok: true, dir };
  if (o.memo !== false) remember(dir, v.ok ? { revision: spec.revision, stamp, ok: true } : { revision: spec.revision, stamp, ok: false, state: v.state, why: v.why, bad: v.bad });
  return v;
}

export type Source = "agent-wardrobe" | "studio";
export type Found = { ok: true; dir: string; source: Source } | { ok: false; tried: (Verdict & { source: Source })[] };
let cached: { at: number; v: Found } | null = null;
/** The pinned model on this Mac: Agent Wardrobe's copy when it verifies, else Studio's own. Kept 60 s (fresh: look again). */
export async function findKokoro(fresh = false, spec?: Spec): Promise<Found> {
  if (!fresh && !spec && cached && Date.now() - cached.at < 60_000) return cached.v;
  const tried: (Verdict & { source: Source })[] = [], aw = wardrobeModels();
  const places: [string, Source][] = [...(aw ? [[join(aw, KOKORO.name), "agent-wardrobe"] as [string, Source]] : []), [join(studioModels(), KOKORO.name), "studio"]];
  let v: Found = { ok: false, tried };
  for (const [dir, source] of places) { const r = await verifyModel(dir, { spec }); if (r.ok) { v = { ok: true, dir, source }; break; } tried.push({ ...r, source }); }
  if (!spec) cached = { at: Date.now(), v }; return v;
}
/** the last answer without looking again (null: not looked yet) */
export const lastFound = () => cached?.v ?? null;
export const forgetFound = () => { cached = null; };

/** the engine's paths inside a verified folder (as agent-wardrobe and sherpa-onnx's own examples load it) */
export function kokoroConfig(dir: string, threads = 2) {
  const k = (n: string) => join(dir, n);
  return { model: { kokoro: { model: k("model.onnx"), voices: k("voices.bin"), tokens: k("tokens.txt"), dataDir: k("espeak-ng-data"), dictDir: k("dict"), lexicon: `${k("lexicon-us-en.txt")},${k("lexicon-zh.txt")}` }, numThreads: threads, provider: "cpu" },
    ruleFsts: `${k("date-zh.fst")},${k("phone-zh.fst")},${k("number-zh.fst")}`, maxNumSentences: 1 };
}
