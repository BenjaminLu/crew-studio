import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Cursor as a third vendor: its capability probe, the crew's API key (never the keychain here: CREW_KEYCHAIN_TOOL=none),
// the secret paths a round and a check may never read, attachments, process identification, the host (fresh only, never a
// takeover) and a real Studio (src/server.ts) on the strict offline fixture tests/fixture/cursor-agent.mjs: Doctor, the
// account route, the takeover refusals, a fresh Firstmate on Cursor whose turns carry on one chat and reach Studio's tools.
//   bun tests/cursor-vendor.ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { freePort, waitUp } from "./boot.mjs";

const repo = join(import.meta.dir, ".."), FIXTURE = join(import.meta.dir, "fixture", "cursor-agent.mjs");
const TMP = mkdtempSync(join(tmpdir(), "crew-cursor-vendor-"));
// the Doctor runs `<bin> --version` directly: a thin wrapper gives it the fixture as an executable
const CLI = join(TMP, "cursor-agent"); writeFileSync(CLI, `#!/bin/sh\nexec bun "${FIXTURE}" "$@"\n`, { mode: 0o755 });
const KEY = "crsr_acceptance" + "0".repeat(49); // the fixture's key shape; not a credential
process.env.HOME = join(TMP, "home"); mkdirSync(process.env.HOME, { recursive: true });
process.env.CREW_KEYCHAIN_TOOL = "none";
delete process.env.CURSOR_API_KEY;
const { probeCursor } = await import("../src/providers/cursor");
const { cursorLogin } = await import("../src/providers/login");
const { SECRET_DIRS, cursorSecretPaths } = await import("../src/runtime/checks");
const { deliveryFor } = await import("../src/attachments");
const { isVendorProcess, driving } = await import("../src/host/probe");
const { cursorHost, CURSOR_TAKEOVER_REFUSED } = await import("../src/host/cursor");

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const until = async (f: () => boolean | Promise<boolean>, ms = 15000) => { const t = Date.now(); while (!(await f()) && Date.now() - t < ms) await Bun.sleep(50); return f(); };

console.log("capability and the crew's key");
{
  const gone = probeCursor(["composer-2.5"], join(TMP, "no-such-cursor-agent"));
  ok(!gone.available && gone.refusal === "unavailable" && gone.models.length === 0 && /not installed/.test(gone.reason ?? ""), "no CLI: Cursor is unavailable, with the reason", JSON.stringify(gone));
  const noKey = probeCursor(["composer-2.5"], FIXTURE);
  ok(noKey.available && noKey.auth === "missing" && noKey.refusal === "missing-login" && noKey.models.length === 0, "the CLI without a key: missing login, no model offered", JSON.stringify(noKey));
  process.env.CURSOR_API_KEY = KEY;
  const ready = probeCursor(["composer-2.5", "composer-2.5", ""], FIXTURE);
  ok(ready.available && ready.auth === "verified" && ready.quota === "available" && JSON.stringify(ready.models) === JSON.stringify([{ id: "composer-2.5", efforts: [] }]), "the CLI and a key: verified, the configured model once, no effort levels", JSON.stringify(ready));
  const env = cursorLogin();
  ok(env.ok && env.env?.CURSOR_API_KEY === KEY && cursorLogin({ probe: true }).ok && cursorLogin({ probe: true }).env?.CURSOR_API_KEY === "", "the key from Studio's environment; a probe never carries it");
  process.env.CURSOR_API_KEY = "crsr_short";
  const bad = cursorLogin();
  ok(!bad.ok && /not a Cursor API key/.test(bad.error ?? "") && !(bad.error ?? "").includes("crsr_short"), "a key of the wrong shape is refused without echoing it", bad.error);
  delete process.env.CURSOR_API_KEY;
  const dir = join(process.env.HOME!, ".config", "crew-studio"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cursor-api-key"), KEY + "\n", { mode: 0o600 }); chmodSync(join(dir, "cursor-api-key"), 0o600);
  const probed = cursorLogin({ probe: true }), read = cursorLogin();
  ok(probed.ok && /cursor-api-key/.test(probed.source ?? ""), "a presence probe finds the crew's private key file (no keychain)", JSON.stringify(probed));
  ok(read.ok && read.env?.CURSOR_API_KEY === KEY, "a round's login reads the crew's private key file");
  ok(probeCursor(["composer-2.5"], FIXTURE).auth === "verified", "the private key file makes Cursor ready");
  rmSync(join(dir, "cursor-api-key"));
}

console.log("secrets, attachments, processes");
{
  const h = homedir(), dirs = SECRET_DIRS(null);
  ok(["auth.json", "cli-config.json", "mcp.json", "chats", "projects"].every((f) => dirs.includes(join(h, ".cursor", f))) && cursorSecretPaths(h).every((p) => dirs.includes(p)), "Cursor's login, settings, MCP servers and chats are never readable by a check");
  ok(!dirs.includes(join(h, ".cursor")) && !dirs.some((d) => d.startsWith(join(h, ".cursor", "worktrees"))), "~/.cursor itself is not denied: a checkout under ~/.cursor/worktrees keeps working");
  const ref = (kind: "image" | "pdf") => ({ id: kind, kind, mime: kind === "image" ? "image/png" : "application/pdf", name: `a.${kind === "image" ? "png" : "pdf"}`, bytes: 10, sha256: "x" } as any);
  const refused: any = deliveryFor("cursor", [ref("image")]), pdf: any = deliveryFor("cursor", [ref("pdf")]);
  ok(refused.ok === false && refused.code === "cursorNoAttachments" && pdf.code === "cursorNoAttachments" && /Cursor/.test(refused.reason.en) && /Cursor/.test(refused.reason["zh-TW"]), "a file to a Cursor Firstmate is refused, in both languages");
  ok((deliveryFor("cursor", []) as any).ok === true && (deliveryFor("codex", [ref("image")]) as any).ok === true, "no file is fine on Cursor; Codex still takes the image");
  ok(isVendorProcess("cursor-agent -p --resume abc") && isVendorProcess("/opt/tools/bin/cursor-agent --resume abc") && !isVendorProcess("cat cursor-agent.log"), "a running cursor-agent is a vendor process");
  ok(/^cursor-agent process 4242/.test(driving({ list: () => [{ pid: 4242, command: "cursor-agent --resume chat-123456", cwd: null }] }, { host: "cursor", id: "chat-123456", cwd: "/x", file: null, newestInDir: false }, new Set()) ?? ""), "a terminal's cursor-agent on the same chat is named as cursor-agent");
}

console.log("the host: fresh only");
{
  const host = cursorHost(FIXTURE);
  ok((await host.discover()).length === 0, "discover finds no Cursor session to take over");
  const base = { cwd: TMP, onEvent: () => {}, onPermission: async () => ({ allow: false }) } as any;
  const err = (p: Promise<unknown>) => p.then(() => "", (e) => String(e?.message ?? e));
  ok(await err(host.attach("chat-123456", { ...base, fresh: false })) === CURSOR_TAKEOVER_REFUSED, "attaching an existing Cursor chat is refused");
  ok(/Cursor API key/.test(await err(host.attach("", { ...base, fresh: true, env: {} }))), "a fresh start without the key is refused");
  ok(/native tools/.test(await err(host.attach("", { ...base, fresh: true, env: { CURSOR_API_KEY: KEY } }))), "a fresh start without Studio's tools is refused");
}

console.log("a real Studio on the Cursor fixture");
const apps: ChildProcess[] = [];
async function boot(name: string, extra: Record<string, string | undefined>) {
  const home = join(TMP, `${name}-home`), data = join(TMP, `${name}-data`), log = join(TMP, `${name}-cursor.jsonl`); mkdirSync(home, { recursive: true }); mkdirSync(data, { recursive: true });
  const port = await freePort(), base = `http://127.0.0.1:${port}`, token = `cursor-vendor-${name}-session`;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, CREW_DATA: data, CREW_RUNTIME_DIR: join(TMP, `${name}-runtime`), CREW_PORT: String(port), CREW_SESSION_TOKEN: token,
    CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_LOCAL_UNRESTRICTED: "0", CREW_KEYCHAIN_TOOL: "none",
    CREW_CURSOR_BIN: CLI, CREW_HOST_CURSOR_BIN: FIXTURE, CURSOR_FIXTURE_LOG: log };
  for (const k of ["CURSOR_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_CHAT_PROVIDER", "CREW_MAIN_PROJECT", "CREW_FM_STATE", "CREW_CURSOR_MODEL"]) delete env[k];
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k]; else env[k] = v;
  const app = spawn("bun", ["src/server.ts"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] }); apps.push(app);
  let out = ""; app.stdout!.on("data", (b) => { out += b; }); app.stderr!.on("data", (b) => { out += b; });
  await waitUp(base, app);
  const api = async (path: string, body?: unknown) => { const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "x-crew-session": token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch {} return { status: r.status, body: j, text }; };
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { api, calls, out: () => out };
}
try {
  const s = await boot("keyed", { CURSOR_API_KEY: KEY });
  const doc = await s.api("/api/doctor"), items = doc.body?.items ?? [];
  const row = items.find((i: any) => i.id === "cursor"), login = items.find((i: any) => i.id === "round-login-cursor");
  ok(row?.authenticated === true && row?.status === "ok" && login?.status === "ok", "Doctor: the Cursor CLI is signed in with the crew's key", JSON.stringify({ row, login }).slice(0, 400));
  const acct = await s.api("/api/cursor/account");
  ok(acct.status === 200 && acct.body?.installed === true && acct.body?.key === "present" && !acct.text.includes(KEY) && !doc.text.includes(KEY), "the account route says the key is there and never shows it", acct.text.slice(0, 300));
  const take = await s.api("/api/main/takeover", { host: "cursor", confirm: true }), list = await s.api("/api/main/sessions?host=cursor"), att = await s.api("/api/main/attach", { host: "cursor", id: "chat-123456" });
  ok(take.status === 409 && take.body?.code === "cursorTakeover" && list.status === 400 && list.body?.code === "cursorTakeover" && att.status === 409 && att.body?.code === "cursorTakeover", "Studio never takes over, lists or attaches a Cursor session", JSON.stringify([take.status, take.body, list.status, att.status]).slice(0, 400));
  ok(s.calls().length === 0, "no refusal ran cursor-agent");
  const ready = await s.api("/api/main/start/cursor-ready");
  ok(ready.body?.ok === true && ready.body?.model === "composer-2.5" && !ready.text.includes(KEY), "the start check names the model and never the key", ready.text);
  const st = await s.api("/api/main/start", { host: "cursor", confirm: true });
  ok(st.status === 200, "a fresh Firstmate starts on Cursor in Studio's own workspace", `${st.status} ${st.text.slice(0, 300)}`);
  const view = async () => (await s.api("/api/main")).body;
  const said = (re: RegExp) => async () => ((await view())?.log ?? []).some((e: any) => re.test(String(e.text ?? "")));
  ok(await until(said(/Hello! I am your Studio Firstmate/)), "its first turn greets the captain", JSON.stringify((await view())?.log?.slice(-3)).slice(0, 400));
  const v1 = await view(), chat = s.calls().find((c) => c.argv[0] === "create-chat")?.chat;
  ok(v1.host === "cursor" && v1.sessionId === chat && v1.model === "composer-2.5", "the session is Cursor's chat Studio made with create-chat, on the configured model", JSON.stringify({ host: v1.host, id: v1.sessionId, chat, model: v1.model }));
  await until(async () => !(await view()).busy);
  const sent = await s.api("/api/main/send", { text: 'NATIVE-TOOL {"name":"studio_staffing_facts","args":{}}' });
  ok(sent.status === 200, "a second turn is sent", sent.text.slice(0, 200));
  await until(async () => s.calls().filter((c) => c.argv[0] === "-p").length >= 2 && !(await view()).busy);
  const turns = s.calls().filter((c) => c.argv[0] === "-p");
  ok(turns.length === 2 && turns.every((t) => t.argv[t.argv.indexOf("--resume") + 1] === chat && t.chat === chat), "every turn resumes the same chat", JSON.stringify(turns.map((t) => t.argv.slice(-4))));
  ok(turns.every((t) => t.argv.includes("--trust") && t.argv.includes("--approve-mcps") && t.argv[t.argv.indexOf("--model") + 1] === "composer-2.5" && !t.argv.join(" ").includes(KEY) && t.home !== join(TMP, "keyed-home")),
    "turns run in a private home, on the model, with the key never on the command line");
  const log = JSON.stringify((await view()).log ?? []);
  ok(/studio_staffing_facts/.test(log) && /cursor/.test(log) && !/studio_staffing_facts[^]*?(unknown_tool|is not allowed)/.test(log), "the turn reached Studio's native tool through the private MCP server", log.slice(-600));
  const lines = (await view()).log ?? [];
  ok(lines.filter((e: any) => e.kind === "firstmate").length === 1 && lines.every((e: any) => e.kind !== "firstmate" || String(e.text ?? "").trim()), "a turn that only calls a tool adds no empty Firstmate line", JSON.stringify(lines.filter((e: any) => e.kind === "firstmate")).slice(0, 300));

  const n = await boot("keyless", {});
  const nd = (await n.api("/api/doctor")).body?.items ?? [], nl = nd.find((i: any) => i.id === "round-login-cursor");
  ok(nd.find((i: any) => i.id === "cursor")?.authenticated === false && nl?.status === "missing" && nl?.action?.item === "cursor", "Doctor without a key: not signed in, and the fix is adding the key", String(JSON.stringify(nl)).slice(0, 300));
  const ns = await n.api("/api/main/start", { host: "cursor", confirm: true });
  ok(ns.status === 409 && ns.body?.code === "cursorKeyMissing" && (await n.api("/api/main")).body?.state === "detached" && n.calls().length === 0, "starting on Cursor without a key is refused and never falls back to another vendor", `${ns.status} ${ns.text.slice(0, 300)}`);
} finally {
  for (const a of apps) try { a.kill(); } catch {}
  await Bun.sleep(200);
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`\ncursor-vendor: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
