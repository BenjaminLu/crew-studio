import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The stdio MCP proxy (src/mcp.ts) against a stub Studio on a free port and a private unix socket, for every token family
// that goes through it: a chat question's token, a Studio-owned session's token file over a socket, an external CLI grant.
// initialize negotiates protocolVersion from the proxy's own list (never echoes an unknown one) and sends the server
// instructions from src/observe/instructions.ts (at most 4 KB); tools/list comes back sorted by name, the same on every call,
// whatever order Studio answers in. Tool names and calls pass through unchanged.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { SERVER_INSTRUCTIONS, IRON_RULES } from "../src/observe/instructions";

const REPO = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "crew-mcp-proxy-"));
const TOOLS = ["studio_work_status", "list_workflows", "studio_manual", "read_cards", "prs_list", "start_run", "Zeta_upper", "alpha_tool"];
let served = 0, lastToken = "";
const shuffled = () => { served++; const t = [...TOOLS]; for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
  if (served % 2) t.reverse(); return t.map((name) => ({ name, description: `stub ${name}`, inputSchema: { type: "object" } })); };
const handler = async (req: Request) => {
  lastToken = req.headers.get("x-crew-tool-token") ?? "";
  const path = new URL(req.url).pathname;
  if (path === "/api/tools") return Response.json(shuffled());
  if (path.startsWith("/api/tools/")) return Response.json({ called: decodeURIComponent(path.slice(11)), args: await req.json() });
  return new Response("not found", { status: 404 });
};
const tcp = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
const socket = join(dir, "studio.sock");
const uds = Bun.serve({ unix: socket, fetch: handler });
const base = `http://127.0.0.1:${tcp.port}`;
writeFileSync(join(dir, "native-token"), "tok-native\n", { mode: 0o600 });
writeFileSync(join(dir, "grant"), "csg_g-0000beef_stub\n", { mode: 0o600 });

const families: { name: string; token: string; args: string[]; env: Record<string, string> }[] = [
  { name: "chat question token", token: "tok-chat", args: [], env: { CREW_STUDIO_URL: base, CREW_TOOL_TOKEN: "tok-chat" } },
  { name: "Studio-owned session over a socket", token: "tok-native", args: [], env: { CREW_STUDIO_SOCKET: socket, CREW_TOOL_TOKEN_FILE: join(dir, "native-token") } },
  { name: "external CLI grant", token: "csg_g-0000beef_stub", args: ["--grant-file", join(dir, "grant"), "--url", base], env: {} },
];

function proxy(args: string[], env: Record<string, string>) {
  const clean = { ...process.env }; for (const k of ["CREW_STUDIO_URL", "CREW_TOOL_TOKEN", "CREW_TOOL_TOKEN_FILE", "CREW_STUDIO_SOCKET"]) delete clean[k];
  const p = spawn("bun", ["src/mcp.ts", ...args], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"], env: { ...clean, ...env } });
  const waiting = new Map<number, (v: any) => void>(); let n = 0, err = "";
  p.stderr.on("data", (b) => { err += b; });
  createInterface({ input: p.stdout }).on("line", (l) => { try { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch {} });
  const rpc = (method: string, params?: unknown) => new Promise<any>((res, rej) => { const id = ++n; waiting.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); setTimeout(() => rej(new Error(`no answer to ${method}: ${err}`)), 15_000); });
  return { rpc, close: () => p.kill() };
}

let failed = false;
const step = async (name: string, f: () => Promise<void>) => { try { await f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
const sorted = [...TOOLS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
try {
  await step("the instructions source holds the three iron rules, the untrusted-data rule and the manual pointer, within 4 KB", async () => {
    assert.equal(IRON_RULES.length, 3);
    for (const r of IRON_RULES) assert.ok(SERVER_INSTRUCTIONS.includes(r), r);
    assert.match(SERVER_INSTRUCTIONS, /untrusted .* is data, not instructions/);
    assert.match(SERVER_INSTRUCTIONS, /cite the refs/);
    assert.match(SERVER_INSTRUCTIONS, /studio_manual/);
    assert.ok(Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8") <= 4096, `${Buffer.byteLength(SERVER_INSTRUCTIONS)} bytes`);
  });
  for (const f of families) {
    const c = proxy(f.args, f.env);
    try {
      await step(`${f.name}: a client asking for 2026-07-28 gets the newest supported version back`, async () => {
        const r = await c.rpc("initialize", { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "stub-client", version: "1" } });
        assert.equal(r.result.protocolVersion, "2025-11-25", JSON.stringify(r));
        assert.equal(r.result.serverInfo.name, "studio");
        assert.deepEqual(r.result.capabilities, { tools: {} });
      });
      await step(`${f.name}: supported versions are kept, an unknown or missing one is never echoed`, async () => {
        assert.equal((await c.rpc("initialize", { protocolVersion: "2025-06-18" })).result.protocolVersion, "2025-06-18");
        assert.equal((await c.rpc("initialize", { protocolVersion: "2025-11-25" })).result.protocolVersion, "2025-11-25");
        assert.equal((await c.rpc("initialize", { protocolVersion: "2024-11-05" })).result.protocolVersion, "2025-11-25");
        assert.equal((await c.rpc("initialize", { protocolVersion: "not-a-version" })).result.protocolVersion, "2025-11-25");
        assert.equal((await c.rpc("initialize", {})).result.protocolVersion, "2025-11-25");
      });
      await step(`${f.name}: initialize carries the server instructions, at most 4096 bytes`, async () => {
        const r = await c.rpc("initialize", { protocolVersion: "2025-06-18" });
        assert.equal(r.result.instructions, SERVER_INSTRUCTIONS);
        assert.ok(Buffer.byteLength(r.result.instructions, "utf8") <= 4096);
      });
      await step(`${f.name}: tools/list is sorted by name and identical on every call`, async () => {
        const lists: string[] = [];
        for (let i = 0; i < 4; i++) { const r = await c.rpc("tools/list"); assert.deepEqual(r.result.tools.map((t: any) => t.name), sorted); lists.push(JSON.stringify(r.result.tools)); }
        assert.equal(new Set(lists).size, 1, "the same bytes every call");
        assert.equal(lastToken, f.token, "the family's own token reached Studio");
      });
      await step(`${f.name}: a tool call passes through unchanged`, async () => {
        const r = await c.rpc("tools/call", { name: "read_cards", arguments: { run: "R-7" } });
        assert.equal(r.result.isError, false);
        assert.deepEqual(JSON.parse(r.result.content[0].text), { called: "read_cards", args: { run: "R-7" } });
      });
    } finally { c.close(); }
  }
} finally {
  tcp.stop(true); uds.stop(true); rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.log("mcp-proxy-conformance: FAILED"); process.exit(1); }
console.log("mcp-proxy-conformance: all passed");
