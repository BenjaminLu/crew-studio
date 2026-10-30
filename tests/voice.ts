import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's local neural voice (src/voice): the sidecar's stdio protocol against a fake engine (one request at a
// time, timeouts, a crash, idle exit and restart, the least environment, text never on argv, no network and no writes
// under sandbox-exec), mixed Chinese/English runs, clip cache keys, the pinned model's verification (a good copy is
// accepted, a wrong checksum or marker refused, Agent Wardrobe's folder never written), the pinned download, and Doctor's
// voice rows for found, missing and corrupt. No real model, runtime, network or paid model.        bun tests/voice.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { suite } from "./rt-harness";
const { ok, end } = suite("voice");
const root = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "crew-voice-"));
process.env.CREW_VOICE_MODELS = join(tmp, "studio-models"); process.env.CREW_VOICE_TOOLS = join(tmp, "tools");
const { Sidecar, sidecarArgv, sidecarEnv } = await import("../src/voice/sidecar");
const { splitRuns, SPEAKERS, DEFAULT_VOICE, langOf } = await import("../src/voice/runs");
const { kokoroSpeaker, clipName, roomClip, readClip, ENGINE_VERSION, MAX_CLIPS } = await import("../src/voice/kokoro");
const { verifyModel, findKokoro, KOKORO, kokoroBytes } = await import("../src/voice/models");
const { wav, wavInfo, trimSilence } = await import("../src/voice/wav");
const { runtimeState, SHERPA_PINS, SHERPA_VERSION, installCommand, platformPackage, ensureScripts } = await import("../src/voice/runtime");
const { voiceItems, methodsFor } = await import("../src/doctor");
const fake = join(root, "tests/fixture/fake-voice-sidecar.cjs");
const sandboxed = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
const mk = (o: Record<string, any> = {}) => new Sidecar({ node: process.execPath, script: fake, config: { model: "fake" }, idleMs: 60_000, timeoutMs: 1500, loadTimeoutMs: 5000, ...o });

// ---------- the protocol ----------
process.env.OPENAI_API_KEY = "sk-test-not-for-the-sidecar";
{ const s = mk();
  const outs = await Promise.all(["one", "two", "three"].map((t) => s.tts(t, 45)));
  const ping: any = await s.request({ op: "ping" });
  ok(outs.map((o) => o.pcm.length).join() === "24,24,40" && outs.every((o) => o.sampleRate === 24000) && ping.loaded?.model === "fake", "the model is loaded first, then each run comes back as 16-bit PCM", JSON.stringify(outs.map((o) => o.pcm.length)));
  ok(ping.most === 1, "one request at a time: three asked together reach the engine one after another", String(ping.most));
  ok(!ping.argv.some((a: string) => /one|two|three/.test(a)) && !sidecarArgv({ node: "node", script: "s.cjs" }).some((a) => /one/.test(a)), "the room's text is sent on stdin, never on argv", JSON.stringify(ping.argv));
  const extra = ping.env.filter((k: string) => !Object.keys(sidecarEnv()).includes(k) && !/^(__CF_USER_TEXT_ENCODING|BUN_.*|_|PWD|SHLVL|OLDPWD|TMPDIR)$/.test(k));
  ok(!ping.env.includes("OPENAI_API_KEY") && !ping.env.includes("HOME") && !extra.length, "the engine gets the least environment: no credential, no home, nothing of Studio's", JSON.stringify(ping.env));
  s.stop(); }
{ const argv = sidecarArgv({ node: "/x/node", script: "/x/sidecar.cjs", sandbox: true });
  ok(argv[0] === "/usr/bin/sandbox-exec" && /deny network\*/.test(argv[2]) && /deny file-write\*/.test(argv[2]) && argv.slice(-2).join() === "/x/node,/x/sidecar.cjs", "on macOS the engine runs under sandbox-exec with no network and no file writes", JSON.stringify(argv)); }
if (sandboxed) { const s = mk({ sandbox: true }); const r: any = await s.request({ op: "tts", text: "PROBE", sid: 0 });
  ok(r.net !== "allowed" && r.write !== "allowed", "inside the sandbox the engine can neither reach the network nor write a file", JSON.stringify(r)); s.stop(); }
{ const s = mk({ timeoutMs: 400 }); const t0 = Date.now(); let err: any = null; try { await s.tts("HANG", 45); } catch (e) { err = e; }
  ok(/longer than/.test(err?.message ?? "") && Date.now() - t0 < 3000 && !s.running, "a synthesis that never answers times out and the engine is stopped", err?.message);
  const again = await s.tts("after", 45);
  ok(again.pcm.length === 40 && s.starts === 2, "the next request starts it again", String(s.starts)); s.stop(); }
{ const s = mk(); let err: any = null; try { await s.tts("CRASH", 45); } catch (e) { err = e; }
  ok(/exit 5/.test(err?.message ?? ""), "a crashed engine fails its request with its exit", err?.message);
  ok((await s.tts("ok", 45)).pcm.length === 16 && s.starts === 2, "and the next request starts a fresh one"); s.stop(); }
{ const s = mk({ idleMs: 250 }); await s.tts("hi", 45); await Bun.sleep(700);
  ok(!s.running, "the engine exits by itself after being idle");
  ok((await s.tts("back", 45)).pcm.length === 32 && s.starts === 2, "and comes back for the next point, reloading the model", String(s.starts)); s.stop(); }

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

// ---------- clips: keyed by text, voices, mix, language and engine; made once, kept in the room ----------
{ const v = DEFAULT_VOICE, base = clipName("一點", { lang: "zh", mode: "switch", voices: v });
  const variants = [clipName("另一點", { lang: "zh", mode: "switch", voices: v }), clipName("一點", { lang: "zh", mode: "same", voices: v }), clipName("一點", { lang: "en", mode: "switch", voices: v }),
    clipName("一點", { lang: "zh", mode: "switch", voices: { ...v, zh: "zf_xiaoxiao" } }), clipName("一點", { lang: "zh", mode: "switch", voices: { ...v, en: "bf_emma" } }), clipName("一點", { lang: "zh", mode: "switch", voices: v, engine: "kokoro@other" })];
  ok(/^kvoice-[0-9a-f]{16}\.wav$/.test(base) && base === clipName("一點", { lang: "zh", mode: "switch", voices: v }) && new Set([base, ...variants]).size === 7, "a clip's name changes with its text, mix, language, either voice and the engine version; the same point keeps its name", JSON.stringify([base, ...variants]));
  ok(ENGINE_VERSION.includes(KOKORO.revision.slice(0, 12)) && ENGINE_VERSION.includes(`sherpa-onnx-node@${SHERPA_VERSION}`), "the engine version names the model revision and the runtime", ENGINE_VERSION);
  const dir = join(tmp, "room-a"); let calls = 0;
  const speaker = async (t: string) => { calls++; await Bun.sleep(30); return { bytes: wav([Buffer.alloc(200)], 24000), model: "k", voice: "zf_xiaobei" }; };
  const [a, b] = await Promise.all([roomClip(dir, "第一點", { lang: "zh", mode: "switch", speaker }), roomClip(dir, "第一點", { lang: "zh", mode: "switch", speaker })]);
  const c = await roomClip(dir, "第一點", { lang: "zh", mode: "switch", speaker });
  ok(!a.cached && a.name === b.name && c.cached && calls === 1 && !!readClip(dir, a.name), "a point's clip is made once (two asks at once make one), then served from the room's folder", JSON.stringify({ a, c, calls }));
  ok(readClip(dir, "../room.json") === null && readClip(dir, "voice-t1-0123456789ab.mp3") === null, "only a clip's own name is served");
  let reset: any = null; try { await roomClip(dir, "第二點", { lang: "zh", mode: "switch", speaker, alive: () => false }); } catch (e) { reset = e; }
  ok(reset?.code === "reset" && readdirSync(dir).filter((n) => n.endsWith(".wav")).length === 1, "a room started over while its clip was made keeps nothing of it");
  let bad: any = null; try { await roomClip(dir, "x", { lang: "zh", mode: "loud" as any, speaker }); } catch (e) { bad = e; } ok(/mix/.test(bad?.message ?? ""), "an unknown mix mode is refused");
  ok(MAX_CLIPS >= 100, "a room keeps a bounded number of clips"); }

// ---------- the pinned model: a good copy is accepted, a wrong one refused, Agent Wardrobe's folder never written ----------
const spec = (dir: string) => { const files: [string, number, string][] = []; const walk = (d: string) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (n !== ".complete") { const b = readFileSync(f); files.push([relative(dir, f), b.length, createHash("sha256").update(b).digest("hex")]); } } }; walk(dir); return { revision: "r".repeat(40), files: files.sort() }; };
const makeModel = (dir: string) => { mkdirSync(join(dir, "dict"), { recursive: true }); writeFileSync(join(dir, "model.onnx"), "model-bytes"); writeFileSync(join(dir, "voices.bin"), "voices"); writeFileSync(join(dir, "dict", "jieba.dict.utf8"), "詞"); };
const snapshot = (dir: string) => { const out: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const f = join(d, n), s = statSync(f); out.push(`${relative(dir, f)}:${s.size}:${s.mtimeMs}:${s.isDirectory() ? "d" : createHash("sha256").update(readFileSync(f)).digest("hex")}`); if (s.isDirectory()) walk(f); } }; walk(dir); return out.join("\n"); };
{ const aw = join(tmp, "Agent Wardrobe", "models"), good = join(aw, "kokoro-multi-lang-v1_0"); makeModel(good); const sp = spec(good); writeFileSync(join(good, ".complete"), sp.revision + "\n");
  const before = snapshot(aw);
  process.env.CREW_VOICE_WARDROBE = aw;
  const v1 = verifyModel(good, { spec: sp }), v2 = verifyModel(good, { spec: sp }), f = findKokoro(true, sp);
  ok(v1.ok && v2.ok && f.ok && f.source === "agent-wardrobe", "Agent Wardrobe's copy is used when its marker, revision and every SHA-256 match the pins", JSON.stringify({ v1, f }));
  ok(snapshot(aw) === before && existsSync(join(process.env.CREW_VOICE_MODELS!, ".verified.json")), "verifying it never writes into Agent Wardrobe's folder: the memo lives in Studio's models folder");
  // the same size, other bytes: the memo of the good copy does not hide it (its mtime changed)
  writeFileSync(join(good, "voices.bin"), "VOICES"); const t = new Date(Date.now() + 5000); utimesSync(join(good, "voices.bin"), t, t);
  const wrong = verifyModel(good, { spec: sp });
  ok(!wrong.ok && wrong.state === "corrupt" && /SHA-256/.test(wrong.why) && wrong.bad?.join() === "voices.bin", "a file with a wrong checksum is refused", JSON.stringify(wrong));
  writeFileSync(join(good, "voices.bin"), "voices");
  writeFileSync(join(good, ".complete"), "f".repeat(40)); const rev = verifyModel(good, { spec: sp });
  ok(!rev.ok && rev.state === "corrupt" && /another revision/.test(rev.why), "a marker naming another revision is refused", JSON.stringify(rev));
  writeFileSync(join(good, ".complete"), ""); const inc = verifyModel(good, { spec: sp });
  ok(!inc.ok && inc.state === "incomplete", "a folder without its .complete marker is an unfinished download", JSON.stringify(inc));
  writeFileSync(join(good, ".complete"), sp.revision); writeFileSync(join(good, "model.onnx"), "short"); const size = verifyModel(good, { spec: sp });
  ok(!size.ok && size.state === "corrupt" && /wrong size/.test(size.why), "a file of the wrong size is refused before any hashing", JSON.stringify(size));
  // Studio's own copy is used when Agent Wardrobe's is refused
  const own = join(process.env.CREW_VOICE_MODELS!, "kokoro-multi-lang-v1_0"); makeModel(own); writeFileSync(join(own, ".complete"), sp.revision);
  const f2 = findKokoro(true, sp);
  ok(f2.ok && f2.source === "studio", "when Agent Wardrobe's copy is refused, Studio's own verified copy is used", JSON.stringify(f2));
  process.env.CREW_VOICE_WARDROBE = "none"; writeFileSync(join(own, "model.onnx"), "MODEL-BYTES"); utimesSync(join(own, "model.onnx"), t, t);
  const f3 = findKokoro(true, sp);
  ok(!f3.ok && f3.tried.length === 1 && f3.tried[0].source === "studio" && !f3.tried[0].ok && f3.tried[0].state === "corrupt", "with no good copy anywhere nothing is used", JSON.stringify(f3));
  ok(!verifyModel(join(tmp, "nowhere")).ok && (verifyModel(join(tmp, "nowhere")) as any).state === "missing", "a folder that is not there is missing"); }
{ const m = new Map(KOKORO.files.map((f) => [f[0], f[2]]));
  ok(Object.entries(KOKORO.pins).every(([f, h]) => m.get(f) === h) && KOKORO.revision === "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b" && KOKORO.files.length > 300 && kokoroBytes() > 380e6,
    "the manifest pins the revision and every file; its four largest files match the SHA-256 pinned in code", String(KOKORO.files.length));
  ok(KOKORO.files.every(([p]) => !p.startsWith("/") && !p.split("/").includes("..")), "no manifest path leaves the model folder"); }

// ---------- the pinned download (Doctor's install), from a local server ----------
{ const srcDir = join(tmp, "dl-src"); makeModel(srcDir); const sp = spec(srcDir), tools = join(tmp, "dl-tools"); mkdirSync(tools, { recursive: true });
  copyFileSync(join(root, "src/voice/fetch-model.cjs"), join(tools, "fetch-model.cjs"));
  writeFileSync(join(tools, "kokoro-manifest.json"), JSON.stringify({ repo: "csukuangfj/kokoro-multi-lang-v1_0", revision: sp.revision, files: sp.files }));
  let tamper = false; const served: string[] = [];
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { const p = decodeURIComponent(new URL(req.url).pathname.split(`/resolve/${sp.revision}/`)[1] ?? ""); served.push(p);
    const f = join(srcDir, p); if (!p || !existsSync(f)) return new Response("no", { status: 404 }); const b = readFileSync(f); return new Response(tamper && p === "voices.bin" ? Buffer.from("VOICEX") : b); } });
  const fetchModel = async (models: string) => { const p = Bun.spawn(["node", join(tools, "fetch-model.cjs"), "--models", models], { env: { PATH: process.env.PATH!, CREW_VOICE_MODEL_BASE: `http://127.0.0.1:${srv.port}` }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); return { exitCode, stdout: { toString: () => stdout }, stderr: { toString: () => stderr } }; };
  const models = join(tmp, "dl-models"), r1 = await fetchModel(models), dest = join(models, "kokoro-multi-lang-v1_0");
  ok(r1.exitCode === 0 && readFileSync(join(dest, ".complete"), "utf8").trim() === sp.revision && verifyModel(dest, { spec: sp, memo: false }).ok && !existsSync(dest + ".partial") && served.length === sp.files.length,
    "the download fetches every pinned file at the pinned revision, verifies it, marks it complete and moves it into place", r1.stderr.toString() + r1.stdout.toString());
  tamper = true; const models2 = join(tmp, "dl-models-2"), r2 = await fetchModel(models2);
  ok(r2.exitCode === 1 && /does not match the pin/.test(r2.stderr.toString()) && !existsSync(join(models2, "kokoro-multi-lang-v1_0")) && !existsSync(join(models2, "kokoro-multi-lang-v1_0.partial", ".complete")), "a file that does not match its pinned SHA-256 stops the download: nothing is put in place", r2.stderr.toString());
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
  ok(/--save-exact/.test(installCommand()) && /--ignore-scripts/.test(installCommand()) && installCommand().includes(`sherpa-onnx-node@${SHERPA_VERSION}`) && installCommand("x64").includes(`sherpa-onnx-darwin-x64@${SHERPA_VERSION}`) && installCommand("arm64").includes("~/.crew-studio/tools/voice"),
    "Doctor's install pins both packages exactly, runs no install script and stays in ~/.crew-studio/tools/voice", installCommand());
  const t = join(tmp, "scripts"); ok(ensureScripts(t) && ["sidecar.cjs", "fetch-model.cjs", "kokoro-manifest.json"].every((n) => existsSync(join(t, n))) && JSON.parse(readFileSync(join(t, "kokoro-manifest.json"), "utf8")).revision === KOKORO.revision, "Studio writes its own sidecar, download script and manifest into the runtime folder"); }

// ---------- Doctor: the voice group, found / missing / corrupt ----------
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
  ok(found["voice-mac"].status === "info" && /Spoken Content/.test(found["voice-mac"].fix) && /語音內容/.test(found["voice-mac"].fixZh!) && /Meijia \(compact\)/.test(found["voice-mac"].detail), "only compact Mac voices: a tip to download Premium or Enhanced ones in System Settings", JSON.stringify(found["voice-mac"]));
  const better = rows({ mac: [{ ...mac[0], quality: 3 }, { ...mac[1], quality: 2, name: "Ava" }] }); ok(better["voice-mac"].status === "ok" && !better["voice-mac"].fix && /Meijia \(Premium\)/.test(better["voice-mac"].detail), "Premium and Enhanced voices: no tip");
  const tts = methodsFor("voice-tts", "darwin")[0], rt = methodsFor("voice-runtime", "darwin")[0];
  ok(/fetch-model\.cjs/.test(tts.argv.join(" ")) && /401 MB/.test(tts.label) && tts.needs.join() === "node" && /f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b/.test(tts.source) && !tts.admin, "the model's installer: the pinned download, its size and revision named, no admin rights", JSON.stringify(tts));
  ok(rt.argv.join(" ").includes(installCommand()) && rt.needs.join() === "npm", "the runtime's installer is the pinned npm line"); }
end();
