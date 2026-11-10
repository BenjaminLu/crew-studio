import "./lib/isolated-env.mjs";
// scripts/lan-guard.ts: what the two-machine trial must refuse before it starts its own Studio. Pure checks only:
// nothing is started, so a broken guard cannot reach the live board's port or data. HOME is a temp dir here.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveBoardRefusal } from "../scripts/lan-guard";

let passed = 0, failed = 0;
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };
const home = mkdtempSync(join(tmpdir(), "lan-guard-"));
const trial = join(home, "crew-lan-trial"), liveData = join(home, "live-data"), envData = join(home, "env-data");
const writeLive = (live: unknown) => { mkdirSync(join(home, ".crew-studio", "releases"), { recursive: true }); writeFileSync(join(home, ".crew-studio", "releases", "live.json"), JSON.stringify({ schema: 1, live })); };
const refuse = (port: number, data: string, env: Record<string, string> = {}) => liveBoardRefusal({ port, data, home, env });

try {
  ok(refuse(4310, trial) === null, "the trial defaults pass with no live.json");
  ok(/live board's port/.test(refuse(4210, trial) ?? ""), "4210 is refused even with no live.json");
  ok(/live board data dir/.test(refuse(4310, join(home, ".crew-studio", "data")) ?? ""), "the default ~/.crew-studio/data is refused");
  writeLive({ port: 4999, data: liveData });
  ok(/live board's port/.test(refuse(4999, trial) ?? ""), "live.json's port is refused");
  ok(/live board data dir/.test(refuse(4310, liveData) ?? ""), "live.json's data dir is refused");
  ok(/live board data dir/.test(refuse(4310, join(liveData, ".")) ?? ""), "the same data dir written another way is refused");
  writeLive(null);
  ok(/live board's port/.test(refuse(4211, trial, { CREW_PORT: "4211" }) ?? ""), "CREW_PORT from the environment is refused when live.json has no live");
  ok(/live board data dir/.test(refuse(4310, envData, { CREW_DATA: envData }) ?? ""), "CREW_DATA from the environment is refused when live.json has no live");
  ok(refuse(4310, trial, { CREW_PORT: "4211", CREW_DATA: envData }) === null, "other ports and data dirs still pass");
} finally { rmSync(home, { recursive: true, force: true }); }

console.log(`lan-two-machine-guard: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
