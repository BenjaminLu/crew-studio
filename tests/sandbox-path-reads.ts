import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// What the PATH opens to a sandboxed process (a check, a test run, an agent round): each bin folder on PATH, and its parent
// only when the parent is an install prefix (it has lib/: node's and python's own modules). A tool's private folder whose
// bin is on PATH (~/.orbstack/bin next to ~/.orbstack/ssh, ~/.cache/lm-studio/bin next to its credentials) stays closed,
// and so do the account's own secret folders when Studio runs with another HOME.   bun tests/sandbox-path-reads.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roundProfile, profileFor, sandboxInfo, accountHomeDir } from "../src/runtime/checks";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const root = mkdtempSync(join(tmpdir(), "crew-path-reads-"));
// a tool's private folder: bin on PATH, its keys beside it, no lib/
const tool = join(root, "home", ".tool"); mkdirSync(join(tool, "bin"), { recursive: true }); mkdirSync(join(tool, "ssh"));
writeFileSync(join(tool, "bin", "tool"), "#!/bin/sh\necho tool\n", { mode: 0o755 }); writeFileSync(join(tool, "ssh", "id_ed25519"), "PRIVATE KEY");
// an install prefix: bin on PATH and its lib/ (node under a version manager)
const prefix = join(root, "home", ".nvm", "v1"); mkdirSync(join(prefix, "bin"), { recursive: true }); mkdirSync(join(prefix, "lib", "node_modules"), { recursive: true });
writeFileSync(join(prefix, "lib", "node_modules", "npm.js"), "// npm");
const work = join(root, "work"), tmp = join(root, "tmp"); mkdirSync(work); mkdirSync(tmp);
const savedPath = process.env.PATH;
process.env.PATH = `${join(tool, "bin")}:${join(prefix, "bin")}:/usr/bin:/bin`;
const cat = (profile: string, file: string) => { const f = join(root, `p-${Math.random().toString(36).slice(2)}.sb`); writeFileSync(f, profile);
  const r = Bun.spawnSync(["/usr/bin/sandbox-exec", "-f", f, "/bin/cat", file], { stdout: "pipe", stderr: "pipe" }); return r.exitCode === 0; };
try {
  if (!sandboxInfo().ok) { console.log("  skip  no OS sandbox on this machine"); }
  else for (const [kind, profile] of [
    ["agent round", roundProfile({ cwd: work, tmp, writes: [work], reads: [], proxyPort: 1, toolPort: 2 })],
    ["check", profileFor({ out: work, tmp, reads: [], network: false })],
  ] as const) {
    ok(cat(profile, join(tool, "bin", "tool")), `${kind}: a tool's bin folder on PATH stays readable (runnable)`);
    ok(!cat(profile, join(tool, "ssh", "id_ed25519")), `${kind}: the rest of that tool's private folder is not readable (its ssh key)`);
    ok(cat(profile, join(prefix, "lib", "node_modules", "npm.js")), `${kind}: an install prefix's lib/ stays readable (node's own modules)`);
    // the account's own secret folders, even when Studio runs with another HOME (this test's HOME is a temp folder)
    ok(profile.includes(JSON.stringify(join(accountHomeDir(), ".ssh"))), `${kind}: the account's own ~/.ssh is on the deny list`);
  }
} finally { process.env.PATH = savedPath; rmSync(root, { recursive: true, force: true }); }
console.log(`\nsandbox-path-reads: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
