// A live smoke test of the cursor provider against the real cursor-agent and a real Cursor model (it spends a little
// of the crew's Cursor quota; never part of CI). Two turns: a chat turn that must look up two Studio tools through the
// Studio MCP server and answer from them, and an agent round under the OS sandbox and the egress proxy that must call
// a Studio tool for a nonce. It signs in like a round does (login.ts cursorLogin).
//   bun scripts/cursor-smoke.ts [model]        (default composer-2.5)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedTurn } from "../src/chat";
import { Agents } from "../src/agent";
import { Egress } from "../src/egress";
import { cursorProvider } from "../src/providers/cursor";
import { cursorLogin } from "../src/providers/login";

const model = process.argv[2] ?? "composer-2.5";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const before = new Set(readdirSync("/tmp").filter((d) => d.startsWith("crc.")));
const login = cursorLogin();
if (!login.ok) { console.log(`no Cursor API key: ${login.error}`); process.exit(2); }

// 1. a chat turn, outside the round sandbox
{
  const TOKEN = "t".repeat(48), calls: string[] = [];
  const listed = (await import("../src/tools")).TOOLS.filter((t) => t.name === "runs_list" || t.name === "task_get").map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema }));
  const tools = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const path = new URL(req.url).pathname, name = path.replace("/api/tools/", "");
    if (req.headers.get("x-crew-tool-token") !== TOKEN) return new Response(JSON.stringify({ error: "no valid tool token" }), { status: 403 });
    if (path === "/api/tools") return Response.json(listed);
    calls.push(name);
    return Response.json(name === "runs_list" ? [{ id: "T-41", status: "running" }, { id: "T-42", status: "done", link: "#/task/T-42" }]
      : name === "task_get" ? { id: "T-42", title: "Ship the quarterly report", merged: { link: "#/event/9" } } : { error: "unknown" });
  } });
  const url = `http://127.0.0.1:${tools.port}`, tokenFile = join(mkdtempSync(join(tmpdir(), "crew-cursor-smoke-")), "tool-token");
  writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  const ctx = { tokenFile, studioUrl: url, token: TOKEN, cwd: tmpdir(), mcpCommand: [process.execPath, join(import.meta.dir, "../src/mcp.ts")],
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, CREW_STUDIO_URL: url, CREW_TOOL_TOKEN_FILE: tokenFile, ...login.env } };
  const ev: any[] = []; const t0 = Date.now();
  for await (const e of guardedTurn(cursorProvider(model), "Which task is done, and what is its title? Use the Studio tools runs_list then task_get; answer in one line.", ctx, { timeoutMs: 180_000, system: "You are Crew Studio's assistant. Answer only from the Studio tools." })) ev.push(e);
  const end = ev.at(-1), text = ev.filter((e) => e.type === "delta").map((e) => e.text).join("");
  ok(end?.type === "turnEnd" && end.status === "ok", `chat: the turn ends ok (${Math.round((Date.now() - t0) / 1000)}s)`, JSON.stringify(end));
  ok(calls.includes("runs_list") && calls.includes("task_get"), "chat: the model reached both Studio tools through the Studio MCP server", calls.join(","));
  ok(ev.filter((e) => e.type === "toolStart").length === ev.filter((e) => e.type === "toolEnd").length && ev.some((e) => e.type === "toolEnd" && e.error === null), "chat: tool calls start and end, with results");
  ok(/T-42/.test(text) && /quarterly report/i.test(text), "chat: the answer comes from the tools", text.slice(0, 200));
  ok(typeof end?.usage?.inTokens === "number" && typeof end?.usage?.outTokens === "number", "chat: usage is reported", JSON.stringify(end?.usage));
  tools.stop(true);
}

// 2. an agent round under the OS sandbox and the egress proxy
{
  const data = mkdtempSync(join(tmpdir(), "crew-cursor-round-"));
  const egress = new Egress(join(data, "egress.log")); await egress.start();
  const main = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("studio page") });
  const agents = new Agents(data, () => `http://127.0.0.1:${main.port}`);
  const tools = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => { const u = new URL(req.url); const t = req.headers.get("x-crew-tool-token") ?? "";
    if (!u.pathname.startsWith("/api/tools")) return new Response("no", { status: 404 }); if (!agents.hasToken(t)) return new Response("no", { status: 401 });
    return Response.json(u.pathname === "/api/tools" ? agents.toolList(t) : await agents.callTool(t, u.pathname.slice(11), await req.json().catch(() => ({})))); } });
  agents.egress = egress; agents.toolUrl = () => `http://127.0.0.1:${tools.port}`;
  const wt = join(data, "work", "sandbox", "R-1"); mkdirSync(wt, { recursive: true });
  let called = 0;
  const nonce = { name: "crew_nonce", description: "Return the round's nonce for the given label.", schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
    run: (a: any) => { called++; return { label: a.label, nonce: "NONCE-5521" }; } };
  const t0 = Date.now();
  const job = await agents.run({ kind: "smoke", title: "cursor sandboxed smoke", system: "You are a Crew worker. Use only the Studio tools.", text: "Call crew_nonce with label 'smoke' and reply with only the nonce it returns.",
    tools: [nonce], provider: cursorProvider(model), timeoutMs: 240_000, sandbox: { writes: [wt], cwd: wt } });
  ok(job.status === "done", `round: the sandboxed round ends done (${Math.round((Date.now() - t0) / 1000)}s)`, `${job.status} ${job.error} ${job.said.slice(0, 300)}`);
  ok(called === 1 && /NONCE-5521/.test(job.said), "round: the model called the Studio tool from inside the sandbox and answered with its nonce", `called=${called} said=${job.said.slice(0, 200)}`);
  const log = existsSync(join(data, "egress.log")) ? readFileSync(join(data, "egress.log"), "utf8") : "";
  const hosts = [...new Set([...log.matchAll(/(?:CONNECT|host[=: ]+)\s*([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1]))];
  console.log(`  info  egress log hosts: ${hosts.join(", ") || "(none recorded)"}`);
  if (job.status !== "done") console.log(log.slice(-2000));
  egress.stop?.(); tools.stop(true); main.stop(true);
}
const left = readdirSync("/tmp").filter((d) => d.startsWith("crc.") && !before.has(d));
ok(left.length === 0, "every private cursor root is removed after its turn", left.join(","));
console.log(`\ncursor smoke (${model}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
