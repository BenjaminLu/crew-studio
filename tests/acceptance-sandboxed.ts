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

// --e2e (bun run test:sandboxed-e2e): the pre-deploy gate never skips. No Chromium at all refuses to start; a Chromium cache with
// nothing in it fails the film run (the renderer is real there: no stand-in), never skips it
{
  const { mkdtempSync, rmSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const none = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/acceptance-sandboxed.ts"), "--e2e"], { env: { ...(process.env as Record<string, string>), PLAYWRIGHT_BROWSERS_PATH: "/nonexistent/ms-playwright", ACCEPTANCE_ONLY: "video:approve" }, stdout: "pipe", stderr: "pipe" });
  ok(none.exitCode === 1 && /sandboxed e2e needs Playwright's Chromium/.test(none.stdout.toString()), "e2e: no Playwright browser cache is a failure that names the install", none.stdout.toString());
  const empty = mkdtempSync(join(tmpdir(), "crew-e2e-no-chromium-"));
  try {
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/acceptance-sandboxed.ts"), "--e2e"], { env: { ...(process.env as Record<string, string>), PLAYWRIGHT_BROWSERS_PATH: empty, ACCEPTANCE_ONLY: "video:approve,documents:local-unrestricted" }, stdout: "pipe", stderr: "pipe" });
    const o = r.stdout.toString() + r.stderr.toString();
    ok(r.exitCode === 1 && /FAIL\s+video:approve/.test(o) && !/SKIPPED\s+video:approve/.test(o), "e2e: a film that cannot render with the sandbox on fails the gate (never skipped)", o.slice(-1500));
    ok(!/documents:local-unrestricted/.test(o), "e2e: a local-unrestricted run is not part of the sandbox-only gate", o.slice(-800));
  } finally { rmSync(empty, { recursive: true, force: true }); }
}

// the sandbox probe's verdict (tests/acceptance/proves.ts): exactly what a sandboxed round may do passes; each way around it is named
{
  const { probeProblems } = await import("./acceptance/proves");
  const good = { proxyEnv: true, proxyCredentialFree: true, noProxyLoopbackOnly: true, directPublic: { ok: false, error: "EPERM" }, directSink: { ok: false, error: "EPERM" }, directStudio: { ok: false, error: "EPERM" }, toolListener: { ok: true }, providerViaProxy: { status: 200 }, otherViaProxy: { status: 403 }, noCredentialViaProxy: { status: 200 }, ownLogin: "account:claude", loginCopy: null, otherCredentials: [], denied: { "/x/ledger.key": false }, tmpWritable: true, nowrite: { "/x/data": false } };
  ok(probeProblems(good).length === 0, "probe: a round that reaches only its provider through the proxy and reads only its own login passes", JSON.stringify(probeProblems(good)));
  const open = { ...good, proxyEnv: false, directPublic: { ok: true }, directSink: { ok: true }, directStudio: { ok: true }, otherViaProxy: { status: 200 }, loginCopy: "$HOME/.codex/auth.json", otherCredentials: ["GITHUB_TOKEN"], denied: { "/x/ledger.key": true }, nowrite: { "/x/data": true } };
  const bad = probeProblems(open).join(" | ");
  ok(["no egress proxy", "public address went out", "sink", "Studio's own port", "host off the round's list", "a copy of a login", "GITHUB_TOKEN", "could read /x/ledger.key", "could write into /x/data"].every((w) => bad.includes(w)), "probe: an unsandboxed round fails, naming each way out", bad);
  ok(probeProblems({...good, noCredentialViaProxy:undefined}).some(p=>/required client credentials/.test(p)), "probe: a missing scoped-relay observation cannot pass");
  ok(probeProblems({...good, proxyCredentialFree:false}).some(p=>/credential in exec environment/.test(p)), "probe: a proxy credential in exec env fails even when network calls succeed");
  ok(probeProblems({...good, noCredentialViaProxy:{status:407}}).some(p=>/required client credentials/.test(p)), "probe: an admitted scoped relay that still needs client credentials fails");
  ok(probeProblems({ ...good, providerViaProxy: { status: 403 } }).some((p) => /provider's API host/.test(p)), "probe: a proxy that refuses the round's own provider fails");
}
console.log(`\nacceptance-sandboxed: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
