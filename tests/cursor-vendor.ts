import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Cursor as a third vendor: its capability probe, the crew's API key (never the keychain here: CREW_KEYCHAIN_TOOL=none),
// the secret paths a round and a check may never read, attachments, process identification, the host (fresh only, never a
// takeover) and a real Studio (src/server.ts) on the strict offline fixture tests/fixture/cursor-agent.mjs: Doctor, the
// account route, the takeover refusals, a fresh Firstmate on Cursor whose turns carry on one chat and reach Studio's tools.
//   bun tests/cursor-vendor.ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const { cursorHost, cursorProjectPermissions, CURSOR_TAKEOVER_REFUSED } = await import("../src/host/cursor");

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
  const image: any = deliveryFor("cursor", [ref("image")]), pdf: any = deliveryFor("cursor", [ref("pdf")]), mixed: any = deliveryFor("cursor", [ref("image"), ref("pdf")]);
  ok(image.ok === true && JSON.stringify(image.deliveries) === JSON.stringify([{ id: "image", mode: "native", note: null }]), "an image goes to a Cursor Firstmate as its own image input", JSON.stringify(image));
  ok(pdf.ok === false && pdf.code === "cursorNoPdf" && mixed.code === "cursorNoPdf" && /Cursor/.test(pdf.reason.en) && /PDF/.test(pdf.reason.en) && /PDF/.test(pdf.reason["zh-TW"]) && /工作空間/.test(pdf.reason["zh-TW"]),
    "in Studio's own workspace a PDF (alone or beside an image) is refused, never dropped, in both languages", JSON.stringify(pdf));
  const read: any = deliveryFor("cursor", [ref("image"), ref("pdf")], { cursorReads: true });
  ok(read.ok === true && read.deliveries[0].mode === "native" && read.deliveries[1].mode === "file" && /Read/.test(read.deliveries[1].note.en) && /Read/.test(read.deliveries[1].note["zh-TW"]), "a Cursor Firstmate with its own Read tool gets a PDF as a file it opens", JSON.stringify(read));
  ok((deliveryFor("cursor", []) as any).ok === true, "no file is fine on Cursor");
  // Codex and Claude take files exactly as before Cursor took any (the cursorReads option is Cursor's only)
  const big = { ...ref("image"), size: 4_000_000 };
  const before = JSON.stringify([deliveryFor("codex", [ref("image"), ref("pdf")]), deliveryFor("claude", [ref("image"), ref("pdf")]), deliveryFor("claude", [big]), deliveryFor(null, [ref("image")])]);
  const withOpt = JSON.stringify([deliveryFor("codex", [ref("image"), ref("pdf")], { cursorReads: true }), deliveryFor("claude", [ref("image"), ref("pdf")], { cursorReads: true }), deliveryFor("claude", [big], { cursorReads: true }), deliveryFor(null, [ref("image")], { cursorReads: true })]);
  ok(before === withOpt && before === JSON.stringify([
    { ok: true, deliveries: [{ id: "image", mode: "native", note: null }, { id: "pdf", mode: "file", note: { en: "Codex cannot read PDFs directly; it opens the file itself.", "zh-TW": "Codex 不能直接讀 PDF，會自己開檔。" } }] },
    { ok: true, deliveries: [{ id: "image", mode: "native", note: { en: "Image size unknown — Claude refuses images over 8000 px on a side.", "zh-TW": "讀不出圖片尺寸——Claude 會拒收每邊超過 8000 px 的圖片。", warn: true } }, { id: "pdf", mode: "native", note: { en: "Page count unknown — Claude refuses PDFs over 100 pages.", "zh-TW": "讀不出頁數——Claude 會拒收超過 100 頁的 PDF。", warn: true } }] },
    { ok: false, code: "claudeImageTooLarge", reason: { en: "Claude takes images up to 3.75 MB; a.png is larger. Studio does not shrink or drop it.", "zh-TW": "Claude 只收 3.75 MB 以內的圖片；a.png 太大。Studio 不會縮小或略過它。" } },
    { ok: false, code: "attachmentNoHost", reason: { en: "Start Firstmate before sending files.", "zh-TW": "請先啟動 Firstmate 再傳檔案。" } },
  ]), "Codex and Claude attachments are unchanged", before);
  ok(isVendorProcess("cursor-agent -p --resume abc") && isVendorProcess("/opt/tools/bin/cursor-agent --resume abc") && !isVendorProcess("cat cursor-agent.log"), "a running cursor-agent is a vendor process");
  ok(/^cursor-agent process 4242/.test(driving({ list: () => [{ pid: 4242, command: "cursor-agent --resume chat-123456", cwd: null }] }, { host: "cursor", id: "chat-123456", cwd: "/x", file: null, newestInDir: false }, new Set()) ?? ""), "a terminal's cursor-agent on the same chat is named as cursor-agent");
}

console.log("the Crew page's model list");
{
  const { crewModels } = await import("../src/crew-routes");
  const team: any = { members: {}, workflows: {}, projects: {} };
  const codex = { provider: "codex", models: [{ id: "gpt-x", efforts: ["low"] }], auth: "verified" } as any, cursor = { provider: "cursor", models: [{ id: "composer-2.5", efforts: [] }], auth: "verified" } as any;
  ok(crewModels([codex], team).providers.map((p: any) => p.provider).join() === "codex,claude", "a crew Studio never read Cursor for lists Codex and Claude only");
  const both = crewModels([codex, cursor], team);
  ok(both.providers.map((p: any) => p.provider).join() === "codex,claude,cursor" && both.models.some((m: any) => m.provider === "cursor" && m.model === "composer-2.5" && m.efforts.length === 0), "once Cursor is read, its models are listed without effort levels");
  ok(crewModels([codex], { ...team, members: { maker: { provider: "cursor", model: "composer-2.5", effort: null, skills: [] } } }).providers.some((p: any) => p.provider === "cursor"), "a team member on Cursor keeps Cursor listed");
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

console.log("the host in an explicit project: the project folder only");
{
  const proj = join(TMP, "host-project"), outside = join(TMP, "host-outside"); mkdirSync(proj, { recursive: true }); mkdirSync(outside, { recursive: true });
  const ws = realpathSync(proj);
  ok(JSON.stringify(cursorProjectPermissions(ws, ["/data/a.pdf"])) === JSON.stringify({ allow: [`Read(${ws}/**)`, `Write(${ws}/**)`, "Read(/data/a.pdf)"], deny: [`Write(${ws}/.cursor/**)`] }),
    "cli-config.json allows reads and writes in the project folder only (and this turn's PDFs), with no Shell rule");
  const log = join(TMP, "host-project.jsonl"); process.env.CURSOR_FIXTURE_LOG = log;
  const said: string[] = [];
  const s = await cursorHost(FIXTURE).attach("", { cwd: proj, fresh: true, cursorProject: true, env: { CURSOR_API_KEY: KEY }, model: "composer-2.5", onEvent: (e: any) => { if (e.type === "message") said.push(e.text); }, onPermission: async () => ({ allow: false }) } as any);
  const targets = [join(proj, "notes", "inside.txt"), join(outside, "escape.txt"), join(proj, "..", "host-outside", "dotdot.txt"), join(proj, ".cursor", "mcp.json"), join(process.env.HOME!, "home-escape.txt")];
  const r = await s.send(`FIXTURE-WRITE ${JSON.stringify(targets)}`);
  const runs = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => c.argv[0] === "-p");
  ok(r.status === "completed" && existsSync(targets[0]) && !targets.slice(1).some((t) => existsSync(t)) && !existsSync(join(proj, ".cursor")),
    "it writes inside the project folder and cannot write outside it (a sibling folder, a ../ path, the home folder) nor the project's .cursor/", JSON.stringify({ r, said, exists: targets.map((t) => existsSync(t)) }));
  ok(/"[^"]*inside\.txt":true/.test(said.join(" ")) && /escape\.txt":false/.test(said.join(" ")), "the write tool reports each refusal");
  ok(runs.length === 1 && runs[0].argv[runs[0].argv.indexOf("--workspace") + 1] === ws && runs[0].argv[runs[0].argv.indexOf("--sandbox") + 1] === "enabled" && !runs[0].argv.includes("--approve-mcps") && !runs[0].argv.includes("--force") && runs[0].home !== process.env.HOME,
    "the project is the workspace, cursor-agent's sandbox is on, never --force, no MCP server auto-approved, a private home", JSON.stringify(runs[0]?.argv));
  await s.detach(); delete process.env.CURSOR_FIXTURE_LOG;
  ok(!existsSync(join(proj, ".cursor")), "Studio wrote nothing into the project's .cursor/");
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

  // attachments: an image reaches cursor-agent as --image <Studio's stored file>; a PDF is refused in Studio's own workspace
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 1 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n", "latin1");
  const upImg = await s.api("/api/main/attachments", { name: "shot.png", data: PNG.toString("base64") });
  ok(upImg.status === 200 && upImg.body?.delivery?.mode === "native" && !upImg.body?.hostRefusal, "uploading an image to a Cursor Firstmate is accepted as image input", upImg.text.slice(0, 300));
  const upPdf = await s.api("/api/main/attachments", { name: "brief.pdf", data: PDF.toString("base64") });
  ok(upPdf.status === 200 && upPdf.body?.hostRefusal?.code === "cursorNoPdf", "uploading a PDF says at once that this Cursor Firstmate cannot take it", upPdf.text.slice(0, 300));
  const turnsBefore = s.calls().filter((c) => c.argv[0] === "-p").length;
  const pdfSend = await s.api("/api/main/send", { text: "read this", attachments: [upImg.body.attachment.id, upPdf.body.attachment.id] });
  ok(pdfSend.status === 409 && pdfSend.body?.code === "cursorNoPdf" && /PDF/.test(pdfSend.body?.reason?.["zh-TW"] ?? ""), "a message with a PDF is not queued: a typed refusal, never a silent drop", pdfSend.text.slice(0, 300));
  const imgSend = await s.api("/api/main/send", { text: "what is in this picture?", attachments: [upImg.body.attachment.id] });
  ok(imgSend.status === 200 && imgSend.body?.deliveries?.[0]?.mode === "native", "a message with an image is queued", imgSend.text.slice(0, 300));
  await until(async () => s.calls().filter((c) => c.argv[0] === "-p").length > turnsBefore && !(await view()).busy);
  const imgTurn = s.calls().filter((c) => c.argv[0] === "-p").at(-1);
  const sha = upImg.body.attachment.id, at = imgTurn?.argv.indexOf("--image");
  ok(s.calls().filter((c) => c.argv[0] === "-p").length === turnsBefore + 1 && at > 0 && imgTurn.argv[at + 1].endsWith(`${sha}.png`) && imgTurn.images?.[0]?.sha256 === sha && imgTurn.argv[imgTurn.argv.indexOf("--resume") + 1] === chat,
    "the image turn gives cursor-agent the stored file with --image, on the same chat", JSON.stringify(imgTurn).slice(0, 500));
  ok(await until(said(new RegExp(`FIXTURE-SAW-IMAGES ${sha.slice(0, 12)}`))), "cursor-agent saw exactly the captain's image");

  await s.api("/api/main/detach", {});

  // an explicit project: Cursor starts there as Codex does (its folder, its AGENTS.md, the newest handoff); Claude still does not
  const proj = join(TMP, "explicit-project"), state = join(TMP, "explicit-state"), elsewhere = join(TMP, "explicit-elsewhere");
  for (const d of [proj, state, elsewhere]) mkdirSync(d, { recursive: true });
  writeFileSync(join(proj, "AGENTS.md"), "# firstmate\n"); writeFileSync(join(state, "HANDOFF-2026-10-23.md"), "# Handoff\nnext: ship it\n");
  const e = await boot("explicit", { CURSOR_API_KEY: KEY, CREW_MAIN_PROJECT: proj, CREW_FM_STATE: state });
  const ev = async () => (await e.api("/api/main")).body;
  ok((await ev())?.context === "explicit-project", "the second Studio runs in an explicit project");
  const claude = await e.api("/api/main/start", { host: "claude", confirm: true });
  ok(claude.status === 400 && claude.body?.code === "host" && (await ev()).state === "detached", "Claude still starts only in Studio's own workspace (unchanged)", `${claude.status} ${claude.text.slice(0, 200)}`);
  const er = await e.api("/api/main/start/cursor-ready");
  ok(er.body?.ok === true && !er.text.includes(KEY), "the Cursor start check answers in an explicit project too", er.text);
  const es = await e.api("/api/main/start", { host: "cursor", confirm: true });
  ok(es.status === 200 && es.body?.seededFrom === "state/HANDOFF-2026-10-23.md", "a fresh Firstmate starts on Cursor in the explicit project, first message the newest handoff", `${es.status} ${es.text.slice(0, 300)}`);
  const eSaid = (re: RegExp) => async () => ((await ev())?.log ?? []).some((x: any) => re.test(String(x.text ?? "")));
  ok(await until(eSaid(new RegExp(`Ready as firstmate in ${realpathSync(proj)}; first message: state/HANDOFF-2026-10-23\\.md`))), "its first turn runs in the project folder and reads the handoff", JSON.stringify((await ev())?.log?.slice(-3)).slice(0, 400));
  const hv = await ev();
  ok(hv.host === "cursor" && hv.drive?.path === "fresh" && !hv.origin && hv.drive?.seededFrom === "state/HANDOFF-2026-10-23.md", "Studio drives a fresh Cursor chat, no takeover", JSON.stringify(hv.drive).slice(0, 300));
  const note = (await e.api("/api/takeover?independent=1")).body?.handoffs?.[0]?.text ?? "";
  ok(/explicit project; AGENTS\.md applies/.test(note) && /its sandbox is on \(never --force\)/.test(note) && /inside this folder alone/.test(note) && /never hands a Cursor chat to a terminal/.test(note), "the handoff note says it follows the project and its sandbox", note.slice(0, 600));
  ok(!existsSync(join(proj, ".cursor")), "nothing was written into the project's .cursor/");
  await until(async () => !(await ev()).busy);
  const out1 = join(elsewhere, "escape.txt"), in1 = join(proj, "draft.md");
  await e.api("/api/main/send", { text: `FIXTURE-WRITE ${JSON.stringify([in1, out1])}` });
  ok(await until(eSaid(/FIXTURE-WROTE/)) && existsSync(in1) && !existsSync(out1), "through Studio too, Firstmate on Cursor writes in the project and cannot write outside it");
  await until(async () => !(await ev()).busy);
  // attachments in the project: the image as --image, the PDF read with its Read tool (allowed for that file only)
  const PNG2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const PDF2 = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
  const ui = await e.api("/api/main/attachments", { name: "shot.png", data: PNG2.toString("base64") }), up = await e.api("/api/main/attachments", { name: "brief.pdf", data: PDF2.toString("base64") });
  ok(ui.body?.delivery?.mode === "native" && up.body?.delivery?.mode === "file" && !up.body?.hostRefusal, "in an explicit project Cursor takes the image and the PDF", up.text.slice(0, 300));
  const both = await e.api("/api/main/send", { text: "look at both", attachments: [ui.body.attachment.id, up.body.attachment.id] });
  ok(both.status === 200, "the message with both files is queued", both.text.slice(0, 200));
  ok(await until(eSaid(new RegExp(`FIXTURE-READ-PDF ${up.body.attachment.id.slice(0, 12)}`))) && await until(eSaid(new RegExp(`FIXTURE-SAW-IMAGES ${ui.body.attachment.id.slice(0, 12)}`))), "cursor-agent saw the image and read the PDF itself", JSON.stringify((await ev())?.log?.slice(-4).map((l: any) => l.text)).slice(0, 800));
  await until(async () => !(await ev()).busy);
  const stop = await e.api("/api/main/detach", {}), after = await ev();
  ok(stop.status === 200 && stop.body?.stopped === true && !stop.body?.resume && after.state === "detached" && after.driver?.holder === "none" && !after.driver?.resume,
    "Stop ends it: never handed to a terminal with a resume command Cursor could not honour", JSON.stringify({ stop: stop.body, driver: after.driver }).slice(0, 400));

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
