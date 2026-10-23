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
const { probeCursor, probeCursorChecked, verifyCursor, parseCursorModels, cursorKeyCheck } = await import("../src/providers/cursor");
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
  // a key that is present is unverified until the bounded `cursor-agent models` check with it succeeds (as Claude until Verify)
  process.env.CURSOR_API_KEY = "crsr_" + "9".repeat(40); // a key's shape the fixture refuses; not a credential
  const unchecked = probeCursor(["composer-2.5"], FIXTURE);
  ok(unchecked.available && unchecked.auth === "unverified" && unchecked.quota === "unknown" && unchecked.refusal === "unverified" && unchecked.models.length === 0 && cursorKeyCheck(FIXTURE).state === "unchecked",
    "the CLI and a key not checked yet: unverified, no model offered", JSON.stringify(unchecked));
  const rejected = await probeCursorChecked(["composer-2.5"], FIXTURE);
  ok(rejected.auth === "unverified" && rejected.refusal === "unverified" && rejected.models.length === 0 && /did not accept/.test(rejected.reason ?? "") && cursorKeyCheck(FIXTURE).state === "failed" && !(rejected.reason ?? "").includes("9".repeat(40)),
    "a key cursor-agent refuses stays unverified with the reason (never the key)", JSON.stringify(rejected));
  process.env.CURSOR_API_KEY = KEY;
  const stale = await probeCursorChecked(["composer-2.5"], FIXTURE);
  ok(stale.auth === "unverified" && cursorKeyCheck(FIXTURE).state === "failed", "a refused check is not retried at once for the same key source (Check again does)", JSON.stringify(stale));
  await verifyCursor({ bin: FIXTURE, fresh: true });
  const ready = await probeCursorChecked(["composer-2.5", "composer-2.5", ""], FIXTURE);
  ok(ready.available && ready.auth === "verified" && ready.quota === "available" && JSON.stringify(ready.models) === JSON.stringify(["composer-2.5", "composer-2.5-fast", "gpt-5.5"].map((id) => ({ id, efforts: [] }))),
    "after `cursor-agent models` accepted the key: verified, the account's models from the CLI, no effort levels", JSON.stringify(ready));
  ok(probeCursor(["composer-2.5"], FIXTURE).auth === "verified", "a passed check is reused (no second run)");
  // the models the CLI lists; a hung check ends at its deadline
  const listing = (name: string, extra: string) => { const f = join(TMP, name); writeFileSync(f, `#!/bin/sh\n${extra} exec bun "${FIXTURE}" "$@"\n`, { mode: 0o755 }); return f; };
  const own = await verifyCursor({ bin: listing("cursor-agent-own", "CURSOR_FIXTURE_MODELS=composer-9,gpt-x.1"), fresh: true });
  ok(own?.ok === true && JSON.stringify(probeCursor(["composer-2.5"], join(TMP, "cursor-agent-own")).models.map((m) => m.id)) === '["composer-9","gpt-x.1"]', "the models are what this CLI lists for the account", JSON.stringify(own));
  const hungAt = Date.now(), hung = await verifyCursor({ bin: listing("cursor-agent-hung", "CURSOR_FIXTURE_MODELS_HANG=1"), fresh: true, timeoutMs: 1500 });
  ok(hung?.ok === false && /deadline/.test(hung.reason ?? "") && Date.now() - hungAt < 10_000 && probeCursor(["composer-2.5"], join(TMP, "cursor-agent-hung")).auth === "unverified", "a check that never answers ends at its deadline and leaves the key unverified", JSON.stringify(hung));
  ok(JSON.stringify(parseCursorModels("\x1b[2mAvailable models\x1b[22m\n\n\x1b[32mcomposer-2.5\x1b[39m \x1b[2m- Composer 2.5\x1b[22m \x1b[2m(current, default)\x1b[22m\nclaude-opus-4-8 - Opus 4.8\ngpt-5.5\n\nTip: use --model <id> (or /model <id> in interactive mode) to switch.\n")) === '["composer-2.5","claude-opus-4-8","gpt-5.5"]'
    && parseCursorModels("No models available for this account.").length === 0, "the CLI's model list is parsed from its own output (colours, heading and tip aside)");
  await verifyCursor({ bin: FIXTURE, fresh: true });
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
  ok((await probeCursorChecked(["composer-2.5"], FIXTURE)).auth === "verified", "the private key file, once checked, makes Cursor ready");
  rmSync(join(dir, "cursor-api-key"));
}

console.log("the key's source: the keychain first, CURSOR_API_KEY in Studio's environment last");
// a stand-in security(1) answering from files (never the operator's keychain); the keys are fixture-shaped, not credentials
const KC = join(TMP, "keychain"), KC_TOOL = join(TMP, "security"); mkdirSync(KC);
writeFileSync(KC_TOOL, `#!/bin/sh\nsvc=; prev=; for a in "$@"; do [ "$prev" = -s ] && svc="$a"; prev="$a"; done\n[ -f "${KC}/$svc" ] && { cat "${KC}/$svc"; exit 0; }\nexit 44\n`, { mode: 0o755 });
const KC_KEY = "crsr_acceptance" + "1".repeat(49), V1_KEY = "crsr_acceptance" + "2".repeat(49), FILE_KEY = "crsr_acceptance" + "3".repeat(49);
const sha12 = (v: string) => new Bun.CryptoHasher("sha256").update(v).digest("hex").slice(0, 12);
{
  const dir = join(process.env.HOME!, ".config", "crew-studio"), file = join(dir, "cursor-api-key"); mkdirSync(dir, { recursive: true });
  process.env.CREW_KEYCHAIN_TOOL = KC_TOOL; process.env.CURSOR_API_KEY = KEY;
  writeFileSync(join(KC, "crew-studio-cursor-api-key"), KC_KEY + "\n"); writeFileSync(join(KC, "firstmate-cursor-api-key"), V1_KEY + "\n");
  writeFileSync(file, FILE_KEY + "\n", { mode: 0o600 }); chmodSync(file, 0o600);
  const pick = () => { const r = cursorLogin(), p = cursorLogin({ probe: true }); return { key: r.ok ? r.env.CURSOR_API_KEY : null, source: r.ok ? r.source : r.error, probe: p.ok ? p.source : p.error, warn: r.ok ? r.warn : null }; };
  const shown = (g: ReturnType<typeof pick>) => JSON.stringify({ key: g.key ? sha12(g.key) : null, source: g.source, probe: g.probe });
  let got = pick();
  ok(got.key === KC_KEY && got.source === "the crew's Cursor API key (keychain item crew-studio-cursor-api-key)" && got.probe === got.source,
    "the keychain item crew-studio-cursor-api-key wins over firstmate's item, the key file and a different CURSOR_API_KEY in Studio's environment", shown(got));
  rmSync(join(KC, "crew-studio-cursor-api-key")); got = pick();
  ok(got.key === V1_KEY && got.source === "the crew's Cursor API key (keychain item firstmate-cursor-api-key)" && got.probe === got.source, "then firstmate v1's keychain item, still before the key file and the environment", shown(got));
  rmSync(join(KC, "firstmate-cursor-api-key")); got = pick();
  ok(got.key === FILE_KEY && got.source === "the crew's Cursor API key (~/.config/crew-studio/cursor-api-key)" && got.probe === got.source, "then ~/.config/crew-studio/cursor-api-key, still before the environment", shown(got));
  rmSync(file); got = pick();
  ok(got.key === KEY && got.source === "CURSOR_API_KEY in Studio's environment" && got.probe === got.source, "CURSOR_API_KEY in Studio's environment only when no keychain item and no key file is there", shown(got));
  writeFileSync(join(KC, "crew-studio-cursor-api-key"), "crsr_short\n"); got = pick();
  ok(got.key === KEY && /keychain item crew-studio-cursor-api-key\): it is not a Cursor API key/.test(got.warn ?? "") && !(got.warn ?? "").includes("crsr_short"), "a keychain key of the wrong shape falls through to the next source, said without echoing it", shown(got));
  writeFileSync(join(KC, "crew-studio-cursor-api-key"), KC_KEY + "\n");

  // a chat or work turn (chat.ts, work.ts: roundEnv(provider.envKeys)) gets its key the same way, never straight from Studio's environment
  const { roundEnv } = await import("../src/secure"), { cursorProvider } = await import("../src/providers/cursor");
  const rec = join(TMP, "rec-cursor.mjs"), seenKey = join(TMP, "rec-cursor.out");
  writeFileSync(rec, `import { writeFileSync } from "node:fs"; import { createHash } from "node:crypto";\nwriteFileSync(${JSON.stringify(seenKey)}, createHash("sha256").update(process.env.CURSOR_API_KEY ?? "").digest("hex").slice(0, 12));\nprocess.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }) + "\\n");\n`);
  const tokenFile = join(TMP, "rec-token"); writeFileSync(tokenFile, "fixture-token", { mode: 0o600 });
  const p = cursorProvider("composer-2.5", rec);
  const ctx = { studioUrl: "http://127.0.0.1:9", token: "fixture-token", tokenFile, cwd: TMP, mcpCommand: ["true"], env: roundEnv(p.envKeys ?? [], { CREW_STUDIO_URL: "http://127.0.0.1:9", CREW_TOOL_TOKEN_FILE: tokenFile }) };
  for await (const _ of p.start("system", [], ctx).send("hi")) {}
  ok(!("CURSOR_API_KEY" in ctx.env) && existsSync(seenKey) && readFileSync(seenKey, "utf8") === sha12(KC_KEY), "a Cursor chat turn signs in with the keychain key, not CURSOR_API_KEY from Studio's environment",
    existsSync(seenKey) ? `saw ${readFileSync(seenKey, "utf8")}` : "no run");
  rmSync(join(KC, "crew-studio-cursor-api-key"));
  process.env.CREW_KEYCHAIN_TOOL = "none"; delete process.env.CURSOR_API_KEY;
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

console.log("the fixture keeps cursor-agent's real rules (2026.10.19: deny first, reads open, an explicit Write allow skips the protected files)");
{
  const fx = join(TMP, "fidelity"), h = join(fx, "h"), cfg = join(h, ".config", "cursor"); mkdirSync(cfg, { recursive: true }); mkdirSync(join(fx, "w"), { recursive: true });
  const ws = realpathSync(join(fx, "w")), secret = join(fx, "auth.json"); writeFileSync(secret, "not a credential\n");
  const turn = (permissions: unknown, text: string, extra: string[] = []) => {
    writeFileSync(join(cfg, "cli-config.json"), JSON.stringify({ version: 1, permissions }));
    const r = Bun.spawnSync(["bun", FIXTURE, "-p", "--output-format", "stream-json", "--trust", ...extra, "--workspace", ws, text], { cwd: ws, env: { ...process.env, HOME: h, XDG_CONFIG_HOME: join(h, ".config"), CURSOR_API_KEY: KEY, CURSOR_FIXTURE_LOG: "" } });
    return r.stdout.toString().split("\n").filter(Boolean).flatMap((l) => { try { return (JSON.parse(l).message?.content ?? []).map((c: any) => String(c.text)); } catch { return []; } }).join("\n");
  };
  const t = (n: string) => join(ws, n), wrote = (s: string) => JSON.parse(/FIXTURE-WROTE (.*)/.exec(s)?.[1] ?? "{}");
  const targets = [t("a.txt"), t(".CURSOR/cli.json"), t(".claude/settings.json"), t(".git/hooks/x"), t(".vscode/settings.json"), t("app.code-workspace"), join(fx, "sibling.txt")];
  const plain = wrote(turn({ allow: [], deny: ["Shell(*)"] }, `FIXTURE-WRITE ${JSON.stringify(targets)}`));
  ok(plain[targets[0]] === true && targets.slice(1).every((p) => plain[p] === false), "with no Write rule a write in the workspace applies; protected files (any case) and outside paths are refused", JSON.stringify(plain));
  for (const p of targets) rmSync(p, { force: true });
  const allowed = wrote(turn({ allow: [`Write(${ws}/**)`], deny: ["Shell(*)", `Write(${ws}/.cursor/**)`] }, `FIXTURE-WRITE ${JSON.stringify(targets.slice(1, 3))}`));
  ok(allowed[targets[1]] === true && allowed[targets[2]] === true, "an explicit Write allow skips the protected list, and a case-sensitive deny misses .CURSOR/", JSON.stringify(allowed));
  rmSync(t(".CURSOR"), { recursive: true, force: true }); rmSync(t(".claude"), { recursive: true, force: true });
  ok(new RegExp(`FIXTURE-GOT .*"${secret}":"[0-9a-f]{12}"`).test(turn({ allow: [], deny: ["Shell(*)"] }, `FIXTURE-READ ${JSON.stringify([secret])}`)), "a read outside the workspace is allowed when no Read deny names it");
  ok(/FIXTURE-GOT .*:false/.test(turn({ allow: [`Read(${secret})`], deny: ["Shell(*)", "Read(**)"] }, `FIXTURE-READ ${JSON.stringify([secret])}`)), "a Read deny wins over a Read allow (deny first)");
  mkdirSync(t(".cursor"), { recursive: true }); writeFileSync(t(".cursor/cli.json"), JSON.stringify({ permissions: { allow: ["Write(**)"] } }));
  const merged = wrote(turn({ allow: [], deny: ["Shell(*)"] }, `FIXTURE-WRITE ${JSON.stringify([t(".claude/settings.json")])}`)), off = wrote(turn({ allow: [], deny: ["Shell(*)"] }, `FIXTURE-WRITE ${JSON.stringify([t(".claude/x.json")])}`, ["--disable-project-configs"]));
  ok(merged[t(".claude/settings.json")] === true && off[t(".claude/x.json")] === false, "a project .cursor/cli.json merges into the config unless --disable-project-configs", JSON.stringify({ merged, off }));
  rmSync(t(".cursor"), { recursive: true, force: true }); rmSync(t(".claude"), { recursive: true, force: true });
  mkdirSync(join(fx, ".git")); mkdirSync(join(fx, ".cursor")); writeFileSync(join(fx, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: "echo git-root-hook" }] } }));
  ok(turn({ allow: [], deny: ["Shell(*)"] }, "hello").includes("FIXTURE-HOOK-OUTPUT git-root-hook"), "hooks load from the git root above the workspace");
}

console.log("a prompt that looks like an option stays the prompt");
{
  const { cursorProvider } = await import("../src/providers/cursor");
  const tok = join(TMP, "provider-token"); writeFileSync(tok, "t".repeat(32), { mode: 0o600 });
  // an MCP server with no tools: every request is answered with an empty result
  const mcp = join(TMP, "mcp-empty.mjs"); writeFileSync(mcp, `import { createInterface } from "node:readline";\ncreateInterface({ input: process.stdin }).on("line", (l) => { const m = JSON.parse(l); process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [] } }) + "\\n"); });\n`);
  for (const text of ["--force", "--statsig-overrides={}"]) {
    const s = cursorProvider("composer-2.5", FIXTURE).start("You are a worker.", [], { tokenFile: tok, mcpCommand: [process.execPath, mcp], studioUrl: "http://127.0.0.1:9", env: { CURSOR_API_KEY: KEY, PATH: process.env.PATH! }, sandbox: null } as any);
    const events: any[] = []; for await (const e of s.send(text)) events.push(e);
    const seen = JSON.stringify(events);
    ok(!/parsed as an option|statsig-overrides read from the raw argv|unexpected argv/.test(seen), `a round's prompt ${text} reaches cursor-agent as the prompt, after --`, seen.slice(0, 300));
  }
}

console.log("the host in an explicit project: the project folder only");
{
  const proj = join(TMP, "host-project"), outside = join(TMP, "host-outside"); mkdirSync(proj, { recursive: true }); mkdirSync(outside, { recursive: true });
  // a fresh start in folder `cwd` and one turn: the refusal, or "" once the turn ran (its events go to `heard`)
  var host_attach = async (cwd: string, heard: any[]) => {
    try {
      const x = await cursorHost(FIXTURE).attach("", { cwd, fresh: true, cursorProject: true, env: { CURSOR_API_KEY: KEY }, model: "composer-2.5", onEvent: (e: any) => heard.push(e), onPermission: async () => ({ allow: false }) } as any);
      await x.send("hello"); await x.detach(); return "";
    } catch (e: any) { return String(e?.message ?? e); }
  };
  const ws = realpathSync(proj);
  const pp = cursorProjectPermissions(ws, ["/data/a.pdf"]);
  ok(JSON.stringify(pp.allow) === '["Read(/data/a.pdf)"]' && ["Shell(*)", "Mcp(*:*)", `Write(${ws}*/.cursor/**)`, `Write(${ws}*/.claude/**)`, `Write(${ws}*/.git/**)`, `Write(${ws}*/.vscode/**)`, `Write(${ws}*/.idea/**)`, `Write(${ws}*.code-workspace)`, `Write(${ws}*/.cursorignore)`].every((d) => pp.deny.includes(d)),
    "cli-config.json has no Write allow (an explicit allow would skip cursor-agent's protected files), denies Shell, every MCP tool and the config folders at any depth, and allows reading this turn's PDFs", JSON.stringify(pp));
  const log = join(TMP, "host-project.jsonl"); process.env.CURSOR_FIXTURE_LOG = log;
  const pruns = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.argv[0] === "-p") : [];
  // hooks: cursor-agent runs a trusted project's .cursor/hooks.json and Claude Code's .claude/settings*.json hooks in its own
  // environment, CURSOR_API_KEY included, whatever cli-config.json denies; the user-level ones come from the host's private HOME
  const leak = "printenv CURSOR_API_KEY";
  const userHooks = join(process.env.HOME!, ".cursor"); mkdirSync(userHooks, { recursive: true });
  writeFileSync(join(userHooks, "hooks.json"), JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: leak }] } }));
  for (const [file, body] of [[".cursor/hooks.json", { version: 1, hooks: { sessionStart: [{ command: leak }] } }], [".claude/settings.json", { hooks: { Stop: [{ hooks: [{ type: "command", command: leak }] }] } }], [".claude/settings.local.json", { hooks: { PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: leak }] }] } }]] as const) {
    const hp = join(TMP, `hooked-${file.replace(/\W/g, "-")}`); mkdirSync(join(hp, file.split("/")[0]), { recursive: true }); writeFileSync(join(hp, file), JSON.stringify(body));
    const heard: any[] = [];
    const why = await host_attach(hp, heard);
    ok(why.includes(file) && /hooks/.test(why) && /hooks/.test(why.split(" / ")[1] ?? "") && /帶有 Cursor API key 的環境/.test(why) && !why.includes(KEY) && pruns().length === 0 && !heard.some((e) => JSON.stringify(e).includes(KEY)),
      `a project whose ${file} defines hooks is refused before cursor-agent runs, in English and zh-TW`, why);
  }
  // the same in any case (the Mac's disk ignores it), from the git root above the folder, and any .cursor/cli.json or sandbox.json
  const cases: [string, string, string, unknown][] = [["case", ".CURSOR/hooks.json", ".CURSOR/hooks.json", { version: 1, hooks: { sessionStart: [{ command: leak }] } }],
    ["claude-case", ".Claude/Settings.json", ".Claude/Settings.json", { hooks: { Stop: [{ hooks: [{ type: "command", command: leak }] }] } }],
    ["cli", ".cursor/cli.json", ".cursor/cli.json", { permissions: { allow: ["Write(**)", "Shell(*)"] }, approvalMode: "unrestricted" }],
    ["sandbox", ".cursor/sandbox.json", ".cursor/sandbox.json", { additionalReadwritePaths: ["/"] }],
    ["gitroot", "../.cursor/hooks.json", "../.cursor/hooks.json", { version: 1, hooks: { sessionStart: [{ command: leak }] } }],
    ["gitroot-cli", "../.CURSOR/cli.json", "../.CURSOR/cli.json", { permissions: { allow: ["Write(**)"] } }]];
  for (const [name, file, shown, body] of cases) {
    const repo = join(TMP, `settings-${name}`), hp = join(repo, "app"); mkdirSync(join(repo, ".git"), { recursive: true }); mkdirSync(hp); mkdirSync(join(hp, file, ".."), { recursive: true }); writeFileSync(join(hp, file), JSON.stringify(body));
    const heard: any[] = [], why = await host_attach(hp, heard);
    ok(why.includes(shown) && /cursor-agent/.test(why.split(" / ")[1] ?? "") && !why.includes(KEY) && pruns().length === 0 && !heard.some((e) => JSON.stringify(e).includes(KEY)),
      `a project with ${file} (relative to the folder Firstmate starts in) is refused before cursor-agent runs`, why);
  }
  {
    const hp = join(TMP, "hooked-none"); mkdirSync(join(hp, ".claude"), { recursive: true }); writeFileSync(join(hp, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: [] }, hooks: {} }));
    ok(await host_attach(hp, []) === "", "a .claude/settings.json without hooks does not stop it");
  }
  const said: string[] = [], events: any[] = [];
  const s = await cursorHost(FIXTURE).attach("", { cwd: proj, fresh: true, cursorProject: true, env: { CURSOR_API_KEY: KEY }, model: "composer-2.5", onEvent: (e: any) => { events.push(e); if (e.type === "message") said.push(e.text); }, onPermission: async () => ({ allow: false }) } as any);
  const targets = [join(proj, "notes", "inside.txt"), join(outside, "escape.txt"), join(proj, "..", "host-outside", "dotdot.txt"), join(proj, ".cursor", "mcp.json"), join(process.env.HOME!, "home-escape.txt"), join(proj, ".claude", "settings.json"), join(proj, ".git", "hooks", "pre-commit"),
    join(proj, ".CURSOR", "cli.json"), join(proj, ".Claude", "settings.local.json"), join(proj, ".vscode", "tasks.json"), join(proj, ".idea", "workspace.xml"), join(proj, "app.code-workspace"), join(proj, "sub", ".cursor", "hooks.json")];
  const r = await s.send(`FIXTURE-WRITE ${JSON.stringify(targets)}`);
  const runs = pruns().filter((c) => c.argv[c.argv.indexOf("--workspace") + 1] === ws);
  ok(r.status === "completed" && existsSync(targets[0]) && !targets.slice(1).some((t) => existsSync(t)) && !existsSync(join(proj, ".cursor")) && !existsSync(join(proj, ".claude")) && !existsSync(join(proj, ".git")),
    "it writes inside the project folder and cannot write outside it (a sibling folder, a ../ path, the home folder) nor the project's .cursor/, .claude/, .git/, .vscode/, .idea/ or a workspace file, in any case", JSON.stringify({ r, said, exists: targets.map((t) => existsSync(t)) }));
  ok(!said.some((t) => t.startsWith("FIXTURE-HOOK-OUTPUT")), "the captain's own ~/.cursor/hooks.json never runs: cursor-agent's HOME is the host's private one", JSON.stringify(said));
  ok(/"[^"]*inside\.txt":true/.test(said.join(" ")) && /escape\.txt":false/.test(said.join(" ")), "the write tool reports each refusal");
  // cursor-agent holds CURSOR_API_KEY in its environment; a shell command it ran (auto-run in its sandbox) would see it
  const sh = await s.send("FIXTURE-SHELL");
  ok(sh.status === "completed" && said.includes("FIXTURE-SHELL-DENIED") && !said.some((t) => t.includes("FIXTURE-SHELL-SAW-KEY") || t.includes(KEY)), "its shell is denied, so no command it runs can read the Cursor API key", JSON.stringify(said.slice(-2)));
  for (const text of ["--force", "--sandbox=disabled", "--statsig-overrides={}"]) {
    const r = await s.send(text);
    ok(r.status === "completed", `the captain's message ${text} is the prompt, never an option`, JSON.stringify(r));
  }
  // hooks that appear after the start (the captain or another tool wrote them): the next turn is refused and never runs them
  const before = pruns().length;
  mkdirSync(join(proj, ".claude"), { recursive: true }); writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: leak }] }] } }));
  const hooked = await s.send("hello again");
  const refusal = events.find((e) => e.type === "hostRefusal");
  ok(hooked.status === "failed" && refusal?.code === "cursorProjectHooks" && /\.claude\/settings\.local\.json/.test(refusal.reason.en) && /hooks/.test(refusal.reason["zh-TW"]) && pruns().length === before
    && !said.some((t) => t.includes(KEY)) && !JSON.stringify(events).includes(KEY), "hooks that appear later refuse the next turn (typed, English and zh-TW) and cursor-agent does not run", JSON.stringify({ hooked, refusal, runs: pruns().length - before }));
  rmSync(join(proj, ".claude"), { recursive: true, force: true });
  ok(runs.length === 1 && runs[0].argv[runs[0].argv.indexOf("--workspace") + 1] === ws && runs[0].argv[runs[0].argv.indexOf("--sandbox") + 1] === "enabled" && runs[0].argv.includes("--disable-project-configs") && !runs[0].argv.includes("--approve-mcps") && !runs[0].argv.includes("--force") && runs[0].home !== process.env.HOME,
    "the project is the workspace, cursor-agent's sandbox is on, never --force, no MCP server auto-approved, a private home", JSON.stringify(runs[0]?.argv));
  const resume = await s.detach(); delete process.env.CURSOR_FIXTURE_LOG;
  ok(resume === "", "stopping it hands back no resume command", JSON.stringify(resume));
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
  ok(login?.detail?.includes("CURSOR_API_KEY in Studio's environment") && login?.detailZh?.includes("Studio 環境中的 CURSOR_API_KEY")
    && login?.adds?.includes("the keychain item crew-studio-cursor-api-key, the keychain item firstmate-cursor-api-key, ~/.config/crew-studio/cursor-api-key, and only then CURSOR_API_KEY")
    && login?.addsZh?.includes("最後才使用 Studio 環境中的 CURSOR_API_KEY"), "Doctor names the source in use and the order, in English and zh-TW", JSON.stringify(login).slice(0, 600));
  const acct = await s.api("/api/cursor/account");
  ok(acct.status === 200 && acct.body?.installed === true && acct.body?.key === "present" && !acct.text.includes(KEY) && !doc.text.includes(KEY), "the account route says the key is there and never shows it", acct.text.slice(0, 300));
  const take = await s.api("/api/main/takeover", { host: "cursor", confirm: true }), list = await s.api("/api/main/sessions?host=cursor"), att = await s.api("/api/main/attach", { host: "cursor", id: "chat-123456" });
  ok(take.status === 409 && take.body?.code === "cursorTakeover" && list.status === 400 && list.body?.code === "cursorTakeover" && att.status === 409 && att.body?.code === "cursorTakeover", "Studio never takes over, lists or attaches a Cursor session", JSON.stringify([take.status, take.body, list.status, att.status]).slice(0, 400));
  ok(s.calls().length === 0, "no refusal ran cursor-agent");
  // the key checked with `cursor-agent models`: staffing and the model picker offer the models the CLI lists for the account
  const team = await s.api("/api/team?facts=1"), tc = team.body?.providers?.find((p: any) => p.provider === "cursor");
  ok(tc?.state === "detected" && tc?.login === "logged-in" && ["composer-2.5", "composer-2.5-fast", "gpt-5.5"].every((id) => team.body.models.some((m: any) => m.provider === "cursor" && m.model === id && m.available && !m.unverified)),
    "staffing: a checked key offers the models cursor-agent lists, verified", JSON.stringify({ tc, models: team.body?.models?.filter((m: any) => m.provider === "cursor") }).slice(0, 500));
  const listed = (await s.api("/api/models")).body?.providers?.find((p: any) => p.id === "cursor");
  ok(listed?.source === "cli" && JSON.stringify(listed.models.map((m: any) => m.id)) === '["composer-2.5","composer-2.5-fast","gpt-5.5"]', "the model picker lists Cursor's models from the CLI", JSON.stringify(listed));
  ok((await s.api("/api/cursor/native/status")).body?.state === "ready", "Cursor's native status is ready once the key passed the check");
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

  // an explicit project with hooks: the start check says why (typed, English and zh-TW) and Start runs nothing
  const hookedProj = join(TMP, "hooked-project"); mkdirSync(join(hookedProj, ".cursor"), { recursive: true });
  writeFileSync(join(hookedProj, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: "printenv CURSOR_API_KEY" }] } }));
  const hk = await boot("hooked", { CURSOR_API_KEY: KEY, CREW_MAIN_PROJECT: hookedProj, CREW_FM_STATE: state });
  const hr = await hk.api("/api/main/start/cursor-ready"), hs = await hk.api("/api/main/start", { host: "cursor", confirm: true });
  ok(hr.body?.ok === false && hr.body?.code === "cursorProjectHooks" && /\.cursor\/hooks\.json/.test(hr.body?.en) && /hooks/.test(hr.body?.zh) && hs.status === 409 && (await hk.api("/api/main")).body?.state === "detached"
    && hk.calls().length === 0 && ![hr.text, hs.text, hk.out()].some((t) => t.includes(KEY)), "a project with hooks: the start check refuses it with the reason and nothing runs", JSON.stringify([hr.body, hs.status, hs.text.slice(0, 200)]));

  writeFileSync(join(KC, "crew-studio-cursor-api-key"), KC_KEY + "\n");
  const k = await boot("keychain", { CREW_KEYCHAIN_TOOL: KC_TOOL, CURSOR_API_KEY: KEY });
  const kd = await k.api("/api/doctor"), kl = (kd.body?.items ?? []).find((i: any) => i.id === "round-login-cursor");
  ok(kl?.status === "ok" && kl.detail.includes("the crew's Cursor API key (keychain item crew-studio-cursor-api-key)") && kl.detailZh.includes("鑰匙圈項目 crew-studio-cursor-api-key") && !kl.detail.includes("CURSOR_API_KEY in Studio's environment")
    && ![KEY, KC_KEY].some((v) => kd.text.includes(v)), "Doctor: with a keychain key and a different CURSOR_API_KEY, the keychain item is the source shown (never a key)", JSON.stringify(kl).slice(0, 500));
  const kst = await k.api("/api/main/start", { host: "cursor", confirm: true });
  ok(kst.status === 200 && await until(() => k.calls().some((c) => c.argv[0] === "-p")), "a fresh Firstmate on Cursor starts", `${kst.status} ${kst.text.slice(0, 200)}`);
  const kturn = k.calls().find((c) => c.argv[0] === "-p");
  ok(kturn?.key === sha12(KC_KEY), "Firstmate on Cursor signs in with the keychain key, not CURSOR_API_KEY from Studio's environment", `saw ${kturn?.key}`);
  await k.api("/api/main/detach", {}); rmSync(join(KC, "crew-studio-cursor-api-key"));

  const n = await boot("keyless", {});
  const nd = (await n.api("/api/doctor")).body?.items ?? [], nl = nd.find((i: any) => i.id === "round-login-cursor");
  ok(nd.find((i: any) => i.id === "cursor")?.authenticated === false && nl?.action?.item === "cursor", "Doctor without a key: not signed in, and the fix is adding the key", String(JSON.stringify(nl)).slice(0, 300));
  ok(nd.find((i: any) => i.id === "cursor")?.status === "info" && nl?.status === "info" && /^Optional: needed only to run work or Firstmate on Cursor/.test(nl?.adds ?? "") && /^選用/.test(nl?.addsZh ?? ""),
    "with Cursor not in use, its CLI and key rows are optional information, not attention items (English and zh-TW)", JSON.stringify(nd.filter((i: any) => /cursor/.test(i.id)).map((i: any) => [i.id, i.status])));
  const u = await boot("keyless-in-use", { CREW_CHAT_PROVIDER: "cursor", CREW_EXAMPLE_WORKFLOWS: "1" });
  const ud = (await u.api("/api/doctor")).body?.items ?? [];
  const uo = await u.api("/api/wruns/start-options?workflow=startup-recursion");
  ok(uo.status === 200 && !("providerAdvice" in uo.body), "startup competition: no Cursor advice while Cursor is not signed in either", uo.text.slice(0, 300));
  const so = await (await boot("cursor-only-startup", { CURSOR_API_KEY: KEY, CREW_EXAMPLE_WORKFLOWS: "1" })).api("/api/wruns/start-options?workflow=startup-recursion");
  ok(JSON.stringify(so.body?.providerAdvice?.params) === '["founderProvider","judgeProvider"]' && /Set founderProvider and judgeProvider to cursor/.test(so.body.providerAdvice.en) && /設為 cursor/.test(so.body.providerAdvice.zh),
    "startup competition on a Cursor-only Studio: the Start form is told, in English and zh-TW, to set both providers to Cursor", so.text.slice(0, 400));
  ok(ud.find((i: any) => i.id === "cursor")?.status === "degraded" && ud.find((i: any) => i.id === "round-login-cursor")?.status === "missing", "with Cursor as the chat vendor, a missing key is an attention item", JSON.stringify(ud.filter((i: any) => /cursor/.test(i.id)).map((i: any) => [i.id, i.status])));
  const ns = await n.api("/api/main/start", { host: "cursor", confirm: true });
  ok(ns.status === 409 && ns.body?.code === "cursorKeyMissing" && (await n.api("/api/main")).body?.state === "detached" && n.calls().length === 0, "starting on Cursor without a key is refused and never falls back to another vendor", `${ns.status} ${ns.text.slice(0, 300)}`);

  // no cursor-agent on this Mac and Cursor not in use: the Crew page lists Codex and Claude only; Cursor once it is in use
  const NONE = join(TMP, "no-cursor-agent");
  for (const [name, extra, listed] of [["plain", {}, false], ["cursor-chat", { CREW_CHAT_PROVIDER: "cursor" }, true]] as const) {
    const c = await boot(name, { CREW_CURSOR_BIN: NONE, CREW_HOST_CURSOR_BIN: NONE, ...extra });
    const t = await c.api("/api/team?facts=1"), ids = (t.body?.providers ?? []).map((p: any) => p.provider);
    const cr = ((await c.api("/api/doctor")).body?.items ?? []).find((i: any) => i.id === "cursor");
    ok(cr?.status === (listed ? "missing" : "info"), listed ? "Doctor: cursor-agent missing while Cursor is the chat vendor is an attention item" : "Doctor: cursor-agent not installed on a Codex/Claude Studio is optional information", JSON.stringify(cr).slice(0, 200));
    ok(t.status === 200 && ids.includes("codex") && ids.includes("claude") && ids.includes("cursor") === listed && (!listed || t.body.providers.find((p: any) => p.provider === "cursor")?.state === "unavailable"),
      listed ? "Cursor as the chat vendor keeps it listed on the Crew page (unavailable: not installed)" : "without cursor-agent and with Cursor not in use, the Crew page lists Codex and Claude only", JSON.stringify(t.body?.providers ?? t.text.slice(0, 200)));
  }

  // a key cursor-agent refuses: unverified everywhere, as an unverified Claude is, and Firstmate on Cursor does not start
  const BAD = "crsr_" + "9".repeat(40); // a key's shape the fixture refuses; not a credential
  const b = await boot("refused", { CURSOR_API_KEY: BAD });
  const bt = await b.api("/api/team?facts=1"), bc = bt.body?.providers?.find((p: any) => p.provider === "cursor"), bm = (bt.body?.models ?? []).filter((m: any) => m.provider === "cursor");
  ok(bc?.state === "unverified-fallback" && bc?.login === "unknown" && bm.length === 1 && bm[0].model === "composer-2.5" && bm[0].unverified === true, "staffing: a refused key offers only the configured model, marked unverified (as Claude's)", JSON.stringify({ bc, bm }));
  const bl = (await b.api("/api/models")).body?.providers?.find((p: any) => p.id === "cursor");
  ok(bl?.source === "unverified-fallback" && JSON.stringify(bl.models.map((m: any) => m.id)) === '["composer-2.5"]' && /did not accept/.test(bl.reason ?? ""), "the model picker falls back to the configured model, saying why", JSON.stringify(bl));
  const bst = await b.api("/api/cursor/native/status");
  ok(bst.body?.state === "hold" && /unverified/.test(bst.body?.reason ?? ""), "Cursor's native status holds", bst.text.slice(0, 300));
  const bs = await b.api("/api/main/start", { host: "cursor", confirm: true }), br = await b.api("/api/main/start/cursor-ready");
  ok(bs.status === 409 && bs.body?.code === "cursorKeyRefused" && /did not accept/.test(bs.body?.en ?? "") && /不接受/.test(bs.body?.zh ?? "") && br.body?.ok === false && br.body?.code === "cursorKeyRefused" && b.calls().length === 0
    && ![bt.text, bs.text, br.text].some((t) => t.includes(BAD)), "Start on Cursor is refused with why (English and zh-TW), and the start check says so after", JSON.stringify([bs.status, bs.body, br.body]).slice(0, 500));
} finally {
  for (const a of apps) try { a.kill(); } catch {}
  await Bun.sleep(200);
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`\ncursor-vendor: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
