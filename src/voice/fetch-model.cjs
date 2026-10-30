// Downloads the review room's local voice model into Studio's own models folder, only when the captain presses Install
// in Doctor (Doctor runs: node ~/.crew-studio/tools/voice/fetch-model.cjs). Every file comes from one pinned Hugging Face
// revision over HTTPS (a redirect to anything but https is refused) and must match the pinned size and SHA-256 in
// kokoro-manifest.json beside this file; anything else stops the download. A file that stalls or takes too long stops it
// too. Files go into <name>.partial, each first as <file>.download, renamed only once verified; a stopped download
// removes its .download files, and keeps the verified files of .partial, which a second press hashes again before it
// keeps them (a resume). A finished, verified folder gets .complete (the revision) and is renamed into place.
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
const downloads = new Set();

/** GET a file, following at most five redirects, each to an https address only */
async function get(u, signal) {
  for (let hops = 0; hops <= 5; hops++) {
    const r = await fetch(u, { redirect: "manual", signal });
    if (r.status >= 300 && r.status < 400) {
      const to = new URL(r.headers.get("location") || "", u);
      if (to.protocol !== "https:") throw new Error(`a redirect to a non-HTTPS address was refused (${to.protocol}//${to.host})`);
      u = to.toString(); continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}
async function fetchOne(rel, size, sha) {
  const dest = inside(rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
  // resume: a file kept from a stopped download is used only when it is a regular file with the pinned size and hash
  try { const s = fs.lstatSync(dest); if (s.isFile() && s.size === size && (await hashOf(dest)) === sha) return false; fs.rmSync(dest, { force: true, recursive: true }); } catch {}
  const ac = new AbortController(), tmp = dest + ".download"; downloads.add(tmp);
  let stall = setTimeout(() => ac.abort(new Error("stalled")), STALL_MS); const whole = setTimeout(() => ac.abort(new Error("took too long")), deadline(size));
  try {
    const r = await get(url(rel), ac.signal);
    if (!r.ok || !r.body) throw new Error(`${rel}: HTTP ${r.status}`);
    const h = crypto.createHash("sha256"), w = fs.openSync(tmp, "w"); let n = 0;
    try { for await (const d of r.body) { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error("stalled")), STALL_MS);
        n += d.length; if (n > size) throw new Error(`${rel}: larger than its pinned ${size} bytes`); h.update(d); fs.writeSync(w, d); } }
    finally { fs.closeSync(w); }
    const got = h.digest("hex");
    if (n !== size || got !== sha) throw new Error(`${rel}: size ${n} / SHA-256 ${got.slice(0, 12)}… does not match the pin (${size} / ${sha.slice(0, 12)}…)`);
    fs.renameSync(tmp, dest); downloads.delete(tmp); return true;
  } catch (e) { const why = ac.signal.aborted && ac.signal.reason ? ac.signal.reason.message : null; throw why ? new Error(`${rel}: ${why}`) : e; }
  finally { clearTimeout(stall); clearTimeout(whole); }
}
const cleanup = () => { for (const f of downloads) try { fs.rmSync(f, { force: true }); } catch {} };
(async () => {
  console.log(`Kokoro-82M v1.0 (Apache-2.0) from ${m.repo} at ${m.revision.slice(0, 12)}: ${m.files.length} files, ${mb(total)} MB, into ${partial.replace(os.homedir(), "~")}`);
  fs.mkdirSync(partial, { recursive: true });
  let done = 0, last = -1, kept = 0;
  for (const [rel, size, sha] of m.files) {
    if (!(await fetchOne(rel, size, sha))) kept++; done += size;
    const pct = Math.floor((done / total) * 100); if (pct >= last + 5 || size > 5e6) { last = pct; console.log(`${pct}%  ${mb(done)} / ${mb(total)} MB  ${rel}`); }
  }
  fs.writeFileSync(path.join(partial, ".complete"), m.revision + "\n");
  fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(partial, final);
  console.log(`verified ${m.files.length} files against the pinned SHA-256 (${kept} kept from an earlier try); ready at ${final.replace(os.homedir(), "~")}`);
})().catch((e) => { cleanup(); console.error(`download stopped: ${String((e && e.message) || e)}; press Install again to resume`); process.exit(1); });
for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, () => { cleanup(); process.exit(143); });
