import "../lib/isolated-env.mjs";
// tests/server-lifetime.ts: a test entry that starts a "Studio" (argv[2], a file at …/src/server.ts) and ends without
// stopping it. It records the child's pid, then exits.
import { appendFileSync } from "node:fs";
const child = Bun.spawn([process.execPath, process.argv[2]], { stdio: ["ignore", "ignore", "ignore"] });
appendFileSync(process.argv[3], `${child.pid}\n`);
child.unref();
await Bun.sleep(300);
process.exit(0);
