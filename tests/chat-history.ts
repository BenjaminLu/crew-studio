import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Firstmate chat history across Studio restarts, and errors from outside Studio as typed notices.
//   1. units: the class of an external message, its cleaning (credentials, control characters, length), the log file
//   2. a server with stub CLIs: messages, files and every external error class are logged, typed, with the CLI's words;
//      a restart reloads them; a new primary keeps the earlier session as its own block; nothing secret is kept
// Offline: stub CLIs only, a temporary HOME and data folder.
//   bun tests/chat-history.ts
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
import { pdf, png } from "./fixture/attachment-files.mjs";

const here = import.meta.dir, root = join(here, "..");
const TMP = mkdtempSync(join(tmpdir(), "crew-chat-history-"));
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`.trimEnd()); } };
const until = async (f: () => boolean | Promise<boolean>, ms = 10000) => { const t = Date.now(); while (!(await f()) && Date.now() - t < ms) await Bun.sleep(40); return await f(); };
const SECRET = ["ghp", "_", "Q".repeat(12), "w".repeat(12), "9".repeat(12)].join(""); // a credential shape, built so no file holds it
const PNG = png(32, 32, [200, 40, 40]);
const load = async (p: string) => { try { return await import(p); } catch (e: any) { console.log(`  (${p} missing: ${String(e?.message ?? e).slice(0, 100)})`); return null; } };
const X = await load("../src/host/external-errors"), L = await load("../src/host/chat-log");

// ---------- 1. units ----------
try {
  const c = (m: string) => X?.classify(m);
  ok(c("You've hit your usage limit. Try again at 3pm.") === "quota" && c("429 Too Many Requests") === "quota", "quota and rate limits are the quota class");
  ok(c("unexpected status 401 Unauthorized: invalid token") === "auth" && c("Not logged in · Please run /login") === "auth", "sign-in refusals are the auth class");
  ok(c("Request timed out after 120s") === "timeout", "time-outs are the timeout class");
  ok(c("stream disconnected before completion: error sending request") === "network" && c("fetch failed: ECONNRESET") === "network", "network failures are the network class");
  ok(c("claude exited 3") === "exit", "a process exit is the exit class");
  ok(c("API Error: 500 Internal server error") === "network" || c("API Error: 500 Internal server error") === "api", "a 5xx is a vendor (network) error");
  ok(c("Invalid model parameter") === "api", "anything else is a vendor api error");
  const e = X?.externalError("codex", `boom ${SECRET}\u001b[31m red\u0007 ${"x".repeat(900)}`);
  ok(e && !e.message.includes(SECRET) && e.message.includes("[credential removed]") && !/[\u0000-\u0008\u001b]/.test(e.message) && e.message.length <= 600, "the external message is kept without credentials or control characters, at most 600 characters");
  ok(e?.reason?.en && e.reason["zh-TW"] && e.code === "codex_api" && e.schema === 1, "every external error has a code, a class, and a reason in both languages");
  ok(X?.externalError("claude", "")?.message === "Claude gave no error text.", "an empty external message says so instead of a generic failure");
  // the log file
  const dir = join(TMP, "unit");
  const log = L ? new L.ChatLog(dir, 200, 2) : null;
  for (let i = 0; i < 12; i++) log?.append({ at: i, kind: "captain", text: `line ${i} ${i === 3 ? SECRET : ""}` });
  const files = existsSync(join(dir, "chat-log")) ? readdirSync(join(dir, "chat-log")) : [];
  const all = files.map((f) => readFileSync(join(dir, "chat-log", f), "utf8")).join("");
  ok(files.length === 3 && files.every((f) => /^log(\.\d)?\.jsonl$/.test(f)) && files.every((f) => statSync(join(dir, "chat-log", f)).size <= 200), "the log rotates at its size bound and keeps two older files", files.join(","));
  ok(!all.includes(SECRET) && (statSync(join(dir, "chat-log")).mode & 0o777) === 0o700 && (statSync(join(dir, "chat-log", "log.jsonl")).mode & 0o777) === 0o600, "the log on disk holds no credential; folder 0700, files 0600");
  const back = log?.load(400) ?? [];
  ok(back.length > 0 && back.at(-1)?.text === "line 11 " && back.every((x: any, i: number, a: any[]) => !i || a[i - 1].at < x.at), "loading returns the newest lines, oldest first");
  // a credential split by an escape sequence or a control character is removed after the split is undone
  const ant = ["sk-ant-", "oat01-", "Z".repeat(40)], gh = ["ghp", "_", "R".repeat(36)];
  const split = X?.cleanExternal(`auth failed ${ant[0]}\u001b[0m${ant[1]}${ant[2]} and ${gh[0]}${gh[1]}\u0000${gh[2]}`) ?? "";
  ok(!split.includes(ant.join("")) && !split.includes(gh.join("")) && (split.match(/\[credential removed\]/g) ?? []).length === 2, "tokens split by ANSI or NUL are redacted once rejoined", split);
  const bidi = X?.cleanExternal("a\u202eb\u2066c\u0085d\u009be") ?? "";
  ok(bidi === "abcde", "bidi overrides and C1 control characters are stripped", JSON.stringify(bidi));
  // a torn last line does not swallow the next entry; rotation counts bytes, not characters
  const tdir = join(TMP, "torn"); const tl = L ? new L.ChatLog(tdir, 300, 2) : null;
  tl?.append({ at: 1, kind: "captain", text: "first" });
  if (tl) writeFileSync(join(tdir, "chat-log", "log.jsonl"), readFileSync(join(tdir, "chat-log", "log.jsonl"), "utf8") + '{"at":2,"kind":"captain","text":"cut sho', { flag: "w" });
  tl?.append({ at: 3, kind: "captain", text: "after the torn line" });
  ok(tl?.load(10).some((x: any) => x.text === "after the torn line"), "an entry appended after a torn line is kept");
  const mdir = join(TMP, "multibyte"); const ml = L ? new L.ChatLog(mdir, 550, 2) : null;
  for (let i = 0; i < 6; i++) ml?.append({ at: i, kind: "captain", text: "船".repeat(85) }); // ~295 bytes, ~125 UTF-16 units per line
  const mfiles = existsSync(join(mdir, "chat-log")) ? readdirSync(join(mdir, "chat-log")) : [];
  ok(mfiles.length === 3 && mfiles.every((f) => statSync(join(mdir, "chat-log", f)).size <= 550), "rotation measures bytes: multibyte lines never push a file past its bound", mfiles.map((f) => statSync(join(mdir, "chat-log", f)).size).join(","));
  // a refusal in one turn Studio did not send must not hide a failure in a later one
  const { MainSession } = await import("../src/host/main");
  const M = join(TMP, "m2"); mkdirSync(join(M, "data"), { recursive: true });
  let emit: (e: any) => void = () => {};
  const fake = { id: "claude", resumeCommand: (x: string) => x, discover: async () => [{ host: "claude", id: "s1", title: "t", cwd: M, updated: 0, possiblyOpen: false, openReason: null, file: null }],
    attach: async (_: string, o: any) => { emit = o.onEvent; return { host: "claude", id: "s1", model: "fake", busy: false, pid: null, send: async () => ({ status: "completed" }), interrupt: async () => {}, detach: async () => "x" }; } };
  const m = new MainSession({ dataDir: join(M, "data"), projectDir: M, stateDir: join(M, "state"), probe: { list: () => [] }, hosts: { claude: fake, codex: fake } as any, pollMs: 200, permissionMcp: () => ({ command: ["true"], env: {} }) } as any);
  await m.start(); await m.attach("claude", "s1");
  emit({ type: "turnStart", source: "hook" }); emit({ type: "hostRefusal", code: "claudeQuotaExhausted", reason: { en: "quota", "zh-TW": "額度" }, raw: { error: { message: "usage limit reached" } } }); emit({ type: "turnEnd", status: "failed", message: "quota", external: true });
  emit({ type: "turnStart", source: "hook" }); emit({ type: "turnEnd", status: "failed", message: "API Error: 529 overloaded_error", external: true });
  ok(m.view().log.some((x: any) => x.external?.message === "API Error: 529 overloaded_error"), "after a refused hook turn, a later hook turn's failure is still a typed notice");
  emit({ type: "hostRefusal", code: "claudeQuotaExhausted", reason: { en: "quota", "zh-TW": "額度" }, raw: { error: { message: "usage limit reached again" } } }); emit({ type: "turnEnd", status: "failed", message: "quota", external: true });
  emit({ type: "turnEnd", status: "failed", message: "second failure without a turnStart", external: true });
  ok(m.view().log.some((x: any) => x.external?.message === "second failure without a turnStart"), "the refusal mark is cleared once its turn ends, even without a turnStart");
  m.stop();
} catch (e: any) { ok(false, "the unit section ran", String(e?.message ?? e).slice(0, 300)); }

// ---------- 2. the server ----------
{
  const S = join(TMP, "server"), home = join(S, "home"), proj = join(S, "proj"), state = join(S, "state"), data = join(S, "data");
  for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
  const projects = join(home, ".claude/projects"), pdir = join(projects, proj.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(pdir, { recursive: true });
  for (const id of ["sess-b", "sess-c"]) { const f = join(pdir, `${id}.jsonl`); writeFileSync(f, JSON.stringify({ type: "user", isSidechain: false, cwd: proj, sessionId: id, message: { role: "user", content: "firstmate" } }) + "\n"); const old = (Date.now() - 3_600_000) / 1000; utimesSync(f, old, old); }
  const TOKEN = "chat-history-session";
  const env: any = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
  let port = 0;
  const boot = async () => {
    port = await freePort();
    const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
      CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_LOCAL_UNRESTRICTED: "0",
      CREW_WAKE_GRACE_MS: "600000", CREW_ATTACH_SWEEP_MS: "300", CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: projects,
      STUB_CODEX_THREADS: JSON.stringify([{ id: "th-a", cwd: proj, preview: "firstmate", updatedAt: Math.floor(Date.now() / 1000) - 3600 }]) } });
    await waitUp(`http://127.0.0.1:${port}`, app);
    return app;
  };
  const raw = (method: string, path: string, body?: unknown) => new Promise<{ status: number; body: any; buf: Buffer }>((resolve) => {
    const d = body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body);
    const r = httpRequest({ host: "127.0.0.1", port, method, path, agent: false, headers: { "x-crew-session": TOKEN, ...(d !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(d) } : {}) } }, (res) => {
      const parts: Buffer[] = []; res.on("data", (c) => parts.push(c)); res.on("end", () => { const buf = Buffer.concat(parts); let j = null; try { j = JSON.parse(buf.toString("utf8")); } catch {} resolve({ status: res.statusCode ?? 0, body: j, buf }); });
    });
    r.on("error", (e) => resolve({ status: 0, body: { error: String(e) }, buf: Buffer.alloc(0) })); if (d !== undefined) r.write(d); r.end();
  });
  const view = async () => (await raw("GET", "/api/main")).body;
  const idle = () => until(async () => { const v = await view(); return !v.busy && !v.queue.length; }, 15000);
  const say = async (text: string, attachments?: any[]) => { await raw("POST", "/api/main/send", { text, ...(attachments ? { attachments } : {}) }); await Bun.sleep(150); await idle(); };
  const ext = (v: any, cls: string, re: RegExp) => v.log.find((x: any) => x.external?.class === cls && re.test(x.external.message));
  // left by an earlier Studio: an old upload never sent and a stray temporary file; the boot sweep removes them
  const att = join(data, "chat-attachments"); mkdirSync(att, { recursive: true, mode: 0o700 });
  const strayId = createHash("sha256").update("stray").digest("hex");
  writeFileSync(join(att, `${strayId}.png`), PNG); writeFileSync(join(att, `${strayId}.json`), JSON.stringify({ id: strayId, mime: "image/png", kind: "image", size: PNG.length, name: "stray.png" })); writeFileSync(join(att, ".tmp-0123456789abcdef"), "x");
  const ageAll = () => { const t = (Date.now() - 2 * 24 * 3600_000) / 1000; for (const f of readdirSync(att)) utimesSync(join(att, f), t, t); };
  ageAll();
  let app = await boot();
  try {
    ok(!existsSync(join(att, `${strayId}.png`)) && !existsSync(join(att, ".tmp-0123456789abcdef")), "the retention sweep runs at boot: an old unsent upload and a stray temporary file are gone");
    // Codex: a message with a file and a secret, then vendor failures in Codex's own words
    ok((await raw("POST", "/api/main/attach", { host: "codex", id: "th-a" })).body?.ok, "Codex session attached");
    const up = (await raw("POST", "/api/main/attachments", { name: "kept.png", data: PNG.toString("base64") })).body;
    await say(`hello with a file ${SECRET}`, [{ id: up?.attachment?.id, name: "kept.png" }]);
    var keptId = up?.attachment?.id, neverId = (await raw("POST", "/api/main/attachments", { name: "never.png", data: png(7, 7, [5, 5, 5]).toString("base64") })).body?.attachment?.id;
    ok(keptId && existsSync(join(att, `${keptId}.sent`)), "the send marks its file as sent");
    await say("STUB_FAIL stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)");
    await say("STUB_FAIL You've hit your usage limit. Upgrade to Pro or try again at 3:05 PM.");
    await say("STUB_FAIL unexpected status 401 Unauthorized: Your authentication token has expired. Please try signing in again.");
    await say("STUB_FAIL Request timed out after 300s");
    // the periodic sweep: it runs, and a file a queued (not yet sent) message carries survives it
    const slow = raw("POST", "/api/main/send", { text: "STUB_SLOW" }); await slow; await until(async () => (await view()).busy);
    const qf = (await raw("POST", "/api/main/attachments", { name: "queued.png", data: png(9, 9, [3, 3, 3]).toString("base64") })).body?.attachment?.id;
    const uf = (await raw("POST", "/api/main/attachments", { name: "dropped.png", data: png(11, 11, [4, 4, 4]).toString("base64") })).body?.attachment?.id;
    await raw("POST", "/api/main/send", { text: "queued with a file", attachments: [{ id: qf, name: "queued.png" }] });
    { const t = (Date.now() - 2 * 24 * 3600_000) / 1000; for (const f of readdirSync(att)) if (f.startsWith(qf) || f.startsWith(uf)) utimesSync(join(att, f), t, t); }
    await Bun.sleep(1200);
    const qv = await view();
    ok(qv.queue.some((q: any) => q.attachments?.[0]?.id === qf) && existsSync(join(att, `${qf}.png`)) && !existsSync(join(att, `${uf}.png`)), "the periodic sweep runs (an old unsent upload goes) and keeps the file of a queued message");
    await raw("POST", "/api/main/interrupt"); await idle();
    ok((await view()).log.some((x: any) => x.kind === "captain" && x.text === "queued with a file" && x.attachments?.[0]?.id === qf) && existsSync(join(att, `${qf}.png`)), "the queued message then goes with its file");
    let v = await view();
    ok(ext(v, "network", /stream disconnected before completion/), "Codex network failure: a typed notice with Codex's own message", JSON.stringify(v.log.filter((x: any) => x.kind === "status").slice(-6).map((x: any) => x.text)));
    ok(ext(v, "quota", /hit your usage limit/), "Codex usage limit: a quota notice with Codex's own message");
    ok(ext(v, "auth", /authentication token has expired/), "Codex sign-in refusal: an auth notice with Codex's own message");
    ok(ext(v, "timeout", /timed out after 300s/), "Codex time-out: a timeout notice with Codex's own message");
    ok(!v.log.some((x: any) => /^Turn failed$/.test(x.text)), "no failure is reported without its message");
    await raw("POST", "/api/main/detach");
    // Claude: an API error, a quota refusal and a process exit, in Claude's own words
    ok((await raw("POST", "/api/main/attach", { host: "claude", id: "sess-b" })).body?.ok, "Claude session attached");
    await say('STUB_API_ERROR API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.1.image.source.base64: image exceeds 5 MB maximum"}}');
    await say("STUB_QUOTA");
    await say("STUB_EXIT");
    v = await view();
    ok(ext(v, "api", /image exceeds 5 MB maximum/), "Claude API error: an api notice with Claude's own message");
    const q = v.log.find((x: any) => x.external?.code === "claudeQuotaExhausted");
    ok(q && q.external.class === "quota" && /rate limit rejected|usage limit reached/.test(q.external.message) && q.refusal === "claudeQuotaExhausted", "Claude quota refusal: typed (claudeQuotaExhausted) with Claude's own message", JSON.stringify(q?.external));
    ok(v.log.filter((x: any) => x.external?.code === "claudeQuotaExhausted" || (x.external && /usage limit reached/.test(x.external.message))).length === 1, "a refusal is one notice, not a refusal plus a generic failed turn");
    ok(!v.log.some((x: any) => x.kind === "status" && /^Turn failed/.test(x.text) && x.session?.id === "sess-b" && /usage limit|quota/i.test(x.text)), "the refused turn has no grey \"Turn failed\" line beside its typed notice");
    ok(v.log.some((x: any) => x.external?.source === "claude" && /connection to the API was closed unexpectedly|exited 3/.test(x.external.message)), "Claude process exit: a notice with the exit and its last stderr");
    // a PDF whose pages Studio cannot read: the captain is warned before Claude decides
    const opaque = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 0x41)]);
    const u2 = (await raw("POST", "/api/main/attachments", { name: "opaque.pdf", data: opaque.toString("base64") })).body;
    ok(u2?.ok && u2.attachment.pages === null && u2.delivery?.note?.warn === true && /Page count unknown — Claude refuses PDFs over 100 pages/.test(u2.delivery.note.en), "a PDF with an unreadable page count is uploaded with a warning for Claude", JSON.stringify(u2?.delivery));
    const u3 = (await raw("POST", "/api/main/attachments", { name: "fine.pdf", data: pdf("one page").toString("base64") })).body;
    ok(u3?.delivery?.note === null, "a PDF with a readable page count carries no warning");
    await raw("POST", "/api/main/detach");
    const disk = readdirSync(join(data, "chat-log")).map((f) => readFileSync(join(data, "chat-log", f), "utf8")).join("");
    ok(disk.includes("hello with a file") && !disk.includes(SECRET) && !JSON.stringify(v).includes(SECRET), "the log on disk and in the panel holds the message but not the credential");
  } catch (e: any) { ok(false, "first server ran", String(e?.stack ?? e).slice(0, 500)); }
  finally { app.kill("SIGTERM"); await Bun.sleep(300); app.kill("SIGKILL"); }

  // restart: the history comes back, with its sessions, files and notices; two days later the boot sweep keeps what the history shows
  ageAll();
  app = await boot();
  try {
    ok(existsSync(join(att, `${keptId}.png`)) && !existsSync(join(att, `${neverId}.png`)), "after two days: the sent file the history references stays; the upload never sent is gone");
    let v = await view();
    const cap = v.log.find((x: any) => x.kind === "captain" && /hello with a file/.test(x.text));
    ok(cap && cap.attachments?.[0]?.name === "kept.png" && cap.session?.host === "codex" && cap.session?.id === "th-a", "after a restart the captain's message is back, with its file and its session (codex th-a)", JSON.stringify(cap));
    ok(cap && (await raw("GET", `/api/main/attachments/${cap.attachments[0].id}`)).status === 200, "the restored message's file still opens");
    ok(v.log.some((x: any) => x.kind === "firstmate" && /echo: hello with a file/.test(x.text)) && ext(v, "network", /stream disconnected/) && v.log.some((x: any) => x.external?.code === "claudeQuotaExhausted"), "Firstmate's replies and the typed notices are back too");
    ok(v.log.some((x: any) => x.session?.id === "sess-b" && x.session.host === "claude") && v.state === "detached", "the Claude session's lines keep their own label; nothing is attached after the restart");
    // a new primary: the earlier sessions stay, as earlier blocks
    ok((await raw("POST", "/api/main/attach", { host: "claude", id: "sess-c" })).body?.ok, "a new Claude primary attached");
    await say("after restart");
    v = await view();
    const ids = [...new Set(v.log.map((x: any) => x.session?.id).filter(Boolean))];
    ok(v.sessionId === "sess-c" && ids.includes("th-a") && ids.includes("sess-b") && ids.includes("sess-c") && v.log.findIndex((x: any) => x.session?.id === "th-a") < v.log.findIndex((x: any) => x.session?.id === "sess-c"), "the new primary's lines follow the earlier sessions' blocks; none is deleted", JSON.stringify(ids));
    await raw("POST", "/api/main/detach");
  } catch (e: any) { ok(false, "restarted server ran", String(e?.stack ?? e).slice(0, 500)); }
  finally { app.kill("SIGTERM"); await Bun.sleep(300); app.kill("SIGKILL"); }
}

console.log(`chat-history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
