import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Web terminals (src/terminals.ts, docs/units/web-terminal.md) against a real Studio on temporary data, stub CLIs only:
//   a PTY round trip (create, attach with replay, input, resize, exit code), kill takes the process group, the child's env
//   carries no Studio internals, a phone may list and watch but never type, start, resize or stop, a script's
//   x-crew-session cannot type either, scrollback and transcript are bounded, Claude Code's Remote Control is turned on
//   once (launch flag or /remote-control), its link is shown to the desktop only and removed from the transcript, the
//   toggle off sends nothing, Studio stopping kills every terminal, the routes live on the loopback listener only.
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
import { LinkRedactor, Ring, terminalEnv, REMOTE_REMOVED } from "../src/terminals";
import { sessionCookieName } from "../src/csrf";

let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { if (v) { pass++; console.log("  ok    " + n); } else { fail++; console.log(("  FAIL  " + n + " " + extra).trimEnd()); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => any, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(50); } return null; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------- the parts, alone ----------
{
  const r = new Ring(10); r.push(new Uint8Array([1, 2, 3, 4, 5, 6])); r.push(new Uint8Array([7, 8, 9, 10, 11, 12]));
  ok(r.size === 10 && r.bytes().join() === "3,4,5,6,7,8,9,10,11,12" && r.dropped === 2, "the ring keeps the newest bytes and counts what it dropped");
  r.push(new Uint8Array(25).fill(9)); ok(r.size === 10 && r.bytes().every((b) => b === 9), "a chunk larger than the ring keeps only its end");
  const red = new LinkRedactor(); const parts = ["Remote Control: htt", "ps://claude.ai/co", "de/session_ABC123", "\r\nnext line"];
  const out = parts.map((p) => red.push(p)).join("") + red.flush();
  ok(!out.includes("session_ABC123") && out.includes(REMOTE_REMOVED) && out.includes("next line"), "a link split over four chunks is still removed", JSON.stringify(out));
  ok(new LinkRedactor().push("plain text http-ish but no link") === "plain text http-ish but no link", "ordinary text passes untouched");
  const env = terminalEnv({ PATH: "/bin", HOME: "/h", CREW_SESSION_TOKEN: "s".repeat(24), CREW_DATA: "/d", FM_IN_ROUND: "1", COPY: "secret-session-value-xyz", MINE: "kept" }, ["secret-session-value-xyz"]);
  ok(env.PATH === "/bin" && env.MINE === "kept" && !("CREW_SESSION_TOKEN" in env) && !("CREW_DATA" in env) && !("FM_IN_ROUND" in env) && !("COPY" in env) && env.TERM === "xterm-256color", "terminalEnv drops CREW_*, FM_* and Studio's secret values under any name", JSON.stringify(env));
}

// ---------- a real Studio ----------
const tmp = mkdtempSync(join(tmpdir(), "crew-terminals-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data"), bin = join(tmp, "bin");
for (const d of [home, proj, state, data, bin, join(home, ".codex")]) mkdirSync(d, { recursive: true });
writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "demo", name: "Demo", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true },
  { id: "off", name: "Off", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: false }]));
// a stub Claude Code: --help lists --remote-control only when ./mode says "flag"; it prints a fake Remote Control link
// when started with the flag or when it reads /remote-control; it logs its arguments and every line it reads
writeFileSync(join(bin, "claude"), `#!/bin/sh
d=$(dirname "$0")
if [ "$1" = "--help" ]; then if [ "$(cat "$d/mode")" = flag ]; then echo "  --remote-control [name]   Start an interactive session with Remote Control enabled"; else echo "  -p, --print"; fi; exit 0; fi
echo "$$ start: $*" >> "$d/calls.log"
for a in "$@"; do [ "$a" = "--remote-control" ] && printf 'Remote Control active \\342\\200\\242 https://claude.ai/code/rc-FAKEFLAG123?env=x\\r\\n'; done
while :; do printf '\\r\\n> '; IFS= read -r line || exit 0; echo "$$ input: $line" >> "$d/calls.log"
  case "$line" in /remote-control*) printf 'Remote Control enabled: https://claude.ai/code/rc-FAKESLASH456\\r\\n';; quit) exit 0;; *) printf 'you said %s\\r\\n' "$line";; esac; done
`); chmodSync(join(bin, "claude"), 0o755); writeFileSync(join(bin, "mode"), "flag");
const TOKEN = "terminals-test-session-token", TAILNET = "studio.tail-term.ts.net";
const env: any = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
const serverEnv = (port: number) => ({ ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/sh",
  CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1",
  CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TAILNET_NAME: TAILNET,
  CREW_TERMINAL_SCROLLBACK: "65536", CREW_TERMINAL_TRANSCRIPT: "100000", CREW_TERMINAL_IDLE_MS: "400", CREW_TERMINAL_MAX: "6",
  FM_SECRET_THING: "fm-internal", STUDIO_COPY_OF_TOKEN: TOKEN, MY_OWN_VAR: "mine-visible",
  CREW_HOST_CODEX_BIN: join(import.meta.dir, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(import.meta.dir, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") });
const cookie = `${sessionCookieName(TOKEN)}=${TOKEN}`;
let port = 0, app: any = null;
type Who = { as?: "page" | "script" | "phone" | "none"; token?: string; host?: string; headers?: Record<string, string> };
const hdrs = (o: Who) => ({ host: o.host ?? (o.as === "phone" ? TAILNET : `127.0.0.1:${port}`),
  ...(o.as === "phone" ? { authorization: `Bearer ${o.token}` } : o.as === "script" ? { "x-crew-session": TOKEN } : o.as === "none" ? {} : { cookie, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" }), ...(o.headers ?? {}) });
const raw = (method: string, path: string, body?: unknown, o: Who = {}) => new Promise<{ status: number; body: any }>((resolve) => {
  const d = method === "GET" ? undefined : JSON.stringify(body ?? {});
  const r = httpRequest({ host: "127.0.0.1", port, method, path, agent: false, headers: { ...hdrs(o), ...(d ? { "content-type": "application/json", "content-length": Buffer.byteLength(d) } : {}) } }, (res) => {
    const parts: Buffer[] = []; res.on("data", (c) => parts.push(c)); res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch {} resolve({ status: res.statusCode ?? 0, body: j }); }); });
  r.on("error", (e) => resolve({ status: 0, body: { error: String(e) } })); if (d) r.write(d); r.end();
});
/** An SSE reader: every event, the output as text (desktop b64 decoded, phone text), the last meta, the exit. */
function attach(id: string, o: Who = {}) {
  const s = { events: [] as { ev: string; data: any }[], out: "", replay: "", meta: null as any, exit: null as any, status: 0, close: () => {} };
  const dec = new TextDecoder(); let buf = "";
  const r = httpRequest({ host: "127.0.0.1", port, method: "GET", path: `/api/terminals/${id}/stream${o.as === "phone" ? `?token=${o.token}` : ""}`, agent: false, headers: hdrs({ ...o, as: o.as === "phone" ? "none" : o.as, host: o.as === "phone" ? TAILNET : undefined }) }, (res) => {
    s.status = res.statusCode ?? 0;
    res.on("data", (c: Buffer) => { buf += c.toString("utf8"); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1] ?? "message", dl = /^data: (.*)$/m.exec(block)?.[1]; const data = dl ? JSON.parse(dl) : null; s.events.push({ ev, data });
      const text = data?.b64 !== undefined ? dec.decode(Buffer.from(data.b64, "base64")) : data?.text ?? "";
      if (ev === "replay") { s.replay = text; s.out += text; } if (ev === "out") s.out += text; if (ev === "meta") s.meta = data; if (ev === "exit") s.exit = data; } });
  });
  r.on("error", () => {}); r.end(); s.close = () => r.destroy();
  return s;
}
const list = async (o: Who = {}) => (await raw("GET", "/api/terminals", undefined, o)).body;
const term = async (id: string, o: Who = {}) => (await list(o))?.terminals?.find((t: any) => t.id === id);
const create = async (b: any, o: Who = {}) => raw("POST", "/api/terminals", { project: "demo", cols: 90, rows: 25, ...b }, o);
const calls = () => { try { return readFileSync(join(bin, "calls.log"), "utf8"); } catch { return ""; } };
async function boot() { port = await freePort(); app = spawn(process.execPath, ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: serverEnv(port) }); app.stdout.resume(); await waitUp(`http://127.0.0.1:${port}`, app); }

try {
  await boot();
  // ---------- what the page sees ----------
  const L = await list();
  ok(L?.canWrite === true && L.presets?.some((p: any) => p.id === "claude" && p.remoteControl) && L.presets.some((p: any) => p.id === "shell"), "the page lists the presets on PATH (the stub claude, with Remote Control) and the shell", JSON.stringify(L?.presets));
  ok(L.presets.every((p: any) => p.id !== "codex" || existsSync(p.path)) && !L.presets.some((p: any) => p.id === "aider"), "a CLI that is not on PATH is not offered");
  ok(L.projects?.some((p: any) => p.id === "demo" && p.path === proj) && !L.projects.some((p: any) => p.id === "off"), "registered, enabled projects only");
  ok((await create({ project: "off", command: "true" })).body?.code === "project", "a disabled project cannot host a terminal");
  ok((await create({ preset: "aider" })).body?.code === "preset", "a preset that is not installed is refused");

  // ---------- the round trip ----------
  const c1 = await create({ command: "stty size; printf '\\303\\251 \\033[31mred\\033[0m\\n'; read x; echo got:$x; stty size; pwd; exit 3" });
  const id1 = c1.body?.terminal?.id; ok(c1.status === 200 && id1 && c1.body.terminal.state === "working", "create: a custom command starts in a PTY", JSON.stringify(c1.body));
  ok(c1.body.terminal.project.path === proj && c1.body.terminal.by === "desktop", "it runs in the project's folder, started by the desktop page");
  const s1 = attach(id1);
  ok(await until(() => s1.out.includes("25 90")), "the PTY has the size the page asked for", JSON.stringify(s1.out));
  ok(s1.out.includes("é") && s1.out.includes("\x1b[31mred"), "UTF-8 and colour come through untouched");
  ok((await raw("POST", `/api/terminals/${id1}/resize`, { cols: 120, rows: 40 })).body?.terminal?.cols === 120, "resize");
  ok((await raw("POST", `/api/terminals/${id1}/input`, { data: "hello\r" })).body?.ok === true, "input");
  ok(await until(() => s1.exit), "the exit arrives on the stream");
  ok(s1.out.includes("got:hello") && s1.out.includes("40 120") && s1.out.includes(proj.split("/").pop()!), "the input reached the program, the resize reached the PTY, cwd is the project", JSON.stringify(s1.out.slice(-200)));
  ok(s1.exit?.exitCode === 3 && (await term(id1))?.state === "exited", "exit code 3: exited", JSON.stringify(s1.exit));
  const late = attach(id1); ok(await until(() => late.replay.includes("got:hello") && late.exit), "attaching after the end replays the output and the exit"); late.close(); s1.close();
  ok((await raw("POST", `/api/terminals/${id1}/input`, { data: "x" })).body?.code === "ended", "input to an ended terminal is refused");
  const meta1 = JSON.parse(readFileSync(join(data, "terminals", `${id1}.json`), "utf8"));
  ok(meta1.exitCode === 3 && meta1.project.id === "demo" && meta1.by === "desktop" && meta1.sandboxed === false && meta1.evidence === false && meta1.endedAt, "the record keeps who, project, command, end and exit code; unsandboxed, not evidence", JSON.stringify(meta1));
  ok((statSync(join(data, "terminals", `${id1}.log`)).mode & 0o777) === 0o600 && readFileSync(join(data, "terminals", `${id1}.log`), "utf8").includes("got:hello"), "the transcript is a 0600 file under Studio's data");
  const ev = readFileSync(join(data, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.data?.id === id1);
  ok(ev.some((e) => e.type === "terminal.start" && e.data.unsandboxed === true) && ev.some((e) => e.type === "terminal.exit" && e.data.exitCode === 3), "Studio's activity log has the start and the exit");
  ok((await raw("POST", `/api/terminals/${id1}/dismiss`, {})).body?.ok && !(await term(id1)), "an ended terminal can be dismissed from the list");

  // ---------- kill takes the whole process group ----------
  const c2 = await create({ command: "sleep 300 & echo $! > child.pid; echo started; wait" }); const id2 = c2.body.terminal.id;
  const childPid = Number(await until(() => { try { return readFileSync(join(proj, "child.pid"), "utf8").trim(); } catch { return ""; } }));
  ok(childPid > 0 && alive(childPid), "a background child is running");
  ok((await raw("POST", `/api/terminals/${id2}/kill`, {})).status === 200, "kill");
  ok(await until(async () => (await term(id2))?.running === false), "the terminal ends");
  ok(await until(() => !alive(childPid), 4000), "its background child is gone too");
  rmSync(join(proj, "child.pid"), { force: true });

  // ---------- the child's environment ----------
  const c3 = await create({ command: "env; echo ENV_END" }); const s3 = attach(c3.body.terminal.id);
  await until(() => s3.out.includes("ENV_END") && s3.exit); s3.close();
  ok(s3.out.includes("MY_OWN_VAR=mine-visible") && s3.out.includes("TERM=xterm-256color"), "the user's own variables reach the child, with a terminal type");
  ok(!/\bCREW_[A-Z_]*=/.test(s3.out) && !/\bFM_[A-Z_]*=/.test(s3.out), "no CREW_* or FM_* variable reaches the child", (s3.out.match(/\b(?:CREW|FM)_[A-Z_]*=/g) ?? []).join(","));
  ok(!s3.out.includes(TOKEN) && !s3.out.includes("STUDIO_COPY_OF_TOKEN"), "Studio's session token reaches it under no name");

  // ---------- a phone watches, never drives; a script cannot type ----------
  const code = (await raw("POST", "/api/remote/pair/start", {}, { as: "script" })).body?.code;
  const ptok = (await raw("POST", "/api/remote/pair", { code, name: "Pixel" }, { as: "none", host: TAILNET })).body?.token;
  ok(typeof ptok === "string" && ptok.length > 10, "a phone pairs");
  await raw("POST", "/api/remote/settings", { allowDrive: true }, { as: "script" });
  const c4 = await create({ command: "printf 'Proceed with deploy? [y/N] '; read a; echo answer:$a" }); const id4 = c4.body.terminal.id;
  const PL = await list({ as: "phone", token: ptok });
  ok(PL?.canWrite === false && PL.terminals?.some((t: any) => t.id === id4) && !("presets" in PL) && !("projects" in PL), "a phone lists the terminals, read only, without presets or project paths", JSON.stringify(PL)?.slice(0, 300));
  const ps = attach(id4, { as: "phone", token: ptok });
  ok(await until(() => ps.status === 200 && ps.out.includes("Proceed with deploy?")), "a phone attaches and watches the output", `${ps.status} ${JSON.stringify(ps.out)}`);
  const st4 = await until(async () => { const t = await term(id4, { as: "phone", token: ptok }); return t?.state === "waiting" && t; });
  ok(st4?.reason === "question" && st4.ask === "Proceed with deploy? [y/N]", "the phone sees the same state: waiting for you, with the question", JSON.stringify(st4));
  for (const [path, body] of [["/api/terminals", { project: "demo", command: "true" }], [`/api/terminals/${id4}/input`, { data: "y\r" }], [`/api/terminals/${id4}/resize`, { cols: 50, rows: 10 }], [`/api/terminals/${id4}/kill`, {}], [`/api/terminals/${id4}/restart`, {}]] as const) {
    const r = await raw("POST", path, body, { as: "phone", token: ptok });
    ok(r.status === 403 && r.body?.code === "desktopOnly", `a phone (even allowed to drive Firstmate) is refused: ${path.split("/").pop()}`, JSON.stringify(r));
  }
  const sc = await raw("POST", `/api/terminals/${id4}/input`, { data: "y\r" }, { as: "script" });
  ok(sc.status === 403 && sc.body?.code === "pageOnly", "a script with x-crew-session cannot type (the page's cookie only)", JSON.stringify(sc));
  ok((await raw("POST", "/api/terminals", { project: "demo", command: "true" }, { as: "script" })).body?.code === "pageOnly", "nor start a terminal");
  ok((await raw("POST", `/api/terminals/${id4}/input`, { data: "y\r" }, { headers: { origin: "https://evil.example" } })).body?.code === "crossSite", "a cross-site page carrying the cookie is refused");
  ok((await raw("GET", "/api/terminals", undefined, { as: "none" })).status === 401 && (await raw("GET", `/api/terminals/${id4}/stream`, undefined, { as: "none" })).status === 401, "no session: no list, no stream");
  ok((await raw("POST", `/api/terminals/${id4}/input`, { data: "y\r" })).body?.ok, "the desktop page answers the question");
  ok(await until(() => ps.out.includes("answer:y") && ps.exit), "the phone sees the answer and the end"); ps.close();
  ok(readFileSync(join(data, "terminals", `${id4}.log`), "utf8").includes("answer:y") && !calls().includes("y\r"), "phone attach did not disturb the transcript");

  // ---------- bounds ----------
  const c5 = await create({ command: "head -c 300000 /dev/zero | tr '\\000' 'a'; echo; echo TAIL_MARK" }); const id5 = c5.body.terminal.id;
  await until(async () => (await term(id5))?.running === false);
  const s5 = attach(id5); await until(() => s5.exit); s5.close();
  const rep = s5.events.find((e) => e.ev === "replay")!.data; const repBytes = Buffer.from(rep.b64, "base64");
  ok(repBytes.length <= 65536 && repBytes.toString().includes("TAIL_MARK") && rep.dropped > 200000, "the replay is bounded by the scrollback ring (64 KiB here) and keeps the end", `${repBytes.length} dropped=${rep.dropped}`);
  const log5 = readFileSync(join(data, "terminals", `${id5}.log`), "utf8");
  ok(Buffer.byteLength(log5) <= 100000 + 100 && log5.includes("[transcript stopped at 100000 bytes]") && (await term(id5))?.transcriptTruncated, "the transcript stops at its cap and says so", String(Buffer.byteLength(log5)));
  const many = []; for (let i = 0; i < 7; i++) many.push(await create({ command: "sleep 30" }));
  ok(many.filter((r) => r.status === 200).length === 6 && many.some((r) => r.body?.code === "tooMany"), "at most CREW_TERMINAL_MAX run at once", many.map((r) => r.body?.code ?? r.status).join(","));
  for (const r of many) if (r.body?.terminal) await raw("POST", `/api/terminals/${r.body.terminal.id}/kill`, {});
  await until(async () => (await list()).terminals.every((t: any) => !t.running));

  // ---------- Claude Code's Remote Control ----------
  writeFileSync(join(bin, "calls.log"), "");
  const c6 = await create({ preset: "claude" }); const id6 = c6.body.terminal.id;
  ok(c6.body.terminal.remote?.enabled && c6.body.terminal.remote.mode === "flag" && c6.body.terminal.command.endsWith("--remote-control"), "a Claude Code whose --help lists --remote-control starts with it (on by default)", JSON.stringify(c6.body.terminal));
  const t6 = await until(async () => { const t = await term(id6); return t?.remote?.url && t; });
  ok(t6?.remote.url === "https://claude.ai/code/rc-FAKEFLAG123?env=x", "the page gets the session's Remote Control link", JSON.stringify(t6?.remote));
  ok((await term(id6, { as: "phone", token: ptok }))?.remote && !("url" in (await term(id6, { as: "phone", token: ptok })).remote), "the phone does not get the link");
  const pw = attach(id6, { as: "phone", token: ptok }); await until(() => pw.out.includes("Remote Control active")); pw.close();
  ok(pw.out.includes(REMOTE_REMOVED) && !pw.out.includes("FAKEFLAG123"), "the phone's stream carries the output with the link removed", JSON.stringify(pw.out));
  ok(await until(async () => (await term(id6))?.state === "waiting" && (await term(id6)).reason === "prompt"), "Claude at its prompt: waiting (prompt)");
  await sleep(900);
  ok(!calls().includes("input: /remote-control"), "with the flag, no /remote-control is typed");
  await raw("POST", `/api/terminals/${id6}/kill`, {}); await until(async () => !(await term(id6))?.running);
  const log6 = readFileSync(join(data, "terminals", `${id6}.log`), "utf8");
  ok(!log6.includes("FAKEFLAG123") && log6.includes(REMOTE_REMOVED), "the stored transcript has the link removed", JSON.stringify(log6.slice(0, 200)));
  ok(!readFileSync(join(data, "terminals", `${id6}.json`), "utf8").includes("FAKEFLAG") && !readFileSync(join(data, "events.jsonl"), "utf8").includes("FAKEFLAG"), "the record and the activity log never hold the link");

  // an older Claude Code without the flag: /remote-control, typed once, when it first sits at its prompt
  writeFileSync(join(bin, "mode"), "slash"); const later = new Date(Date.now() + 5000); utimesSync(join(bin, "claude"), later, later); writeFileSync(join(bin, "calls.log"), "");
  const c7 = await create({ preset: "claude" }); const id7 = c7.body.terminal.id;
  ok(c7.body.terminal.remote?.mode === "slash" && !c7.body.terminal.command.includes("--remote-control"), "without the flag in --help: no flag, the slash command instead", JSON.stringify(c7.body.terminal.remote));
  const t7 = await until(async () => { const t = await term(id7); return t?.remote?.url && t; });
  ok(t7?.remote.url === "https://claude.ai/code/rc-FAKESLASH456" && t7.remote.sent, "/remote-control was sent and its link is shown", JSON.stringify(t7?.remote));
  await sleep(1500);
  ok((calls().match(/input: \/remote-control/g) ?? []).length === 1, "it was sent exactly once", calls());
  await raw("POST", `/api/terminals/${id7}/kill`, {}); await until(async () => !(await term(id7))?.running);
  ok(!readFileSync(join(data, "terminals", `${id7}.log`), "utf8").includes("FAKESLASH456"), "that link is removed from the transcript too");

  // the toggle off: nothing sent, nothing shown
  writeFileSync(join(bin, "calls.log"), "");
  const c8 = await create({ preset: "claude", remoteControl: false }); const id8 = c8.body.terminal.id;
  ok(c8.body.terminal.remote?.enabled === false && c8.body.terminal.remote.mode === null, "Remote Control off: recorded as off");
  await until(async () => (await term(id8))?.state === "waiting"); await sleep(1200);
  ok(!/--remote-control|input: \/remote-control/.test(calls()) && !(await term(id8))?.remote?.url, "toggle off: no flag, no /remote-control, no link", calls());
  await raw("POST", `/api/terminals/${id8}/kill`, {});
  const c9 = await create({ command: "echo https://claude.ai/code/rc-NOTAGENT; sleep 1" }); await sleep(800);
  ok((await term(c9.body.terminal.id))?.remote === null, "another program has no Remote Control: nothing to show");

  // ---------- loopback only; Studio stopping kills every terminal ----------
  ok((await raw("GET", "/api/terminals", undefined, { host: "192.168.1.50:4210" })).status === 421, "an unknown Host (another interface's name) is refused");
  const src = readFileSync(join(import.meta.dir, "..", "src", "terminals.ts"), "utf8");
  ok(!/Bun\.serve|\.listen\(|createServer/.test(src), "the terminal service opens no listener of its own (it is served on Studio's loopback port)");
  ok(/Bun\.serve\(\{ port: PORT, hostname: "127\.0\.0\.1"/.test(readFileSync(join(import.meta.dir, "..", "src", "server.ts"), "utf8")), "Studio's main listener is bound to 127.0.0.1");
  const c10 = await create({ command: "echo $$ > leader.pid; sleep 300" }); const id10 = c10.body.terminal.id;
  const leader = Number(await until(() => { try { return readFileSync(join(proj, "leader.pid"), "utf8").trim(); } catch { return ""; } }));
  ok(leader > 0 && alive(leader), "a long-running terminal");
  app.kill("SIGTERM"); await until(() => app.exitCode !== null, 10000);
  ok(await until(() => !alive(leader), 4000), "Studio stopping killed it");
  ok(JSON.parse(readFileSync(join(data, "terminals", `${id10}.json`), "utf8")).reason === "studio-stopped", "its record says Studio stopped it");
  await boot();
  ok((await list()).terminals.length === 0, "after a restart nothing is re-attached (the list starts empty)");
  ok(readdirSync(join(data, "terminals")).filter((f) => f.endsWith(".json")).every((f) => JSON.parse(readFileSync(join(data, "terminals", f), "utf8")).endedAt), "every record from before the restart is closed");
} finally {
  try { app?.kill("SIGTERM"); } catch {}
  await sleep(300); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminals: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
