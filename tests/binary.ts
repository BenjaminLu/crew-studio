// The single binary works on its own: run dist/crew-studio from another folder
// with no Bun on PATH, against a copy of the fixture state, and check every page
// and asset is served, the API answers, and its helper subcommands start.
//   bun run build && bun tests/binary.ts
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";

const root = join(import.meta.dir, "..");
const bin = join(root, "dist/crew-studio");
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
if (!existsSync(bin)) { console.log("no dist/crew-studio: run `bun run build` first"); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), "crew-bin-"));
cpSync(join(root, "tests/fixture/state"), join(tmp, "state"), { recursive: true });
const PATH = "/usr/bin:/bin:/usr/sbin:/sbin"; // no bun, no node, no gh, no claude
ok(!Bun.spawnSync(["/bin/sh", "-c", "command -v bun"], { env: { PATH } }).success, "the clean PATH has no bun");
const v = Bun.spawnSync([bin, "--version"], { cwd: tmp, env: { PATH, HOME: tmp } });
ok(v.success && /crew-studio/.test(v.stdout.toString()), "the binary runs from another folder with no bun", v.stderr.toString());

const port = await freePort();
const app = Bun.spawn([bin], { cwd: tmp, env: { PATH, HOME: tmp, CREW_FM_STATE: join(tmp, "state"), CREW_PORT: String(port), CREW_GH: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1",
  CREW_BOARD_URL: "http://127.0.0.1:9" }, stdout: "pipe", stderr: "pipe" });
const base = `http://127.0.0.1:${port}`;
try {
  await waitUp(base, app);
  for (const [path, type] of [["/", "text/html"], ["/remote/", "text/html"], ["/app.js", "javascript"], ["/ootb.js", "javascript"], ["/styles.css", "text/css"], ["/fonts.css", "text/css"],
    ["/fonts/ibm-plex-sans-latin-400-normal.woff2", "font/woff2"], ["/vendor/qrcode-1.4.4.min.js", "javascript"], ["/fonts/OFL-IBM-Plex.txt", "text/plain"]] as const) {
    const r = await fetch(base + path);
    ok(r.ok && (r.headers.get("content-type") ?? "").includes(type) && (await r.arrayBuffer()).byteLength > 100, `serves ${path} from inside the binary`);
  }
  const s = await (await fetch(base + "/api/summary")).json();
  ok(s.tasks.length > 0 && s.flow?.nodes?.length > 0, "the API reads the state folder and the embedded workflow");
  const d = await (await fetch(base + "/api/doctor")).json();
  const by = Object.fromEntries(d.items.map((i: any) => [i.id, i]));
  ok(d.compiled === true && by.assets.detail.includes("embedded"), "the Doctor knows it is the binary");
  ok(by.state.status === "ok" && by.claude.status === "missing" && by.github.status === "info", "with nothing installed: state ok, CLI missing, GitHub off", JSON.stringify([by.state.status, by.claude.status, by.github.status]));
  for (const view of ["board", "inbox", "crew", "activity", "workflow", "intents", "library", "doctor", "remote"]) ok((await fetch(`${base}/#/${view}`)).ok, `page ${view} loads`);
  // the helper subcommands the agent CLIs start: an MCP server answers initialize
  const mcp = Bun.spawn([bin, "mcp"], { cwd: tmp, env: { PATH, HOME: tmp, CREW_STUDIO_URL: base, CREW_TOOL_TOKEN: "x" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n"); mcp.stdin.flush();
  const reader = mcp.stdout.getReader(); const first = await Promise.race([reader.read(), Bun.sleep(4000).then(() => null)]);
  const line = first && first.value ? new TextDecoder().decode(first.value) : "";
  ok(/"serverInfo":\{"name":"studio"/.test(line), "`crew-studio mcp` is the chat tools' MCP server", line.slice(0, 120));
  mcp.kill();
  const perm = Bun.spawn([bin, "permission-mcp"], { cwd: tmp, env: { PATH, HOME: tmp }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  perm.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n"); perm.stdin.flush();
  const pr = perm.stdout.getReader(); const pf = await Promise.race([pr.read(), Bun.sleep(4000).then(() => null)]);
  ok(/"name":"approve"/.test(pf && pf.value ? new TextDecoder().decode(pf.value) : ""), "`crew-studio permission-mcp` is the permission bridge");
  perm.kill();
} finally { app.kill(); }
console.log(`\nbinary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
