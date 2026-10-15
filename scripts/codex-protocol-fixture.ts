// Builds tests/fixture/codex-app-server/protocol.json from the INSTALLED codex:
// `codex app-server generate-json-schema` (the stable protocol, no --experimental),
// cut down to the methods Studio uses and the definitions they reference, with
// descriptions removed. It never starts an app-server, a thread or a turn, and
// the schema holds no tokens or paths of this machine.
//   bun scripts/codex-protocol-fixture.ts [codex-bin]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = process.argv[2] ?? "codex";
const out = join(import.meta.dir, "../tests/fixture/codex-app-server");
const tmp = mkdtempSync(join(tmpdir(), "codex-schema-"));
const run = (args: string[]) => { const r = Bun.spawnSync([bin, ...args], { stdout: "pipe", stderr: "pipe" }); if (!r.success) throw new Error(`${bin} ${args.join(" ")}: ${r.stderr}`); return r.stdout.toString().trim(); };
const version = run(["--version"]);
run(["app-server", "generate-json-schema", "--out", tmp]);
const bundle = JSON.parse(readFileSync(join(tmp, "codex_app_server_protocol.schemas.json"), "utf8"));
const methodsOf = (name: string) => (bundle.definitions[name].oneOf as any[]).map((a) => a.properties.method.enum[0]).sort();
const clientRequests = methodsOf("ClientRequest"), serverRequests = methodsOf("ServerRequest"), notifications = methodsOf("ServerNotification");

// method -> the definitions of its params and result (client requests), or params (server requests, notifications)
const v2 = (n: string) => `v2/${n}`;
const use: Record<string, { params: string; result?: string }> = {
  initialize: { params: "InitializeParams", result: "InitializeResponse" },
  "thread/list": { params: v2("ThreadListParams"), result: v2("ThreadListResponse") },
  "thread/fork": { params: v2("ThreadForkParams"), result: v2("ThreadForkResponse") },
  "thread/start": { params: v2("ThreadStartParams"), result: v2("ThreadStartResponse") },
  "thread/resume": { params: v2("ThreadResumeParams"), result: v2("ThreadResumeResponse") },
  "thread/turns/list": { params: v2("ThreadTurnsListParams"), result: v2("ThreadTurnsListResponse") },
  "turn/start": { params: v2("TurnStartParams"), result: v2("TurnStartResponse") },
  "turn/interrupt": { params: v2("TurnInterruptParams"), result: v2("TurnInterruptResponse") },
  "turn/started": { params: v2("TurnStartedNotification") },
  "turn/completed": { params: v2("TurnCompletedNotification") },
  "item/started": { params: v2("ItemStartedNotification") },
  "item/completed": { params: v2("ItemCompletedNotification") },
  "item/agentMessage/delta": { params: v2("AgentMessageDeltaNotification") },
  "item/commandExecution/requestApproval": { params: "CommandExecutionRequestApprovalParams", result: "CommandExecutionRequestApprovalResponse" },
  "item/tool/call": { params: "DynamicToolCallParams", result: "DynamicToolCallResponse" },
  "item/fileChange/requestApproval": { params: "FileChangeRequestApprovalParams", result: "FileChangeRequestApprovalResponse" },
};
const roots = [...new Set(Object.values(use).flatMap((u) => [u.params, u.result].filter(Boolean) as string[])), "JSONRPCErrorError"];

const get = (path: string) => path.split("/").reduce((o: any, k) => o?.[k], bundle.definitions);
const keep: Record<string, any> = {};
const strip = (o: any): any => Array.isArray(o) ? o.map(strip) : o && typeof o === "object"
  ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "description" && k !== "$schema").map(([k, v]) => [k, strip(v)])) : o;
const visit = (path: string) => {
  if (keep[path]) return;
  const def = get(path); if (!def) throw new Error(`no definition ${path}`);
  keep[path] = strip(def);
  JSON.stringify(def, (k, v) => { if (k === "$ref" && typeof v === "string") visit(v.replace("#/definitions/", "")); return v; });
};
for (const r of roots) visit(r);
const definitions: any = {};
for (const [path, def] of Object.entries(keep)) { const parts = path.split("/"); let o = definitions; for (const p of parts.slice(0, -1)) o = o[p] ??= {}; o[parts.at(-1)!] = def; }
for (const m of Object.keys(use)) if (![...clientRequests, ...serverRequests, ...notifications].includes(m)) throw new Error(`${m} is not in this codex's protocol`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "protocol.json"), JSON.stringify({ source: `${version}: codex app-server generate-json-schema (stable, no --experimental)`,
  clientRequests, serverRequests, notifications, use, definitions }, null, 1) + "\n");
rmSync(tmp, { recursive: true, force: true });
console.log(`${version}: ${clientRequests.length} client requests (thread/fork ${clientRequests.includes("thread/fork") ? "present" : "ABSENT"}), ${Object.keys(keep).length} definitions -> ${out}/protocol.json`);
