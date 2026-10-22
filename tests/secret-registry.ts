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
{ const F = ["sk-ant-api03-AbCdEfGh_IjKl", "sk-proj-AbCdEfGhIjKlMnOpQr12", "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2", "github_pat_" + "11AAAAAAA0abcdefghijklmn", "xoxb-1234567890-abcdefghij", "AKIAABCDEFGHIJKLMNOP", "crsr_" + "0123456789abcdefABCDEF".repeat(3), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"];
  const left = F.filter((f) => sec.redactText(`see ${f} here`).includes(f));
  ok(!left.length, "a known credential format is removed anywhere in a text, with no name around it", JSON.stringify(left)); }
ok(sec.redactText("the crsr_prefix and crsr_short stay") === "the crsr_prefix and crsr_short stay", "a word that only starts like a Cursor key (crsr_ under 32 characters) stays");

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

// ---------- the logins Studio hands a round (src/providers/login.ts, v1 option A) ----------
{ const { codexLogin, claudeLogin } = await import("../src/providers/login"); const { statSync, readFileSync, existsSync } = await import("node:fs");
  const saved = { home: process.env.CODEX_HOME, key: process.env.CODEX_API_KEY, oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN, bill: process.env.CREW_CLAUDE_BILLING };
  for (const k of ["CODEX_HOME", "CODEX_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CREW_CLAUDE_BILLING"]) delete process.env[k];
  const ch = mkdtempSync(join(tmpdir(), "crew-codexhome-")); process.env.CODEX_HOME = ch;
  writeFileSync(join(ch, "auth.json"), JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: "eyJhbGciOiJub25lIn0.eyJjb2RleGZpeHR1cmUiOjEyMzR9.c2lnbmF0dXJlZml4dHVyZTEyMzQ", refresh_token: "codex-refresh-fixture-token-5678", id_token: "codex-id-fixture-token-9012", account_id: "acct" } }));
  const round = mkdtempSync(join(tmpdir(), "crew-roundhome-")); const l = codexLogin(join(round, ".codex"));
  const copy = join(round, ".codex", "auth.json"); const body = readFileSync(copy, "utf8");
  const copiedLogin = JSON.parse(body);
  ok(l.ok && copiedLogin.tokens.refresh_token === "" && !body.includes("codex-refresh-fixture-token-5678") && copiedLogin.tokens.access_token === "eyJhbGciOiJub25lIn0.eyJjb2RleGZpeHR1cmUiOjEyMzR9.c2lnbmF0dXJlZml4dHVyZTEyMzQ" && JSON.stringify(Object.keys(copiedLogin).sort()) === JSON.stringify(["tokens"]) && JSON.stringify(Object.keys(copiedLogin.tokens).sort()) === JSON.stringify(["access_token", "account_id", "id_token", "refresh_token"]) && (statSync(copy).mode & 0o777) === 0o600, "codex: the round gets only allowlisted login fields, an empty CLI-required refresh field without its original secret, mode 600");
  ok(sec.redactText("x eyJhbGciOiJub25lIn0.eyJjb2RleGZpeHR1cmUiOjEyMzR9.c2lnbmF0dXJlZml4dHVyZTEyMzQ y codex-id-fixture-token-9012") === `x ${M} y ${M}`, "the login values Studio hands a round are registered with the redactor when it reads them");
  writeFileSync(join(ch, "auth.json"), JSON.stringify({ tokens: { access_token: "a-token-abcdefgh", refresh_token: "r", other: { refresh_token_v2: "still here" } } }));
  const l2 = codexLogin(join(round, ".codex2"));
  ok(!l2.ok && /still holds a refresh token/.test((l2 as any).error), "codex: a login that still holds a refresh token after the drop is refused, nothing handed", JSON.stringify(l2));
  process.env.CODEX_API_KEY = "   "; const l3 = codexLogin(join(round, ".codex3")); delete process.env.CODEX_API_KEY;
  ok(!l3.ok && /no codex login for rounds works \(CODEX_API_KEY: it is set but empty; .*auth\.json: .*still holds a refresh token/.test((l3 as any).error),
    "codex: refused only when every source fails, the refusal listing why each one did (an empty CODEX_API_KEY, a login file that keeps a refresh token)", JSON.stringify(l3));
  // Timestamp metadata is compatibility data, never authority to refresh a token.
  const stampDoc={auth_mode:"chatgpt",tokens:{access_token:"abcdefgh.abcdefgh.abcdefgh",refresh_token:"never-copy-refresh",id_token:"fixture-id",account_id:"fixture-account"},unknown:"never-copy-config",hooks:["never-copy-hook"]};
  for(const [n,stamp] of ["2001-01-01T00:00:00Z","2024-02-29T23:59:59.123456789-05:30","2026-10-15T08:09:10+08:00"].entries()){
    const source=JSON.stringify({...stampDoc,last_refresh:stamp});writeFileSync(join(ch,"auth.json"),source);const target=join(round,`valid-stamp-${n}`),login=codexLogin(target),copied=login.ok?JSON.parse(readFileSync(join(target,"auth.json"),"utf8")):null;
    ok(login.ok&&copied.last_refresh===stamp&&copied.tokens.refresh_token===""&&Object.keys(copied).sort().join(',')==="auth_mode,last_refresh,tokens"&&!JSON.stringify(copied).includes("never-copy")&&readFileSync(join(ch,"auth.json"),"utf8")===source&&(statSync(join(target,"auth.json")).mode&0o777)===0o600,"codex timestamp: valid original calendar/offset metadata copied exactly without refresh/config or source mutation");
  }
  for(const [n,stamp] of ["2023-02-29T00:00:00Z","2024-04-31T00:00:00Z","2024-01-01T24:00:00Z","2024-01-01T00:00:00+24:00","2024-01-01T00:00:00+00:60","2024-01-01", "not-a-date", "2024-01-01T00:00:00Z\n", {value:"2024-01-01T00:00:00Z"},null].entries()){
    const source=JSON.stringify({...stampDoc,last_refresh:stamp});writeFileSync(join(ch,"auth.json"),source);const target=join(round,`invalid-stamp-${n}`),login=codexLogin(target);
    ok(!login.ok&&!existsSync(join(target,"auth.json"))&&readFileSync(join(ch,"auth.json"),"utf8")===source,"codex timestamp: malformed calendar/type/time/offset refused before disposable credential write");
  }
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-claude-oauth-fixture-3456-abcdefghijklmnopqrstuvwxyz"; const c = claudeLogin();
  ok(c.ok && (c as any).env.CLAUDE_CODE_OAUTH_TOKEN === "sk-ant-oat01-claude-oauth-fixture-3456-abcdefghijklmnopqrstuvwxyz" && sec.redactText("t sk-ant-oat01-claude-oauth-fixture-3456-abcdefghijklmnopqrstuvwxyz t") === `t ${M} t`, "claude: a CLAUDE_CODE_OAUTH_TOKEN Studio holds is handed as is and redacted everywhere");
  for (const [k, v] of [["CODEX_HOME", saved.home], ["CODEX_API_KEY", saved.key], ["CLAUDE_CODE_OAUTH_TOKEN", saved.oauth], ["CREW_CLAUDE_BILLING", saved.bill]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }

// ---------- claudeLoginStatus mirrors claudeLogin (one resolver) ----------
{ const { claudeLogin, claudeLoginStatus } = await import("../src/providers/login"); const { chmodSync: ch } = await import("node:fs");
  const saved = { home: process.env.HOME, oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN, bill: process.env.CREW_CLAUDE_BILLING, tool: process.env.CREW_KEYCHAIN_TOOL };
  for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "CREW_CLAUDE_BILLING"]) delete process.env[k];
  const home = mkdtempSync(join(tmpdir(), "crew-loginhome-")); process.env.HOME = home;
  const kd = mkdtempSync(join(tmpdir(), "crew-kc2-")); const tool = join(kd, "security"); let ownJson = "";
  const setTool = (own: string | null) => { writeFileSync(tool, `#!/bin/sh\ncase "$*" in *Claude\\ Code-credentials*) ${own === null ? "exit 44" : `case "$*" in *-w*) printf '%s' '${own}';; esac; exit 0`};; esac\nexit 44\n`); ch(tool, 0o755); };
  process.env.CREW_KEYCHAIN_TOOL = tool; setTool(null);
  // an empty crew token file: both say so
  mkdirSync(join(home, ".config", "crew-studio"), { recursive: true }); writeFileSync(join(home, ".config", "crew-studio", "claude-token"), "", { mode: 0o600 });
  const a = claudeLogin(), b = claudeLoginStatus();
  ok(!a.ok && !b.ok && /is empty/.test((a as any).error) && (a as any).error === b.error, "an empty crew token file: the round's login and the Doctor's status report the same problem", JSON.stringify([a, b]));
  writeFileSync(join(home, ".config", "crew-studio", "claude-token"), "sk-ant-oat01-crew-file-fixture-12-abcdefghijklmnopqrstuvwxyz0123456789", { mode: 0o600 });
  const c = claudeLogin(), d = claudeLoginStatus();
  ok(c.ok && d.ok && (c as any).source === d.source, "a crew token file: both name the same source", JSON.stringify([(c as any).source, d.source]));
  (await import("node:fs")).rmSync(join(home, ".config", "crew-studio", "claude-token"));
  // the captain's own login: expired (the round reads it and refuses; the Doctor cannot decrypt it and says its expiry is checked when a round starts)
  setTool(JSON.stringify({ claudeAiOauth: { accessToken: "own-access-fixture-token-77", expiresAt: Date.now() - 60_000 } }));
  const e = claudeLogin(), f = claudeLoginStatus();
  ok(!e.ok && /has expired/.test((e as any).error) && f.ok && /expiry is checked when a round starts/.test(f.warn ?? ""), "the captain's own keychain login: the round refuses an expired token; the Doctor, which never decrypts it, says its expiry is checked when a round starts", JSON.stringify([e, f]));
  setTool(JSON.stringify({ claudeAiOauth: {} }));
  const g = claudeLogin(); ok(!g.ok && /holds no access token/.test((g as any).error), "an own login with no access token is refused", JSON.stringify(g));
  setTool(null); const h = claudeLogin(), i = claudeLoginStatus();
  ok(!h.ok && !i.ok && (h as any).error === i.error, "no login at all: both report the same problem", JSON.stringify([h, i]));
  // an error at one source moves on to the next: a crew keychain item that cannot be read (prompt denied) or is empty, then a valid file
  const tokFile = join(home, ".config", "crew-studio", "claude-token");
  for (const [how, body] of [["a denied keychain prompt", `echo "User interaction is not allowed." >&2; exit 51`], ["an empty keychain item", `printf ''; exit 0`]] as const) {
    writeFileSync(tool, `#!/bin/sh\ncase "$*" in *crew-studio-claude-token*-w*) ${body};; *crew-studio-claude-token*) exit 0;; esac\nexit 44\n`); ch(tool, 0o755);
    writeFileSync(tokFile, "sk-ant-oat01-crew-file-fixture-34-abcdefghijklmnopqrstuvwxyz0123456789", { mode: 0o600 });
    const j = claudeLogin();
    ok(j.ok && (j as any).env.CLAUDE_CODE_OAUTH_TOKEN === "sk-ant-oat01-crew-file-fixture-34-abcdefghijklmnopqrstuvwxyz0123456789" && /claude-token\)/.test((j as any).source) && /crew-studio-claude-token/.test((j as any).warn ?? ""),
      `${how} on the crew keychain item moves on: the valid crew token file is used (the failure named in a warning)`, JSON.stringify(j));
    (await import("node:fs")).rmSync(tokFile);
    writeFileSync(tool, `#!/bin/sh\ncase "$*" in *crew-studio-claude-token*-w*) ${body};; *crew-studio-claude-token*) exit 0;; *Claude\\ Code-credentials*-w*) printf '%s' '{"claudeAiOauth":{"accessToken":"own-access-fixture-token-88","expiresAt":1}}'; exit 0;; *Claude\\ Code-credentials*) exit 0;; esac\nexit 44\n`); ch(tool, 0o755);
    const k = claudeLogin();
    ok(!k.ok && /crew-studio-claude-token: .*(could not be read|is empty)/.test((k as any).error) && /Claude Code-credentials\): .*has expired/.test((k as any).error),
      `${how}, then an expired own login: refused only when every source fails, listing why each one failed`, JSON.stringify(k)); }
  // the Doctor never decrypts the crew keychain item: present is not OK; it says the content is checked when a round starts,
  // and once a round has tried it, shows that round's outcome (persisted per source, names and errors only)
  { const { setLoginOutcomeFile } = await import("../src/providers/login"); const of = join(home, "login-outcomes.json"); setLoginOutcomeFile(of);
    writeFileSync(tool, `#!/bin/sh\ncase "$*" in *crew-studio-claude-token*-w*) printf ''; exit 0;; *crew-studio-claude-token*) exit 0;; esac\nexit 44\n`); ch(tool, 0o755);
    const before = claudeLoginStatus();
    ok(before.ok && before.verified === false && /crew keychain item present, but its content is checked when a round starts/.test(before.warn ?? ""), "an untried crew keychain item: the Doctor says it is present but its content is checked when a round starts (never a plain OK)", JSON.stringify(before));
    const round = claudeLogin(); const after = claudeLoginStatus();
    ok(!round.ok && !after.ok && /crew-studio-claude-token' is empty \(the last round, /.test(after.error ?? "") && !(await import("node:fs")).readFileSync(of, "utf8").includes("sk-ant"),
      "after a round found the crew keychain item empty (and no later source works), the Doctor shows that failure instead of OK; the outcome file holds no value", JSON.stringify([round, after]));
    writeFileSync(tokFile, "sk-ant-oat01-crew-file-fixture-56-abcdefghijklmnopqrstuvwxyz0123456789", { mode: 0o600 });
    const later = claudeLoginStatus();
    ok(later.ok && /claude-token\)/.test(later.source ?? ""), "with the keychain item's last round failed and a valid crew token file, the Doctor names the file (as the round would use it)", JSON.stringify(later));
    // a value that is not a setup-token result (92 characters, the shape of a one-time browser code): that source fails, the next is tried;
    // with none left the round is refused with what was expected, and not one character of the value appears anywhere
    const FAKE = "Q".repeat(40) + "z9".repeat(26); (await import("node:fs")).rmSync(tokFile); (await import("node:fs")).rmSync(of, { force: true });
    writeFileSync(tool, `#!/bin/sh\ncase "$*" in *crew-studio-claude-token*-w*) printf '%s' '${FAKE}'; exit 0;; *crew-studio-claude-token*) exit 0;; esac\nexit 44\n`); ch(tool, 0o755);
    const bad = claudeLogin(); const badSt = claudeLoginStatus(); const seenAll = JSON.stringify([bad, badSt]) + (await import("node:fs")).readFileSync(of, "utf8");
    ok(FAKE.length === 92 && !bad.ok && /crew token is not a claude setup-token result \(expected sk-ant-oat01-…\)/.test((bad as any).error) && !badSt.ok && /not a claude setup-token result/.test(badSt.error ?? "")
      && !seenAll.includes("QQQQ") && !seenAll.includes("z9z9"), "a 92-character crew token that is no setup-token result is refused before the round starts, the Doctor shows the same from the last round, and no character of it is shown", seenAll.slice(0, 400));
    writeFileSync(tokFile, FAKE, { mode: 0o600 }); const fst = claudeLoginStatus();
    ok(!fst.ok && /claude-token: crew token is not a claude setup-token result/.test(fst.error ?? "") && !JSON.stringify(fst).includes("QQQQ"), "a crew token file of the wrong shape: the Doctor reads the file (it asks no one) and shows the shape failure", JSON.stringify(fst));
    writeFileSync(tokFile, "sk-ant-oat01-crew-file-fixture-78-abcdefghijklmnopqrstuvwxyz0123456789", { mode: 0o600 }); const good = claudeLogin();
    ok(good.ok && /claude-token\)/.test((good as any).source) && /not a claude setup-token result/.test((good as any).warn ?? ""), "a wrong-shape keychain token moves on to a well-formed crew token file", JSON.stringify(good).replace(/sk-ant-oat01-[\w-]+/g, "<tok>"));
    // a round signs in with the crew keychain item: from then on the Doctor calls it verified
    (await import("node:fs")).rmSync(tokFile); (await import("node:fs")).rmSync(of, { force: true });
    writeFileSync(tool, `#!/bin/sh\ncase "$*" in *crew-studio-claude-token*-w*) printf '%s' 'sk-ant-oat01-crew-keychain-fixture-90-abcdefghijklmnopqrstuvwxyz0123456789'; exit 0;; *crew-studio-claude-token*) exit 0;; esac\nexit 44\n`); ch(tool, 0o755);
    const pre = claudeLoginStatus(); const signed = claudeLogin(); const post = claudeLoginStatus();
    ok(pre.ok && pre.verified === false && signed.ok && post.ok && post.verified === true && !post.warn, "a crew keychain item is unverified until a round signs in with it, verified after", JSON.stringify([pre, post]));
    setLoginOutcomeFile(null); }
  for (const [k, v] of [["HOME", saved.home], ["CLAUDE_CODE_OAUTH_TOKEN", saved.oauth], ["CREW_CLAUDE_BILLING", saved.bill], ["CREW_KEYCHAIN_TOOL", saved.tool]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }

// ---------- every shape check outside the crew keychain token: a wrong shape fails that source, the next is tried, no character shown ----------
{ const { claudeLogin, codexLogin, setLoginOutcomeFile } = await import("../src/providers/login"); const { setKeysDir } = await import("../src/keys"); const fs = await import("node:fs");
  const keep = ["HOME", "CLAUDE_CODE_OAUTH_TOKEN", "CREW_CLAUDE_BILLING", "CREW_KEYCHAIN_TOOL", "ANTHROPIC_API_KEY", "CODEX_API_KEY", "CODEX_HOME"]; const saved = Object.fromEntries(keep.map((k) => [k, process.env[k]]));
  for (const k of keep) delete process.env[k]; setLoginOutcomeFile(null);
  const home = mkdtempSync(join(tmpdir(), "crew-shapes-")); process.env.HOME = home; const BAD = "Q".repeat(40) + "z9".repeat(26); const shown: string[] = [];
  const GOOD = "sk-ant-oat01-shape-fixture-abcdefghijklmnopqrstuvwxyz0123456789", GOODKEY = "sk-ant-api03-shape-fixture-abcdefghijklmnopqrstuvwxyz";
  const kd = mkdtempSync(join(tmpdir(), "crew-kc3-")); const tool = join(kd, "security");
  const own = (tok: string) => { writeFileSync(tool, `#!/bin/sh\ncase "$*" in *Claude\\ Code-credentials*-w*) printf '%s' '${JSON.stringify({ claudeAiOauth: { accessToken: tok, expiresAt: Date.now() + 3_600_000 } })}'; exit 0;; *Claude\\ Code-credentials*) exit 0;; esac\nexit 44\n`); fs.chmodSync(tool, 0o755); };
  const L = (x: any) => { shown.push(JSON.stringify(x)); return x; };
  // the crew token file
  process.env.CREW_KEYCHAIN_TOOL = tool; own(BAD); fs.mkdirSync(join(home, ".config", "crew-studio"), { recursive: true }); const tf = join(home, ".config", "crew-studio", "claude-token");
  writeFileSync(tf, BAD, { mode: 0o600 }); const a = L(claudeLogin());
  ok(!a.ok && /claude-token: crew token is not a claude setup-token result/.test(a.error) && /Claude Code-credentials\): your claude login's access token is not a claude OAuth token/.test(a.error),
    "shape: a crew token file of the wrong shape fails, the next source (own keychain login) is tried, and a wrong-shape own keychain token fails too: both reasons listed", a.error ?? "");
  own(GOOD); const b = L(claudeLogin());
  ok(b.ok && b.env.CLAUDE_CODE_OAUTH_TOKEN === GOOD && /own claude login/.test(b.source) && /claude-token: crew token is not/.test(b.warn ?? ""), "shape: past a wrong-shape crew file, a well-formed own keychain login is used", JSON.stringify(b.source));
  fs.rmSync(tf);
  // the own credentials file (where there is no keychain)
  process.env.CREW_KEYCHAIN_TOOL = "none"; fs.mkdirSync(join(home, ".claude"), { recursive: true }); const cf = join(home, ".claude", ".credentials.json");
  writeFileSync(cf, JSON.stringify({ claudeAiOauth: { accessToken: BAD, expiresAt: Date.now() + 3_600_000 } }), { mode: 0o600 }); const c = L(claudeLogin());
  ok(!c.ok && /\.credentials\.json\): your claude login's access token is not a claude OAuth token/.test(c.error), "shape: a wrong-shape token in the own credentials file is refused", c.error ?? "");
  writeFileSync(cf, JSON.stringify({ claudeAiOauth: { accessToken: GOOD, expiresAt: Date.now() + 3_600_000 } }), { mode: 0o600 }); const d = L(claudeLogin());
  ok(d.ok && d.env.CLAUDE_CODE_OAUTH_TOKEN === GOOD, "shape: a well-formed own credentials file is used", JSON.stringify(d.source));
  fs.rmSync(cf);
  // CLAUDE_CODE_OAUTH_TOKEN in Studio's environment
  process.env.CLAUDE_CODE_OAUTH_TOKEN = BAD; writeFileSync(tf, GOOD, { mode: 0o600 }); const e = L(claudeLogin()); delete process.env.CLAUDE_CODE_OAUTH_TOKEN; fs.rmSync(tf);
  ok(e.ok && e.env.CLAUDE_CODE_OAUTH_TOKEN === GOOD && /CLAUDE_CODE_OAUTH_TOKEN in Studio's environment: it is not a claude OAuth token/.test(e.warn ?? ""), "shape: a wrong-shape CLAUDE_CODE_OAUTH_TOKEN moves on to the crew file", JSON.stringify(e.warn));
  // API billing: Studio's environment, then the key Studio keeps
  process.env.CREW_CLAUDE_BILLING = "api-key"; const kdir = mkdtempSync(join(tmpdir(), "crew-keys-")); setKeysDir(kdir); writeFileSync(join(kdir, "keys.json"), JSON.stringify({ anthropic: GOODKEY }));
  process.env.ANTHROPIC_API_KEY = BAD; const f = L(claudeLogin());
  ok(f.ok && f.env.ANTHROPIC_API_KEY === GOODKEY && /ANTHROPIC_API_KEY in Studio's environment: it is not an Anthropic API key/.test(f.warn ?? ""), "shape: under API billing a wrong-shape ANTHROPIC_API_KEY moves on to the key Studio keeps", JSON.stringify(f.warn));
  writeFileSync(join(kdir, "keys.json"), JSON.stringify({ anthropic: BAD + "kept" })); const g = L(claudeLogin());
  ok(!g.ok && /no Anthropic API key works \(ANTHROPIC_API_KEY in Studio's environment: .*; the Anthropic key Studio keeps .*: it is not an Anthropic API key/.test(g.error), "shape: under API billing both keys of the wrong shape refuse the round, listing both reasons", g.error ?? "");
  delete process.env.ANTHROPIC_API_KEY; writeFileSync(join(kdir, "keys.json"), JSON.stringify({ anthropic: GOODKEY })); const h = L(claudeLogin());
  ok(h.ok && h.env.ANTHROPIC_API_KEY === GOODKEY && !h.warn, "shape: under API billing a well-formed kept key alone is used", JSON.stringify(h.source));
  setKeysDir(""); delete process.env.CREW_CLAUDE_BILLING;
  // codex: CODEX_API_KEY, then auth.json (its access token a JWT, its OPENAI_API_KEY sk-…)
  const ch = join(home, ".codex"); fs.mkdirSync(ch, { recursive: true }); process.env.CODEX_HOME = ch; const JWT = "eyJhbGciOiJub25lIn0.eyJzaGFwZWZpeHR1cmUiOjF9.c2hhcGVzaWduYXR1cmUx";
  process.env.CODEX_API_KEY = BAD; writeFileSync(join(ch, "auth.json"), JSON.stringify({ tokens: { access_token: JWT } })); const i = L(codexLogin(join(home, "r1")));
  ok(i.ok && i.env.CODEX_HOME, "shape: a wrong-shape CODEX_API_KEY moves on to a well-formed codex login file", JSON.stringify(i));
  writeFileSync(join(ch, "auth.json"), JSON.stringify({ tokens: { access_token: BAD } })); const j = L(codexLogin(join(home, "r2")));
  ok(!j.ok && /CODEX_API_KEY: it is not an OpenAI API key .*auth\.json: its access token is not a codex login token/.test(j.error), "shape: a wrong-shape CODEX_API_KEY and a login file whose access token is no JWT refuse the round, listing both", j.error ?? "");
  delete process.env.CODEX_API_KEY; writeFileSync(join(ch, "auth.json"), JSON.stringify({ OPENAI_API_KEY: BAD })); const k = L(codexLogin(join(home, "r3")));
  ok(!k.ok && /its OPENAI_API_KEY is not an OpenAI API key/.test(k.error), "shape: a codex login file whose OPENAI_API_KEY is not one is refused", k.error ?? "");
  writeFileSync(join(ch, "auth.json"), JSON.stringify({ tokens: { id_token: JWT }, OPENAI_API_KEY: null })); const k2 = L(codexLogin(join(home, "r4")));
  ok(!k2.ok && /auth\.json: it holds no access token and no API key/.test(k2.error) && !fs.existsSync(join(home, "r4", "auth.json")), "codex: a login file with neither an access token nor an OPENAI_API_KEY is refused, nothing copied", k2.error ?? "");
  // the Doctor's probe of the captain's own keychain login: present and unverified, verified after a round signed in, failed after a round was refused
  delete process.env.CODEX_HOME; process.env.CREW_KEYCHAIN_TOOL = tool; const { claudeLoginStatus } = await import("../src/providers/login"); const of = join(home, "outcomes.json"); setLoginOutcomeFile(of);
  own(GOOD); const s1 = L(claudeLoginStatus());
  ok(s1.ok && s1.verified === false && /own claude login/.test(s1.source ?? "") && /its expiry is checked when a round starts/.test(s1.warn ?? ""), "Doctor, own keychain login: a present item no round has used is unverified (warn), its expiry checked when a round starts", JSON.stringify(s1));
  const r1 = claudeLogin(); const s2 = L(claudeLoginStatus());
  ok(r1.ok && s2.ok && s2.verified === true && !/expiry is checked/.test(s2.warn ?? ""), "Doctor, own keychain login: verified once a round signed in with it", JSON.stringify(s2));
  own(BAD); const r2 = L(claudeLogin()); const s3 = L(claudeLoginStatus());
  ok(!r2.ok && !s3.ok && /your claude login's access token is not a claude OAuth token \(expected sk-ant-oat01-…\) \(the last round, /.test(s3.error ?? ""), "Doctor, own keychain login: failed when the last round was refused (here a wrong-shape token) and nothing later works", JSON.stringify(s3));
  setLoginOutcomeFile(null);
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
