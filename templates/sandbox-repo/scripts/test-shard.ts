// Runs one shard of the tests (CREW_SHARD of CREW_SHARDS) and prints each failing
// test as "FAIL <file>: <name>", the line format Crew Studio's CI check reads.
import { readdirSync } from "node:fs";
const shard = Number(process.env.CREW_SHARD ?? 0), shards = Number(process.env.CREW_SHARDS ?? 1);
const only = (process.env.CREW_TEST_FILES ?? "").split(",").filter(Boolean);
const files = readdirSync("test").filter((f) => f.endsWith(".test.ts") && (!only.length || only.includes(f))).sort().filter((_, i) => i % shards === shard).map((f) => `test/${f}`);
if (!files.length) { console.log(`shard ${shard + 1}/${shards}: no test files`); process.exit(0); }
// process.execPath: the bun running this script (a sandbox may hand bun an empty environment, so PATH is not relied on)
const p = Bun.spawnSync([process.execPath, "test", ...files.map((f) => `./${f}`)], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
const out = p.stdout.toString() + p.stderr.toString();
let file = "";
for (const line of out.split("\n")) {
  const m = /^(test\/[\w./-]+\.test\.ts):$/.exec(line.trim()); if (m) { file = m[1]; continue; }
  const f = /^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/.exec(line.trim()); if (f) console.log(`FAIL ${file || "test"}: ${f[1]}`);
}
console.log(out.trim().split("\n").slice(-3).join("\n"));
process.exit(p.exitCode ?? 1);
