import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The sandboxed acceptance profile (scripts/acceptance-sandboxed.ts, retro finding 28): the stub acceptance with the OS
// sandbox on, an empty HOME and no tool cache. A run that needs an install this Mac lacks is SKIPPED with the install
// named (never passed), a local-unrestricted run is SKIPPED, the rest pass sandboxed, and the summary says which
// workflow needs which install. The needs come from each definition (scripts/acceptance/installs.ts).
import { join } from "node:path";
import { bundledText, parseYaml } from "../src/bundled";
import { installsFor } from "../scripts/acceptance/installs";

let passed = 0, failed = 0;
const ok = (c: boolean, name: string, detail = "") => { if (c) { passed++; console.log(`  ok    ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? ` ${detail.slice(0, 2000)}` : ""}`); } };
const ids = (f: string) => installsFor(parseYaml(bundledText(f) ?? "")).map((i) => i.id).join(",");
ok(ids("packs/firstmate/workflows/code-firstmate.wf.yaml") === "git,node,python", "code-firstmate needs git (its worktree), node and python3 (its check scripts)", ids("packs/firstmate/workflows/code-firstmate.wf.yaml"));
ok(ids("workflows/v2/video.wf.yaml") === "renderer,ffmpeg" && ids("workflows/v2/documents.wf.yaml") === "", "video needs the renderer and ffmpeg; documents needs nothing beyond Studio");

const env: Record<string, string> = { ...(process.env as Record<string, string>), ACCEPTANCE_ONLY: "documents:approve,documents:local-unrestricted,video:approve", CREW_LOCAL_UNRESTRICTED: "1", CREW_RENDER_STUB: "1" };
const r = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/acceptance-sandboxed.ts")], { env, stdout: "pipe", stderr: "pipe" });
const out = r.stdout.toString() + r.stderr.toString();
ok(r.exitCode === 0, "the sandboxed profile exits 0 when nothing fails", out);
ok(/PASS\s+documents:approve/.test(out), "a run that needs no install passes with the sandbox on", out);
ok(/SKIPPED\s+documents:local-unrestricted\n\s+the sandboxed profile runs only with the OS sandbox on/.test(out), "a local-unrestricted run is skipped, even with CREW_LOCAL_UNRESTRICTED=1 in the caller's environment", out);
ok(/SKIPPED\s+video:approve\n\s+needs renderer \(render renders the film to MP4\)/.test(out), "video is skipped naming the renderer: no stand-in renderer and no browser cache in this profile", out);
ok(/Installs per workflow \(sandboxed profile/.test(out) && /\n  video\s+renderer MISSING, ffmpeg (installed|MISSING)/.test(out) && /\n  documents\s+nothing beyond Studio/.test(out), "the summary lists which workflow needs which install", out);
console.log(`\nacceptance-sandboxed: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
