// Downloads the review room's local voice model into Studio's own models folder, only when the captain presses Install
// in Doctor (Doctor runs: node ~/.crew-studio/tools/voice/fetch-model.cjs). Every file comes from one pinned Hugging Face
// revision and must match the pinned size and SHA-256 in kokoro-manifest.json beside this file; anything else stops the
// download. Files go into <name>.partial; a finished, verified folder gets .complete (the revision) and is renamed into
// place. A file already in .partial with the right hash is kept, so a second press resumes. Nothing else is written.
//   --models <dir>   the models folder (default ~/.crew-studio/models)
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { Readable } = require("node:stream");
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "kokoro-manifest.json"), "utf8"));
const NAME = "kokoro-multi-lang-v1_0";
const at = process.argv.indexOf("--models"), models = at > 0 ? process.argv[at + 1] : path.join(os.homedir(), ".crew-studio", "models");
const final = path.join(models, NAME), partial = final + ".partial";
const total = m.files.reduce((n, f) => n + f[1], 0), mb = (n) => (n / 1e6).toFixed(1);
// tests serve the files from this machine (CREW_VOICE_MODEL_BASE, loopback only); everything else comes from Hugging Face
const local = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.CREW_VOICE_MODEL_BASE || "") ? process.env.CREW_VOICE_MODEL_BASE : null;
const url = (p) => `${local || "https://huggingface.co"}/${m.repo}/resolve/${m.revision}/${p.split("/").map(encodeURIComponent).join("/")}`;
const inside = (rel) => { const p = path.normalize(path.join(partial, rel)); if (!p.startsWith(path.normalize(partial) + path.sep)) throw new Error(`a manifest path leaves the folder: ${rel}`); return p; };
const hashOf = (f) => new Promise((ok, bad) => { const h = crypto.createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", bad); });

async function fetchOne(rel, size, sha) {
  const dest = inside(rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { if (fs.statSync(dest).size === size && (await hashOf(dest)) === sha) return false; } catch {}
  const r = await fetch(url(rel), { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`${rel}: HTTP ${r.status}`);
  const h = crypto.createHash("sha256"), tmp = dest + ".download", w = fs.createWriteStream(tmp); let n = 0;
  await new Promise((ok, bad) => { const s = Readable.fromWeb(r.body); s.on("data", (d) => { n += d.length; h.update(d); if (n > size) s.destroy(new Error(`${rel}: larger than pinned`)); }); s.on("error", bad); w.on("error", bad); w.on("finish", ok); s.pipe(w); });
  const got = h.digest("hex");
  if (n !== size || got !== sha) { fs.rmSync(tmp, { force: true }); throw new Error(`${rel}: size ${n} / SHA-256 ${got.slice(0, 12)}… does not match the pin (${size} / ${sha.slice(0, 12)}…)`); }
  fs.renameSync(tmp, dest); return true;
}
(async () => {
  console.log(`Kokoro-82M v1.0 (Apache-2.0) from ${m.repo} at ${m.revision.slice(0, 12)}: ${m.files.length} files, ${mb(total)} MB, into ${partial.replace(os.homedir(), "~")}`);
  fs.mkdirSync(partial, { recursive: true });
  let done = 0, last = -1;
  for (const [rel, size, sha] of m.files) {
    await fetchOne(rel, size, sha); done += size;
    const pct = Math.floor((done / total) * 100); if (pct >= last + 5 || size > 5e6) { last = pct; console.log(`${pct}%  ${mb(done)} / ${mb(total)} MB  ${rel}`); }
  }
  fs.writeFileSync(path.join(partial, ".complete"), m.revision + "\n");
  fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(partial, final);
  console.log(`verified ${m.files.length} files against the pinned SHA-256; ready at ${final.replace(os.homedir(), "~")}`);
})().catch((e) => { console.error(`download stopped: ${String((e && e.message) || e)}`); process.exit(1); });
