// Strict offline cursor-agent fixture (tests/acceptance.ts with ACCEPTANCE_PROVIDER=cursor, tests/cursor-vendor.ts).
// No real vendor, login, network or config access. It answers only to the acceptance key (CURSOR_API_KEY starting
// crsr_acceptance); anything else is "not logged in", as the real CLI says without a key.
//   --version                   a fixture version (no key needed, as with the real CLI)
//   models                      the account's models as the real CLI lists them (CURSOR_FIXTURE_MODELS, comma-separated, else
//                               composer-2.5, composer-2.5-fast, gpt-5.5); CURSOR_FIXTURE_MODELS_HANG=1 never answers
//   create-chat                 prints a new chat id
//   -p --output-format stream-json --workspace W … <text>
//     Firstmate (W/.cursor/mcp.json's studio server reaches a native socket): the scripted Firstmate turns of
//     tests/fixture/codex-account.mjs, its tools over that MCP server; otherwise a worker or reviewer round, the shared
//     scripted agent (tests/acceptance/agent.mjs cursorPrint). A Firstmate turn's `--image <path>` files must be images
//     on disk; it answers FIXTURE-SAW-IMAGES with their SHA-256 prefixes.
// Every -p run refuses a cli-config.json that does not deny the built-in Shell, Read and Write tools, except an image
// run (its allow list names GenerateImage(*)), which must deny Shell (and every Read, unless it has a reference.png, which
// it reads under the rules below) and allow nothing but GenerateImage(*) (and a Read of its reference.png); as the real CLI
// does, a Write(**) deny then refuses saving the image. Its turn lists the image
// tool, saves tests/fixture/jpeg/cursor-image.jpg under $CURSOR_DATA_DIR/projects/<workspace>/assets/ and returns it as
// imageData. The prompt's CURSOR-IMAGE:<mode> picks a failure: refused, duplicate, edit (a successful file edit), denied
// (a denied shell call, then the image), fail (the turn fails), escape (writes its workspace, the private root above it
// and /private/tmp; the turn fails naming any write that succeeded, else makes the image).
// The other exception is an explicit project's Firstmate (no Studio MCP server in the workspace): that run is never --force
// or --approve-mcps, and its Shell is denied. Its turns model cursor-agent's own tools under the real rules (the permission
// engine below): FIXTURE-WRITE ["path", …] and FIXTURE-READ ["path", …] write and read what those rules let through (and an
// OS sandbox around the process, if any, does not refuse), an attached PDF likewise, and FIXTURE-SHELL runs
// `printenv CURSOR_API_KEY` unless Shell(*) is denied. A turn that carries the conversation so far (everything before
// "[Studio <token>: the captain's new message]") answers FIXTURE-RECALL <word> with whether that word is in it.
// As the real CLI: --resume of a UUID chat (or --continue) fails when /tmp cannot be written, and a lone prompt naming a
// subcommand runs that subcommand.
// Every -p run first runs the hooks cursor-agent would load (the user's under $HOME; the git root's .cursor/hooks.json and
// .claude/settings*.json) with its own environment, key included, and says each one's output as FIXTURE-HOOK-OUTPUT.
//   CURSOR_FIXTURE_LOG  a file each run appends its argv (without the prompt) and chat id to (tests/cursor-vendor.ts); a
//                       Firstmate turn also its home, images and the first 12 hex of its key's SHA-256
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cursorPrint, mcpSession } from "../acceptance/agent.mjs";

// commander (index.js) reads options up to `--` and operands after it, so without `--` a prompt starting with "-" is an option
// (--force, --sandbox=disabled, --workspace=/ …); a few flags are read from the raw argv whatever `--` says (ft() for
// --disable-project-configs, ht() for --statsig-overrides): a prompt operand starting with one of them would set it.
const raw = process.argv.slice(2), end = raw.indexOf("--"), argv = end < 0 ? raw : [...raw.slice(0, end), ...raw.slice(end + 1)], flags = end < 0 ? raw : raw.slice(0, end), key = process.env.CURSOR_API_KEY ?? "";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const get = (k) => flags.includes(k) ? flags[flags.indexOf(k) + 1] : undefined;
const fail = (text, code = 1) => { out({ type: "result", subtype: "error", is_error: true, result: text }); process.exit(code); };
// a terminal's persistent session (CURSOR_AGENT_PERSIST_SESSION, tmux's TMUX*) changes what cursor-agent does (it ignores SIGINT
// and SIGTERM, and rebinds chats in the user's /tmp/cursor-agent-persist-<uid>), and a parent cursor-agent's CURSOR_AGENT_*,
// CURSOR_CONVERSATION_ID and CURSOR_REQUEST_ID are its own chat's: Studio's children (--version included) never inherit them
{ const tied = Object.keys(process.env).filter((k) => /^(TMUX(_|$)|CURSOR_AGENT_|CURSOR_(CONVERSATION|REQUEST)_ID$)/.test(k)); if (tied.length) fail(`cursor-agent fixture: run inside a terminal's persistent session or another agent's chat (${tied.join(", ")})`, 2); }
if (argv.length === 1 && argv[0] === "--version") { console.log("2026.10.01-fixture"); process.exit(0); }
// --resume <chat> / --continue (544.index.js J → index.js K, before the key is even looked at): a chat id shaped as a UUID (and
// --continue's latest chat) is first checked against cursor-agent's persistent sessions, which mkdirs a claim lock under the
// hard-coded /tmp/cursor-agent-persist-<uid> (k()); an OS sandbox that keeps /tmp closed fails every such turn. Modelled with a
// folder of the fixture's own under /tmp, made and removed at once.
{
  const chat = flags.includes("--continue") ? "-1" : flags.includes("--resume") ? flags[flags.indexOf("--resume") + 1] : undefined;
  if (chat === "-1" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chat ?? "")) {
    const lock = join("/tmp", `crew-fixture-persist-${process.pid}-${randomUUID()}`);
    try { mkdirSync(lock, { mode: 0o700 }); rmdirSync(lock); } catch (e) { fail(`Chat ${chat} may still be running, but Cursor could not verify its persistent session: ${e?.code}: ${e?.message}`); }
  }
}
if (!/^crsr_acceptance[A-Za-z0-9]+$/.test(key)) fail("Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY.");
// best effort: under an OS sandbox only a log inside the writable folders is written
const log = (o) => { if (process.env.CURSOR_FIXTURE_LOG) try { appendFileSync(process.env.CURSOR_FIXTURE_LOG, JSON.stringify(o) + "\n"); } catch {} };
if (argv[0] === "models") {
  log({ argv, home: process.env.HOME, key: createHash("sha256").update(key).digest("hex").slice(0, 12) });
  if (process.env.CURSOR_FIXTURE_MODELS_HANG === "1") await new Promise(() => setInterval(() => {}, 1000));
  const ids = (process.env.CURSOR_FIXTURE_MODELS ?? "composer-2.5,composer-2.5-fast,gpt-5.5").split(",").filter(Boolean);
  console.log(["Available models", "", ...ids.map((id, i) => `${id} - ${id.toUpperCase()}${i === 0 ? " (current, default)" : ""}`), "", "Tip: use --model <id> (or /model <id> in interactive mode) to switch."].join("\n"));
  process.exit(0);
}
if (argv[0] === "create-chat") { const id = randomUUID(); log({ argv, chat: id }); console.log(id); process.exit(0); }
if (argv[0] !== "-p" || get("--output-format") !== "stream-json" || !get("--workspace") || !argv.includes("--trust")) fail(`cursor-agent fixture: unexpected argv ${JSON.stringify(argv.slice(0, -1))}`, 2);
if (end < 0 && argv.at(-1).startsWith("-")) fail("cursor-agent fixture: the prompt was parsed as an option", 2);
if (raw.some((a) => a.startsWith("--statsig-overrides"))) fail("cursor-agent fixture: --statsig-overrides read from the raw argv", 2);
// a lone operand naming one of cursor-agent's subcommands runs that subcommand, `--` or not (index.js .command(…))
const SUBCOMMANDS = ["about", "acp", "agent", "create-chat", "generate-rule", "install-shell-integration", "login", "logout", "ls", "mcp", "models", "persist", "resume", "sandbox", "status", "uninstall-shell-integration", "update", "upgrade", "worker", "worker-server"];
if (SUBCOMMANDS.includes(argv.at(-1))) fail(`cursor-agent fixture: the prompt ran the ${argv.at(-1)} subcommand`, 2);
// ---------- cursor-agent's configuration and permission engine, as the installed 2026.10.19-6bbf2c4 bundle (index.js) has them ----------
// FileBasedConfigProvider.loadFromDefaults: the user's cli-config.json, then every .cursor/cli.json from the git root (utils/git.ts
//   p(): the nearest folder above the workspace holding .git, else the workspace) down to the workspace, merged in (permissions and
//   approvalMode included), unless --disable-project-configs (ft() scans the raw argv; the first match wins).
// matchesPathEntry (fe/pe): a Read(…)/Write(…) rule's pattern as an anchored, case-sensitive regex, `*` → `.*`.
// InteractivePermissionsService.shouldBlockWrite, in order: the realpath (df); an explicit Write deny refuses; a .cursorignore
//   basename refuses; an explicit Write allow ALLOWS, skipping every check below; approvalMode "unrestricted" allows;
//   checkCursorFileProtection (any .cursor or .vscode segment, any case, but *.md/*.mdc) refuses; outside the workspace a path
//   under /private/tmp/ or /private/var/folders/ but not under $HOME is allowed ($f), any other needsApproval; the protected list L (J.OK, ignore-lib with ignoreCase: .cursor/**/*.json, .claude/**/*.json, .vscode/**,
//   .idea/**, *.code-workspace, .cursorignore, .git/hooks/**, .git/config …) needsApproval; anything else is allowed. Print mode
//   without --force answers every needsApproval with always-deny-decision-provider: refused.
// shouldBlockReadInternal: an explicit Read deny refuses, matched against the path as asked (not its realpath); every other read
//   is allowed (readBoundary "workspace" is behind the sandbox_read_control_portal gate, off by default; not modelled).
// matchesMcpEntry / shouldBlockMcp: an explicit Mcp(server:tool) deny refuses first.
const PROTECTED = [/(^|\/)\.cursor\/(?!(rules|commands|worktrees|skills|agents)(\/|$))(.*\/)?[^/]*\.json$/i, /(^|\/)\.cursor\/\.workspace-trusted$/i, /(^|\/)\.workspace-trusted$/i,
  /(^|\/)\.claude\/(.*\/)?[^/]*\.json$/i, /(^|\/)\.vscode\//i, /(^|\/)\.idea\//i, /\.code-workspace$/i, /(^|\/)\.cursorignore$/i,
  /(^|\/)\.git\/hooks\//i, /(^|\/)\.git\/(config|config\.worktree|info\/attributes|commondir)$/i, /(^|\/)\.git\/worktrees\/[^/]+\/commondir$/i, /(^|\/)\.git$/i];
const gitRoot = (ws) => { for (let d = ws; ; d = dirname(d)) { if (existsSync(join(d, ".git"))) return d; if (dirname(d) === d) return ws; } };
const chain = (ws) => { const root = gitRoot(ws), out = []; for (let d = ws; ; d = dirname(d)) { out.unshift(d); if (d === root || dirname(d) === d) return out; } };
const projectConfigs = (process.argv.slice(2).find((a) => /^--disable-project-configs(=true|=false)?$/.test(a)) ?? "--disable-project-configs=false").endsWith("=false");
let perms = null, approvalMode = "allowlist";
try { const c = JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "/nonexistent", ".config"), "cursor", "cli-config.json"), "utf8")); perms = c.permissions; if (c.approvalMode) approvalMode = c.approvalMode; } catch {}
if (perms && get("--workspace") && projectConfigs) for (const d of chain(resolve(get("--workspace")))) {
  let c = null; try { c = JSON.parse(readFileSync(join(d, ".cursor", "cli.json"), "utf8")); } catch {}
  if (c?.permissions) perms = { allow: [...(perms.allow ?? []), ...(c.permissions.allow ?? [])], deny: [...(perms.deny ?? []), ...(c.permissions.deny ?? [])] };
  if (c?.approvalMode) approvalMode = c.approvalMode;
}
const pattern = (list, kind) => (list ?? []).flatMap((r) => { const m = new RegExp(`^\\s*${kind}\\s*\\((.*)\\)\\s*$`).exec(r); return m ? [new RegExp(`^${m[1].trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)] : []; });
const real = (p) => { const abs = resolve(p); try { return realpathSync(abs); } catch { return dirname(abs) === abs ? abs : join(real(dirname(abs)), basename(abs)); } };
function mayWrite(p, ws) {
  const f = real(p);
  if (pattern(perms.deny, "Write").some((r) => r.test(f))) return false;
  if ([basename(resolve(p)), basename(f)].some((b) => b.toLowerCase() === ".cursorignore")) return false;
  if (pattern(perms.allow, "Write").some((r) => r.test(f))) return true;
  if (approvalMode === "unrestricted") return true;
  if (f !== ws && !f.startsWith(ws + "/")) { const home = real(process.env.HOME ?? "/nonexistent"); return f !== home && !f.startsWith(home + "/") && ["/private/tmp/", "/private/var/folders/"].some((t) => f.startsWith(t)); }
  const rel = relative(ws, f), segs = rel.split("/");
  if (segs.some((s) => [".cursor", ".vscode"].includes(s.toLowerCase())) && !/\.(md|mdc)$|^\.cursorrules$/i.test(segs.at(-1))) return false;
  return !PROTECTED.some((r) => r.test(rel));
}
const mayRead = (p) => !pattern(perms.deny, "Read").some((r) => r.test(resolve(p)));
// hooks, as cursor-agent loads them (hooks-exec A(), 6121.index.js): the user's ~/.cursor/hooks.json and ~/.claude/settings.json
// (under $HOME) and the project's .cursor/hooks.json, .claude/settings.json and .claude/settings.local.json, the project being the
// git root above the workspace (7629.index.js Ae(): ky(cwd)). Every command runs in cursor-agent's own environment,
// CURSOR_API_KEY included, outside its sandbox (insecure_none), whatever cli-config.json says about Shell.
const hookOutput = [];
{
  const ws = get("--workspace"), home = process.env.HOME ?? "/nonexistent", root = gitRoot(resolve(ws));
  const files = [join(home, ".cursor", "hooks.json"), join(home, ".claude", "settings.json"), join(root, ".cursor", "hooks.json"), join(root, ".claude", "settings.json"), join(root, ".claude", "settings.local.json")];
  const commands = (h) => Array.isArray(h) ? h.flatMap((x) => typeof x?.command === "string" ? [x.command] : commands(x?.hooks)) : [];
  for (const f of files) {
    let hooks = null; try { hooks = JSON.parse(readFileSync(f, "utf8")).hooks; } catch {}
    for (const cmd of Object.values(hooks ?? {}).flatMap(commands)) {
      const r = spawnSync("/bin/sh", ["-c", cmd], { cwd: ws, env: process.env, encoding: "utf8", timeout: 5000 });
      hookOutput.push(String(r.stdout ?? "").trim());
    }
  }
}
if (perms?.allow?.includes("GenerateImage(*)")) { await imageTurn(); process.exit(0); }
const denied = ["Shell(*)", "Read(**)", "Write(**)"].every((d) => perms?.deny?.includes(d));
let server = null;
try { server = JSON.parse(readFileSync(join(get("--workspace"), ".cursor", "mcp.json"), "utf8")).mcpServers.studio; } catch {}
// an explicit project's Firstmate: its own tools, no Studio MCP server, and a config that keeps every write inside the workspace
const project = !denied && !server;
if (!project) {
  if (!denied) fail("cursor-agent fixture: cli-config.json does not deny the built-in tools", 2);
  if (!server) fail("cursor-agent fixture: no studio MCP server in the workspace's .cursor/mcp.json", 2);
  if (!server.env?.CREW_STUDIO_SOCKET) { await cursorPrint(argv); process.exit(process.exitCode ?? 0); }
}
const ws = project ? realpathSync(get("--workspace")) : "";
if (project) {
  if (["--force", "--yolo", "-f", "--approve-mcps"].some((f) => flags.includes(f))) fail(`cursor-agent fixture: a project Firstmate is never forced or auto-approving MCP servers ${JSON.stringify(argv.slice(0, -1))}`, 2);
  if (!(perms?.deny ?? []).includes("Shell(*)") || (perms?.allow ?? []).some((r) => /^\s*Shell\s*\(/.test(r))) fail("cursor-agent fixture: a project Firstmate's shell is not denied", 2);
}

// ---------- Firstmate (host) turn ----------
const session_id = get("--resume") ?? randomUUID(), model = get("--model") ?? "composer-2.5";
// --image <path> (repeatable): the headless prompt's images, read from disk as cursor-agent does; anything not an image fails the run
const images = argv.flatMap((a, i) => a === "--image" ? [argv[i + 1]] : []).map((p) => {
  let b; try { b = readFileSync(p); } catch { fail(`cursor-agent fixture: --image ${p} cannot be read`, 2); }
  if (!(b[0] === 0x89 && b[1] === 0x50 || b[0] === 0xff && b[1] === 0xd8 || b.subarray(0, 3).toString() === "GIF" || b.subarray(8, 12).toString() === "WEBP")) fail("cursor-agent fixture: --image is not an image", 2);
  return { path: p, sha256: createHash("sha256").update(b).digest("hex") };
});
log({ argv: argv.slice(0, -1), chat: session_id, home: process.env.HOME, images, key: createHash("sha256").update(key).digest("hex").slice(0, 12) });
// an explicit project's turn carries the conversation so far before the captain's new message (src/host/cursor.ts carried()). Read
// as a model would, carelessly: where the carried note names a token, the first appearance of the new-message marker with that
// token ends it, even inside a quoted reply; otherwise the first line that says it is the captain's new message does, wherever it
// came from. Its earlier captain turns: a JSON line's "captain", or any line starting "Captain: ".
const whole = argv.at(-1), fence = /^\s*\[Studio ([0-9a-f-]{36}): this chat so far/.exec(whole)?.[1];
const marker = fence ? `[Studio ${fence}: the captain's new message]` : "";
const boundary = fence ? whole.indexOf(marker) : whole.search(/\n\[Studio[^\]\n]*: the captain's new message\]\n/);
const earlier = boundary < 0 ? "" : whole.slice(0, boundary);
const text = (boundary < 0 ? whole : fence ? whole.slice(boundary + marker.length).replace(/^\n/, "") : whole.slice(whole.indexOf("\n", boundary + 1) + 1)).replace(/(?:\n\n\[Studio note: [^\n]*\])+$/, "");
const captainSaid = earlier.split("\n").slice(1).flatMap((l) => { try { const o = JSON.parse(l); if (typeof o?.captain === "string") return [o.captain]; } catch {} return l.startsWith("Captain: ") ? [l.slice(9)] : []; });
out({ type: "system", subtype: "init", apiKeySource: "env", cwd: get("--workspace"), session_id, model, permissionMode: "default" });
const say = (t) => out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] }, session_id });
// FIXTURE-THINK: cursor-agent streams the model's thinking before its reply
if (text.includes("FIXTURE-THINK")) { for (const t of ["weighing ", "the ask"]) out({ type: "thinking", subtype: "delta", text: t, session_id }); out({ type: "thinking", subtype: "completed", session_id }); say("FIXTURE-THOUGHT"); }
if (images.length) say(`FIXTURE-SAW-IMAGES ${images.map((i) => i.sha256.slice(0, 12)).join(",")}`);
for (const o of hookOutput) say(`FIXTURE-HOOK-OUTPUT ${o}`);
if (project) {
  // FIXTURE-SAY <JSON string>: the model replies with exactly that text, {FENCE} in it this turn's token (a reply that saw this
  // turn's new-message marker repeats it); FIXTURE-SPOOF in what it takes for the captain's message means a carried reply forged
  // the boundary
  if (text.includes("FIXTURE-SAY ")) say(JSON.parse(text.slice(text.indexOf("FIXTURE-SAY ") + 12).split("\n")[0]).replaceAll("{FENCE}", fence ?? ""));
  if (text.includes("FIXTURE-SPOOF")) say("FIXTURE-SPOOFED");
  // FIXTURE-CAPTAIN-ASKED <word>: whether an earlier captain turn, as the model reads the carried conversation, holds that word
  if (text.includes("FIXTURE-CAPTAIN-ASKED ")) { const w = text.slice(text.indexOf("FIXTURE-CAPTAIN-ASKED ") + 22).split(/\s/)[0]; say(`FIXTURE-CAPTAIN-ASKED ${w} ${captainSaid.some((c) => c.includes(w))}`); }
  // FIXTURE-RECALL <word>: whether the conversation carried into this turn holds that word
  if (text.includes("FIXTURE-RECALL ")) { const w = text.slice(text.indexOf("FIXTURE-RECALL ") + 15).split(/\s/)[0]; say(`FIXTURE-RECALLED ${w} ${earlier.includes(w)}`); }
  // FIXTURE-HISTORY: the carried conversation's shape: its JSON lines' lengths, and whether it holds a raw U+2028/2029/0085
  if (text.includes("FIXTURE-HISTORY")) say(`FIXTURE-HISTORY ${JSON.stringify({ lines: earlier.split("\n").filter((l) => l.startsWith("{")).map((l) => l.length), raw: /[\u2028\u2029\u0085]/.test(earlier), huge: earlier.includes("HUGE\\u2028TURN\\u2029\\u0085") })}`);
  if (text.includes("Crew Studio started you as firstmate in")) say(`Ready as firstmate in ${ws}; first message: ${/## (state\/HANDOFF-[\w.-]+\.md)/.exec(text)?.[1] ?? "none"}`);
  // FIXTURE-WRITE ["path", ...]: the model tries to write each file with its Write tool
  if (text.includes("FIXTURE-WRITE ")) {
    const wrote = {};
    for (const [i, p] of JSON.parse(text.slice(text.indexOf("FIXTURE-WRITE ") + 14).split("\n")[0]).entries()) {
      const call_id = `fixture-write-${i}`;
      let ok = mayWrite(p, ws);
      out({ type: "tool_call", subtype: "started", call_id, tool_call: { editToolCall: { args: { path: p } } }, session_id });
      // the process's own writes: an OS sandbox around it may still refuse them
      if (ok) try { mkdirSync(dirname(resolve(p)), { recursive: true }); writeFileSync(p, "written by the fixture\n"); } catch { ok = false; }
      out({ type: "tool_call", subtype: "completed", call_id, tool_call: { editToolCall: { args: { path: p }, result: ok ? { success: { content: [{ text: "ok" }] } } : { permissionDenied: { error: `Write(${p}) is not allowed` } } } }, session_id });
      wrote[p] = ok;
    }
    say(`FIXTURE-WROTE ${JSON.stringify(wrote)}`);
  }
  // FIXTURE-READ ["path", ...]: the model reads each file with its Read tool; says the first 12 hex of the SHA-256 of what it got
  if (text.includes("FIXTURE-READ ")) {
    const got = {};
    for (const p of JSON.parse(text.slice(text.indexOf("FIXTURE-READ ") + 13).split("\n")[0])) {
      let b = null; if (mayRead(p)) try { b = readFileSync(p); } catch {}
      got[p] = b ? createHash("sha256").update(b).digest("hex").slice(0, 12) : false;
    }
    say(`FIXTURE-GOT ${JSON.stringify(got)}`);
  }
  if (text.includes("FIXTURE-SHELL")) {
    const call_id = "fixture-shell", args = { command: "printenv CURSOR_API_KEY" }, blocked = !!perms?.deny?.includes("Shell(*)");
    out({ type: "tool_call", subtype: "started", call_id, tool_call: { shellToolCall: { args } }, session_id });
    out({ type: "tool_call", subtype: "completed", call_id, tool_call: { shellToolCall: { args, result: blocked ? { permissionDenied: { error: "Shell(printenv) is denied" } } : { success: { stdout: key, exitCode: 0 } } } }, session_id });
    say(blocked ? "FIXTURE-SHELL-DENIED" : `FIXTURE-SHELL-SAW-KEY ${createHash("sha256").update(key).digest("hex").slice(0, 12)}`);
  }
  // an attached PDF: read with the Read tool, when the config allows that file
  for (const m of text.matchAll(/The file is at (\S+) \(Studio's copy\)/g)) {
    let b = null; if (mayRead(m[1])) try { b = readFileSync(m[1]); } catch {}
    say(b && b.subarray(0, 5).toString() === "%PDF-" ? `FIXTURE-READ-PDF ${createHash("sha256").update(b).digest("hex").slice(0, 12)}` : "FIXTURE-READ-DENIED");
  }
  out({ type: "result", subtype: "success", is_error: false, result: "", session_id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  process.exit(0);
}
const ask = (q, escalate, extra = {}) => ({ name: "studio_answer_agent_question", args: { task: q[1], node: q[2], visit: Number(/visit:(\d+)/.exec(text)?.[1]), escalate, ...extra } });
let tool = null;
try {
  const marker = ["NATIVE-TOOL ", "NATIVE-STAFFING ", "NATIVE-PROJECT ", "NATIVE-PROPOSE "].find((m) => text.includes(m));
  if (marker) {
    const args = JSON.parse(text.slice(text.indexOf(marker) + marker.length));
    tool = marker === "NATIVE-TOOL " || marker === "NATIVE-STAFFING " ? args : { name: marker === "NATIVE-PROJECT " ? "studio_prepare_project_work" : "studio_propose_work", args };
  } else if (text.includes("Agent question in Task ") && /discount/.test(text)) tool = ask(/Task (R-\d+), step ([a-z-]+)/.exec(text), "The discount percentage is a captain preference that I cannot infer.");
  else if (text.includes("Escalation in Task ")) tool = ask(/Task (R-\d+), step ([a-z-]+)/.exec(text), "The worker needs work outside the approved scope; only the captain can widen it.", { recommendation: "Rescope to include it, or park the Task." });
} catch {}
if (text.includes("You are Studio's own Firstmate")) say("Hello! I am your Studio Firstmate. What would you like to make?");
if (tool) {
  const call_id = "fixture-call-1", allowed = perms.allow?.includes(`Mcp(studio:${tool.name})`);
  const event = (subtype, result) => out({ type: "tool_call", subtype, call_id, tool_call: { mcpToolCall: { args: { name: `studio-${tool.name}`, args: tool.args, toolName: tool.name, providerIdentifier: "studio" }, ...(result ? { result } : {}) } }, session_id });
  event("started");
  if (!allowed) event("completed", { rejected: { reason: `Mcp(studio:${tool.name}) is not allowed` } });
  else {
    const mcp = mcpSession(server);
    try {
      await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cursor-agent-fixture", version: "1" } });
      const r = await mcp.rpc("tools/call", { name: tool.name, arguments: tool.args });
      const body = (r.result?.content ?? []).map((c) => c?.text ?? "").join("") || String(r.error?.message ?? "");
      event("completed", { success: { content: [{ text: { text: body } }], isError: !!r.result?.isError || !!r.error } });
    } finally { mcp.close(); }
  }
}
out({ type: "result", subtype: "success", is_error: false, result: "", session_id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });

// ---------- an image job (src/providers/cursor-image.ts) ----------
async function imageTurn() {
  const ws = get("--workspace"), text = argv.at(-1), mode = /CURSOR-IMAGE:([a-z]+)/.exec(text)?.[1] ?? "success", session_id = randomUUID();
  const reference = text.includes("reference.png");
  if (!perms.deny?.includes("Shell(*)") || !reference && !perms.deny.includes("Read(**)") || perms.allow.some((a) => a !== "GenerateImage(*)" && !/^Read\((.*\/)?reference\.png\)$/.test(a))) fail("cursor-agent fixture: an image run must deny Shell (and every Read without a reference) and allow only the image tool", 2);
  let servers = null; try { servers = JSON.parse(readFileSync(join(ws, ".cursor", "mcp.json"), "utf8")).mcpServers; } catch {}
  if (!servers || Object.keys(servers).length) fail("cursor-agent fixture: an image run registers no MCP server", 2);
  if (!existsSync(join(ws, "AGENTS.md")) || !readFileSync(join(ws, "AGENTS.md"), "utf8").includes("# Operating rules (set by the captain)")) fail("cursor-agent fixture: the image run's AGENTS.md carries no operating rules", 2);
  // the reference is read as any file is: a Read deny that matches it wins over every allow (deny first)
  if (reference && (!mayRead(join(ws, "reference.png")) || readFileSync(join(ws, "reference.png")).subarray(1, 4).toString() !== "PNG")) fail("cursor-agent fixture: the reference image is not readable", 2);
  out({ type: "system", subtype: "init", apiKeySource: "env", cwd: ws, session_id, model: get("--model") ?? "composer-2.5", permissionMode: "default" });
  if (mode === "fail") fail("the model run failed");
  const call = (n, kind, args, result) => { const id = `fixture-image-${n}`; out({ type: "tool_call", subtype: "started", call_id: id, tool_call: { [kind]: { args } }, session_id }); out({ type: "tool_call", subtype: "completed", call_id: id, tool_call: { [kind]: { args, result } }, session_id }); };
  if (mode === "escape") {
    const wrote = [join(ws, "escape.txt"), join(ws, "..", "escape.txt"), `/private/tmp/crew-cursor-image-escape-${process.pid}`].filter((f) => { try { writeFileSync(f, "escaped"); return true; } catch { return false; } });
    if (wrote.length) fail(`ESCAPED: ${wrote.join(", ")}`);
  }
  call(1, "getMcpToolsToolCall", { server: "cursor", toolName: "GenerateImage" }, { success: { tools: [{ name: "GenerateImage" }] } });
  if (mode === "denied") call(2, "shellToolCall", { command: "ls" }, { permissionDenied: { error: "Command blocked by permissions configuration" } });
  if (mode === "edit") call(2, "editToolCall", { path: join(ws, "x.txt") }, { success: { path: join(ws, "x.txt") } });
  const args = { description: text.slice(0, 200), referenceImagePaths: text.includes("reference.png") ? ["reference.png"] : [], aspectRatio: "1:1" };
  if (mode === "refused") call(3, "generateImageToolCall", args, { rejected: { reason: "Image generation is not allowed" } });
  else {
    const jpeg = readFileSync(join(import.meta.dir, "jpeg", "cursor-image.jpg")), assets = join(process.env.CURSOR_DATA_DIR ?? "/nonexistent", "projects", basename(ws), "assets"), filePath = join(assets, "image.jpg");
    let saved = !perms.deny.includes("Write(**)");
    if (saved) try { mkdirSync(assets, { recursive: true }); writeFileSync(filePath, jpeg); } catch { saved = false; }
    const result = saved ? { success: { filePath, imageData: jpeg.toString("base64") } } : { error: { error: "Failed to save generated image: permission denied (Blocked by permissions configuration)" } };
    call(3, "generateImageToolCall", args, result);
    if (mode === "duplicate") call(4, "generateImageToolCall", args, result);
  }
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "The image is ready." }] }, session_id });
  out({ type: "result", subtype: "success", is_error: false, result: "The image is ready.", session_id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
}
