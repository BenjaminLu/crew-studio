import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The real-model eval (scripts/observe-eval.ts) against a fake `claude` and a fake `codex` on PATH: each one starts the MCP
// helper the eval hands it, asks tools/list and calls studio_now, as a real CLI does mid-answer. The eval serves that helper's
// endpoint in its own event loop, so a blocking spawn of the CLI leaves tools/list unanswered and every question at 0 calls
// (the dry run spawns asynchronously and never saw it). No model, no network.
//      bun tests/observe-eval-cli.ts
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { suite } from "./rt-harness";
const { ok, end } = suite("observe-eval-cli");
const root = join(import.meta.dir, ".."), bin = mkdtempSync(join(tmpdir(), "crew-observe-eval-cli-"));

// One fake for both CLIs: it reads the MCP server from the arguments the eval passes, gives each request 10 s, then answers
// with what it got (or with "no tools" when tools/list never came back).
const fake = `#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const argv = process.argv.slice(2), codex = argv[0] === "exec";
let server;
if (codex) { const c = (k) => { const a = argv.find((x) => x.startsWith("mcp_servers.studio." + k + "=")); return a.slice(a.indexOf("=") + 1); };
  const env = {}; for (const m of c("env").matchAll(/(\\w+)=("(?:[^"\\\\]|\\\\.)*")/g)) env[m[1]] = JSON.parse(m[2]);
  server = { command: JSON.parse(c("command")), args: JSON.parse(c("args")), env }; }
else server = JSON.parse(readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8")).mcpServers.studio;
const p = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "ignore"] });
let buf = ""; const waiting = new Map();
p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1);
  try { const m = JSON.parse(line); waiting.get(m.id)?.(m); } catch {} } });
let id = 0;
const rpc = (method, params) => new Promise((done) => { const n = ++id; const t = setTimeout(() => done(null), 10_000);
  waiting.set(n, (m) => { clearTimeout(t); done(m); }); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\\n"); });
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
const list = await rpc("tools/list", {});
const names = (list?.result?.tools ?? []).map((t) => t.name);
const now = names.includes("studio_now") ? await rpc("tools/call", { name: "studio_now", arguments: {} }) : null;
const answer = now ? "tools: " + names.join(",") + "; studio_now answered（見「room:PR-0123456789ab-1645」；\\x60room:PR-0123456789ab-1645\\x60）**room:PR-0123456789ab-1645**" : "no tools";
p.kill();
if (codex) { console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: answer } })); console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })); }
else console.log(JSON.stringify({ result: answer, usage: { input_tokens: 1, output_tokens: 1 } }));
process.exit(0);
`;
for (const name of ["claude", "codex"]) { writeFileSync(join(bin, name), fake); chmodSync(join(bin, name), 0o755); }

for (const provider of ["claude", "codex"]) {
  const r = spawnSync("bun", [join(root, "scripts", "observe-eval.ts"), "--provider", provider, "--questions", "1"], { cwd: root, encoding: "utf8", timeout: 90_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("Q1 ")) ?? "";
  ok(/calls 1 \(studio_now\)/.test(line), `${provider}: the CLI's tools/list and studio_now are answered while the eval waits on it (not blocked by a sync spawn)`, `${line} ${(r.stderr ?? "").slice(-400)}`);
  ok(/refs room:PR-0123456789ab-1645 room:PR-0123456789ab-1645 room:PR-0123456789ab-1645$/.test(line), `${provider}: the eval reads the answer's refs without the CJK punctuation, backtick or markdown bold after them`, line);
}
end();
