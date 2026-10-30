// Downloads the review room's local voice model into Studio's own models folder, only when the captain presses Install
// in Doctor (Doctor runs: node ~/.crew-studio/tools/voice/fetch-model.cjs). Every file comes from one pinned Hugging Face
// revision over HTTPS (a redirect to anything but https is refused) and must match the pinned size and SHA-256 in
// kokoro-manifest.json beside this file; anything else stops the download. Files go into <name>.partial, each first as
// <file>.download, renamed only once verified. A press that stalls, runs out of its time or is killed keeps what it
// wrote; the next press hashes those bytes again and asks for the rest with an HTTP Range request (a slow network still
// finishes, press by press). A .download is deleted only when its whole file does not match its pin, or grows past it.
// A finished, verified folder gets .complete (the revision) and is renamed into place.
//   --models <dir>   the models folder (default ~/.crew-studio/models)
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "kokoro-manifest.json"), "utf8"));
const NAME = "kokoro-multi-lang-v1_0";
const at = process.argv.indexOf("--models"), models = at > 0 ? process.argv[at + 1] : path.join(os.homedir(), ".crew-studio", "models");
const final = path.join(models, NAME), partial = final + ".partial";
const total = m.files.reduce((n, f) => n + f[1], 0), mb = (n) => (n / 1e6).toFixed(1);
// tests serve the files from this machine (CREW_VOICE_MODEL_BASE, loopback only, and may shorten the stall timeout);
// everything else comes from Hugging Face
const local = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.CREW_VOICE_MODEL_BASE || "") ? process.env.CREW_VOICE_MODEL_BASE : null;
const STALL_MS = local && Number(process.env.CREW_VOICE_FETCH_STALL_MS) > 0 ? Number(process.env.CREW_VOICE_FETCH_STALL_MS) : 30_000;
/** a file may take a minute plus the time it needs at 200 kB/s */
const deadline = (size) => 60_000 + Math.ceil(size / 200_000) * 1000;
const url = (p) => `${local || "https://huggingface.co"}/${m.repo}/resolve/${m.revision}/${p.split("/").map(encodeURIComponent).join("/")}`;
const inside = (rel) => { const p = path.normalize(path.join(partial, rel)); if (!p.startsWith(path.normalize(partial) + path.sep)) throw new Error(`a manifest path leaves the folder: ${rel}`); return p; };
const hashOf = (f) => new Promise((ok, bad) => { const h = crypto.createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", bad); });
/** One press of Install may run this long: less than Doctor's installer timeout (src/doctor.ts RealRunner, 15 min), so a
 *  slow network ends a press on its own, keeping what it has, and the next press goes on from there. */
const PRESS_MS = 13 * 60_000;
const started = Date.now();

/** GET a file, following at most five redirects, each to an https address only */
async function get(u, signal, headers) {
  for (let hops = 0; hops <= 5; hops++) {
    const r = await fetch(u, { redirect: "manual", signal, headers });
    if (r.status >= 300 && r.status < 400) {
      const to = new URL(r.headers.get("location") || "", u);
      if (to.protocol !== "https:") throw new Error(`a redirect to a non-HTTPS address was refused (${to.protocol}//${to.host})`);
      u = to.toString(); continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}
const hashInto = (h, f) => new Promise((ok, bad) => { fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", ok).on("error", bad); });
async function fetchOne(rel, size, sha) {
  const dest = inside(rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
  // a file kept from an earlier press is used only when it is a regular file with the pinned size and hash
  try { const s = fs.lstatSync(dest); if (s.isFile() && s.size === size && (await hashOf(dest)) === sha) return { fetched: 0, kept: true }; fs.rmSync(dest, { force: true, recursive: true }); } catch {}
  // a transfer cut short (a stall, the press's time, a kill) left <file>.download: its bytes are hashed again and the
  // rest is asked for with an HTTP Range request; it is deleted only when the whole file does not match its pin
  const tmp = dest + ".download"; let h = crypto.createHash("sha256"), have = 0;
  try { const s = fs.lstatSync(tmp); if (s.isFile() && s.size <= size) { await hashInto(h, tmp); have = s.size; } else fs.rmSync(tmp, { force: true, recursive: true }); } catch {}
  const mismatch = (n, got) => { fs.rmSync(tmp, { force: true }); return new Error(`${rel}: size ${n} / SHA-256 ${got.slice(0, 12)}… does not match the pin (${size} / ${sha.slice(0, 12)}…)`); };
  if (have === size) { const got = h.digest("hex"); if (got !== sha) throw mismatch(have, got); fs.renameSync(tmp, dest); return { fetched: 0, kept: false, from: have }; }
  const left = PRESS_MS - (Date.now() - started); if (left <= 0) throw new Error("this press's time is up");
  const ac = new AbortController();
  let stall = setTimeout(() => ac.abort(new Error("stalled")), STALL_MS); const whole = setTimeout(() => ac.abort(new Error("this press's time is up")), Math.min(deadline(size), left));
  try {
    let r = await get(url(rel), ac.signal, have ? { range: `bytes=${have}-` } : undefined), from = have;
    if (have && !(r.status === 206 && new RegExp(`^bytes ${have}-`).test(r.headers.get("content-range") || ""))) {
      // the server sent the whole file: start again from its first byte
      if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
      from = 0; have = 0; h = undefined;
    }
    if (!r.ok || !r.body) throw new Error(`${rel}: HTTP ${r.status}`);
    const hash = from ? h : crypto.createHash("sha256"), w = fs.openSync(tmp, from ? "a" : "w"); let n = from;
    try { for await (const d of r.body) { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error("stalled")), STALL_MS);
        if (n + d.length > size) { fs.closeSync(w); fs.rmSync(tmp, { force: true }); throw Object.assign(new Error(`${rel}: larger than its pinned ${size} bytes`), { closed: true }); }
        n += d.length; hash.update(d); fs.writeSync(w, d); } }
    catch (e) { if (!e.closed) try { fs.closeSync(w); } catch {} throw e; }
    fs.closeSync(w);
    const got = hash.digest("hex");
    if (n !== size || got !== sha) throw mismatch(n, got);
    fs.renameSync(tmp, dest); return { fetched: n - from, kept: false, from };
  } catch (e) { const why = ac.signal.aborted && ac.signal.reason ? ac.signal.reason.message : null; throw why ? new Error(`${rel}: ${why} (${mb(fs.existsSync(tmp) ? fs.statSync(tmp).size : 0)} MB kept)`) : e; }
  finally { clearTimeout(stall); clearTimeout(whole); }
}
(async () => {
  console.log(`Kokoro-82M v1.0 (Apache-2.0) from ${m.repo} at ${m.revision.slice(0, 12)}: ${m.files.length} files, ${mb(total)} MB, into ${partial.replace(os.homedir(), "~")}`);
  fs.mkdirSync(partial, { recursive: true });
  let done = 0, last = -1, kept = 0;
  for (const [rel, size, sha] of m.files) {
    const r = await fetchOne(rel, size, sha); if (r.kept) kept++; if (r.from) console.log(`resumed ${rel} from byte ${r.from}`); done += size;
    const pct = Math.floor((done / total) * 100); if (pct >= last + 5 || size > 5e6) { last = pct; console.log(`${pct}%  ${mb(done)} / ${mb(total)} MB  ${rel}`); }
  }
  fs.writeFileSync(path.join(partial, ".complete"), m.revision + "\n");
  fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(partial, final);
  console.log(`verified ${m.files.length} files against the pinned SHA-256 (${kept} kept from an earlier try); ready at ${final.replace(os.homedir(), "~")}`);
})().catch((e) => { console.error(`download stopped: ${String((e && e.message) || e)}; press Install again to go on from here`); process.exit(1); });
// a kill keeps what was written (each chunk is written synchronously): the next press resumes it
for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => process.exit(143));
