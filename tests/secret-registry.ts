import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The redaction rules (src/secure.ts; units fix-record-smoke-r2, redaction-rules), table-driven:
// 1. known values, always: credential-named env variables, every registered file-held
//    secret (key store, GitHub token from env, file or `gh auth token`, ledger key,
//    session token), a round's own token as `extra`; never shorter than SECRET_MIN;
// 2. a credential name is a credential word as the whole name or its last word; a prefix
//    alone (GH_, AWS_, GITHUB_, DOCKER_, FM_, HERDR_) is not;
// 3. under a credential name the value goes whatever its shape (JSON key, NAME=value,
//    a header or YAML line, name = "literal"); code identifiers assigned an expression stay;
// 4. known formats anywhere.                                bun tests/secret-registry.ts
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const sec: any = await import("../src/secure");
const M = "[credential removed]";
ok(sec.REDACTED === M, "the one marker is \"[credential removed]\"");

// ---------- rule 2 and 3: every credential name, every value shape, every form ----------
const NAMES = [...sec.CREDENTIAL_WORDS, "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "CREW_TOOL_TOKEN", "apiKey", "accessToken", "client_secret", "X-API-Key", "sessionId", "db_password", "token",
  "STRIPE_KEY", "OPENAI_KEY", "SIGNING_KEY", "DB_CREDENTIALS", "SSH_PRIVATE_KEY", "GOOGLE_CREDENTIALS", "MY_PRIVATE_THING"];
const SHAPES: Record<string, string> = { passphrase: "correct horse battery staple", base64: "aGVsbG8v/d29ybGQ+Zm9vYmFy==", shortHex: "a3f9c2e1", lettersOnly: "CorrectHorseBatteryStaple" };
const FORMS: Record<string, (n: string, v: string) => string> = {
  json: (n, v) => JSON.stringify({ [n]: v }),
  assignment: (n, v) => `${n}="${v}"`,
  assignmentBare: (n, v) => (/\s/.test(v) ? `${n}="${v}"` : `${n}=${v}`),
  header: (n, v) => `${n}: ${v}`,
  source: (n, v) => `const ${n.replace(/[^A-Za-z0-9_]/g, "_")} = "${v}";`,
};
const leaks: string[] = [];
for (const n of NAMES) for (const [sh, v] of Object.entries(SHAPES)) for (const [f, make] of Object.entries(FORMS)) {
  const t = make(n, v); const r = sec.redactText(t); if (r.includes(v) || !r.includes(M)) leaks.push(`${f}/${sh}/${n}: ${r}`); }
ok(!leaks.length, `every credential name (${NAMES.length}) with a passphrase, base64, short-hex or letters-only value is redacted in JSON, NAME=value, header and source forms`, leaks.slice(0, 6).join(" | "));
{ const j = sec.redactJSON({ password: "CorrectHorseBatteryStaple", nested: { api_key: "my secret pass phrase", list: [{ token: "a3f9c2e1" }] }, max_tokens: 4096000, count: 3 });
  ok(j.password === M && j.nested.api_key === M && j.nested.list[0].token === M && j.max_tokens === 4096000 && j.count === 3, "redactJSON: a string under a credential name goes at any depth, whatever its shape; numbers under other names stay", JSON.stringify(j)); }

// ---------- rule 2: prefix-only names stay visible ----------
const PREFIX: Record<string, string> = { GH_HOST: "github.example.com", AWS_REGION: "eu-central-1", GITHUB_REPOSITORY: "acme-org/widget-repo", DOCKER_HOST: "unix:///var/run/docker.sock", FM_HOME: "/home/captain/firstmate", HERDR_MODE: "autopilot-on", GITHUB_EVENT_NAME: "pull_request" };
for (const [k, v] of Object.entries(PREFIX)) process.env[k] = v;
{ const text = Object.entries(PREFIX).map(([k, v]) => `${k}=${v} and ${k}: ${v} and ${JSON.stringify({ [k]: v })} and plain ${v}`).join("\n");
  const r = sec.redactText(text);
  ok(r === text && Object.entries(PREFIX).every(([k]) => !sec.isCredentialName(k)), "a prefix-only name (GH_, AWS_, GITHUB_, DOCKER_, FM_, HERDR_) is no credential name: its value stays visible, in the environment and in text", r === text ? "" : r.slice(0, 300)); }
for (const k of Object.keys(PREFIX)) delete process.env[k];

// ---------- rule 3: code identifiers stay ----------
const CODE = ["password: true", "secret: null", "token: 12345", "token: \"\"", "session: undefined", "\"token\": 4096", "\"password\": false",
  "token == expected", "max_tokens: 4096000", "\"max_tokens\": 4096000", "tokenizer: cl100k_base", "token_count = 12", "const token = \"\";", "password = null", "if (session) return", `commit ${"ab".repeat(20)} sha256 ${"cd".repeat(32)}`, "the session ended at noon"];
{ const changed = CODE.filter((k) => sec.redactText(k) !== k);
  ok(!changed.length, "the kept values under a credential name (true/false/null/undefined, small numbers, empty strings), comparisons, other names and hashes stay unchanged", JSON.stringify(changed.map((k) => [k, sec.redactText(k)]))); }

// ---------- rule 3: under a credential name security wins: code expressions, dotted tokens and bracketed values go too ----------
{ const UNDER: [string, string][] = [["token: getToken(),", "getToken()"], ["apiKey: process.env.API_KEY,", "process.env.API_KEY"], ["session: req.session,", "req.session"], ["token: v1.abcdef123", "v1.abcdef123"],
    ["secret: [one, two];", "[one, two]"], ["  password: hunter2;", "hunter2"], ["TOKEN=12345678", "12345678"]];
  const left = UNDER.filter(([t, v]) => sec.redactText(t).includes(v));
  const j = sec.redactJSON({ token: "getToken()", password: "", secret: 1234567, apiKey: 12345678 });
  ok(!left.length && j.token === M && j.password === "" && j.secret === 1234567 && j.apiKey === M, "under a credential name everything goes but true/false/null/undefined, a number under 8 digits and an empty string: code, dotted tokens, brackets too",
    JSON.stringify([left.map(([t]) => [t, sec.redactText(t)]), j])); }
// ---------- rule 3: a JSON string under a credential name always goes; ini and properties lines go ----------
{ const j = sec.redactJSON({ password: "1234567", pin_token: "123456", secret: "true", api_key: true, session_id: 1234, token: null });
  ok(j.password === M && j.pin_token === M && j.secret === M && j.api_key === true && j.session_id === 1234 && j.token === null, "a JSON string under a credential name always goes (\"1234567\", \"123456\", \"true\": a PIN is a secret); only the types boolean, null and short numbers stay", JSON.stringify(j));
  const INI: [string, string][] = [["password = hunter2longvalue", "hunter2longvalue"], ["db.password = s3cret pass phrase", "s3cret pass phrase"], ["spring.datasource.password=letmein123", "letmein123"], ["  client_secret =  zzz9yyy8", "zzz9yyy8"], ["[client]\npassword = my.cnf-secret", "my.cnf-secret"]];
  const left = INI.filter(([t, v]) => sec.redactText(t).includes(v));
  const SRC: [string, string][] = [["token = getToken()", "getToken()"], ["api_key = process.env.KEY", "process.env.KEY"], ["password = await vault.read(name)", "vault.read"], ["password = P4ss.word", "P4ss.word"], ["password = hunter2(prod)", "hunter2(prod)"],
    ["const token = getToken();", "getToken()"], ["const apiKey = process.env.API_KEY;", "process.env.API_KEY"], ["token = await fetchToken(user)", "fetchToken"], ["password = input.value", "input.value"], ["  export const secret = s3cr3t.v4lue;", "s3cr3t.v4lue"]];
  const leftSrc = SRC.filter(([t, v]) => sec.redactText(t).includes(v));
  ok(!left.length && !leftSrc.length && typeof (sec as any).isSourceExpression === "undefined", "a name = value line under a credential name (ini, properties, my.cnf, or source) goes whatever its right side looks like: P4ss.word, hunter2(prod), getToken(), process.env.X; there is no source-code exemption",
    JSON.stringify([left.map(([t]) => [t, sec.redactText(t)]), leftSrc.map(([t]) => [t, sec.redactText(t)])])); }
// ---------- rule 3: a YAML or header line under a credential name with a data value goes ----------
{ const HDR: [string, string][] = [["token: abc123def456", "abc123def456"], ["Authorization: Bearer abcdefgh123", "abcdefgh123"], ["password: correct horse battery staple", "correct horse battery staple"], ["  api_key: k9f8e7d6c5", "k9f8e7d6c5"]];
  const left = HDR.filter(([t, v]) => sec.redactText(t).includes(v));
  ok(!left.length, "a YAML or header line under a credential name with a data value (a scalar, a passphrase, a bearer token) is redacted", JSON.stringify(left.map(([t]) => [t, sec.redactText(t)]))); }
ok(typeof sec.isCredentialName === "function" && sec.SECRET_KEY === undefined && ["STRIPE_KEY", "SSH_PRIVATE_KEY", "DB_CREDENTIALS"].every(sec.isCredentialName) && !["GH_HOST", "AWS_REGION", "primary_key", "max_tokens"].some(sec.isCredentialName),
  "the name rule is one plain function (no RegExp that matches anything): env *_KEY, *_CREDENTIAL(S) and PRIVATE names count; prefix-only and ordinary names do not");

// ---------- rule 4: known formats anywhere ----------
{ const F = ["sk-ant-api03-AbCdEfGh_IjKl", "sk-proj-AbCdEfGhIjKlMnOpQr12", "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2", "github_pat_" + "11AAAAAAA0abcdefghijklmn", "xoxb-1234567890-abcdefghij", "AKIAABCDEFGHIJKLMNOP", "crsr_" + "0123456789abcdefABCDEF".repeat(3), "key_" + "0123456789abcdef".repeat(4), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"];
  const left = F.filter((f) => sec.redactText(`see ${f} here`).includes(f));
  ok(!left.length, "a known credential format is removed anywhere in a text, with no name around it", JSON.stringify(left)); }
ok(sec.redactText("the crsr_prefix and crsr_short stay") === "the crsr_prefix and crsr_short stay", "a word that only starts like a Cursor key (crsr_ under 32 characters) stays");
ok(sec.redactText("api_key_" + "a".repeat(40) + " and key_short stay") === "api_key_" + "a".repeat(40) + " and key_short stay", "a name ending in key_ and a short key_ word stay (only a whole older key_… Cursor key is removed)");

// ---------- rule 1: known values ----------
{ process.env.CREW_GITHUB_TOKEN = "aGVsbG8v/d29ybGQ+Zm9vYmFy=="; process.env.BOARD_SECRET = "board secret with spaces 42"; process.env.SHORT_TOKEN = "abc1234";
  const t = sec.redactText(`a ${process.env.CREW_GITHUB_TOKEN} b ${process.env.BOARD_SECRET} c ${process.env.SHORT_TOKEN} d`);
  ok(!t.includes("aGVsbG8v") && !t.includes("board secret with spaces") && t.includes("abc1234"), "a credential-named variable's value is removed wherever it appears, whatever its characters; a value shorter than SECRET_MIN is left alone", t);
  delete process.env.CREW_GITHUB_TOKEN; delete process.env.BOARD_SECRET; delete process.env.SHORT_TOKEN; }
ok(sec.redactText("call with tok-7f3a9c2e5b8d1f40aa here", ["tok-7f3a9c2e5b8d1f40aa"]) === `call with ${M} here`, "a round's own token, passed as extra, is removed");
{ const { setKeysDir, saveKeys } = await import("../src/keys"); const kd = mkdtempSync(join(tmpdir(), "crew-keys-")); setKeysDir(kd); saveKeys({ openai: "plain-key-store-value-77" });
  ok(sec.redactText("x plain-key-store-value-77 y") === `x ${M} y`, "the key store's values are registered"); }
// Studio's GitHub token, from each place it reads it: env, its settings file, `gh auth token`
{ const gh: any = await import("../src/github"); const d = mkdtempSync(join(tmpdir(), "crew-gh-"));
  const saved = { a: process.env.CREW_GITHUB_TOKEN, b: process.env.GITHUB_TOKEN, c: process.env.GH_TOKEN, n: process.env.CREW_GH_NO_CLI };
  for (const k of ["CREW_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GH_NO_CLI"]) delete process.env[k];
  const fake = join(d, "gh"); writeFileSync(fake, "#!/bin/sh\necho gho-fixture-token-from-gh-cli-1234\n"); chmodSync(fake, 0o755);
  const r1 = gh.findToken(d, fake);
  const viaCli = r1.source === "gh" && sec.redactText("t gho-fixture-token-from-gh-cli-1234 t") === `t ${M} t`;
  writeFileSync(join(d, "github-token"), "plain-settings-file-token-99\n"); const r2 = gh.findToken(d, fake);
  const viaFile = r2.source === "settings" && sec.redactText("t plain-settings-file-token-99 t") === `t ${M} t`;
  process.env.GH_TOKEN = "plain-env-gh-token-55"; const r3 = gh.findToken(d, fake);
  const viaEnv = r3.source === "env" && sec.redactText("t plain-env-gh-token-55 t") === `t ${M} t`;
  for (const [k, v] of [["CREW_GITHUB_TOKEN", saved.a], ["GITHUB_TOKEN", saved.b], ["GH_TOKEN", saved.c], ["CREW_GH_NO_CLI", saved.n]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  ok(viaCli && viaFile && viaEnv, "Studio's GitHub token is registered where it is read: from `gh auth token`, from its settings file, from the environment", JSON.stringify([viaCli, viaFile, viaEnv])); }

// ---------- the logins a round gets (src/providers/login.ts): Studio never reads a subscription login ----------
{ const { codexLogin, claudeLogin, claudeLoginStatus, claudeLoginPresence } = await import("../src/providers/login"); const { setKeysDir } = await import("../src/keys"); const fs = await import("node:fs");
  const keep = ["HOME", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CREW_CLAUDE_BILLING", "CREW_KEYCHAIN_TOOL", "ANTHROPIC_API_KEY", "CODEX_API_KEY", "CODEX_HOME"]; const saved = Object.fromEntries(keep.map((k) => [k, process.env[k]]));
  for (const k of keep) delete process.env[k];
  const home = mkdtempSync(join(tmpdir(), "crew-logins-")); process.env.HOME = home; const BAD = "Q".repeat(40) + "z9".repeat(26); const shown: string[] = [];
  const L = (x: any) => { shown.push(JSON.stringify(x)); return x; };
  // claude, subscription: the captain's own account, whatever lies around: no keychain call, no file read, no value handed on
  const kd = mkdtempSync(join(tmpdir(), "crew-kc-")), tool = join(kd, "security"), calls = join(kd, "calls");
  writeFileSync(tool, `#!/bin/sh\necho "$@" >> ${calls}\nprintf '%s' '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-never-read-abcdefghijklmnopqrstuvwxyz0123456789"}}'\n`); fs.chmodSync(tool, 0o755);
  process.env.CREW_KEYCHAIN_TOOL = tool; process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-env-token-never-handed-abcdefghijklmnopqrstuvwxyz";
  fs.mkdirSync(join(home, ".claude"), { recursive: true }); writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-file-never-read-abcdefghijklmnopqrstuvwxyz" } }), { mode: 0o600 });
  fs.mkdirSync(join(home, ".config", "crew-studio"), { recursive: true }); writeFileSync(join(home, ".config", "crew-studio", "claude-token"), "sk-ant-oat01-crew-file-never-read-abcdefghijklmnopqrstuvwxyz0123", { mode: 0o600 });
  const c = L(claudeLogin()), st = L(claudeLoginStatus()), pr = claudeLoginPresence();
  ok(c.ok && c.kind === "account" && JSON.stringify(c.env) === "{}" && /your own Claude sign-in/.test(c.source) && st.ok && st.kind === "account" && pr.ok && pr.kind === "account" && !fs.existsSync(calls) && !/sk-ant-oat01/.test(JSON.stringify([c, st])),
    "claude: the subscription is the captain's own account: no keychain item, credentials file, crew token or CLAUDE_CODE_OAUTH_TOKEN is read or handed on", JSON.stringify([c, st]));
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN; delete process.env.CREW_KEYCHAIN_TOOL;
  // API billing: Studio's environment, then the key Studio keeps; a wrong shape fails that source, the next is tried, no character shown
  const GOODKEY = "sk-ant-api03-shape-fixture-abcdefghijklmnopqrstuvwxyz";
  process.env.CREW_CLAUDE_BILLING = "api-key"; const kdir = mkdtempSync(join(tmpdir(), "crew-keys-")); setKeysDir(kdir); writeFileSync(join(kdir, "keys.json"), JSON.stringify({ anthropic: GOODKEY }));
  process.env.ANTHROPIC_API_KEY = BAD; const f = L(claudeLogin());
  ok(f.ok && f.kind === "api-key" && f.env.ANTHROPIC_API_KEY === GOODKEY && /ANTHROPIC_API_KEY in Studio's environment: it is not an Anthropic API key/.test(f.warn ?? ""), "shape: under API billing a wrong-shape ANTHROPIC_API_KEY moves on to the key Studio keeps", JSON.stringify(f.warn));
  ok(sec.redactText(`t ${GOODKEY} t`) === `t ${M} t`, "the API key Studio hands a round is registered with the redactor");
  writeFileSync(join(kdir, "keys.json"), JSON.stringify({ anthropic: BAD + "kept" })); const g = L(claudeLogin()), gs = L(claudeLoginStatus());
  ok(!g.ok && !gs.ok && g.error === gs.error && /no Anthropic API key works \(ANTHROPIC_API_KEY in Studio's environment: .*; the Anthropic key Studio keeps .*: it is not an Anthropic API key/.test(g.error), "shape: under API billing both keys of the wrong shape refuse the round, listing both reasons; the Doctor reports the same", g.error ?? "");
  delete process.env.ANTHROPIC_API_KEY; writeFileSync(join(kdir, "keys.json"), JSON.stringify({ anthropic: GOODKEY })); const h = L(claudeLogin());
  ok(h.ok && h.env.ANTHROPIC_API_KEY === GOODKEY && !h.warn, "shape: under API billing a well-formed kept key alone is used", JSON.stringify(h.source));
  setKeysDir(""); delete process.env.CREW_CLAUDE_BILLING;
  // codex: Studio's own CODEX_API_KEY in a private auth.json; else the captain's own codex home, which Studio never reads or copies
  const ch = join(home, ".codex"); fs.mkdirSync(ch, { recursive: true }); process.env.CODEX_HOME = ch;
  const own = JSON.stringify({ tokens: { access_token: "own-access-never-read", refresh_token: "own-refresh-never-read" } }); writeFileSync(join(ch, "auth.json"), own, { mode: 0o600 });
  const i = L(codexLogin(join(home, "r1")));
  ok(i.ok && i.kind === "account" && i.env.CODEX_HOME === ch && JSON.stringify(Object.keys(i.env)) === '["CODEX_HOME"]' && !fs.existsSync(join(home, "r1")) && fs.readFileSync(join(ch, "auth.json"), "utf8") === own && !JSON.stringify(i).includes("never-read"),
    "codex: the captain's own codex home, in place: nothing read, copied or written", JSON.stringify(i));
  process.env.CODEX_API_KEY = BAD; const j = L(codexLogin(join(home, "r2"))); delete process.env.CODEX_API_KEY;
  ok(j.ok && j.kind === "account" && /CODEX_API_KEY: it is not an OpenAI API key/.test(j.warn ?? "") && !fs.existsSync(join(home, "r2")), "shape: a wrong-shape CODEX_API_KEY moves on to the captain's own codex home", JSON.stringify(j));
  process.env.CODEX_API_KEY = "sk-codex-studio-key-fixture-0123456789"; const k = L(codexLogin(join(home, "r3"))); delete process.env.CODEX_API_KEY;
  const kf = join(home, "r3", "auth.json");
  ok(k.ok && k.kind === "api-key" && k.env.CODEX_HOME === join(home, "r3") && JSON.parse(fs.readFileSync(kf, "utf8")).OPENAI_API_KEY === "sk-codex-studio-key-fixture-0123456789" && (fs.statSync(kf).mode & 0o777) === 0o600 && sec.redactText("x sk-codex-studio-key-fixture-0123456789 y") === `x ${M} y`,
    "codex: Studio's own CODEX_API_KEY goes in a private auth.json (0600) of the round's own home, and is redacted", JSON.stringify(k));
  fs.rmSync(join(ch, "auth.json")); fs.symlinkSync(join(home, ".claude", ".credentials.json"), join(ch, "auth.json")); const sl = L(codexLogin(join(home, "r4")));
  fs.rmSync(join(ch, "auth.json")); process.env.CODEX_API_KEY = "   "; const none = L(codexLogin(join(home, "r5"))); delete process.env.CODEX_API_KEY;
  ok(!sl.ok && !none.ok && /no codex login for rounds works \(CODEX_API_KEY: it is set but empty; .*auth\.json is missing\)/.test(none.error) && /codex login/.test(none.error),
    "codex: refused when there is no plain login file (a symlink is none) and no key, saying why", JSON.stringify([sl, none]));
  const all = shown.join("\n");
  ok(!all.includes("QQQQ") && !all.includes("z9z9"), "shape: across every branch, no character of a wrong-shape value appears in any error or warning", all.match(/.{20}(QQQQ|z9z9).{20}/)?.[0] ?? "");
  for (const kk of keep) { if (saved[kk] === undefined) delete process.env[kk]; else process.env[kk] = saved[kk]; } }

// ---------- the server's registrations: a node run's record naming them is served without them ----------
{ const { spawn } = await import("node:child_process");
  const tmp = mkdtempSync(join(tmpdir(), "crew-secreg-")); const data = join(tmp, "data"); for (const x of ["state", "home", "proj"]) mkdirSync(join(tmp, x), { recursive: true });
  mkdirSync(data, { recursive: true });
  const GH = "plain-gh-file-token-1234567", LK = "plain-ledger-key-abcdefgh9", ST = "plain-session-token-zyxw987";
  writeFileSync(join(data, "github-token"), GH + "\n", { mode: 0o600 }); writeFileSync(join(data, "ledger.key"), LK, { mode: 0o600 }); writeFileSync(join(data, "session-token"), ST, { mode: 0o600 });
  const d = join(data, "runs", "R-001", "nodes", "make", "1"); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "prompt.md"), `---\nrun: "R-001"\nnode: "make"\nround: 1\n---\nhere are ${GH} and ${LK} and ${ST}\n`); writeFileSync(join(d, "system.md"), `sys ${GH}`);
  const port = await freePort(); const env: any = { ...process.env }; delete env.CREW_SESSION_TOKEN; delete env.CREW_GITHUB_TOKEN;
  const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_DATA: data, CREW_PORT: String(port), CREW_FM_STATE: join(tmp, "state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_SANDBOX: "0", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
  const base = `http://127.0.0.1:${port}`; await waitUp(base, app);
  const body = await (await fetch(`${base}/api/node-runs/R-001/make/1`, { headers: { "x-crew-session": ST } })).text(); app.kill();
  ok(body.length > 50 && ![GH, LK, ST].some((v) => body.includes(v)) && body.includes(M), "the server registers its file-held secrets (GitHub token file, ledger key, session token): a record naming them is served without them", body.slice(0, 300)); }
console.log(`\nsecret-registry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
