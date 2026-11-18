import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// MCP conformance with the official SDK client (@modelcontextprotocol/sdk), and acceptance question 14 without a paid CLI:
// Studio's MCP helper (src/mcp.ts) behind an external CLI grant, against a stub of Studio's grant route that serves the real
// read tools over the observe fixture. For every client snippet the grant dialog gives (Claude Code's command and .mcp.json,
// Codex's command and config.toml, Cursor's and VS Code's mcp.json) and for the plug-in's .mcp.json, the config parses, and
// the SDK client started exactly as that config says initializes, lists the tools (the same fixed order every time, every
// input schema valid) and calls studio_find; structuredContent matches each tool's outputSchema (the SDK client checks it);
// a mistake is isError with how to fix it; resources/templates and resources/read mirror studio_get.
//      bun tests/mcp-sdk-conformance.ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { suite } from "./rt-harness";
import { observeP2Fixture, ROOM } from "./lib/observe-p2-fixture";
import { createObserve } from "../src/observe/tools";
import { grantableKinds } from "../src/observe/grant-scope";
import { clientSnippets, PLUGIN_SERVER } from "../src/mcp-snippets";
import { SUPPORTED_PROTOCOL_VERSIONS } from "../src/mcp-protocol";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("mcp-sdk-conformance");
const J = (v: unknown) => JSON.stringify(v);
const REPO = join(import.meta.dir, ".."), dir = mkdtempSync(join(tmpdir(), "crew-mcp-sdk-")), TOKEN = "csg_g-0000beef_" + "a".repeat(64), grantFile = join(dir, "grant");
writeFileSync(grantFile, TOKEN + "\n", { mode: 0o600 });
const F = await observeP2Fixture();
// the grant route as src/server.ts answers it for an observe grant: its read tools, each call through createObserve's grant
const O = createObserve(F.sources as any, { id: "g-0000beef", kinds: grantableKinds(), project: null, untrusted: false });
const tools = O.specs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations }));
const stub = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  if (req.headers.get("x-crew-tool-token") !== TOKEN) return Response.json({ error: "no valid external CLI grant" }, { status: 403 });
  const p = new URL(req.url).pathname;
  if (p === "/api/tools") return Response.json(tools);
  const name = decodeURIComponent(p.slice("/api/tools/".length)); if (!tools.some((t) => t.name === name)) return Response.json({ error: `no such tool: ${name}` }, { status: 404 });
  try { return Response.json(await O.call(name, await req.json())); } catch (e: any) { return Response.json({ error: e?.publicFailure?.reason?.en ?? String(e?.message ?? e) }); }
} });
const base = `http://127.0.0.1:${stub.port}`, helper = ["bun", join(REPO, "src", "mcp.ts"), "--grant-file", grantFile, "--url", base];
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? dir };

/** the words of a shell command line as src/mcp-snippets.ts quotes them ('…' with '\'' inside) */
function words(line: string): string[] { const out: string[] = []; const re = /'((?:[^']|'\\'')*)'|(\S+)/g; let m; while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]); return out; }
/** the server a snippet starts: { command, args } */
function serverOf(sn: ReturnType<typeof clientSnippets>[number], form: "command" | "config"): { command: string; args: string[] } {
  if (form === "command") { const w = words(sn.command!); const i = w.indexOf("--"); return { command: w[i + 1], args: w.slice(i + 2) }; }
  if (sn.client === "codex") { const t: any = Bun.TOML.parse(sn.config); return t.mcp_servers.studio; }
  const j = JSON.parse(sn.config); return sn.client === "vscode" ? (ok(j.servers.studio.type === "stdio", "VS Code's entry is a stdio server"), j.servers.studio) : j.mcpServers.studio;
}
const schemas = new AjvJsonSchemaValidator(); // the SDK's own JSON Schema validator
async function connectAndUse(label: string, server: { command: string; args: string[] }, extraEnv: Record<string, string> = {}) {
  const client = new Client({ name: "crew-conformance", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: server.command, args: server.args, env: { ...env, ...extraEnv }, cwd: REPO, stderr: "pipe" });
  try {
    await client.connect(transport);
    const v = client.getServerVersion(), caps = client.getServerCapabilities(), instr = client.getInstructions() ?? "";
    ok(v?.name === "studio" && !!caps?.tools && !!caps?.resources && instr.length > 0 && Buffer.byteLength(instr) <= 4096, `${label}: initialize: studio, tools and resources, instructions within 4 KB`, J({ v, caps }));
    const a = await client.listTools(), b = await client.listTools();
    ok(J(a.tools.map((t) => t.name)) === J(b.tools.map((t) => t.name)) && J(a.tools.map((t) => t.name)) === J([...a.tools.map((t) => t.name)].sort()), `${label}: tools/list in one fixed order`, J(a.tools.map((t) => t.name)));
    ok(a.tools.every((t) => { try { schemas.getValidator(t.inputSchema as any); if (t.outputSchema) schemas.getValidator(t.outputSchema as any); return t.annotations?.readOnlyHint === true; } catch { return false; } }), `${label}: every input and output schema compiles; every tool is readOnlyHint`);
    const found: any = await client.callTool({ name: "studio_find", arguments: { query: "1645" } });
    ok(!found.isError && found.structuredContent?.items?.some((x: any) => x.ref === `room:${ROOM}`) && found.content.some((c: any) => c.type === "resource_link" && c.uri === `studio://room/${ROOM}`), `${label}: studio_find answers (structuredContent checked against its outputSchema by the SDK), with resource links`, J(found).slice(0, 300));
    const bad: any = await client.callTool({ name: "studio_list", arguments: { kind: "nope" } });
    ok(bad.isError === true && /Valid kinds/.test(bad.content?.[0]?.text ?? ""), `${label}: a mistake is isError, saying how to fix it`, J(bad));
    return client;
  } catch (e: any) { ok(false, `${label}: connects`, String(e?.stack ?? e)); try { await client.close(); } catch {} return null; }
}
try {
  ok(SUPPORTED_PROTOCOL_VERSIONS.length > 0, "the helper negotiates from a fixed list");
  const all = clientSnippets(helper, { grantFile, url: base, home: { src: REPO } }), snippets = all.filter((s) => s.client !== "plugin");
  ok(J(all.map((s) => s.client)) === J(["claude", "codex", "cursor", "vscode", "plugin"]) && /--scope user/.test(all[0].command!) && all.every((s) => !/^\.(cursor|vscode)\/|^\.mcp\.json$/.test(s.file)) && snippets.every((s) => !s.config.includes(TOKEN) && !(s.command ?? "").includes(TOKEN)), "a snippet for Claude Code, Codex, Cursor and VS Code; none carries the token");
  for (const sn of snippets) for (const form of ["command", "config"] as const) {
    if (form === "command" && !sn.command) continue;
    const label = `${sn.label} ${form === "command" ? "command" : sn.file}`, server = serverOf(sn, form);
    ok(J([server.command, ...server.args]) === J(helper), `${label}: parses to the helper and its grant file`, J(server));
    const c = await connectAndUse(label, server); if (!c) continue;
    if (sn.client === "claude" && form === "config") {
      const tpl = await c.listResourceTemplates(); ok(tpl.resourceTemplates[0]?.uriTemplate === "studio://{kind}/{id}", "resources/templates/list: studio://{kind}/{id}");
      const rd = await c.readResource({ uri: `studio://room/${ROOM}` }); const body = JSON.parse((rd.contents[0] as any).text);
      ok(body.ref === `room:${ROOM}` && rd.contents[0].mimeType === "application/json", "resources/read mirrors studio_get", J(body).slice(0, 200));
      let err = ""; try { await c.readResource({ uri: "studio://terminal/T-mf3k2a-1b2c3d" }); } catch (e: any) { err = String(e?.message ?? e); }
      ok(/not found/i.test(err), "a resource outside the grant is not found", err);
    }
    await c.close();
  }
  // the plug-in (Claude Code and Codex): its .mcp.json starts `crew-studio mcp`; the grant file comes from the environment
  const plug = JSON.parse(readFileSync(join(REPO, "plugins/crew-studio/.mcp.json"), "utf8")).mcpServers.studio;
  ok(J(plug) === J(PLUGIN_SERVER), "the plug-in's .mcp.json is the resolver (nothing on PATH needed)", J(plug));
  const claudeManifest = JSON.parse(readFileSync(join(REPO, "plugins/crew-studio/.claude-plugin/plugin.json"), "utf8")), codexManifest = JSON.parse(readFileSync(join(REPO, "plugins/crew-studio/.codex-plugin/plugin.json"), "utf8"));
  const market = JSON.parse(readFileSync(join(REPO, ".claude-plugin/marketplace.json"), "utf8"));
  ok(plug.command === "sh" && plug.type === "stdio" && claudeManifest.name === "crew-studio" && codexManifest.skills === "./skills/" && codexManifest.mcpServers === "./.mcp.json" && market.plugins[0].source === "./plugins/crew-studio",
    "the plug-in: Claude Code and Codex manifests, its .mcp.json, the marketplace entry", J({ plug, codexManifest }));
  // the plug-in tab's export lines, as a shell would set them, start the resolver with no crew-studio on PATH
  const exported = Object.fromEntries(all.at(-1)!.config.trim().split("\n").map((l) => { const m = /^export (\w+)=(.*)$/.exec(l)!; return [m[1], words(m[2])[0]]; }));
  ok(exported.CREW_STUDIO_GRANT_FILE === grantFile && exported.CREW_STUDIO_URL === base && exported.CREW_STUDIO_SRC === REPO, "the plug-in tab exports the grant file, Studio's address and where Studio is", J(exported));
  const noPath = { PATH: "/usr/bin:/bin:" + dirname(process.execPath) };
  const viaEnv = await connectAndUse("the plug-in's server, from its tab's exports (no crew-studio on PATH)", { command: plug.command, args: plug.args }, { ...noPath, ...exported });
  await viaEnv?.close();
  // what goes wrong says how to fix it, at once
  const run = (env: Record<string, string>) => { const r = Bun.spawnSync([plug.command, ...plug.args], { env: { ...noPath, HOME: dir, ...env }, stdin: new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n') }); return { code: r.exitCode, err: r.stderr.toString() }; };
  const nowhere = run({}), nogrant = run({ CREW_STUDIO_SRC: REPO });
  ok(nowhere.code === 127 && /set CREW_STUDIO_BIN/.test(nowhere.err), "no Studio found: exit 127, saying to set CREW_STUDIO_BIN or CREW_STUDIO_SRC", J(nowhere));
  ok(nogrant.code === 2 && /set CREW_STUDIO_GRANT_FILE/.test(nogrant.err), "no grant: the helper stops at once, saying to set CREW_STUDIO_GRANT_FILE", J(nogrant));
} finally { stub.stop(true); for (const r of F.E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) { try { await F.E.cancel(r.id); } catch {} } F.H.stop(); }
end();
