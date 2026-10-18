// Least authority, in one place (docs/architecture.md §1.8, §10):
//   roundEnv / scrubEnv   what an agent round or a child tool may see of the environment:
//                         an allowlist for rounds, plus only the keys the round's own
//                         provider declares; never a credential for anything else
import { existsSync as _exists, realpathSync as _real } from "node:fs";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { canCopyByDescriptor, copyByDescriptor } from "./untrusted-copy";
import { basename as _base, dirname as _dir, join as _join, resolve as _resolve, sep as _sep } from "node:path";

/** Names that carry credentials. */
export const SECRET_NAME = /TOKEN|SECRET|PASSW(OR)?D|CREDENTIAL|PRIVATE|API_?KEY|_KEY$|^(GH|GITHUB|GITLAB|AWS|AZURE|GOOGLE|GCP|NPM|DOCKER|SSH)_|^FM_|^HERDR|^CREW_(BOARD|GITHUB|TOOL)/i;
/** What an agent round may see: the login basics, nothing else. */
const ROUND_ALLOW = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TZ", "COLORTERM", "NO_COLOR"];

/**
 * The environment of an agent round: the allowlist, plus the variables the round's
 * own provider declares it needs (its own key and config, e.g. claude's
 * ANTHROPIC_API_KEY), plus what Studio adds for the round (its tool URL and token).
 */
export function roundEnv(providerKeys: string[] = [], add: Record<string, string> = {}, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ROUND_ALLOW) if (base[k] !== undefined) out[k] = base[k]!;
  for (const k of providerKeys) if (base[k] !== undefined) out[k] = base[k]!;
  return { ...out, ...add };
}
/** The environment of a non-agent child tool (git, the renderer): everything except credentials. */
export function scrubEnv(base: Record<string, string | undefined> = process.env, keep: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    // Proxy variable names do not match SECRET_NAME, but URL userinfo is a credential.
    // Drop the whole setting: stripping userinfo would silently change proxy authority.
    if (/^(?:https?|all|ftp|socks)_proxy$/i.test(k)) {
      try { const url = new URL(v); if (url.username || url.password) continue; }
      catch { if (v.includes("@")) continue; }
    }
    if (keep.includes(k) || !SECRET_NAME.test(k)) out[k] = v;
  }
  return out;
}

// ---------- path containment on real paths ----------
/** The real path of p; for a path that does not exist yet, the real path of its nearest existing ancestor plus the rest. */
export function realOf(p: string): string {
  let d = _resolve(p); const tail: string[] = [];
  while (!_exists(d)) { const parent = _dir(d); if (parent === d) break; tail.unshift(_base(d)); d = parent; }
  let r = d; try { r = _real(d); } catch {}
  return tail.length ? _join(r, ...tail) : r;
}
/** p is under root (or root itself with allowEqual), comparing real paths. */
export function realInside(root: string, p: string, allowEqual = false): boolean {
  const r = realOf(root), a = realOf(p);
  return (allowEqual && a === r) || a.startsWith(r.endsWith(_sep) ? r : r + _sep);
}

// ---------- the secret registry: one place that knows what a credential looks like ----------
// Names (SECRET_NAME for what a round's environment may see, isCredentialName for what is redacted:
// JSON keys, headers, front matter), value shapes of real formats (SECRET_VALUE),
// and Studio's own secret values: its environment, by name, and the file-held secrets
// their owners register (the key store, the GitHub token file, the ledger key, the
// session token). redactText/redactJSON are what every text written or shown from a
// round passes through: its prompt and record, the agent log, transcript viewers.
/**
 * Redaction rules (unit redaction-rules; explicit, no shape guessing):
 * 1. Known values, always, whatever their characters (8+): the values of environment
 *    variables with a credential name, every file-held secret its owner registers, a
 *    round's own token (`extra`).
 * 2. A credential name is one of CREDENTIAL_WORDS, as the whole name or its last word
 *    (GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, apiKey, X-API-Key), and for an UPPER_SNAKE
 *    name any *_KEY or a name containing PRIVATE. A prefix alone (GH_, AWS_, GITHUB_,
 *    DOCKER_, FM_, HERDR_) is not one: GH_HOST, AWS_REGION stay visible.
 * 3. Under a credential name, security wins over readability: in a JSON key, a
 *    NAME=value assignment, a `name = value` line (ini, properties, my.cnf, or a source
 *    assignment), a `Name: value` header or YAML line, or `name = "literal"` in source,
 *    the value is redacted unless it is exactly true, false, null, undefined, a bare
 *    number under 8 digits, or an empty string (a JSON string: only an empty one).
 *    Code expressions (`getToken()`, `process.env.X`, `hunter2(prod)`), dotted tokens
 *    and values with brackets go too: a false positive under a credential name costs
 *    readability; a false negative leaks a secret. There is no source-code exemption.
 * 4. Known formats anywhere (sk-ant-, sk-, gh*_, github_pat_, xox*, AKIA, JWT, PEM), as a backstop.
 */
export const CREDENTIAL_WORDS = ["PASSWORD", "PASSWD", "SECRET", "TOKEN", "API_KEY", "APIKEY", "ACCESS_KEY", "PRIVATE_KEY", "CLIENT_SECRET", "AUTHORIZATION", "COOKIE", "SESSION", "SESSION_ID", "CREDENTIAL", "CREDENTIALS"];
const normName = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
/** Is this the name of a credential (rule 2)? */
export function isCredentialName(name: string): boolean {
  const raw = String(name ?? ""); const n = normName(raw); if (!n) return false;
  if (CREDENTIAL_WORDS.some((w) => n === w || n.endsWith(`_${w}`)) || /^(PROXY_)?AUTHORIZATION$/.test(n)) return true;
  // an environment-style name (UPPER_SNAKE): any *_KEY (STRIPE_KEY, SIGNING_KEY), and any name with PRIVATE in it (SSH_PRIVATE_KEY)
  return /^[A-Z][A-Z0-9_]*$/.test(raw) && (/_KEY$/.test(raw) || /PRIVATE/.test(raw));
}
/** Values that are credentials by their format alone (rule 4). */
export const SECRET_VALUE: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g, /\bsk-(proj-)?[A-Za-z0-9_-]{16,}/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
/** The one marker a removed credential leaves (the pinned spec's words). */
export const REDACTED = "[credential removed]";
const valueSources: (() => (string | null | undefined)[])[] = [];
/** Whoever reads a credential registers it there, at the moment it reads it (rule 1). */
export function registerSecretValues(f: () => (string | null | undefined)[]) { valueSources.push(f); }
/** Shorter values are never treated as known secrets (they would wipe ordinary text). */
export const SECRET_MIN = 8;
/** The values of Studio's own secrets (rule 1): credential-named variables, registered file-held secrets, `extra`. */
export function secretValues(env: Record<string, string | undefined> = process.env, extra: (string | null | undefined)[] = []): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => { const t = v == null ? "" : String(v).trim(); if (t.length >= SECRET_MIN) out.add(t); };
  for (const [k, v] of Object.entries(env)) if (isCredentialName(k)) add(v);
  for (const f of valueSources) { try { for (const v of f()) add(v); } catch {} }
  for (const v of extra) add(v);
  return [...out].sort((a, b) => b.length - a.length);
}
const N = "[A-Za-z_][A-Za-z0-9_.-]*";
const rx = (src: string, flags: string) => new RegExp(src.replaceAll("NAME", N), flags);
const NAMED: { re: RegExp; name: (m: string[]) => string }[] = [
  // "name": "value"  (JSON or a quoted key)
  { re: rx(/(["'](NAME)["']\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.source, "g"), name: (m) => m[2] },
  // NAME=value (env style, no spaces), value to the next space, or quoted
  { re: rx(/(\b(NAME)=)("[^"]*"|'[^']*'|[^\s"'&;]+)/.source, "g"), name: (m) => m[2] },
  // name = "literal"  (source text: only a string literal is a value, never an expression)
  { re: rx(/(\b(NAME)\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/.source, "g"), name: (m) => m[2] },
  // name = value  (an ini, properties or my.cnf line, or a source assignment, `const token = getToken();`: the rest of the line goes,
  // whatever it looks like; security wins over readable source under a credential name)
  { re: rx(/(^[ \t]*(?:(?:export[ \t]+)?(?:const|let|var|val|final)[ \t]+)?(NAME)[ \t]*=(?!=)[ \t]*)([^\n]*?)(?=;?[ \t]*$)/.source, "gm"), name: (m) => m[2] },
  // Name: value  (a header or YAML line: the key starts the line, the value is the rest of it)
  { re: rx(/(^[ \t-]*(NAME)[ \t]*:[ \t]+)([^\n]+)/.source, "gm"), name: (m) => m[2] },
  // Bearer <token>
  { re: /(\b[Bb]earer\s+)()([A-Za-z0-9._~+\/=-]{8,})/g, name: () => "AUTHORIZATION" },
];
/** Under a credential name, the only values left visible (rule 3): true, false, null, undefined, a bare number under 8 digits, an empty string. */
export function keptUnderName(v: string): boolean {
  const t = v.trim().replace(/,\s*$/, "");
  return t === "" || t === '""' || t === "''" || /^(true|false|null|undefined)$/.test(t) || /^-?\d{1,7}$/.test(t);
}
const quoteKeep = (v: string) => (/^["'\x60]/.test(v) ? `${v[0]}${REDACTED}${v[v.length - 1]}` : REDACTED);
/** Hide every credential in a text by the rules above. */
export function redactText(s: string, extra: (string | null | undefined)[] = []): string {
  let out = String(s);
  for (const v of secretValues(process.env, extra)) if (out.includes(v)) out = out.split(v).join(REDACTED);
  for (const re of SECRET_VALUE) out = out.replace(re, REDACTED);
  for (const { re, name } of NAMED) out = out.replace(re, (...a: any[]) => { const m = a.slice(0, -2) as string[]; const whole = a[0], pre = a[1], value = a[3];
    const nm = name(m); if (!isCredentialName(nm) || value === undefined || value.includes(REDACTED) || keptUnderName(value)) return whole; return `${pre}${quoteKeep(value)}`; });
  return out;
}
/** Hide credentials in structured data: a string value under a credential name (any depth), and every string by redactText. */
export function redactJSON(v: unknown, key = ""): any {
  // a JSON string under a credential name always goes ("1234", "true": a PIN is a secret), only an empty one stays; the keep list applies to the TYPES boolean, null and short numbers
  if (typeof v === "string") return key && isCredentialName(key) && v !== "" ? REDACTED : redactText(v);
  if (typeof v === "number" && key && isCredentialName(key) && !/^-?\d{1,7}$/.test(String(v))) return REDACTED; // a long number under a credential name
  if (Array.isArray(v)) return v.map((x) => redactJSON(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactJSON(x, isCredentialName(k) ? k : "")]));
  return v;
}
/** Does the text hold something credential-shaped (the gates' secret check)? */
export const looksSecret = (t: string) => SECRET_VALUE.some((re) => { re.lastIndex = 0; const hit = re.test(t); re.lastIndex = 0; return hit; });

/**
 * Copy what an untrusted process wrote (a build's out/) into a folder Studio then reads: regular files and folders
 * only. A symlink (at any level), a hard link (more than one name), a device or a socket is refused, never followed.
 * On macOS every level is opened by descriptor (src/untrusted-copy.ts). Caps: files, bytes, depth.
 */
export function copyUntrusted(src: string, dst: string, o: { maxFiles?: number; maxBytes?: number; maxDepth?: number; platform?: string; arch?: string; skipTop?: string[] } = {}): { copied: string[]; refused: string[]; method: "descriptor" | "path" } {
  const fs = nodeFs, path = nodePath;
  const maxFiles = o.maxFiles ?? 200, maxBytes = o.maxBytes ?? 20_000_000, maxDepth = o.maxDepth ?? 6;
  // macOS: by descriptor (openat + O_NOFOLLOW at every level, fstat on the open descriptor): no path is resolved twice, so a
  // folder swapped for a link mid-copy is refused too. Elsewhere the path walk below (lstat, O_NOFOLLOW at the leaf).
  if (canCopyByDescriptor(o.platform, o.arch)) return { ...copyByDescriptor(src, dst, { maxFiles, maxBytes, maxDepth, skipTop: o.skipTop }), method: "descriptor" };
  const out = { copied: [] as string[], refused: [] as string[] }; let bytes = 0;
  const walk = (rel: string, depth: number) => {
    let names: string[] = []; try { names = fs.readdirSync(path.join(src, rel)); } catch { out.refused.push(`${rel || "."}: unreadable`); return; }
    for (const n of names) {
      if (!rel && o.skipTop?.includes(n)) continue; // a top-level name the caller leaves out (a skill folder's .git)
      const r = rel ? `${rel}/${n}` : n; const from = path.join(src, r);
      let st: import("node:fs").Stats; try { st = fs.lstatSync(from); } catch { out.refused.push(`${r}: gone`); continue; }
      if (st.isSymbolicLink()) { out.refused.push(`${r}: a symlink`); continue; }
      if (st.isDirectory()) { if (depth >= maxDepth) { out.refused.push(`${r}: too deep`); continue; } fs.mkdirSync(path.join(dst, r), { recursive: true }); walk(r, depth + 1); continue; }
      if (!st.isFile()) { out.refused.push(`${r}: not a regular file`); continue; }
      if (out.copied.length >= maxFiles) { out.refused.push(`${r}: too many files`); continue; }
      let fd = -1;
      try {
        fd = fs.openSync(from, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const fst = fs.fstatSync(fd);
        if (!fst.isFile()) { out.refused.push(`${r}: not a regular file`); continue; }
        if (fst.nlink > 1) { out.refused.push(`${r}: a hard link`); continue; }
        if (bytes + fst.size > maxBytes) { out.refused.push(`${r}: too large`); continue; }
        const buf = fs.readFileSync(fd); bytes += buf.length;
        fs.mkdirSync(path.dirname(path.join(dst, r)), { recursive: true }); fs.writeFileSync(path.join(dst, r), buf, { mode: 0o644 }); out.copied.push(r);
      } catch { out.refused.push(`${r}: could not be read safely`); }
      finally { if (fd >= 0) try { fs.closeSync(fd); } catch {} }
    }
  };
  fs.mkdirSync(dst, { recursive: true }); walk("", 0);
  return { ...out, method: "path" };
}
