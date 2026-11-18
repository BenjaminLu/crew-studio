import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The crew-studio CLI end to end (docs/units/cli.md) against a real Studio on a free port with temporary data and its own
// Studio home: the board issues a grant and its CLI grant file lands in <home>/grants (0600, folder 0700), and is gone on
// revoke. The CLI finds it (--grant, CREW_STUDIO_GRANT, the only file), never prints the token, answers JSON when piped and a
// summary on a terminal (someone else's words marked), and exits 0 / 2 usage / 3 not in this grant / 4 budget used up /
// 5 not found / 6 Studio not answering / 7 no grant. `crew-studio mcp` finds the same grant. The command table, help --json,
// the MCP tools/list and the grant's tool list agree (drift).
//      bun tests/cli.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { staffedCodeStudio } from "./lib/staffed-code-studio";
import { sessionCookieName } from "../src/csrf";
import { observeSpecs } from "../src/observe/tools";
import { grantableKinds } from "../src/observe/grant-scope";
import { GRANT_TOOLS } from "../src/cli-grants";
import { verbs } from "../src/cli";

const REPO = join(import.meta.dir, "..");
const s = await staffedCodeStudio("cli");
const HOME = process.env.CREW_STUDIO_HOME!, GRANTS = join(HOME, "grants");
const page = () => ({ "content-type": "application/json", cookie: `${sessionCookieName(s.token)}=${s.token}`, "sec-fetch-site": "same-origin", origin: s.base });
const post = async (path: string, body: unknown) => { const r = await fetch(s.base + path, { method: "POST", headers: page(), body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
/** the CLI as an agent runs it: piped (JSON), in a given Studio home */
const cli = (args: string[], env: Record<string, string> = {}) => { const r = Bun.spawnSync(["bun", join(REPO, "src", "main.ts"), ...args], { cwd: REPO, env: { ...process.env, CREW_STUDIO_HOME: HOME, ...env } as any });
  const stdout = r.stdout.toString(), stderr = r.stderr.toString(); let json: any = null; try { json = JSON.parse(stdout); } catch {} return { code: r.exitCode, stdout, stderr, json }; };
/** the CLI on a terminal (a PTY): what a person sees */
async function tty(args: string[], env: Record<string, string> = {}): Promise<{ code: number; text: string }> {
  let text = ""; const p = Bun.spawn(["bun", join(REPO, "src", "main.ts"), ...args], { cwd: REPO, env: { ...process.env, CREW_STUDIO_HOME: HOME, ...env } as any, terminal: { cols: 160, rows: 60, data: (_t: any, d: Uint8Array) => { text += new TextDecoder().decode(d); } } } as any);
  const code = await p.exited; return { code, text: text.replace(/\r/g, "") };
}
let failed = false;
const step = async (name: string, f: () => Promise<void> | void) => { try { await f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
const tokenOf = (id: string) => readFileSync(join(s.data, "grants", id), "utf8").trim();
try {
  let R: any, D: any;
  await step("no grant yet: every command exits 7 and says where grants come from; help still answers", () => {
    const r = cli(["now"]); assert.equal(r.code, 7, r.stdout + r.stderr); assert.match(r.json.error, /issue one on Studio's board/);
    const h = cli(["help", "--json"]); assert.equal(h.code, 0); assert.equal(h.json.grant, null); assert.ok(h.json.commands.some((c: any) => c.command === "now"));
  });
  await step("the board issues a grant: its CLI file lands in the Studio home, 0600 in a 0700 folder, with the token and Studio's address", async () => {
    const r = await post("/api/cli-grants", { scopes: ["observe"], observe: { preset: "review" }, ttl: "1h" }); assert.equal(r.status, 200, JSON.stringify(r.body)); R = r.body.grant;
    const f = join(GRANTS, `${R.id}.json`); assert.ok(existsSync(f)); assert.equal(statSync(f).mode & 0o777, 0o600); assert.equal(statSync(GRANTS).mode & 0o777, 0o700);
    const g = JSON.parse(readFileSync(f, "utf8")); assert.equal(g.token, tokenOf(R.id)); assert.equal(g.url, s.base); assert.deepEqual(g.scopes, ["observe"]);
  });
  await step("whoami: the one grant found, its scopes, kinds and budget; the token is never printed", () => {
    const r = cli(["whoami"]); assert.equal(r.code, 0, r.stderr); assert.equal(r.json.data.id, R.id); assert.deepEqual(r.json.data.kinds, ["room"]); assert.equal(r.json.data.externalText, false);
    assert.ok(!r.stdout.includes(tokenOf(R.id)) && !r.stderr.includes(tokenOf(R.id)));
  });
  await step("exit 3: a kind outside the grant, a never-grantable kind, a tool outside its scopes", () => {
    for (const args of [["list", "task"], ["list", "terminal"], ["get", "settings:studio"], ["run", "workflows"]]) { const r = cli(args); assert.equal(r.code, 3, `${args.join(" ")}: ${r.stdout}${r.stderr}`); assert.equal(r.json.ok, false); }
  });
  await step("a second grant: several in the folder, so --grant or CREW_STUDIO_GRANT picks; exit 7 says so otherwise", async () => {
    const r = await post("/api/cli-grants", { scopes: ["observe"], project: "sandbox", observe: { preset: "custom", kinds: ["workflow", "project", "doctor"], untrusted: true }, ttl: "1h" }); assert.equal(r.status, 200); D = r.body.grant;
    const none = cli(["now"]); assert.equal(none.code, 7); assert.match(none.json.error, /2 grants .* say which with --grant/);
    assert.equal(cli(["whoami", "--grant", D.id]).json.data.id, D.id);
    assert.equal(cli(["whoami"], { CREW_STUDIO_GRANT: D.id }).json.data.id, D.id);
    // a flag first is still the CLI, never Studio's server (the board's test line is `crew-studio --grant <name> whoami`)
    const first = cli(["--grant", D.id, "whoami"]); assert.equal(first.code, 0, first.stdout + first.stderr); assert.equal(first.json.data.id, D.id);
    assert.equal(cli(["whoami"], { CREW_STUDIO_GRANT: join(GRANTS, `${R.id}.json`) }).json.data.id, R.id);
  });
  const g = (args: string[]) => cli([...args, "--grant", D.id]);
  await step("exit 0: now, list, get, find, read, events, through the tools; JSON is {ok, data, trust, untrusted, nextCursor, quota}", () => {
    const now = g(["now"]); assert.equal(now.code, 0, now.stderr); assert.equal(now.json.ok, true); assert.ok("quota" in now.json && now.json.quota.maxCalls > 0, now.stdout);
    const wf = g(["list", "workflow"]); assert.equal(wf.code, 0); assert.ok(wf.json.data.entries.length > 0 && wf.json.items[0].ref.startsWith("workflow:"));
    const pr = g(["get", "project:sandbox"]); assert.equal(pr.code, 0, pr.stdout); assert.equal(pr.json.ref, "project:sandbox");
    const rd = g(["read", "studio://project/sandbox"]); assert.equal(rd.code, 0); assert.equal(rd.json.ref, "project:sandbox");
    const fd = g(["find", "sandbox"]); assert.equal(fd.code, 0); assert.ok(fd.json.items.some((i: any) => i.ref === "project:sandbox"));
    const ev = g(["events"]); assert.equal(ev.code, 0); assert.ok("nextCursor" in ev.json);
  });
  await step("external text: wrapped and listed in JSON, marked on a terminal; left out entirely without it", async () => {
    const docs = g(["list", "doctor"]); const id = docs.json.items[0].ref; const one = g(["get", id]);
    assert.ok(one.json.untrusted.length > 0 && one.json.trust?.rule, JSON.stringify(one.json).slice(0, 300));
    const t = await tty(["get", id, "--grant", D.id]); assert.equal(t.code, 0); assert.match(t.text, /«untrusted: /); assert.match(t.text, /someone else's words/);
    const r2 = await post("/api/cli-grants", { scopes: ["observe"], observe: { preset: "custom", kinds: ["doctor"] }, ttl: "1h" }); const N = r2.body.grant;
    const plain = cli(["get", id, "--grant", N.id]); assert.equal(plain.code, 0); assert.equal(plain.json.untrusted.length, 0); assert.ok(!JSON.stringify(plain.json).includes('"untrusted":true'), plain.stdout.slice(0, 300));
    await post(`/api/cli-grants/${N.id}/revoke`, {});
  });
  await step("a terminal gets a table for a list and a summary for one entity", async () => {
    const t = await tty(["list", "workflow", "--grant", D.id]); assert.equal(t.code, 0); assert.match(t.text, /^workflow:\S+ {2}/m); assert.ok(!t.text.trim().startsWith("{"));
  });
  await step("exit 2: a command without its argument, an unknown command, a filter the kind has not", () => {
    for (const args of [["get"], ["frobnicate"], ["list", "workflow", "--nope", "x"]]) { const r = g(args); assert.equal(r.code, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`); }
    assert.match(g(["get"]).json.usage ?? g(["get"]).stdout, /crew-studio get <ref>/);
  });
  await step("exit 5: a ref Studio does not have", () => { const r = g(["get", "project:no-such-project"]); assert.equal(r.code, 5, r.stdout); });
  await step("exit 4: the hourly budget used up says when it frees up, and that calls hold 24 KB up front", () => {
    const f = join(s.data, "cli-grants.json"), all = JSON.parse(readFileSync(f, "utf8")), now = Date.now();
    for (const x of all) if (x.id === D.id) x.usage = Array.from({ length: 600 }, (_, i) => ({ at: now - 1000 + i, bytes: 10 })); writeFileSync(f, JSON.stringify(all));
    const r = g(["now"]); assert.equal(r.code, 4, r.stdout); assert.ok(Date.parse(r.json.freesAt) > Date.now(), r.stdout); assert.match(r.json.error, /holds 24576 bytes up front/);
  });
  await step("exit 6: Studio not answering at the grant's address", () => {
    const h = mkdtempSync(join(tmpdir(), "crew-cli-dead-")); mkdirSync(join(h, "grants"));
    const gf = JSON.parse(readFileSync(join(GRANTS, `${R.id}.json`), "utf8")); writeFileSync(join(h, "grants", "dead.json"), JSON.stringify({ ...gf, url: "http://127.0.0.1:9" }), { mode: 0o600 });
    const r = cli(["now"], { CREW_STUDIO_HOME: h }); assert.equal(r.code, 6, r.stdout); assert.match(r.json.error, /crew-studio launch/); assert.ok(!r.stdout.includes(gf.token));
  });
  await step("crew-studio mcp finds the same grant (config: command crew-studio, args [mcp]) and lists the grant's tools", async () => {
    const p = spawn("bun", [join(REPO, "src", "main.ts"), "mcp", "--grant", R.id], { cwd: REPO, env: { ...process.env, CREW_STUDIO_HOME: HOME }, stdio: ["pipe", "pipe", "pipe"] });
    const waiting = new Map<number, (m: any) => void>(); let n = 0; createInterface({ input: p.stdout! }).on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
    const rpc = (method: string, params?: unknown) => new Promise<any>((res, rej) => { const id = ++n; waiting.set(id, res); p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); setTimeout(() => rej(new Error(`no answer to ${method}`)), 20_000); });
    try { await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }); const tl = await rpc("tools/list");
      const who = cli(["whoami", "--grant", R.id]).json.data.tools; assert.deepEqual(tl.result.tools.map((t: any) => t.name).sort(), [...who].sort()); }
    finally { p.kill(); }
    const none = Bun.spawnSync(["bun", join(REPO, "src", "main.ts"), "mcp"], { env: { ...process.env, CREW_STUDIO_HOME: mkdtempSync(join(tmpdir(), "crew-cli-none-")) } as any, stdin: new TextEncoder().encode("") });
    assert.equal(none.exitCode, 7); assert.match(none.stderr.toString(), /no grant/);
  });
  await step("drift: every read tool is a command, every command's flags are its tool's inputs, help --json and the grant's tools agree", () => {
    const reads = observeSpecs({ id: "g", kinds: grantableKinds(), project: null, untrusted: false }), tools = new Map([...reads, ...GRANT_TOOLS].map((t) => [t.name, t]));
    const vs = verbs(); assert.ok(reads.every((t) => vs.some((v) => v.tool === t.name)), "a read tool with no command");
    for (const v of vs) { const props = Object.keys((tools.get(v.tool) as any)?.inputSchema?.properties ?? {}); assert.ok(tools.has(v.tool), v.tool); for (const f of v.flags) if (v.verb !== "run start") assert.ok(props.includes(f.key), `${v.verb} --${f.name}`); }
    const h = cli(["help", "--json", "--grant", R.id]).json; assert.deepEqual(h.commands.map((c: any) => c.command), vs.map((v) => v.verb));
    const who = cli(["whoami", "--grant", R.id]).json.data.tools; assert.deepEqual(h.commands.filter((c: any) => c.available).map((c: any) => c.tool).filter((t: string, i: number, a: string[]) => a.indexOf(t) === i).sort(), [...who].sort());
    assert.deepEqual(h.kinds, grantableKinds()); assert.deepEqual(h.exitCodes.map((e: any) => e.code), [0, 1, 2, 3, 4, 5, 6, 7]);
  });
  await step("exit 7 on a revoked grant, and its CLI file is gone", async () => {
    await post(`/api/cli-grants/${R.id}/revoke`, {}); assert.ok(!existsSync(join(GRANTS, `${R.id}.json`)));
    const h = mkdtempSync(join(tmpdir(), "crew-cli-revoked-")); mkdirSync(join(h, "grants"));
    // a copy kept from before the revoke: Studio refuses its token
    writeFileSync(join(h, "grants", "old.json"), JSON.stringify({ schema: 1, name: "old", id: R.id, token: `csg_${R.id}_${"0".repeat(64)}`, scopes: ["observe"], project: null, expiresAt: new Date(Date.now() + 3600_000).toISOString(), url: s.base }), { mode: 0o600 });
    const r = cli(["now"], { CREW_STUDIO_HOME: h }); assert.equal(r.code, 7, r.stdout);
  });
} finally { await s.close(); }
console.log(failed ? "\ncli: FAILED" : "\ncli: all passed");
process.exit(failed ? 1 : 0);
