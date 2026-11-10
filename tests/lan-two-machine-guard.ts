import "./lib/isolated-env.mjs";
// scripts/lan-two-machine.ts starts its own Studio. It must refuse, before starting
// anything, a port or data dir that belongs to the live board: the fixed 4210, the
// port and data dir recorded in ~/.crew-studio/releases/live.json, and the default
// ~/.crew-studio/data. HOME is a temp dir here, so the real live board is never read.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "lan-guard-"));
const liveData = join(home, "live-data");
mkdirSync(join(home, ".crew-studio", "releases"), { recursive: true });
mkdirSync(liveData, { recursive: true });
writeFileSync(join(home, ".crew-studio", "releases", "live.json"), JSON.stringify({ schema: 1, live: { port: 4999, data: liveData } }));

let passed = 0, failed = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) passed++; else { failed++; console.error(`FAIL: ${m} ${extra}`); } };
const run = (...a: string[]) => spawnSync(process.execPath, ["scripts/lan-two-machine.ts", "dispatch", "--to", "192.0.2.1", ...a],
  { cwd: root, env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 20_000, input: "" });

try {
  for (const [args, what] of [[["--port", "4210"], "the fixed live port"], [["--port", "4999"], "live.json's port"],
    [["--data", liveData], "live.json's data dir"], [["--data", join(home, ".crew-studio", "data")], "the default data dir"]] as const) {
    const r = run(...args, ...(args[0] === "--data" ? ["--port", "4398"] : []));
    ok(r.status === 2 && /live board/.test(r.stderr), `refuses ${what} before starting Studio`, `status=${r.status} ${r.stderr.slice(0, 200)}`);
  }
} finally { rmSync(home, { recursive: true, force: true }); }

console.log(`lan-two-machine-guard: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
