import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// MCP conformance of `crew-studio mcp` with the official SDK client (@modelcontextprotocol/sdk), against a stub of Studio's
// grant route that serves the real read tools over the observe fixture. A client's whole config is `command: crew-studio,
// args: ["mcp"]`: the helper finds its grant as the CLI does (docs/units/cli.md "Grants"). The SDK client initializes, lists
// the tools (one fixed order, every schema valid, readOnlyHint), calls studio_find (structuredContent checked against its
// outputSchema by the SDK, resource links), gets isError with how to fix a mistake, and reads studio://{kind}/{id}.
//      bun tests/mcp-sdk-conformance.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { suite } from "./rt-harness";
import { observeP2Fixture, ROOM } from "./lib/observe-p2-fixture";
import { createObserve } from "../src/observe/tools";
import { grantableKinds } from "../src/observe/grant-scope";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("mcp-sdk-conformance");
const J = (v: unknown) => JSON.stringify(v);
const REPO = join(import.meta.dir, ".."), TOKEN = "csg_g-0000beef_" + "a".repeat(64);
const F = await observeP2Fixture();
// the grant route as src/server.ts answers it for an observe grant: its read tools, each call through createObserve's grant
const O = createObserve(F.sources as any, { id: "g-0000beef", kinds: grantableKinds(), project: null, untrusted: false });
const tools = O.specs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations }));
const stub = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  if (req.headers.get("x-crew-tool-token") !== TOKEN) return Response.json({ error: "no valid external CLI grant" }, { status: 403 });
  const p = new URL(req.url).pathname;
  if (p === "/api/tools") return Response.json(tools);
  const name = decodeURIComponent(p.slice("/api/tools/".length)); if (!tools.some((t) => t.name === name)) return Response.json({ error: `no such tool: ${name}` }, { status: 404 });
  try { return Response.json(await O.call(name, await req.json())); } catch (e: any) { return Response.json({ error: e?.publicFailure?.reason?.en ?? String(e?.message ?? e), code: e?.publicFailure?.code ?? null }); }
} });
const base = `http://127.0.0.1:${stub.port}`;
// a Studio home with one grant file, as the board writes it
const home = mkdtempSync(join(tmpdir(), "crew-mcp-sdk-home-")); mkdirSync(join(home, "grants"), { recursive: true, mode: 0o700 });
writeFileSync(join(home, "grants", "review-bot.json"), J({ schema: 1, name: "review-bot", id: "g-0000beef", token: TOKEN, scopes: ["observe"], project: null, expiresAt: new Date(Date.now() + 3600_000).toISOString(), url: base }), { mode: 0o600 });
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, CREW_STUDIO_HOME: home };
const schemas = new AjvJsonSchemaValidator();

async function connect(label: string, args: string[]) {
  const client = new Client({ name: "crew-conformance", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: "bun", args: [join(REPO, "src", "main.ts"), ...args], env, cwd: REPO, stderr: "pipe" });
  await client.connect(transport);
  const v = client.getServerVersion(), caps = client.getServerCapabilities(), instr = client.getInstructions() ?? "";
  ok(v?.name === "studio" && !!caps?.tools && !!caps?.resources && instr.length > 0 && Buffer.byteLength(instr) <= 4096, `${label}: initialize: studio, tools and resources, instructions within 4 KB`, J({ v, caps }));
  return client;
}
try {
  const c = await connect("crew-studio mcp (the only grant)", ["mcp"]);
  const a = await c.listTools(), b = await c.listTools(), names = a.tools.map((t) => t.name);
  ok(J(names) === J(b.tools.map((t) => t.name)) && J(names) === J([...names].sort()) && J([...names].sort()) === J(tools.map((t) => t.name).sort()), "tools/list: the grant's tools, in one fixed order", J(names));
  ok(a.tools.every((t) => { try { schemas.getValidator(t.inputSchema as any); if (t.outputSchema) schemas.getValidator(t.outputSchema as any); return t.annotations?.readOnlyHint === true; } catch { return false; } }), "every input and output schema compiles (the SDK's own validator); every tool is readOnlyHint");
  const found: any = await c.callTool({ name: "studio_find", arguments: { query: "1645" } });
  ok(!found.isError && found.structuredContent?.items?.some((x: any) => x.ref === `room:${ROOM}`) && found.content.some((x: any) => x.type === "resource_link" && x.uri === `studio://room/${ROOM}`), "studio_find answers: structuredContent checked against its outputSchema by the SDK, resource links", J(found).slice(0, 300));
  const bad: any = await c.callTool({ name: "studio_list", arguments: { kind: "nope" } });
  ok(bad.isError === true && /Valid kinds/.test(bad.content?.[0]?.text ?? ""), "a mistake is isError, saying how to fix it", J(bad));
  const tpl = await c.listResourceTemplates(); ok(tpl.resourceTemplates[0]?.uriTemplate === "studio://{kind}/{id}", "resources/templates/list: studio://{kind}/{id}");
  const rd = await c.readResource({ uri: `studio://room/${ROOM}` }); const body = JSON.parse((rd.contents[0] as any).text);
  ok(body.ref === `room:${ROOM}` && rd.contents[0].mimeType === "application/json", "resources/read mirrors studio_get", J(body).slice(0, 200));
  let err = ""; try { await c.readResource({ uri: "studio://terminal/T-mf3k2a-1b2c3d" }); } catch (e: any) { err = String(e?.message ?? e); }
  ok(/not found/i.test(err), "a resource outside the grant is not found", err);
  await c.close();
  const named = await connect("crew-studio mcp --grant review-bot", ["mcp", "--grant", "review-bot"]); ok((await named.listTools()).tools.length === tools.length, "--grant picks the grant by name"); await named.close();
} finally { stub.stop(true); for (const r of F.E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) { try { await F.E.cancel(r.id); } catch {} } F.H.stop(); }
end();
