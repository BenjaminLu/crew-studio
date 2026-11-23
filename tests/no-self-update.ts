import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env, and never reach a real CLI
// Every vendor CLI Studio starts carries DISABLE_AUTOUPDATER=1: a `claude auth status --json` probe in the captain's own HOME
// once ran the CLI's npm-global auto-update, which replaced the installed CLI and ended every other Claude session on the Mac.
// A fake `claude` records the environment it was started with; each real Studio path that starts the CLI is run against it.
// Everything lives in a throwaway root: a temporary HOME, no real CLI, no network.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";

const root = mkdtempSync(join(tmpdir(), "crew-no-self-update-")), home = join(root, "home"), bin = join(root, "bin"), dumps = join(root, "dumps");
for (const d of [home, bin, dumps]) mkdirSync(d, { recursive: true });
const claude = join(bin, "claude"), cursor = join(bin, "cursor-agent");
// the dump folder is written into the script: the probes hand the CLI a bare environment, so nothing could carry it there
for (const f of [claude, cursor]) {
  writeFileSync(f, `#!/bin/sh
f=$(/usr/bin/mktemp "${dumps}/env.XXXXXX")
{ printf 'BIN=%s\\n' "\${0##*/}"; printf 'ARGV=%s\\n' "$*"; /usr/bin/env; } > "$f"
case "$*" in
  "auth status --json") printf '%s\\n' '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty"}'; exit 0;;
  *--version) echo "1.0.0"; exit 0;;
esac
exit 0
`);
  chmodSync(f, 0o755);
}
process.env.HOME = home;
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.CREW_CLAUDE_BIN = claude;
delete process.env.CLAUDE_CONFIG_DIR;

let count = 0;
const ok = (v: unknown, name: string, detail = "") => { assert(v, `${name}${detail ? `: ${detail}` : ""}`); count++; console.log(`ok ${name}`); };
const taken = new Set<string>();
/** the environments of every CLI start since the last call whose argv starts with `argv` */
const started = (argv: string): Record<string, string>[] => {
  const out: Record<string, string>[] = [];
  for (const f of readdirSync(dumps).sort()) {
    if (taken.has(f)) continue;
    const env: Record<string, string> = {};
    for (const line of readFileSync(join(dumps, f), "utf8").split("\n")) { const i = line.indexOf("="); if (i > 0) env[line.slice(0, i)] = line.slice(i + 1); }
    if (!env.ARGV?.startsWith(argv)) continue;
    taken.add(f); out.push(env);
  }
  return out;
};
const carries = (envs: Record<string, string>[], what: string) => {
  ok(envs.length > 0, `${what}: the fake claude was started`);
  ok(envs.every((e) => e.DISABLE_AUTOUPDATER === "1"), `${what}: the CLI is started with DISABLE_AUTOUPDATER=1`, JSON.stringify(envs.map((e) => e.DISABLE_AUTOUPDATER ?? null)));
};
const pair = { model: "claude-sonnet-5-5", effort: "low" };

try {
  const { ClaudeNative, claudeAccountEnv } = await import("../src/providers/claude-native");
  const native = new ClaudeNative({ bin: claude, login: () => ({ ok: true, env: { ANTHROPIC_API_KEY: "sk-ant-api03-" + "x".repeat(48) }, source: "offline fixture only", warn: null, kind: "api-key" as const }) });

  // the login probe from the incident: `claude auth status --json`, outside any sandbox, in the captain's own HOME
  const cap = await native.status(pair);
  const auth = started("auth status --json");
  carries(auth, "auth status probe");
  ok(cap.loginState === "logged-in" && auth.every((e) => e.HOME === home), "the auth probe still reads the ordinary account context (its HOME), the fake answered it", JSON.stringify({ loginState: cap.loginState, home: auth.map((e) => e.HOME) }));
  ok(claudeAccountEnv().DISABLE_AUTOUPDATER === "1", "the shared account environment (sign-in, auth reads) carries DISABLE_AUTOUPDATER=1");

  // the model list probe (stream-json initialize)
  await native.models({ fresh: true });
  carries(started("-p --input-format stream-json"), "model list probe");

  // the bounded live verification before rounds
  await native.verify(pair, { confirm: true, timeoutMs: 4000 });
  const verify = started("-p Reply with OK only.");
  carries(verify, "live verification");
  ok(verify.every((e) => e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1"), "live verification keeps CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1");

  // the official browser sign-in (`claude auth login`)
  const { ClaudeLogin } = await import("../src/host/claude-login");
  const login = new ClaudeLogin({ bin: () => claude, loginMs: 4000 });
  login.start();
  for (let i = 0; i < 100 && login.view().state === "pending"; i++) await new Promise((r) => setTimeout(r, 20));
  carries(started("auth login"), "sign-in");

  // rounds (src/providers/needs.ts): both the throwaway-home and the own-account environments
  const { claudeNeeds } = await import("../src/providers/needs");
  const roundHome = join(root, "round-home");
  const apiKey = claudeNeeds(claude, []).home(roundHome);
  ok(apiKey.DISABLE_AUTOUPDATER === "1" && apiKey.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1", "a round's environment carries DISABLE_AUTOUPDATER=1 and keeps CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", JSON.stringify(apiKey));

  // the spawn layers every round, tutor, explainer and host session goes through: a call site that forgets still gets it
  const { processSession } = await import("../src/providers/proc");
  for (const credentialFds of [false, true]) {
    const session = processSession(() => [claude, "-p", "round", "{TEXT}"], root, { PATH: process.env.PATH! }, () => ({ line: () => [], exit: () => ({ type: "turnEnd", status: "ok" } as any) }), null, { credentialFds });
    for await (const _ of session.send("hello")) { /* drain */ }
  }
  carries(started("-p round hello"), "round / tutor / explainer process (processSession, with and without credential descriptors)");
  const { spawnJsonl } = await import("../src/host/jsonl");
  const jp = spawnJsonl([claude, "-p", "host"], root, { PATH: process.env.PATH! }, () => {});
  await jp.exited;
  carries(started("-p host"), "host session (spawnJsonl)");
  const { probeProcess } = await import("../src/providers/probe-process");
  const pp = probeProcess([claude, "probe"], root, { PATH: process.env.PATH! });
  await pp.exited; await pp.stop();
  carries(started("probe"), "any metadata probe (probeProcess)");

  // the primary session: the environment claudePrimaryReadiness hands the Claude host, on the captain's own sign-in
  {
    const { claudePrimaryReadiness } = await import("../src/host/claude-primary");
    const ready: any = await claudePrimaryReadiness({ pair, status: () => native.status(pair), signInPending: false, configDir: join(root, "primary"),
      login: () => ({ ok: true, env: {}, source: "own account fixture", warn: null, kind: "account" as const }) });
    started("auth status --json");
    ok(ready.ok === true, "the primary readiness check passes on the fake CLI", JSON.stringify(ready).slice(0, 300));
    ok(ready.env?.DISABLE_AUTOUPDATER === "1", "the primary session's environment carries DISABLE_AUTOUPDATER=1", JSON.stringify(ready.env));
  }

  // Doctor: its `claude --version`, `claude auth status --json` and `cursor-agent --version` run in the captain's own HOME
  {
    const { diagnose } = await import("../src/doctor");
    diagnose({ state: root, legacy: false, board: { writable: false }, gh: { connected: false, tokenSource: null, enabled: false }, keys: { anthropic: null, openai: null, compatBaseUrl: null },
      chatProvider: "claude", lanIp: null, tailscale: { installed: false, running: false, dnsName: null }, claudeBin: claude, codexBin: "/nonexistent/codex", cursorBin: cursor, compiled: false } as any);
    const runs = started("");
    const claudeRuns = runs.filter((e) => e.BIN === "claude"), cursorRuns = runs.filter((e) => e.BIN === "cursor-agent");
    ok(claudeRuns.some((e) => e.ARGV === "--version") && claudeRuns.some((e) => e.ARGV === "auth status --json"), "Doctor ran claude --version and claude auth status --json", JSON.stringify(claudeRuns.map((e) => e.ARGV)));
    ok(claudeRuns.every((e) => e.DISABLE_AUTOUPDATER === "1"), "Doctor's claude reads carry DISABLE_AUTOUPDATER=1", JSON.stringify(claudeRuns.map((e) => [e.ARGV, e.DISABLE_AUTOUPDATER ?? null])));
    ok(cursorRuns.length > 0 && cursorRuns.every((e) => e.ARGV === "--disable-auto-update --version"), "Doctor's cursor-agent --version passes --disable-auto-update", JSON.stringify(cursorRuns.map((e) => e.ARGV)));
  }

  // terminals: the Claude preset gets DISABLE_AUTOUPDATER=1, the Cursor Agent preset --disable-auto-update; a shell is the captain's own
  {
    const { Terminals } = await import("../src/terminals");
    const project = join(root, "project"), data = join(root, "terminals");
    mkdirSync(project, { recursive: true });
    const svc = new Terminals({ dataDir: data, projects: () => [{ id: "p", name: "P", path: project }], transcripts: false, shell: "/bin/sh", env: { PATH: process.env.PATH!, HOME: home } });
    const wait = async (bin: string) => { for (let i = 0; i < 250; i++) { const r = started("").filter((e) => e.BIN === bin); if (r.length) return r; await new Promise((r) => setTimeout(r, 20)); } return []; };
    try {
      await svc.create({ project: "p", preset: "claude", cols: 80, rows: 24 } as any);
      const c = await wait("claude");
      ok(c.length === 1 && c[0].DISABLE_AUTOUPDATER === "1", "the Claude preset terminal starts claude with DISABLE_AUTOUPDATER=1", JSON.stringify(c.map((e) => e.DISABLE_AUTOUPDATER ?? null)));
      await svc.create({ project: "p", preset: "cursor-agent", cols: 80, rows: 24 } as any);
      const k = await wait("cursor-agent");
      ok(k.length === 1 && k[0].ARGV.split(" ")[0] === "--disable-auto-update", "the Cursor Agent preset terminal starts cursor-agent with --disable-auto-update", JSON.stringify(k.map((e) => e.ARGV)));
    } finally { svc.shutdown(); }
  }

  // a file that starts a process itself (not through the spawn layers above) and names a vendor CLI must use the helpers of
  // src/providers/no-self-update.ts, or be listed here with what it starts instead
  const STARTS_NO_VENDOR_CLI_ITSELF: Record<string, string> = {
    "src/worktrees.ts": "git only",
    "src/skills.ts": "git clone only",
    "src/host/probe.ts": "ps / lsof only (lists running CLIs)",
    "src/host/claude.ts": "starts the CLI through spawnJsonl",
    "src/providers/login.ts": "security (keychain) only",
    "src/runtime/checks.ts": "system tools only",
    "src/domain/commit-message.ts": "git only",
    "src/domain/review-room.ts": "gh and git only",
    "scripts/lan-two-machine.ts": "starts Studio (bun src/main.ts), whose own spawn layers start the CLIs",
    "scripts/lan-mutation-check.ts": "runs test commands through /bin/sh",
  };
  // starts cursor-agent only, always with a private throwaway HOME (where its update installs, $HOME/.local/share/cursor-agent)
  const PRIVATE_HOME_CURSOR: Record<string, string> = {
    "src/host/cursor.ts": "the Cursor host session: HOME, XDG_CONFIG_HOME and CURSOR_DATA_DIR under its private folder",
  };
  const layers = new Set(["src/host/jsonl.ts", "src/providers/probe-process.ts", "src/providers/proc.ts"]);
  const repo = join(import.meta.dirname, "..");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []);
  const missing: string[] = [];
  for (const f of [...walk(join(repo, "src")), ...walk(join(repo, "scripts"))]) {
    const rel = relative(repo, f), s = readFileSync(f, "utf8");
    if (rel === "src/providers/no-self-update.ts" || !/Bun\.spawn|spawnSync\(|[^.\w]spawn\(/.test(s) || !/claude|codex|cursor-agent/.test(s)) continue;
    if (STARTS_NO_VENDOR_CLI_ITSELF[rel] || PRIVATE_HOME_CURSOR[rel]) continue;
    if (!/\b(cliEnv\(|NO_SELF_UPDATE\b|CURSOR_NO_SELF_UPDATE\b)/.test(s.replace(/^import .*$/gm, ""))) missing.push(rel);
  }
  ok(missing.length === 0, "every file in src/ and scripts/ that starts a vendor CLI itself uses the no-self-update helpers (not just imports them)", missing.join(", "));
  for (const f of Object.keys(PRIVATE_HOME_CURSOR)) { const s = readFileSync(join(repo, f), "utf8"); ok(/HOME: join\(priv, "h"\)/.test(s), `${f}: ${PRIVATE_HOME_CURSOR[f]}`); }
  for (const f of layers) ok(/cliEnv\(/.test(readFileSync(join(repo, f), "utf8")), `${f} applies cliEnv to every child it starts`);
  for (const f of [...Object.keys(STARTS_NO_VENDOR_CLI_ITSELF), ...Object.keys(PRIVATE_HOME_CURSOR)]) ok(existsSync(join(repo, f)), `${f} (listed above) still exists`);

  console.log(`\n${count} no-self-update checks passed`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
