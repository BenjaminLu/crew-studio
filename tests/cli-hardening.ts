import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// What the crew-studio CLI and `crew-studio mcp` refuse, against a stub Studio (no real one: CI's portable job runs it):
//   - a terminal never gets someone else's control characters: ESC[2J, OSC 0 (title), OSC 8 (links), OSC 52 (clipboard),
//     BEL, C1; cut to width only after they are gone. JSON keeps the text as it is (escaped by JSON itself)
//   - a grant's token goes only to this Mac: a grant file naming another host is refused (exit 7); an auto-found grant
//     ignores --url and CREW_STUDIO_URL; an explicit address must be loopback
//   - a grant file is used only when it and its folder are the user's own, private and no link (0644, a symlink, a 0755
//     folder: exit 7 with the fix)
//   - a malformed answer is exit 1 in one line, never a stack trace; piped help is JSON; a flag first is still the CLI
//      bun tests/cli-hardening.ts
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, ".."), TOKEN = "csg_g-0000abcd_" + "b".repeat(64);
const EVIL = "hello \x1b]0;PWNED-TITLE\x07\x1b[2J\x1b[31mRED\x1b[0m \x1b]8;;https://evil.example/click\x1b\\x\x1b]8;;\x1b\\ \x1b]52;c;cHduZWQ=\x07\u009b31m \u202ePWNEDRTL\u202c \u2066iso\u2069 \u200fmark\u200e end";
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
let seen: string[] = [], whoamiBroken = false, lastList: any = null;
const stub = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  const u = new URL(req.url); seen.push(u.pathname + u.search);
  if (req.headers.get("x-crew-tool-token") !== TOKEN) return Response.json({ error: "no valid tool token" }, { status: 403 });
  if (u.searchParams.get("whoami") === "1") return whoamiBroken ? Response.json({ nope: true }) : Response.json({ grant: { id: "g-0000abcd", state: "active", scopes: ["observe"], expiresAt: "2099-01-01T00:00:00Z", observe: { kinds: ["task"], untrusted: true }, budget: { calls: 1, maxCalls: 600, bytes: 10, maxBytes: 4194304 } }, tools: ["studio_get", "studio_list", "studio_now"] });
  if (u.pathname === "/api/tools") return Response.json([{ name: "studio_get" }, { name: "studio_list" }, { name: "studio_now" }]);
  const name = u.pathname.slice("/api/tools/".length);
  if (name === "studio_get") return Response.json({ ref: "task:R-1", kind: "task", route: "#/run/R-1", updatedAt: "2026-01-01T00:00:00Z", data: { externalTitle: { untrusted: true, source: "a Task title", text: EVIL } }, untrusted: [{ path: "externalTitle" }] });
  if (name === "studio_list") lastList = await req.json().catch(() => null);
  if (name === "studio_list") return Response.json({ ref: "list:task", kind: "list", data: {}, items: [{ ref: "task:R-1", title: EVIL + EVIL }] });
  return Response.json({ error: `boom ${EVIL} (look it up with studio_find first, or studio_list {kind: "project"})` });
} });
const catcher = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { caught.push(req.headers.get("x-crew-tool-token") ?? ""); return Response.json([]); } }); const caught: string[] = [];
const base = `http://127.0.0.1:${stub.port}`;
const homeWith = (url = base) => { const h = mkdtempSync(join(tmpdir(), "crew-cli-hard-")); mkdirSync(join(h, "grants"), { mode: 0o700 }); chmodSync(join(h, "grants"), 0o700);
  writeFileSync(join(h, "grants", "bot.json"), JSON.stringify({ schema: 1, name: "bot", id: "g-0000abcd", token: TOKEN, scopes: ["observe"], project: null, expiresAt: "2099-01-01T00:00:00Z", url }), { mode: 0o600 }); return h; };
const H = homeWith();
const env = (h: string, more: Record<string, string> = {}) => ({ ...process.env, CREW_STUDIO_HOME: h, ...more }) as any;
// asynchronous: the stub Studio answers in this same process
const cli = async (args: string[], h = H, more: Record<string, string> = {}) => { const p = Bun.spawn(["bun", join(REPO, "src", "main.ts"), ...args], { cwd: REPO, env: env(h, more), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()]; let json: any = null; try { json = JSON.parse(stdout); } catch {} return { code: await p.exited, stdout, stderr, json }; };
async function tty(args: string[], h = H): Promise<{ code: number; text: string }> {
  let text = ""; const p = Bun.spawn(["bun", join(REPO, "src", "main.ts"), ...args], { cwd: REPO, env: env(h), terminal: { cols: 200, rows: 60, data: (_t: any, d: Uint8Array) => { text += new TextDecoder().decode(d); } } } as any);
  const code = await p.exited; return { code, text: text.replace(/\r/g, "") };
}
async function mcpList(args: string[], h: string, more: Record<string, string> = {}) {
  const p = Bun.spawn(["bun", join(REPO, "src", "main.ts"), "mcp", ...args], { cwd: REPO, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: env(h, more) });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n"); await p.stdin.end();
  const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()]; return { code: await p.exited, out, err };
}
let failed = false;
const step = async (name: string, f: () => Promise<void> | void) => { try { await f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
try {
  await step("a terminal gets no control characters: get, list (cut after stripping), a tool's error on stderr", async () => {
    for (const args of [["get", "task:R-1"], ["list", "task"], ["now"]]) { const t = await tty(args);
      assert.ok(!CONTROL.test(t.text.replace(/\n|\t/g, "")), `${args.join(" ")}: ${JSON.stringify(t.text).slice(0, 300)}`); assert.match(t.text, /hello .*PWNED-TITLE/, args.join(" ")); }
    const l = await tty(["list", "task"]); assert.match(l.text, /^task:R-1 {2}hello /m);
  });
  await step("JSON keeps someone else's text as it is (JSON escapes it), with updatedAt", async () => {
    const r = await cli(["get", "task:R-1"]); assert.equal(r.code, 0); assert.equal(r.json.data.externalTitle.text, EVIL); assert.equal(r.json.updatedAt, "2026-01-01T00:00:00Z");
  });
  await step("a tool's hint names the CLI command, not the MCP tool", async () => {
    // the stub's error goes through fail(): the same path a real tool's "call studio_find" hint takes
    const r = await cli(["call", "studio_x", "{}"]); assert.equal(r.code, 1); assert.match(r.json.error, /look it up with crew-studio find first, or crew-studio list project\)/); assert.ok(!/studio_(find|list)|\{kind:/.test(r.json.error), r.json.error);
  });
  await step("a grant file whose address is not this Mac is refused (exit 7); the token is never sent", async () => {
    caught.length = 0; const h = homeWith(`http://example.invalid:${catcher.port}`); const r = await cli(["now"], h);
    assert.equal(r.code, 7, r.stdout); assert.match(r.json.error, /not this Mac/); assert.equal(caught.length, 0);
  });
  await step("crew-studio mcp with an auto-found grant ignores CREW_STUDIO_URL and --url: the token goes to the grant's own address", async () => {
    caught.length = 0; seen = [];
    const a = await mcpList([], H, { CREW_STUDIO_URL: `http://127.0.0.1:${catcher.port}` }); assert.match(a.out, /studio_get/, a.err); assert.equal(caught.length, 0, "CREW_STUDIO_URL got the token");
    const b = await mcpList(["--url", `http://127.0.0.1:${catcher.port}`], H); assert.match(b.out, /studio_get/, b.err); assert.equal(caught.length, 0, "--url got the token"); assert.ok(seen.length >= 2);
  });
  await step("crew-studio mcp refuses an explicit address off this Mac (exit 2)", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "crew-cli-hard-tok-")), "tok"); writeFileSync(f, TOKEN, { mode: 0o600 });
    const r = await mcpList(["--grant-file", f, "--url", "http://example.invalid"], H); assert.equal(r.code, 2, r.err); assert.match(r.err, /only at http:\/\/127\.0\.0\.1/);
  });
  await step("a grant file readable by others, a symlink, or a 0755 folder: exit 7 with the fix; the token is not used", async () => {
    const a = homeWith(); chmodSync(join(a, "grants", "bot.json"), 0o644); seen = [];
    let r = await cli(["now"], a); assert.equal(r.code, 7); assert.match(r.json.error, /can be read by other users \(mode 644\); fix: chmod 600/); assert.equal(seen.length, 0);
    const b = homeWith(), elsewhere = homeWith(); symlinkSync(join(elsewhere, "grants", "bot.json"), join(b, "grants", "link.json"));
    r = await cli(["now", "--grant", "link"], b); assert.equal(r.code, 7); assert.match(r.json.error, /not a link/);
    const c = homeWith(); chmodSync(join(c, "grants"), 0o755); r = await cli(["now"], c); assert.equal(r.code, 7); assert.match(r.json.error, /mode 755\); fix: chmod 700/);
  });
  await step("a relative CREW_STUDIO_GRANT path is named as the absolute path it resolves to", async () => {
    const r = await cli(["now"], H, { CREW_STUDIO_GRANT: "nope/bot.json" }); assert.equal(r.code, 7);
    assert.ok(r.json.error.includes(join(REPO, "nope", "bot.json")), r.json.error);
  });
  await step("a malformed whoami answer is exit 1 in one line, no stack trace", async () => {
    whoamiBroken = true; const r = await cli(["whoami"]); whoamiBroken = false;
    assert.equal(r.code, 1); assert.match(r.json.error, /not a grant/); assert.ok(!/at .*\.ts:\d+/.test(r.stdout + r.stderr), r.stderr);
  });
  await step("piped help is JSON; a flag first is still the CLI (--json now, --grant bot whoami)", async () => {
    const h = await cli(["help"]); assert.equal(h.code, 0); assert.ok(Array.isArray(h.json.commands));
    const a = await cli(["--json", "now"]); assert.equal(a.code, 1, a.stdout + a.stderr); assert.equal(a.json.exit, 1); // the stub's studio_now fails: but it was the CLI that ran
    const b = await cli(["--grant", "bot", "whoami"]); assert.equal(b.code, 0, b.stdout + b.stderr); assert.equal(b.json.data.id, "g-0000abcd");
  });
  await step("--verbose is never a list filter", async () => {
    const r = await cli(["list", "task", "--verbose", "--open", "true"]); assert.equal(r.code, 0); assert.deepEqual(lastList, { kind: "task", filter: { open: true } });
  });
} finally { stub.stop(true); catcher.stop(true); }
console.log(failed ? "\ncli-hardening: FAILED" : "\ncli-hardening: all passed");
process.exit(failed ? 1 : 0);
