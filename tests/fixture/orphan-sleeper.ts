import "../lib/isolated-env.mjs";
// tests/orphan-watchdog.ts: a test entry that would run forever. It records its pid, then waits.
import { appendFileSync } from "node:fs";
appendFileSync(process.argv[2], `${process.pid}\n`);
setInterval(() => {}, 1000);
