import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's local neural voice (src/voice): the sidecar's stdio protocol against a fake engine (one request at a
// time, timeouts, a crash and its back-off, idle exit and restart, a request given up while queued or running, Studio's
// shutdown, the least environment, text never on argv, a deny-by-default sandbox: no network, no other program, no
// file outside its folders), mixed Chinese/English runs, clip cache keys and bounds, which texts a room may speak, the
// pinned model's verification (a good copy is accepted; a wrong checksum, marker, FIFO, link or swapped file refused,
// quickly; a refused copy not hashed again; Agent Wardrobe's folder never written), the pinned download (https only,
// size, resume), and Doctor's voice rows. No real model, runtime, outside network or paid model.        bun tests/voice.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync, copyFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { suite } from "./rt-harness";
const { ok, end } = suite("voice");
const root = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "crew-voice-"));
process.env.CREW_VOICE_MODELS = join(tmp, "studio-models"); process.env.CREW_VOICE_TOOLS = join(tmp, "tools");
const { Sidecar, sidecarArgv, sidecarEnv, sandboxProfile, stopAllSidecars, CRASH_LIMIT } = await import("../src/voice/sidecar");
const { splitRuns, SPEAKERS, DEFAULT_VOICE, langOf } = await import("../src/voice/runs");
const { kokoroSpeaker, clipName, roomClip, readClip, ENGINE_VERSION, ClipStore, MAX_POINT, voiceStatus, voiceDoctorInput } = await import("../src/voice/kokoro");
const { verifyModel, findKokoro, KOKORO, kokoroBytes, verifyStats } = await import("../src/voice/models");
const { isRoomPoint } = await import("../src/voice/points");
const { narration } = await import("../src/domain/review-room");
const { wav, wavInfo, trimSilence } = await import("../src/voice/wav");
const { runtimeState, SHERPA_PINS, SHERPA_VERSION, installCommand, platformPackage, ensureScripts } = await import("../src/voice/runtime");
const { voiceItems, methodsFor } = await import("../src/doctor");
const fake = join(root, "tests/fixture/fake-voice-sidecar.cjs");
const sandboxed = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
const node = Bun.which("node")!;
const mk = (o: Record<string, any> = {}) => new Sidecar({ node, script: fake, config: { model: "fake" }, idleMs: 60_000, timeoutMs: 1500, loadTimeoutMs: 5000, ...o });
const timed = async <T>(f: () => Promise<T>) => { const t = Date.now(); const v = await f(); return { v, ms: Date.now() - t }; };
const err = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e: any) { return e; } };

// ---------- the protocol ----------
process.env.OPENAI_API_KEY = "sk-test-not-for-the-sidecar";
{ const s = mk();
  const outs = await Promise.all(["one", "two", "three"].map((t) => s.tts(t, 45)));
  const ping: any = await s.request({ op: "ping" });
  ok(outs.map((o) => o.pcm.length).join() === "24,24,40" && outs.every((o) => o.sampleRate === 24000) && ping.loaded?.model === "fake", "the model is loaded first, then each run comes back as 16-bit PCM", JSON.stringify(outs.map((o) => o.pcm.length)));
  ok(ping.most === 1, "one request at a time: three asked together reach the engine one after another", String(ping.most));
  ok(!ping.argv.some((a: string) => /one|two|three/.test(a)) && !sidecarArgv({ node: "node", script: "s.cjs" }).some((a) => ["one", "two", "three"].includes(a)), "the room's text is sent on stdin, never on argv", JSON.stringify(ping.argv));
  const extra = ping.env.filter((k: string) => !Object.keys(sidecarEnv()).includes(k) && !/^(__CF_USER_TEXT_ENCODING|_|PWD|SHLVL|OLDPWD)$/.test(k));
  ok(!ping.env.includes("OPENAI_API_KEY") && !ping.env.includes("HOME") && !extra.length, "the engine gets the least environment: no credential, no home, nothing of Studio's", JSON.stringify(ping.env));
  s.stop(); }

// ---------- the sandbox: deny by default ----------
{ const prof = sandboxProfile(node, ["/x/model dir \"q\""]);
  ok(/\(deny default\)/.test(prof) && !/\(allow default\)/.test(prof) && !/network/.test(prof) && !/file-write\*/.test(prof) && !/mach-lookup|appleevent/.test(prof) && /\(allow process-exec \(literal "[^"]+"\)\)/.test(prof) && prof.includes('(subpath "/x/model dir \\"q\\"")'),
    "the profile denies by default; it allows only the exec of Node, reads of Node, the system and the given folders: no network, no writes, no Apple events, no services", prof);
  // a Homebrew Node links libraries from /opt/homebrew/opt: their folders are readable, nothing else of what otool lists
  const otherHome = ["", "Users", "someone"].join("/"); // built at run time: no tracked file names a home path
  const brew = "/opt/homebrew/Cellar/node/25.2.1/bin/node", home = (await import("node:os")).homedir(), nvm = join(home, ".nvm/versions/node/v20.19.6");
  const listing = (bin: string, libs: string[]) => () => `${bin}:\n${libs.map((l) => `\t${l} (compatibility version 1.0.0, current version 1.0.0)`).join("\n")}\n`;
  const brewLibs = listing(brew, ["/opt/homebrew/opt/icu4c@77/lib/libicui18n.77.dylib", "/opt/homebrew/opt/libuv/lib/libuv.1.dylib", "/opt/homebrew/opt/icu4c@77/lib/libicuuc.77.dylib",
    "/usr/lib/libSystem.B.dylib", "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation", `${otherHome}/evil lib/libx.dylib`, `${home}/lib/liby.dylib`, "@rpath/libz.dylib", "/opt/homebrew/opt/simdjson/../../../../tmp/libw.dylib"]);
  const subpaths = (p: string) => [...p.matchAll(/\(subpath "([^"]+)"\)/g)].map((m) => m[1]).filter((d) => !["/usr/lib", "/System/Library", "/System/Cryptexes", "/private/var/db/timezone", "/usr/share/icu", "/private/var/db/dyld"].includes(d));
  const bp = sandboxProfile(brew, [], brewLibs);
  ok(JSON.stringify(subpaths(bp)) === JSON.stringify(["/opt/homebrew/opt/icu4c@77/lib", "/opt/homebrew/opt/libuv/lib"]) && !bp.includes(otherHome) && !bp.includes(`${home}/lib`),
    "a Homebrew Node's linked libraries' folders are readable, exactly those; a home or temp folder otool lists, the system's own and @rpath are not added", JSON.stringify(subpaths(bp)));
  const np = sandboxProfile(join(nvm, "bin/node"), [], listing(join(nvm, "bin/node"), [join(nvm, "lib/libnode.dylib"), join(home, "other/libq.dylib")]));
  ok(JSON.stringify(subpaths(np)) === JSON.stringify([join(nvm, "lib")]), "a home folder is allowed only inside the Node's own install prefix", JSON.stringify(subpaths(np)));
  const hp = sandboxProfile(join(home, "bin/node"), [], listing(join(home, "bin/node"), [join(home, "lib/libnode.dylib")]));
  ok(!subpaths(hp).length, "a Node whose prefix would be the home folder itself gets no home folder", JSON.stringify(subpaths(hp)));
  const argv = sidecarArgv({ node: "/x/node", script: "/x/tools/sidecar.cjs", sandbox: true });
  ok(argv[0] === "/usr/bin/sandbox-exec" && argv[2].includes('(subpath "/x/tools")') && argv.slice(-2).join() === "/x/node,/x/tools/sidecar.cjs", "on macOS the engine runs under that profile, its own folder readable", JSON.stringify(argv.slice(-2))); }
if (sandboxed) {
  const home = join(tmp, "home"); mkdirSync(join(home, ".ssh"), { recursive: true }); writeFileSync(join(home, ".ssh", "id_fake"), "not a real key");
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("listening") });
  const outside = await fetch(`http://127.0.0.1:${srv.port}/`).then((r) => r.text()).catch((e) => String(e));
  const plain = await (async () => { const s = mk({ sandbox: false, config: { probe: { read: join(home, ".ssh", "id_fake"), exec: "/bin/echo", port: srv.port } } }); const r: any = await s.request({ op: "tts", text: "PROBE", sid: 0 }); s.stop(); return r; })();
  const s = mk({ sandbox: true, config: { probe: { read: join(home, ".ssh", "id_fake"), exec: "/bin/echo", port: srv.port } } }); const r: any = await s.request({ op: "tts", text: "PROBE", sid: 0 }); s.stop(); srv.stop(true);
  ok(outside === "listening" && plain.net === "allowed" && plain.read === "allowed" && plain.exec === "allowed", "without the sandbox the probe reaches the loopback listener, reads the file and runs /bin/echo", JSON.stringify({ outside, plain }));
  ok(r.net !== "allowed" && r.read !== "allowed" && r.exec !== "allowed" && r.write !== "allowed", "inside it the engine cannot reach that listener, read ~/.ssh, run /bin/echo or write a file", JSON.stringify(r));
}

// ---------- timeouts, crashes and their back-off, idle exit, a request given up, shutdown ----------
{ const s = mk({ timeoutMs: 400 }); const t0 = Date.now(), e = await err(() => s.tts("HANG", 45));
  ok(/longer than/.test(e?.message ?? "") && Date.now() - t0 < 3000 && !s.running, "a synthesis that never answers times out and the engine is stopped", e?.message);
  const again = await s.tts("after", 45);
  ok(again.pcm.length === 40 && s.starts === 2, "the next request starts it again", String(s.starts)); s.stop(); }
{ const s = mk({ backoffMs: 400, backoffMaxMs: 1000 }); const e = await err(() => s.tts("CRASH", 45));
  ok(/exit 5/.test(e?.message ?? ""), "a crashed engine fails its request with its exit", e?.message);
  const r = await timed(() => s.tts("ok", 45));
  ok(r.v.pcm.length === 16 && s.starts === 2 && r.ms >= 380 && s.failures === 0, "the next request waits out a short back-off, starts a fresh one, and a success clears the count", JSON.stringify({ ms: r.ms, starts: s.starts }));
  for (let i = 0; i < CRASH_LIMIT; i++) await err(() => s.tts("CRASH", 45));
  const starts = s.starts, refused = await timed(() => err(() => s.tts("ok", 45)));
  ok(s.crashing && refused.v?.code === "voice_crashing" && /一直當掉/.test(refused.v.message) && s.starts === starts && refused.ms < 100, `after ${CRASH_LIMIT} crashes in a row it is not started again for a while: "語音引擎一直當掉"`, JSON.stringify({ code: refused.v?.code, ms: refused.ms }));
  ok(s.failures === CRASH_LIMIT, "each crash counted, the back-off doubling (capped)"); s.stop(); }
{ const s = mk({ idleMs: 250 }); await s.tts("hi", 45); await Bun.sleep(700);
  ok(!s.running, "the engine exits by itself after being idle");
  ok((await s.tts("back", 45)).pcm.length === 32 && s.starts === 2, "and comes back for the next point, reloading the model", String(s.starts)); s.stop(); }
{ const s = mk(), ac = new AbortController(), queued = new AbortController();
  const slow = s.tts("SLOW", 45, 1, ac.signal), waiting = s.tts("queued", 45, 1, queued.signal);
  await Bun.sleep(150); queued.abort(); ac.abort();
  const [a, b] = await Promise.all([err(() => slow), err(() => waiting)]);
  ok(a?.code === "aborted" && b?.code === "aborted" && !s.running, "a request given up while the engine works on it is cancelled (the engine stopped); one given up in the queue is dropped", JSON.stringify([a?.code, b?.code]));
  await s.tts("next", 45); const ping: any = await s.request({ op: "ping" });
  ok(!ping.seen.includes("queued") && ping.seen.includes("next"), "the dropped request never reached the engine; the next one does", JSON.stringify(ping.seen)); s.stop(); }
{ const a = mk(), b = mk(); await a.tts("x", 45); await b.tts("y", 45); stopAllSidecars();
  ok(!a.running && !b.running, "Studio's shutdown stops every engine it started");
  // shutting down while one clip runs and another waits: both refused, and the waiting one never starts a new engine
  const c = mk(); await c.tts("warm", 45); const startsBefore = c.starts;
  const running = c.tts("SLOW", 45), waiting = c.tts("queued", 45); await Bun.sleep(100); stopAllSidecars();
  const [ra, rb] = await Promise.all([err(() => running), err(() => waiting)]); await Bun.sleep(300);
  ok(!!ra && rb?.code === "shutdown" && !c.running && c.starts === startsBefore, "a shutdown refuses the running and the queued request, and nothing starts the engine again", JSON.stringify({ ra: ra?.message, rb: rb?.code, starts: c.starts - startsBefore }));
  ok((await err(() => c.tts("later", 45)))?.code === "shutdown" && c.starts === startsBefore, "after a shutdown no request starts it"); }
{ const src = readFileSync(join(root, "src/server.ts"), "utf8");
  ok(src.includes('process.once(sig,()=>{try{terminals.shutdown();}catch{}try{stopLocal();}catch{}') && src.includes('process.on("exit", () => { try { terminals.shutdown(); } catch {} try { stopLocal(); } catch {} });'), "SIGTERM, SIGINT and exit stop the local voice engine"); }

// ---------- mixed Chinese and English ----------
const runs = (t: string, m: "switch" | "same" = "switch", l: "zh" | "en" = "zh") => splitRuns(t, m, l).map((r) => `${r.lang}:${r.text}`);
ok(JSON.stringify(runs("這個 PR 修好了 GitHub 的 diff 引用。")) === JSON.stringify(["zh:這個", "en:PR", "zh:修好了", "en:GitHub", "zh:的", "en:diff", "zh:引用。"]), "a Chinese point is cut into Chinese and English runs", JSON.stringify(runs("這個 PR 修好了 GitHub 的 diff 引用。")));
ok(JSON.stringify(runs("用 gpt-4o 和 CI/CD，版本 v1.0。")) === JSON.stringify(["zh:用", "en:gpt-4o", "zh:和", "en:CI/CD", "zh:，版本", "en:v1.0。"]), "code names keep their digits and joiners in one English run; punctuation stays with the run before it", JSON.stringify(runs("用 gpt-4o 和 CI/CD，版本 v1.0。")));
ok(JSON.stringify(runs("這個 PR 修好了 GitHub。", "same")) === JSON.stringify(["zh:這個 PR 修好了 GitHub。"]), "same voice: the whole point in the room language's voice");
ok(JSON.stringify(runs("This change moves the room to a local voice.")) === JSON.stringify(["en:This change moves the room to a local voice."]) && JSON.stringify(runs("改了 1999 筆，15% 的折扣。")) === JSON.stringify(["zh:改了 1999 筆，15% 的折扣。"]), "an English point stays one English run, digits in Chinese stay Chinese");
ok(!splitRuns("  ，。 ", "switch", "zh").length && !splitRuns("", "same", "en").length, "a point with nothing to say gives no run");
ok(langOf("zh-TW") === "zh" && langOf("zh-CN") === "zh" && langOf("en") === "en" && langOf(undefined) === "en", "the room language maps to the model's");
{ const s = mk(); const say = kokoroSpeaker(s, { lang: "zh", mode: "switch" }), out = await say("這個 PR 好。", new AbortController().signal), info = wavInfo(out.bytes)!;
  const pcm = out.bytes.subarray(44), sids = new Set<number>(); for (let i = 0; i < pcm.length; i += 2) if (pcm.readInt16LE(i)) sids.add(pcm.readInt16LE(i) - 1000);
  ok(info.sampleRate === 24000 && sids.has(SPEAKERS.zf_xiaobei) && sids.has(SPEAKERS.af_heart) && out.voice === "zf_xiaobei+af_heart" && out.model === "kokoro-multi-lang-v1_0", "switch: each run is spoken by its language's voice (zf_xiaobei, af_heart) and joined into one WAV", JSON.stringify({ info, sids: [...sids], voice: out.voice }));
  const same = await kokoroSpeaker(s, { lang: "zh", mode: "same" })("這個 PR 好。", new AbortController().signal);
  ok(same.voice === "zf_xiaobei", "same: one voice for the whole point", same.voice);
  ok(DEFAULT_VOICE.zh === "zf_xiaobei" && DEFAULT_VOICE.en === "af_heart" && SPEAKERS.zf_xiaobei === 45 && SPEAKERS.af_heart === 3, "the default voices are zf_xiaobei (zh) and af_heart (en)"); s.stop(); }
{ const w = wav([Buffer.alloc(480), Buffer.alloc(480)], 24000, 10), i = wavInfo(w)!;
  ok(i.sampleRate === 24000 && Math.abs(i.seconds - (960 + 480) / 2 / 24000) < 1e-9 && wavInfo(Buffer.from("not a wav"))?.sampleRate === undefined, "the WAV holds the runs and a short gap between them"); }
{ const pcm = Buffer.alloc(2400 * 2); for (let i = 1000; i < 1400; i++) pcm.writeInt16LE(5000, i * 2); const t = trimSilence(pcm, 24000, 10);
  ok(t.length / 2 === 400 + 2 * 240 && trimSilence(Buffer.alloc(100), 24000).length === 0, "the silence around a run is cut to a short margin before the runs are joined", String(t.length / 2)); }

// ---------- clips: keyed by text, voices, mix, language and engine; made once; bounded ----------
const mkWav = (bytes: number) => wav([Buffer.alloc(bytes - 44)], 24000);
{ const v = DEFAULT_VOICE, base = clipName("一點", { lang: "zh", mode: "switch", voices: v });
  const variants = [clipName("另一點", { lang: "zh", mode: "switch", voices: v }), clipName("一點", { lang: "zh", mode: "same", voices: v }), clipName("一點", { lang: "en", mode: "switch", voices: v }),
    clipName("一點", { lang: "zh", mode: "switch", voices: { ...v, zh: "zf_xiaoxiao" } }), clipName("一點", { lang: "zh", mode: "switch", voices: { ...v, en: "bf_emma" } }), clipName("一點", { lang: "zh", mode: "switch", voices: v, engine: "kokoro@other" })];
  ok(/^kvoice-[0-9a-f]{16}\.wav$/.test(base) && base === clipName("一點", { lang: "zh", mode: "switch", voices: v }) && new Set([base, ...variants]).size === 7, "a clip's name changes with its text, mix, language, either voice and the engine version; the same point keeps its name", JSON.stringify([base, ...variants]));
  ok(ENGINE_VERSION.includes(KOKORO.revision.slice(0, 12)) && ENGINE_VERSION.includes(`sherpa-onnx-node@${SHERPA_VERSION}`), "the engine version names the model revision and the runtime", ENGINE_VERSION);
  const store = new ClipStore(join(tmp, "clips-a.json")), dir = join(tmp, "room-a-images"); let calls = 0;
  const speaker = async () => { calls++; await Bun.sleep(30); return { bytes: mkWav(400), model: "k", voice: "zf_xiaobei" }; };
  const [a, b] = await Promise.all([roomClip(dir, "第一點", { lang: "zh", mode: "switch", speaker, store }), roomClip(dir, "第一點", { lang: "zh", mode: "switch", speaker, store })]);
  const c = await roomClip(dir, "第一點", { lang: "zh", mode: "switch", speaker, store });
  ok(!a.cached && a.name === b.name && c.cached && calls === 1 && !!readClip(dir, a.name, store), "a point's clip is made once (two asks at once make one), then served from the room's folder", JSON.stringify({ a, c, calls }));
  ok(readClip(dir, "../room.json") === null && readClip(dir, "voice-t1-0123456789ab.mp3") === null, "only a clip's own name is served");
  const reset = await err(() => roomClip(dir, "第二點", { lang: "zh", mode: "switch", speaker, store, alive: () => false }));
  ok(reset?.code === "reset" && readdirSync(dir).filter((n) => n.endsWith(".wav")).length === 1, "a room started over while its clip was made keeps nothing of it");
  ok(/mix/.test((await err(() => roomClip(dir, "x", { lang: "zh", mode: "loud" as any, speaker, store })))?.message ?? ""), "an unknown mix mode is refused");
  const long = await err(() => roomClip(dir, "長".repeat(MAX_POINT + 1), { lang: "zh", mode: "switch", speaker, store }));
  ok(long?.code === "too_long" && calls === 2, `a text longer than ${MAX_POINT} characters is refused, not cut`, long?.message);
  const ac = new AbortController(); const gone = roomClip(dir, "第三點", { lang: "zh", mode: "switch", store, signal: ac.signal, speaker: (_t, sig) => new Promise((_, bad) => sig.addEventListener("abort", () => bad(new Error("stopped")))) });
  ac.abort(); ok(/stopped/.test((await err(() => gone))?.message ?? ""), "a page that goes away stops the synthesis of its clip");
  // two requests share one job: one giving up does not stop it for the other; only when both give up does it stop
  let sig: AbortSignal | null = null, release!: () => void; const held = new Promise<void>((r) => (release = r));
  const shared = async (_t: string, s: AbortSignal) => { sig = s; await held; return { bytes: mkWav(200), model: "k", voice: "af_heart" }; };
  const one = new AbortController(), two = new AbortController();
  const p1 = roomClip(dir, "第四點", { lang: "zh", mode: "switch", store, speaker: shared, signal: one.signal }), p2 = roomClip(dir, "第四點", { lang: "zh", mode: "switch", store, speaker: shared, signal: two.signal });
  await Bun.sleep(20); one.abort(); const e1 = await err(() => Promise.race([p1, Bun.sleep(2000).then(() => { throw new Error("still waiting"); })])); await Bun.sleep(20);
  ok(e1?.code === "aborted" && sig !== null && !(sig as AbortSignal).aborted, "one of two requests sharing a clip gives up: it stops waiting, the shared synthesis goes on", JSON.stringify({ e1: e1?.code, aborted: (sig as AbortSignal | null)?.aborted }));
  release(); const r2 = await p2; ok(!r2.cached && existsSync(join(dir, r2.name)), "and the other gets its clip");
  let sig2: AbortSignal | null = null; const never = async (_t: string, s: AbortSignal) => { sig2 = s; return new Promise<never>(() => {}); };
  const a1 = new AbortController(), a2 = new AbortController();
  const q1 = roomClip(dir, "第五點", { lang: "zh", mode: "switch", store, speaker: never, signal: a1.signal }), q2 = roomClip(dir, "第五點", { lang: "zh", mode: "switch", store, speaker: never, signal: a2.signal });
  await Bun.sleep(20); const bounded = (q: Promise<unknown>) => err(() => Promise.race([q, Bun.sleep(2000).then(() => { throw new Error("still waiting"); })]));
  a1.abort(); await bounded(q1); const after1 = (sig2 as AbortSignal | null)?.aborted; a2.abort(); await bounded(q2);
  ok(after1 === false && (sig2 as AbortSignal | null)?.aborted === true, "when every request sharing it has given up, the synthesis is stopped", JSON.stringify({ after1, after2: (sig2 as AbortSignal | null)?.aborted })); }
{ const store = new ClipStore(join(tmp, "clips-b.json"), { room: 1000, total: 1500 }), r1 = join(tmp, "lru-1-images"), r2 = join(tmp, "lru-2-images");
  const make = (dir: string, t: string) => roomClip(dir, t, { lang: "en", mode: "switch", store, speaker: async () => ({ bytes: mkWav(400), model: "k", voice: "af_heart" }) });
  const a = await make(r1, "a"); await Bun.sleep(5); const b = await make(r1, "b"); await Bun.sleep(5); readClip(r1, a.name, store); await Bun.sleep(5);
  const c = await make(r1, "c");
  ok(existsSync(join(r1, a.name)) && !existsSync(join(r1, b.name)) && existsSync(join(r1, c.name)), "over a room's bytes the least recently played clip goes first (one just played stays)", JSON.stringify(readdirSync(r1)));
  const d = await make(r2, "d"); await Bun.sleep(5); const e2 = await make(r2, "e");
  ok(store.bytes <= 1500 && !existsSync(join(r1, a.name)) && existsSync(join(r2, e2.name)), "over the total across rooms the oldest clip anywhere goes", JSON.stringify({ bytes: store.bytes, r1: readdirSync(r1), r2: readdirSync(r2) }));
  // a tampered index names other files: none of them is ever deleted, only clips of rooms under the roots
  { const base = join(tmp, "tamper"), roomDir = join(base, "data", "R-1-images"), outside = join(tmp, "outside"); mkdirSync(roomDir, { recursive: true }); mkdirSync(outside, { recursive: true });
    const victims = { note: join(outside, "notes.txt"), named: join(outside, "kvoice-00000000000000aa.wav"), plain: join(base, "data", "kvoice-00000000000000bb.wav"), loose: join(base, "data", "other-dir", "kvoice-00000000000000cc.wav"), picture: join(roomDir, "B1-2.png"), away: join(tmp, "elsewhere", "R-9-images", "kvoice-00000000000000ab.wav") };
    mkdirSync(dirname(victims.away), { recursive: true });
    mkdirSync(dirname(victims.loose), { recursive: true }); for (const f of Object.values(victims)) writeFileSync(f, "keep me");
    const link = join(roomDir, "kvoice-00000000000000dd.wav"); symlinkSync(victims.note, link);
    const dotted = `${roomDir}/../R-1-images/kvoice-00000000000000ee.wav`; writeFileSync(join(roomDir, "kvoice-00000000000000ee.wav"), "x");
    const idx = join(base, "data", "voice-clips.json"), old = 1;
    writeFileSync(idx, JSON.stringify(Object.fromEntries([...Object.values(victims), link, dotted, "relative/kvoice-00000000000000ff.wav"].map((f) => [f, { size: 10_000, at: old }]))));
    const ts = new ClipStore(idx, { room: 100, total: 100 }, [join(base, "data")]);
    await roomClip(roomDir, "new", { lang: "en", mode: "switch", store: ts, speaker: async () => ({ bytes: mkWav(64), model: "k", voice: "af_heart" }) });

    ok(Object.values(victims).every((f) => existsSync(f) && readFileSync(f, "utf8") === "keep me") && existsSync(join(roomDir, "kvoice-00000000000000ee.wav")) && existsSync(link) && readFileSync(victims.note, "utf8") === "keep me",
      "a tampered voice-clips.json deletes nothing but clips: no file outside the roots, no other name, no clip outside a room's folder, no link, no unnormalised path", JSON.stringify(readdirSync(roomDir))); }
  store.dropDir(r2); ok(!readdirSync(r2).some((n) => n.endsWith(".wav")) && !store.has(join(r2, e2.name)), "a room's clips can be dropped with it (started over: deleted, not archived)"); }

// ---------- only the room's own words ----------
{ const room = { turns: [{ n: 1, answer: "The answer. It rounds.", scenes: [{ points: [{ text: "這個軟體四捨五入到分 [diff:src/a.ts:L2]。" }] }], claims: [{ text: "First sentence. Second sentence [ledger:#3].", zh: "第一句。" }] }],
    translations: { en: { "1": { scenes: [{ points: ["Translated point."] }], claims: ["A translated claim."] } } }, check: { questions: [{ q: "What does it return?" }] } };
  const yes = ["这个软件四舍五入到分。", "這個軟體四捨五入到分。", "Second sentence.", "第一句。", "Translated point.", "A translated claim.", "What does it return?", "It rounds."];
  const no = ["Say something else entirely.", "第二句。", "rm -rf / please"];
  ok(yes.every((t) => isRoomPoint(room, t, narration)) && no.every((t) => !isRoomPoint(room, t, narration)), "a room speaks its points, a sentence of an answer, a translation, a check's question, in zh-TW or Simplified; never other text",
    JSON.stringify({ yes: yes.map((t) => isRoomPoint(room, t, narration)), no: no.map((t) => isRoomPoint(room, t, narration)) })); }

// ---------- the pinned model ----------
const spec = (dir: string) => { const files: [string, number, string][] = []; const walk = (d: string) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (n !== ".complete") { const b = readFileSync(f); files.push([relative(dir, f), b.length, createHash("sha256").update(b).digest("hex")]); } } }; walk(dir); return { revision: "r".repeat(40), files: files.sort() }; };
const makeModel = (dir: string) => { mkdirSync(join(dir, "dict"), { recursive: true }); writeFileSync(join(dir, "model.onnx"), "model-bytes"); writeFileSync(join(dir, "voices.bin"), "voices"); writeFileSync(join(dir, "dict", "jieba.dict.utf8"), "詞"); };
const snapshot = (dir: string) => { const out: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const f = join(d, n), s = statSync(f); out.push(`${relative(dir, f)}:${s.size}:${s.mtimeMs}:${s.isDirectory() ? "d" : createHash("sha256").update(readFileSync(f)).digest("hex")}`); if (s.isDirectory()) walk(f); } }; walk(dir); return out.join("\n"); };
{ const aw = join(tmp, "Agent Wardrobe", "models"), good = join(aw, "kokoro-multi-lang-v1_0"); makeModel(good); const sp = spec(good); writeFileSync(join(good, ".complete"), sp.revision + "\n");
  for (const f of ["model.onnx", "voices.bin", "dict/jieba.dict.utf8", ".complete"]) utimesSync(join(good, f), 1_700_000_000, 1_700_000_000);
  const before = snapshot(aw);
  process.env.CREW_VOICE_WARDROBE = aw;
  const v1 = await verifyModel(good, { spec: sp }), h1 = verifyStats.hashed, v2 = await verifyModel(good, { spec: sp }), f = await findKokoro(true, sp);
  ok(v1.ok && v2.ok && f.ok && f.source === "agent-wardrobe", "Agent Wardrobe's copy is used when its marker, revision and every SHA-256 match the pins", JSON.stringify({ v1, f }));
  ok(verifyStats.hashed === h1, "an unchanged good copy is not hashed again");
  ok(snapshot(aw) === before && existsSync(join(process.env.CREW_VOICE_MODELS!, ".verified.json")), "verifying it never writes into Agent Wardrobe's folder: the memo lives in Studio's models folder");
  // a same-size swap with its mtime put back: the inode and ctime still tell
  writeFileSync(join(good, "voices.new"), "VOICES"); renameSync(join(good, "voices.new"), join(good, "voices.bin")); utimesSync(join(good, "voices.bin"), 1_700_000_000, 1_700_000_000);
  const wrong = await verifyModel(good, { spec: sp });
  ok(!wrong.ok && wrong.state === "corrupt" && /SHA-256/.test(wrong.why) && wrong.bad?.join() === "voices.bin", "a same-size file swapped in with its mtime restored is hashed again and refused", JSON.stringify(wrong));
  const h2 = verifyStats.hashed, again = await verifyModel(good, { spec: sp });
  ok(!again.ok && again.state === "corrupt" && verifyStats.hashed === h2, "a refused copy that has not changed is not hashed again on every look", JSON.stringify({ again, hashed: verifyStats.hashed - h2 }));
  writeFileSync(join(good, "voices.bin"), "voices");
  writeFileSync(join(good, ".complete"), "f".repeat(40)); const rev = await verifyModel(good, { spec: sp });
  ok(!rev.ok && rev.state === "corrupt" && /another revision/.test(rev.why), "a marker naming another revision is refused", JSON.stringify(rev));
  writeFileSync(join(good, ".complete"), ""); const inc = await verifyModel(good, { spec: sp });
  ok(!inc.ok && inc.state === "incomplete", "an empty marker is an unfinished download", JSON.stringify(inc));
  rmSync(join(good, ".complete")); ok((await verifyModel(good, { spec: sp }) as any).state === "incomplete", "no marker is an unfinished download");
  // what another app's folder could hold instead of files: a FIFO, a link to /dev/zero, a huge marker; all refused at once
  Bun.spawnSync(["mkfifo", join(good, ".complete")]); const fifo = await timed(() => verifyModel(good, { spec: sp })); rmSync(join(good, ".complete"));
  symlinkSync("/dev/zero", join(good, ".complete")); const zero = await timed(() => verifyModel(good, { spec: sp })); unlinkSync(join(good, ".complete"));
  writeFileSync(join(good, ".complete"), sp.revision + " ".repeat(10_000)); const big = await verifyModel(good, { spec: sp }); writeFileSync(join(good, ".complete"), sp.revision);
  ok(!fifo.v.ok && !zero.v.ok && !big.ok && fifo.ms < 1000 && zero.ms < 1000 && /not a regular file/.test((fifo.v as any).why) && /not a regular file/.test((zero.v as any).why) && /too large/.test((big as any).why), "a FIFO or a link to /dev/zero as the marker, or an oversized marker, is refused at once, never read", JSON.stringify({ fifo, zero, big }));
  renameSync(join(good, "model.onnx"), join(tmp, "model.real")); symlinkSync(join(tmp, "model.real"), join(good, "model.onnx")); const link = await verifyModel(good, { spec: sp }); unlinkSync(join(good, "model.onnx")); renameSync(join(tmp, "model.real"), join(good, "model.onnx"));
  Bun.spawnSync(["mkfifo", join(tmp, "fifo-file")]); renameSync(join(good, "voices.bin"), join(tmp, "voices.keep")); renameSync(join(tmp, "fifo-file"), join(good, "voices.bin")); const fifoFile = await timed(() => verifyModel(good, { spec: sp })); rmSync(join(good, "voices.bin")); renameSync(join(tmp, "voices.keep"), join(good, "voices.bin"));
  ok(!link.ok && /not regular files/.test((link as any).why) && !fifoFile.v.ok && /not regular files/.test((fifoFile.v as any).why) && fifoFile.ms < 1000, "a model file that is a link or a FIFO is refused before any hashing", JSON.stringify({ link, fifoFile }));
  renameSync(join(good, "dict"), join(tmp, "dict-real")); symlinkSync(join(tmp, "dict-real"), join(good, "dict")); const dirLink = await verifyModel(good, { spec: sp }); unlinkSync(join(good, "dict")); renameSync(join(tmp, "dict-real"), join(good, "dict"));
  ok(!dirLink.ok && /link/.test((dirLink as any).why), "a folder inside it that links elsewhere is refused", JSON.stringify(dirLink));
  // the model folder itself: a link to a real folder is followed; one to a file or /dev/zero is not a model
  const alias = join(tmp, "alias-model"); symlinkSync(good, alias); const viaLink = await verifyModel(alias, { spec: sp });
  const notDir = join(tmp, "alias-zero"); symlinkSync("/dev/zero", notDir); const zeroDir = await timed(() => verifyModel(notDir, { spec: sp }));
  ok(viaLink.ok && !zeroDir.v.ok && (zeroDir.v as any).state === "corrupt" && zeroDir.ms < 1000, "the model folder must resolve to a real directory", JSON.stringify({ viaLink, zeroDir }));
  // a link retargeted to another copy with the same sizes and mtimes is checked again
  const other = join(tmp, "other-model"); cpSync(good, other, { recursive: true, preserveTimestamps: true }); writeFileSync(join(other, "voices.bin"), "VOICES");
  const vs = statSync(join(good, "voices.bin")); utimesSync(join(other, "voices.bin"), vs.atime, vs.mtime);
  const moving = join(tmp, "moving-model"); symlinkSync(good, moving); const before2 = await verifyModel(moving, { spec: sp }); unlinkSync(moving); symlinkSync(other, moving); const after2 = await verifyModel(moving, { spec: sp });
  ok(before2.ok && !after2.ok && after2.state === "corrupt", "a link retargeted to another copy is verified again, not taken from the memo", JSON.stringify({ before2, after2 }));
  // Studio's own copy is used when Agent Wardrobe's is refused
  writeFileSync(join(good, ".complete"), "f".repeat(40));
  const own = join(process.env.CREW_VOICE_MODELS!, "kokoro-multi-lang-v1_0"); makeModel(own); writeFileSync(join(own, ".complete"), sp.revision);
  const f2 = await findKokoro(true, sp);
  ok(f2.ok && f2.source === "studio", "when Agent Wardrobe's copy is refused, Studio's own verified copy is used", JSON.stringify(f2));
  process.env.CREW_VOICE_WARDROBE = "none"; writeFileSync(join(own, "model.onnx"), "MODEL-BYTES");
  const f3 = await findKokoro(true, sp);
  ok(!f3.ok && f3.tried.length === 1 && f3.tried[0].source === "studio" && !f3.tried[0].ok && f3.tried[0].state === "corrupt", "with no good copy anywhere nothing is used", JSON.stringify(f3));
  ok((await verifyModel(join(tmp, "nowhere")) as any).state === "missing", "a folder that is not there is missing"); }
{ const m = new Map(KOKORO.files.map((f) => [f[0], f[2]]));
  ok(Object.entries(KOKORO.pins).every(([f, h]) => m.get(f) === h) && KOKORO.revision === "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b" && KOKORO.files.length > 300 && kokoroBytes() > 380e6,
    "the manifest pins the revision and every file; its four largest files match the SHA-256 pinned in code", String(KOKORO.files.length));
  ok(KOKORO.files.every(([p]) => !p.startsWith("/") && !p.split("/").includes("..")), "no manifest path leaves the model folder"); }

// ---------- the pinned download (Doctor's install), from a local server ----------
{ const srcDir = join(tmp, "dl-src"); makeModel(srcDir); writeFileSync(join(srcDir, "model.onnx"), Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 251))); const sp = spec(srcDir), tools = join(tmp, "dl-tools"); mkdirSync(tools, { recursive: true });
  copyFileSync(join(root, "src/voice/fetch-model.cjs"), join(tools, "fetch-model.cjs"));
  writeFileSync(join(tools, "kokoro-manifest.json"), JSON.stringify({ repo: "csukuangfj/kokoro-multi-lang-v1_0", revision: sp.revision, files: sp.files }));
  let mode: "good" | "tamper" | "redirect" | "big" | "stall" | "short" = "good"; const served: string[] = [], ranges: string[] = [];
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { const u = new URL(req.url); if (u.pathname === "/elsewhere") return new Response("x");
    const p = decodeURIComponent(u.pathname.split(`/resolve/${sp.revision}/`)[1] ?? ""); served.push(p);
    const f = join(srcDir, p); if (!p || !existsSync(f)) return new Response("no", { status: 404 });
    if (mode === "redirect" && p === "voices.bin") return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${srv.port}/elsewhere` } });
    if (mode === "big" && p === "voices.bin") return new Response(Buffer.alloc(5_000_000, 1));
    const b = readFileSync(f), range = /^bytes=(\d+)-$/.exec(req.headers.get("range") ?? "");
    if (range) { ranges.push(`${p}:${range[1]}`); const at = Number(range[1]), upto = mode === "short" ? at + Math.floor((b.length - at) / 2) : b.length; return new Response(b.subarray(at, upto), { status: 206, headers: { "content-range": `bytes ${at}-${b.length - 1}/${b.length}` } }); }
    // a slow network: half of model.onnx, then nothing more
    if (mode === "stall" && p === "model.onnx") return new Response(new ReadableStream({ start(c) { c.enqueue(b.subarray(0, 100_000)); }, pull() { return new Promise(() => {}); } }));
    return new Response(mode === "tamper" && p === "voices.bin" ? Buffer.from("VOICEX") : b); } });
  const fetchModel = async (models: string) => { const p = Bun.spawn(["node", join(tools, "fetch-model.cjs"), "--models", models], { env: { PATH: process.env.PATH!, CREW_VOICE_MODEL_BASE: `http://127.0.0.1:${srv.port}`, CREW_VOICE_FETCH_STALL_MS: "400" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); return { exitCode, stdout, stderr }; };
  const leftovers = (d: string) => { const out: string[] = []; const walk = (x: string) => { for (const n of (existsSync(x) ? readdirSync(x) : [])) { const f = join(x, n); if (statSync(f).isDirectory()) walk(f); else if (n.endsWith(".download")) out.push(n); } }; walk(d); return out; };
  const models = join(tmp, "dl-models"), r1 = await fetchModel(models), dest = join(models, "kokoro-multi-lang-v1_0");
  ok(r1.exitCode === 0 && readFileSync(join(dest, ".complete"), "utf8").trim() === sp.revision && (await verifyModel(dest, { spec: sp, memo: false })).ok && !existsSync(dest + ".partial") && served.length === sp.files.length,
    "the download fetches every pinned file at the pinned revision, verifies it, marks it complete and moves it into place", r1.stderr + r1.stdout);
  for (const [m, want, name] of [["tamper", /does not match the pin/, "a file that does not match its pinned SHA-256"], ["redirect", /non-HTTPS/, "a redirect to plain http"], ["big", /larger than its pinned/, "a file larger than its pin"]] as const) {
    mode = m; const out = join(tmp, `dl-${m}`), r = await fetchModel(out);
    ok(r.exitCode === 1 && want.test(r.stderr) && !existsSync(join(out, "kokoro-multi-lang-v1_0")) && !existsSync(join(out, "kokoro-multi-lang-v1_0.partial", ".complete")) && !leftovers(out).length, `${name} stops the download: nothing put in place, no .download left`, r.stderr); }
  // resume: the files a stopped download verified are kept (hashed again), the rest fetched
  mode = "tamper"; const res = join(tmp, "dl-resume"); await fetchModel(res); mode = "good"; served.length = 0; const r2 = await fetchModel(res);
  ok(r2.exitCode === 0 && served.length < sp.files.length && served.includes("voices.bin") && /kept from an earlier try/.test(r2.stdout) && (await verifyModel(join(res, "kokoro-multi-lang-v1_0"), { spec: sp, memo: false })).ok, "a second press resumes: verified files are kept, the failed one fetched again", JSON.stringify({ served, out: r2.stdout.slice(-200) }));
  // a transfer cut short keeps its bytes; the next press hashes them and asks only for the rest (HTTP Range), then verifies
  mode = "stall"; const slow = join(tmp, "dl-slow"), cut = await fetchModel(slow), part = join(slow, "kokoro-multi-lang-v1_0.partial", "model.onnx.download");
  const kept = existsSync(part) ? statSync(part).size : -1;
  ok(cut.exitCode === 1 && /stalled/.test(cut.stderr) && kept === 100_000, "a stalled transfer stops the press and keeps the bytes it got in .download", JSON.stringify({ err: cut.stderr.slice(-160), kept }));
  mode = "good"; ranges.length = 0; const on = await fetchModel(slow);
  ok(on.exitCode === 0 && JSON.stringify(ranges) === JSON.stringify(["model.onnx:100000"]) && /resumed model\.onnx from byte 100000/.test(on.stdout) && (await verifyModel(join(slow, "kokoro-multi-lang-v1_0"), { spec: sp, memo: false })).ok,
    "the next press resumes model.onnx from byte 100000 with a Range request and the whole file verifies", JSON.stringify({ ranges, out: on.stdout.slice(-200), err: on.stderr }));
  // a Range answer shorter than asked: what came is kept, and the press after resumes from there
  mode = "stall"; const shortDir = join(tmp, "dl-short"); await fetchModel(shortDir); mode = "short"; const sh1 = await fetchModel(shortDir), sp1 = join(shortDir, "kokoro-multi-lang-v1_0.partial", "model.onnx.download");
  const keptShort = existsSync(sp1) ? statSync(sp1).size : -1;
  ok(sh1.exitCode === 1 && /ended at 150000 of 200000/.test(sh1.stderr) && keptShort === 150_000, "a Range answer that ends short keeps its bytes instead of erasing the progress", JSON.stringify({ err: sh1.stderr.slice(-160), keptShort }));
  mode = "good"; ranges.length = 0; const sh2 = await fetchModel(shortDir);
  ok(sh2.exitCode === 0 && JSON.stringify(ranges) === JSON.stringify(["model.onnx:150000"]) && (await verifyModel(join(shortDir, "kokoro-multi-lang-v1_0"), { spec: sp, memo: false })).ok, "and the next press resumes from byte 150000 and verifies", JSON.stringify({ ranges, err: sh2.stderr }));
  // kept bytes that are not the file's: the whole file then fails its pin, and only then is .download deleted
  mode = "stall"; const bad = join(tmp, "dl-badpart"); await fetchModel(bad); const bp = join(bad, "kokoro-multi-lang-v1_0.partial", "model.onnx.download");
  writeFileSync(bp, Buffer.alloc(100_000, 9)); mode = "good"; const wrongPart = await fetchModel(bad);
  ok(wrongPart.exitCode === 1 && /does not match the pin/.test(wrongPart.stderr) && !existsSync(bp), "resumed bytes that do not hash to the pin are thrown away with the attempt", wrongPart.stderr);
  const again = await fetchModel(bad); ok(again.exitCode === 0, "and the press after that fetches the file whole", again.stderr);
  const press = /const PRESS_MS = (\d+) \* 60_000;/.exec(readFileSync(join(root, "src/voice/fetch-model.cjs"), "utf8")), runner = /setTimeout\(\(\) => \{ try \{ p\.kill\(\); \} catch \{\} \}, (\d+) \* 60_000\)/.exec(readFileSync(join(root, "src/doctor.ts"), "utf8"));
  ok(!!press && !!runner && Number(press[1]) < Number(runner[1]), "a press ends on its own before Doctor's installer timeout, keeping what it has", JSON.stringify([press?.[1], runner?.[1]]));
  srv.stop(true); }

// ---------- the runtime: Studio's own pinned sherpa-onnx-node, accepted only with the pinned integrity ----------
{ const dir = join(tmp, "rt"), plat = platformPackage();
  const install = (integrity: Record<string, string>, version = SHERPA_VERSION) => { for (const name of ["sherpa-onnx-node", plat]) { mkdirSync(join(dir, "node_modules", name), { recursive: true }); writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version })); }
    writeFileSync(join(dir, "node_modules", plat, "sherpa-onnx.node"), "addon");
    writeFileSync(join(dir, "node_modules", ".package-lock.json"), JSON.stringify({ packages: Object.fromEntries(["sherpa-onnx-node", plat].map((n) => [`node_modules/${n}`, { version, integrity: integrity[n] }])) })); };
  process.env.CREW_NODE_BIN = process.execPath;
  ok(!runtimeState(dir).ok && /not installed/.test(runtimeState(dir).why!), "no runtime installed: not ready");
  install(SHERPA_PINS); ok(runtimeState(dir).ok, "the pinned packages with their registry integrity: ready", JSON.stringify(runtimeState(dir)));
  install({ ...SHERPA_PINS, [plat]: "sha512-other" }); ok(!runtimeState(dir).ok && /pinned build/.test(runtimeState(dir).why!), "a platform package with another integrity is refused", runtimeState(dir).why!);
  install(SHERPA_PINS, "1.14.0"); ok(!runtimeState(dir).ok && /pins 1\.13\.8/.test(runtimeState(dir).why!), "another version is refused", runtimeState(dir).why!);
  process.env.CREW_NODE_BIN = "/nonexistent/node"; ok(!runtimeState(dir).ok && /Node/.test(runtimeState(dir).why!), "without Node it cannot run"); delete process.env.CREW_NODE_BIN;
  ok(/--save-exact/.test(installCommand()) && /--ignore-scripts/.test(installCommand()) && installCommand().includes(`sherpa-onnx-node@${SHERPA_VERSION}`) && installCommand("x64").includes(`sherpa-onnx-darwin-x64@${SHERPA_VERSION}`) && installCommand("arm64").includes(`--prefix '${process.env.CREW_VOICE_TOOLS}'`),
    "Doctor's install pins both packages exactly, runs no install script and stays in the runtime folder", installCommand());
  const t = join(tmp, "scripts"); ok(ensureScripts(t) && ["sidecar.cjs", "fetch-model.cjs", "kokoro-manifest.json"].every((n) => existsSync(join(t, n))) && JSON.parse(readFileSync(join(t, "kokoro-manifest.json"), "utf8")).revision === KOKORO.revision, "Studio writes its own sidecar, download script and manifest into the runtime folder when asked"); }
{ process.env.CREW_VOICE_TOOLS = join(tmp, "untouched-tools");
  const d = await voiceDoctorInput(null), st = await voiceStatus(true);
  ok(!existsSync(process.env.CREW_VOICE_TOOLS) && d.model.ok === false, "a Doctor view writes nothing: Studio's scripts go in place only on an install or a synthesis");
  ok(!/\/(Users|home|private|var|tmp)\//.test(JSON.stringify(st)) && typeof st.ready === "boolean" && st.engine === ENGINE_VERSION && !("dir" in (st.runtime as any)), "the voice status names no path of this Mac: only booleans, versions and voices", JSON.stringify(st));
  const srv = readFileSync(join(root, "src/server.ts"), "utf8");
  ok(/who\.kind === "desktop" \? v : \{ ready: false, engine: v\.engine, desktopOnly: true \}/.test(srv), "a phone is told only that the voice speaks on the Mac"); }

// ---------- this Mac's voices: read asynchronously, one osascript at a time, never blocking Studio ----------
{ const { macVoices } = await import("../src/voice/mac"); let runs = 0, finish!: (v: string) => void;
  const slow = () => { runs++; return new Promise<string | null>((r) => (finish = r)); };
  const a = macVoices(true, slow), b = macVoices(false, slow); let ticked = false; setTimeout(() => (ticked = true), 0); await Bun.sleep(20);
  ok(ticked && runs === 1, "while osascript runs Studio keeps answering (a timer fires), and a second ask shares the first", JSON.stringify({ ticked, runs }));
  finish(JSON.stringify([["zh-TW", "Meijia", 1, "com.apple.voice.compact.zh-TW.Meijia"], ["en-US", "Zarvox", 1, "com.apple.speech.synthesis.voice.Zarvox"], ["en-US", "Ava", 3, "com.apple.voice.premium.en-US.Ava"]]));
  const [va, vb] = (await Promise.race([Promise.all([a, b]), Bun.sleep(2000).then(() => [null, undefined])])) as any[];
  ok(JSON.stringify(va?.map((v) => v.name)) === JSON.stringify(["Ava", "Meijia"]) && va === vb && (await macVoices(false, slow)) === va && runs === 1, "both get the same answer, best first, novelty voices out; it is remembered", JSON.stringify(va));
  ok(!/spawnSync/.test(readFileSync(join(root, "src/voice/mac.ts"), "utf8")) && /macVoices\(\)\.then\(\(mac\) => voiceDoctorInput\(mac\)\)/.test(readFileSync(join(root, "src/server.ts"), "utf8")), "Doctor waits for it inside its bounded race, never synchronously"); }

// ---------- Doctor: the voice group, found / missing / corrupt / crashing ----------
{ const rtOk = { ok: true, node: "/usr/bin/node", dir: "~/.crew-studio/tools/voice", version: SHERPA_VERSION, why: null }, rtNo = { ok: false, node: "/usr/bin/node", dir: "", version: null, why: "sherpa-onnx-node is not installed" };
  const mac = [{ lang: "zh-TW", name: "Meijia", quality: 1 as const, id: "com.apple.voice.compact.zh-TW.Meijia" }, { lang: "en-US", name: "Samantha", quality: 1 as const, id: "com.apple.voice.compact.en-US.Samantha" }];
  const rows = (o: any) => Object.fromEntries(voiceItems({ runtime: rtOk, model: { ok: true, source: "agent-wardrobe", why: null }, bytes: kokoroBytes(), voices: { ...DEFAULT_VOICE }, mac, ...o }).map((x) => [x.id, x]));
  const found = rows({});
  ok(Object.keys(found).join() === "voice-runtime,voice-tts,voice-mac" && Object.values(found).every((x: any) => x.group === "voice"), "Doctor has a voice group of three rows");
  ok(Object.values(found).every((x: any) => /no text or audio leaves it/.test(x.detail) && /不離開這台 Mac/.test(x.detailZh)) && /Apache-2\.0/.test(found["voice-runtime"].detail) && /Apache-2\.0/.test(found["voice-tts"].detail) && /Apache-2\.0/.test(found["voice-tts"].detailZh), "each row states its licence and that nothing leaves this Mac");
  ok(found["voice-tts"].status === "ok" && /Agent Wardrobe/.test(found["voice-tts"].detail) && /zf_xiaobei/.test(found["voice-tts"].detail) && found["voice-tts"].action.kind === "listen" && found["voice-runtime"].status === "ok", "found: the model is verified, from Agent Wardrobe, with a test phrase to play", JSON.stringify(found["voice-tts"]));
  const missing = rows({ runtime: rtNo, model: { ok: false, source: null, state: "missing", why: null } });
  ok(missing["voice-tts"].status === "info" && (missing["voice-tts"].action as any).item === "voice-tts" && /401 MB/.test(missing["voice-tts"].detail) && /401 MB/.test(missing["voice-tts"].fixZh!) && (missing["voice-runtime"].action as any).item === "voice-runtime", "missing: a one-click download that shows its size, and a one-click runtime install", JSON.stringify(missing["voice-tts"]));
  const noNode = rows({ runtime: { ...rtNo, node: null, why: "Node.js is not installed" } }); ok((noNode["voice-runtime"].action as any).item === "node", "without Node the runtime row offers Node first");
  const corrupt = rows({ model: { ok: false, source: null, state: "corrupt", why: "Agent Wardrobe's copy: 1 file(s) do not match the pinned SHA-256 (model.onnx)" } });
  ok(corrupt["voice-tts"].status === "degraded" && corrupt["voice-tts"].availability === "unusable" && /Refused/.test(corrupt["voice-tts"].detail) && /model\.onnx/.test(corrupt["voice-tts"].detail) && (corrupt["voice-tts"].action as any).item === "voice-tts", "corrupt: refused with the reason, and Studio's own copy offered", JSON.stringify(corrupt["voice-tts"]));
  const crash = rows({ crashing: true }); ok(crash["voice-tts"].status === "degraded" && /一直當掉/.test(crash["voice-tts"].detailZh!) && /keeps crashing/.test(crash["voice-tts"].detail), "an engine that keeps crashing shows on the model's row", JSON.stringify(crash["voice-tts"]));
  ok(found["voice-mac"].status === "info" && /Spoken Content/.test(found["voice-mac"].fix) && /語音內容/.test(found["voice-mac"].fixZh!) && /Meijia \(compact\)/.test(found["voice-mac"].detail), "only compact Mac voices: a tip to download Premium or Enhanced ones in System Settings", JSON.stringify(found["voice-mac"]));
  const better = rows({ mac: [{ ...mac[0], quality: 3 }, { ...mac[1], quality: 2, name: "Ava" }] }); ok(better["voice-mac"].status === "ok" && !better["voice-mac"].fix && /Meijia \(Premium\)/.test(better["voice-mac"].detail), "Premium and Enhanced voices: no tip");
  const tts = methodsFor("voice-tts", "darwin")[0], rt = methodsFor("voice-runtime", "darwin")[0];
  ok(/fetch-model\.cjs/.test(tts.argv.join(" ")) && /401 MB/.test(tts.label) && tts.needs.join() === "node" && /f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b/.test(tts.source) && !tts.admin, "the model's installer: the pinned download, its size and revision named, no admin rights", JSON.stringify(tts));
  ok(rt.argv.join(" ").includes(installCommand()) && rt.needs.join() === "npm", "the runtime's installer is the pinned npm line");
  // CREW_VOICE_TOOLS and CREW_VOICE_MODELS set: Doctor installs and downloads into exactly the folders Studio then reads
  const was = [process.env.CREW_VOICE_TOOLS, process.env.CREW_VOICE_MODELS];
  process.env.CREW_VOICE_TOOLS = join(tmp, "own tools"); process.env.CREW_VOICE_MODELS = join(tmp, "own models");
  const rt2 = methodsFor("voice-runtime", "darwin")[0].argv.join(" "), tts2 = methodsFor("voice-tts", "darwin")[0].argv.join(" ");
  ok(rt2.includes(`mkdir -p '${join(tmp, "own tools")}'`) && rt2.includes(`--prefix '${join(tmp, "own tools")}'`) && !rt2.includes("~/.crew-studio") && tts2.includes(`node '${join(tmp, "own tools", "fetch-model.cjs")}' --models '${join(tmp, "own models")}'`),
    "with the folders configured, Doctor's install and download use them (the download is told its models folder)", JSON.stringify({ rt2, tts2 }));
  ensureScripts(); const fm = join(tmp, "own tools", "fetch-model.cjs");
  ok(existsSync(fm) && tts2.includes(fm), "and the download script is where that command runs it");
  [process.env.CREW_VOICE_TOOLS, process.env.CREW_VOICE_MODELS] = was; }
end();
