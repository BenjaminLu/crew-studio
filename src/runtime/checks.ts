import {localUnrestricted} from "../local-execution";
// The check runtime (docs/check-contract.md). Every script that judges a step's
// output is a check: a manifest (check.yaml) plus an executable, a native
// Studio function, an exit-code adapter around an existing script, or a model
// judge through the provider interface. One JSON object in on stdin, one out on
// stdout. The runtime owns parameters (schema defaults → policy → workflow
// override), the sandbox, retries of tool errors, the evidence ledger and the
// done-line map; the check owns only its verdict.
//   packs/<pack>/checks/<id>/check.yaml (+ run)      the manifests (embedded in the binary)
//   packs/<pack>/policies.yaml, data/policies/org.yaml, data/policies/project-<id>.yaml   policies
//   data/evidence/<R-id>/ledger.jsonl                  one signed line per check result, verdict, plan acceptance and card answer
//   data/evidence/<R-id>/<seq>-<id>/out/               what a check wrote (its evidence)
import { createHash, createHmac, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn as spawnChild } from "node:child_process";
import { bundledBytes, bundledList, bundledText, parseYaml } from "../bundled";
import { withLock } from "../ids";
import type { AgentTool } from "../agent";
import { parseFinding, type Finding } from "./locator";

export type Verdict = "pass" | "fail" | "warn" | "error"; // exactly the contract's set
export type Schema = { type?: string; properties?: Record<string, Schema & { default?: any; description?: string; enum?: any[]; minimum?: number; maximum?: number; items?: Schema }>; required?: string[]; items?: Schema; default?: any; enum?: any[]; minimum?: number; maximum?: number; description?: string };
export type CheckManifest = {
  id: string; pack: string; ref: string; version: string; title: { en: string; "zh-TW"?: string }; description?: string;
  applies_to: string[]; kind: "deterministic" | "judged" | "hook"; blocking: boolean; needs: string[];
  params: Schema; policy_bind: Record<string, string>; timeout_s: number; network: boolean;
  adapter?: { command: string[]; pass_on?: number[]; findings_from?: { regex: string; class?: string; severity?: string } } | null;
  native?: string | null; run?: string | null; at?: string | null; proves?: number[] | null;
  judge?: { prompt: string; provider?: string | null; model?: string | null; quorum?: { n: number; of: number } | null; vendors?: string[] | null; distinct_providers?: boolean; from_node?: string | null } | null;
  sample?: any; dir: string; runtime?: "studio" | null;
};
export type CheckRef = { use: string; params?: Record<string, any>; blocking?: boolean; quorum?: { n: number; of: number }; proves?: number[]; prompt?: string; model?: string; provider?: string };
export type CheckOutput = { data?: any; verdict: Verdict; score: number | null; findings: Finding[]; evidence: string[]; proves: number[]; error?: string | null; dropped?: number; votes?: { by: string; verdict: Verdict; provider?: string; model?: string; job?: string }[] };
export type LedgerEntry = CheckOutput & { seq: number; at: string; run: string; node: string; edge?: string | null; round: number; head: string | null; check: string; version: string; kind: string;
  blocking: boolean; inputHash: string; inputHashAlgorithm?: string; params: Record<string, any>; ms: number; dir: string | null; attempt: number; retried?: string | null; actor?: string | null; record?: string | null; data?: any; sig?: string; prev?: string | null };
export type CheckInput = { run: string; node: string; round: number; artifact: any; previous: any; spec: { done: string[] } | null; params: Record<string, any>; workdir: string | null; out: string; [k: string]: any };
export type Native = (input: CheckInput, h: NativeHelp) => Promise<Partial<CheckOutput>> | Partial<CheckOutput>;
export type NativeHelp = { x: any; manifest: CheckManifest };
export type Judge = (o: { system: string; prompt: string; tools: AgentTool[]; provider: string; model: string | null; title: string; timeoutMs: number }) => Promise<{ ok: boolean; error?: string | null; by: string }>;

const VERDICTS = new Set<Verdict>(["pass", "fail", "warn", "error"]);
const now = () => new Date().toISOString();

// ---------- JSON schema (the subset the editor renders as a form) ----------
export function schemaDefaults(s: Schema): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, p] of Object.entries(s?.properties ?? {})) if (p.default !== undefined) out[k] = p.default;
  return out;
}
export function schemaErrors(s: Schema, v: Record<string, any>): string[] {
  const errs: string[] = [];
  for (const k of s?.required ?? []) if (v[k] === undefined || v[k] === null || v[k] === "") errs.push(`${k} is required`);
  for (const [k, p] of Object.entries(s?.properties ?? {})) {
    const x = v[k]; if (x === undefined || x === null) continue;
    const t = p.type;
    if (t === "number" || t === "integer") { if (typeof x !== "number" || !Number.isFinite(x) || (t === "integer" && !Number.isInteger(x))) { errs.push(`${k} must be a ${t}`); continue; }
      if (p.minimum != null && x < p.minimum) errs.push(`${k} must be ≥ ${p.minimum}`); if (p.maximum != null && x > p.maximum) errs.push(`${k} must be ≤ ${p.maximum}`); }
    else if (t === "string" && typeof x !== "string") errs.push(`${k} must be text`);
    else if (t === "boolean" && typeof x !== "boolean") errs.push(`${k} must be true or false`);
    else if (t === "array" && !Array.isArray(x)) errs.push(`${k} must be a list`);
    else if (t === "object" && (typeof x !== "object" || Array.isArray(x))) errs.push(`${k} must be an object`);
    if (p.enum && !p.enum.includes(x)) errs.push(`${k} must be one of ${p.enum.join(", ")}`);
  }
  return errs;
}
/** Coerce form strings to the schema's types (the editor posts text). */
export function coerce(s: Schema, v: Record<string, any>): Record<string, any> {
  const out = { ...v };
  for (const [k, p] of Object.entries(s?.properties ?? {})) {
    const x = out[k]; if (typeof x !== "string") continue;
    if ((p.type === "number" || p.type === "integer") && x.trim() !== "" && Number.isFinite(Number(x))) out[k] = Number(x);
    else if (p.type === "boolean" && (x === "true" || x === "false")) out[k] = x === "true";
    else if ((p.type === "array" || p.type === "object") && x.trim()) { try { out[k] = JSON.parse(x); } catch { if (p.type === "array") out[k] = x.split(/\n|,/).map((y) => y.trim()).filter(Boolean); } }
  }
  return out;
}

// ---------- policies: org → project → workflow override ----------
const getPath = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
/** Policy keys whose levels add up instead of overriding (architecture §6: a project adds sensitive paths, never removes one). */
export const ADDITIVE = new Set(["sensitive_paths"]);
/** A policy file that exists but cannot be read: every writer refuses (HTTP 409 "policyUnreadable") instead of replacing it. */
export class PolicyUnreadable extends Error {
  readonly code = "policyUnreadable"; readonly status = 409;
  constructor(readonly file: string, why: string) { super(`policy file unreadable: ${file.split("/").slice(-2).join("/")} (${why}); fix or move it before changing policy`); this.name = "PolicyUnreadable"; }
}
export class Policies {
  onChange: (() => void) | null = null;
  constructor(readonly dataDir: string) { mkdirSync(join(dataDir, "policies"), { recursive: true }); }
  private yaml(f: string): any { try { return parseYaml(readFileSync(f, "utf8")) ?? {}; } catch { return {}; } }
  org(): Record<string, any> {
    const out: any = {};
    for (const f of bundledList("packs/").filter((p) => /^packs\/[^/]+\/policies\.yaml$/.test(p))) deepMerge(out, parseYaml(bundledText(f) ?? "") ?? {});
    return deepMerge(out, this.yaml(join(this.dataDir, "policies", "org.yaml")));
  }
  project(id: string | null | undefined): Record<string, any> { return id ? this.yaml(join(this.dataDir, "policies", `project-${id.replace(/[^\w-]/g, "")}.yaml`)) : {}; }
  /** A value and the level it came from. */
  get(path: string, o: { project?: string | null; workflow?: Record<string, any> | null } = {}): { value: any; from: "workflow" | "project" | "org" | null } {
    if (path === "auth" || path.startsWith("auth.")) return { value: undefined, from: null }; // authority never comes from policy files: see grants.ts
    if (ADDITIVE.has(path)) { // a lower level adds lines, never removes one (a project's sensitive paths add to the org's)
      const levels = [["org", getPath(this.org(), path)], ["project", getPath(this.project(o.project), path)], ["workflow", getPath(o.workflow ?? {}, path)]] as const;
      const out: any[] = []; let from: "workflow" | "project" | "org" | null = null;
      for (const [lv, v] of levels) if (Array.isArray(v)) { from = lv; for (const x of v) if (!out.some((y) => JSON.stringify(y?.glob ?? y) === JSON.stringify(x?.glob ?? x))) out.push(x); }
      return { value: from ? out : undefined, from };
    }
    const w = getPath(o.workflow ?? {}, path); if (w !== undefined) return { value: w, from: "workflow" };
    const p = getPath(this.project(o.project), path); if (p !== undefined) return { value: p, from: "project" };
    const g = getPath(this.org(), path); if (g !== undefined) return { value: g, from: "org" };
    return { value: undefined, from: null };
  }
  /** The current file for a write: absent is empty; a file that exists but cannot be read is never replaced (it may hold the captain's rules). */
  private forWrite(f: string): Record<string, any> {
    let st; try { st = lstatSync(f); } catch (e: any) { if (e?.code === "ENOENT") return {}; throw new PolicyUnreadable(f, "it cannot be opened"); }
    if (!st.isFile() || st.isSymbolicLink()) throw new PolicyUnreadable(f, "it is not a plain file");
    let v: unknown; try { v = parseYaml(readFileSync(f, "utf8")) ?? {}; } catch { throw new PolicyUnreadable(f, "it is not valid YAML or JSON"); }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new PolicyUnreadable(f, "it is not a mapping");
    return v as Record<string, any>;
  }
  /** The project's policy file exists but cannot be read (writers refuse it). */
  projectUnreadable(id: string): boolean { try { this.forWrite(join(this.dataDir, "policies", `project-${id.replace(/[^\w-]/g, "")}.yaml`)); return false; } catch (e) { return e instanceof PolicyUnreadable; } }
  setOrg(patch: Record<string, any>) { const f = join(this.dataDir, "policies", "org.yaml"); const cur = this.forWrite(f); writeFileSync(f, JSON.stringify(deepMerge(cur, patch), null, 1)); this.onChange?.(); }
  setProject(id: string, patch: Record<string, any>) { const f = join(this.dataDir, "policies", `project-${id.replace(/[^\w-]/g, "")}.yaml`); writeFileSync(f, JSON.stringify(deepMerge(this.forWrite(f), patch), null, 1)); this.onChange?.(); }
}
/** Never follows or writes __proto__, constructor or prototype: a patch cannot reach Object.prototype. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function deepMerge(a: any, b: any) { for (const [k, v] of Object.entries(b ?? {})) { if (UNSAFE_KEYS.has(k)) continue; if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v); else a[k] = v; } return a; }

// ---------- the manifests ----------
export class CheckRegistry {
  private cache: Map<string, CheckManifest> | null = null;
  /** extraRoots: more pack folders on disk (<root>/<pack>/checks/<id>/check.yaml), e.g. installed packs or test fixtures */
  constructor(readonly dataDir: string, readonly extraRoots: string[] = []) {}
  /** Installed native packs validate their signed source before lookup and execution. */
  verifySource: ((manifest: CheckManifest) => void) | null = null;
  verifyRoot: ((root: string, pack: string) => void) | null = null;
  reload() { this.cache = null; }
  all(): CheckManifest[] { return [...this.load().values()].filter(m => { try { this.verifySource?.(m); return true; } catch { return false; } }); }
  get(ref: string): CheckManifest | null { const m = this.load().get(ref) ?? null; if (m) this.verifySource?.(m); return m; }
  private load() {
    if (this.cache) return this.cache;
    const m = new Map<string, CheckManifest>();
    const files: { f: string; text: () => string | null; disk: string | null }[] = bundledList("packs/").filter((p) => /^packs\/[^/]+\/checks\/[^/]+\/check\.yaml$/.test(p)).map((f) => ({ f, text: () => bundledText(f), disk: null }));
    for (const root of this.extraRoots) { if (!existsSync(root)) continue; for (const pack of readdirSync(root)) { this.verifyRoot?.(root, pack); const cd = join(root, pack, "checks"); if (!existsSync(cd)) continue;
      for (const id of readdirSync(cd)) { const y = join(cd, id, "check.yaml"); if (existsSync(y)) files.push({ f: `packs/${pack}/checks/${id}/check.yaml`, text: () => readFileSync(y, "utf8"), disk: join(cd, id) }); } } }
    for (const { f, text, disk } of files) {
      const [, pack, , id] = f.split("/");
      let y: any; try { y = parseYaml(text() ?? ""); } catch { continue; }
      if (!y || y.id !== id) continue;
      const man: CheckManifest = { id, pack, ref: `${pack}/${id}`, version: String(y.version ?? "1.0.0"), title: typeof y.title === "string" ? { en: y.title } : (y.title ?? { en: id }), description: y.description ?? "",
        applies_to: y.applies_to ?? [], kind: y.kind === "judged" ? "judged" : y.kind === "hook" ? "hook" : "deterministic", blocking: y.blocking !== false && y.kind !== "hook", needs: y.needs ?? [],
        params: y.params ?? { type: "object", properties: {} }, policy_bind: y.policy_bind ?? {}, timeout_s: Number(y.timeout_s ?? 120), network: y.network === true,
        adapter: y.adapter ?? null, native: y.native ?? null, run: y.native || y.adapter ? null : (y.run ?? "run"), at: y.at ?? null, proves: Array.isArray(y.proves) ? y.proves : null, judge: y.judge ?? null, sample: y.sample ?? null,
        dir: disk ?? f.slice(0, -"/check.yaml".length), runtime: y.runtime === "studio" ? "studio" : null };
      m.set(man.ref, man);
    }
    this.cache = m; return m;
  }
  /** The executable, copied out of the binary (or the checkout) into data/, versioned, executable. */
  executable(man: CheckManifest): string {
    this.verifySource?.(man);
    const rel = `${man.dir}/${man.run}`; const bytes = man.dir.startsWith("/") ? (existsSync(rel) ? readFileSync(rel) : null) : bundledBytes(rel); if (!bytes) throw new Error(`${man.ref}: no ${man.run}`);
    const d = join(this.dataDir, "tools", "checks", man.pack, man.id, man.version); mkdirSync(d, { recursive: true });
    // Extensionless Node checks use CommonJS. Do not inherit the Studio checkout's
    // package type when data/ lives below an ESM package; .mjs stays explicit ESM.
    const boundary = join(d, "package.json"), moduleType = '{"type":"commonjs"}\n';
    if (!existsSync(boundary) || readFileSync(boundary, "utf8") !== moduleType) writeFileSync(boundary, moduleType);
    const p = join(d, man.run!);
    if (!existsSync(p) || readFileSync(p).compare(bytes) !== 0) { writeFileSync(p, bytes); chmodSync(p, 0o755); }
    return p;
  }
}

// ---------- the sandbox: default deny (architecture §10) ----------
// A check (and a legacy `run` gate) runs under macOS sandbox-exec with a profile that
// starts from (deny default) and allows only: reading the system, the interpreters on
// PATH, the check's own directory and the paths its input names; writing out/ and its
// tmp/; no network (unless the manifest asks), no unix sockets, no LaunchServices or
// AppleEvents. Studio's data (ledger.key, keys, policies) and the user's secret folders
// are denied last, so even an input inside them is not readable. Off macOS there is no
// equivalent sandbox: a check is refused, and the Doctor says so.
export function sandboxInfo() {
  const sbx = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && process.env.CREW_FORCE_NO_SANDBOX !== "1";
  return { kind: sbx ? "sandbox-exec" : "none", ok: sbx, detail: sbx ? "macOS sandbox (default deny): checks read only their inputs and the system, write only out/, no network"
    : "no OS sandbox on this platform: checks are refused (they need read-only inputs, out/ only and no network)" };
}
const q = (p: string) => JSON.stringify(p);
const SYSTEM_READ = ["/usr", "/bin", "/sbin", "/System", "/Library", "/opt", "/private/etc", "/etc", "/dev", "/private/var/db/timezone", "/private/var/db/dyld", "/var/db/timezone", "/Applications/Xcode.app", "/private/var/select"];
/** Folders whose files must never reach a check, even as an input. */
export const SECRET_DIRS = (dataDir?: string | null) => { const h = homedir(); return [...(dataDir ? [join(dataDir, "ledger.key"), join(dataDir, "keys.json"), join(dataDir, "github-token"), join(dataDir, "policies"), join(dataDir, "remote-devices.json")] : []),
  ...[".ssh", ".aws", ".gnupg", ".netrc", ".config", ".claude", ".claude.json", ".codex", ".docker", ".kube", ".npmrc", ".git-credentials", "Library/Keychains"].map((x) => join(h, x))]; };
const realIf = (p: string) => { try { return realpathSync(p); } catch { return null; } };
/** The folders the interpreters on PATH live in (node under a version manager, python, ffmpeg), so a check's shebang works. */
function interpreterDirs(): string[] {
  const out = new Set<string>();
  for (const d of (process.env.PATH ?? "").split(":")) { const r = realIf(d); if (!r || r === homedir()) continue; out.add(r);
    if (/\/bin$/.test(r)) { const parent = r.slice(0, -4); if (parent && parent !== homedir() && parent !== "/") out.add(parent); } }
  return [...out];
}
export function profileFor(o: { out: string; tmp: string; reads: string[]; network: boolean; dataDir?: string | null; cwd?: string | null }) {
  const reads = [...SYSTEM_READ, ...interpreterDirs(), ...o.reads].map((p) => realIf(p) ?? p);
  // the listings (not the files) of the folders above the working folder: bun reads them while it loads its environment
  const ancestors: string[] = []; { let d = o.cwd ? realIf(o.cwd) ?? o.cwd : null; while (d && d !== "/") { d = dirname(d); ancestors.push(d); } }
  return `(version 1)
(deny default)
(import "system.sb")
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow process-info* (target self))
(allow ipc-posix-shm-read-data ipc-posix-shm-write-data)
(allow file-read-metadata)
(allow file-read* ${reads.map((p) => `(subpath ${q(p)})`).join(" ")} (literal "/") (subpath ${q(o.out)}) (subpath ${q(o.tmp)}))
${ancestors.length ? `(allow file-read-data ${ancestors.map((p) => `(literal ${q(p)})`).join(" ")})` : ""}
(allow file-write* (subpath ${q(o.out)}) (subpath ${q(o.tmp)}) (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))
${o.network ? '(allow network-outbound (remote ip))\n(allow network-inbound (local ip))\n(allow system-socket)' : "(deny network*)"}
(deny appleevent-send)
(deny file-read* ${SECRET_DIRS(o.dataDir).map((p) => `(subpath ${q(realIf(p) ?? p)})`).join(" ")})
`;
}
/**
 * The profile of an agent round (architecture §10): writes only to the round's
 * worktree, its tmp and the provider's own config; reads the system, interpreters,
 * the worktree and the provider's install and config; the network only through
 * Studio's egress proxy (and Studio's own tool route); never Studio's data or the
 * user's other secret folders.
 */
export function roundProfile(o: { cwd: string; tmp: string; writes: string[]; reads: string[]; proxyPort: number; toolPort: number; dataDir?: string | null; protect?: string[] }) {
  // Studio's data folder is closed to the round, its file metadata included, except what the runtime materialized for it
  // (its worktree, its tmp, its throwaway home); a protected root (firstmate's checkout) is closed entirely; the user's
  // secret folders are denied last, the login keychain among them
  const R = (p: string) => realIf(p) ?? p;
  const data = o.dataDir ? R(o.dataDir) : null;
  const protect = (o.protect ?? []).map(R);
  const writes = [...o.writes.map(R), R(o.tmp)];
  const reads = [...SYSTEM_READ, ...interpreterDirs(), ...o.reads, ...o.writes, o.cwd].map(R);
  const opened = [...writes, R(o.cwd)];
  const ancestors = new Set<string>(); for (const p of opened) { let d = p; while (d && d !== "/") { d = dirname(d); ancestors.add(d); } }
  const deny = SECRET_DIRS(o.dataDir).map(R); // the login keychain included: a round never reaches it (v1 option A)
  // a worktree's .git (a file naming its git folder) is never the round's: Studio's own git reads it outside the sandbox
  const gitLinks = o.writes.map((p) => join(R(p), ".git"));
  const sub = (ps: string[]) => ps.map((p) => `(subpath ${q(p)})`).join(" ");
  const lit = (ps: string[]) => ps.map((p) => `(literal ${q(p)})`).join(" ");
  return `(version 1)
(deny default)
(import "system.sb")
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow process-info* (target self))
(allow ipc-posix-shm-read-data ipc-posix-shm-write-data)
(allow file-read-metadata)
(allow file-read* ${sub(reads)} (literal "/"))
(allow file-read-data ${lit([...ancestors])})
(allow file-write* ${sub(writes)} (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/dtracehelper") (regex #"^/dev/fd/") (regex #"^/dev/tty"))
(deny network*)
(allow network-outbound (remote tcp ${q(`localhost:${o.proxyPort}`)}) (remote tcp ${q(`localhost:${o.toolPort}`)}))
(allow network-inbound (local tcp "localhost:*"))
(allow mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc") (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.trustd.agent"))
(deny appleevent-send)
${data ? `(deny file-read* file-read-metadata file-write* (subpath ${q(data)}))
(allow file-read* file-read-metadata ${sub(opened)})
(allow file-write* ${sub(writes)})
(allow file-read-metadata ${lit([...ancestors].filter((p) => p === data || p.startsWith(data + "/")))})` : ""}
${protect.length ? `(deny file-read* file-read-metadata file-write* ${sub(protect)})` : ""}
(deny file-write* ${lit(gitLinks)} ${gitLinks.map((g) => `(subpath ${q(g)})`).join(" ")})
${deny.length ? `(deny file-read* file-write* ${sub(deny)})` : ""}
`;
}

/** Absolute paths an input names that exist: they become readable to the check (never a secret: the profile denies those last). */
export function inputPaths(v: any, out: Set<string> = new Set(), depth = 0): string[] {
  if (depth > 6 || v == null) return [...out];
  if (typeof v === "string") { if (v.startsWith("/") && v.length < 1024 && existsSync(v)) out.add(v); }
  else if (Array.isArray(v)) for (const x of v.slice(0, 200)) inputPaths(x, out, depth + 1);
  else if (typeof v === "object") for (const x of Object.values(v)) inputPaths(x, out, depth + 1);
  return [...out];
}
/**
 * Run one sandboxed process in its own process group. At timeoutS the whole group is
 * killed and the call returns, even if a grandchild still holds a pipe open; when the
 * process ends, any child it left behind is killed too.
 */
export async function sandboxed(argv: string[], o: { cwd: string; out: string; tmp: string; stdin?: string; timeoutS: number; network: boolean; env?: Record<string, string>; reads?: string[]; dataDir?: string | null; signal?: AbortSignal;
  /** false: argv is untrusted (a reviewer's command), so its program's folder is never added to the reads; the caller resolved it on a fixed PATH */
  argvRead?: boolean }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number; refused?: string; aborted?: boolean }> {
  const t0 = Date.now();
  const info = sandboxInfo();
  if (!info.ok && !localUnrestricted()) return { code: null, stdout: "", stderr: "", timedOut: false, ms: 0, refused: info.detail };
  mkdirSync(o.out, { recursive: true }); mkdirSync(o.tmp, { recursive: true });
  const out = realpathSync(o.out), tmp = realpathSync(o.tmp);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmp, TMPDIR: tmp, LANG: "C.UTF-8", CI: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PYTHONDONTWRITEBYTECODE: "1", ...(o.env ?? {}) };
  const prof = join(tmp, "..", "profile.sb");
  writeFileSync(prof, profileFor({ out, tmp, reads: [o.cwd, ...(o.reads ?? []), ...(o.argvRead !== false && argv[0]?.startsWith("/") ? [dirname(argv[0])] : [])], network: o.network, dataDir: o.dataDir ?? null, cwd: o.cwd }));
  const full = localUnrestricted()?argv:["/usr/bin/sandbox-exec", "-f", prof, ...argv];
  return await new Promise((resolveP) => {
    let stdout = "", stderr = "", done = false, timedOut = false, aborted = false;
    const p = spawnChild(full[0], full.slice(1), { cwd: o.cwd, env, detached: true, stdio: [o.stdin != null ? "pipe" : "ignore", "pipe", "pipe"] });
    const killGroup = () => { try { if (p.pid) process.kill(-p.pid, "SIGKILL"); } catch {} };
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); killGroup(); try { p.stdout?.destroy(); p.stderr?.destroy(); } catch {} resolveP({ code: timedOut ? null : code, stdout, stderr, timedOut, ms: Date.now() - t0, aborted }); };
    const timer = setTimeout(() => { timedOut = true; finish(null); }, o.timeoutS * 1000);
    if (o.signal) { if (o.signal.aborted) { timedOut = true; setTimeout(() => finish(null), 0); } else o.signal.addEventListener("abort", () => { aborted = true; timedOut = true; finish(null); }, { once: true }); }
    p.stdout?.on("data", (d) => { if (stdout.length < 4_000_000) stdout += d; });
    p.stderr?.on("data", (d) => { if (stderr.length < 1_000_000) stderr += d; });
    p.on("error", (e) => { stderr += String(e); finish(127); });
    p.on("exit", (code) => { setTimeout(() => finish(code), 50); }); // drain what is buffered, then end even if a child holds the pipe
    if (o.stdin != null) { p.stdin?.on("error", () => {}); p.stdin?.end(o.stdin); }
  });
}

/**
 * A command a round's working folder needs run outside any agent (a dependency
 * install) under the round profile: it writes only the folders named (the worktree)
 * and its own tmp, reads nothing of Studio's data or a protected root, and reaches the
 * network only through the egress proxy with a credential of its own and the hosts
 * given (none: no network). Borrowed from v1 bin/fm-sandbox.sh `run` (one profile for
 * whatever a round's tree executes).
 */
export async function roundExec(argv: string[], o: { cwd: string; writes: string[]; tmp: string; dataDir?: string | null; protect?: string[]; timeoutS: number;
  egress?: { port: number; open(t: string, h: string[]): void; close(t: string): void } | null; hosts?: string[]; env?: Record<string, string> }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; refused?: string }> {
  const info = sandboxInfo(); if (!info.ok && !localUnrestricted()) return { code: null, stdout: "", stderr: "", timedOut: false, refused: info.detail };
  mkdirSync(join(o.tmp, "home"), { recursive: true }); const tmp = realpathSync(o.tmp);
  const net = !localUnrestricted() && !!o.egress && !!o.hosts?.length; const token = net ? randomBytes(18).toString("hex") : null;
  if (net) o.egress!.open(token!, o.hosts!);
  const proxy = net ? `http://round:${token}@127.0.0.1:${o.egress!.port}` : null;
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(tmp, "home"), TMPDIR: tmp, LANG: "C.UTF-8", CI: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: "localhost,127.0.0.1,::1", NODE_USE_ENV_PROXY: "1" } : {}), ...(o.env ?? {}) };
  const prof = join(tmp, "round.sb");
  writeFileSync(prof, roundProfile({ cwd: o.cwd, tmp, writes: o.writes, reads: [o.cwd, ...(argv[0]?.startsWith("/") ? [dirname(argv[0])] : [])], proxyPort: net ? o.egress!.port : 1, toolPort: 1, dataDir: o.dataDir ?? null, protect: o.protect ?? [] }));
  try {
    return await new Promise((resolveP) => {
      let stdout = "", stderr = "", done = false, timedOut = false;
      const full=localUnrestricted()?argv:["/usr/bin/sandbox-exec","-f",prof,...argv];
      const p = spawnChild(full[0],full.slice(1), { cwd: o.cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); try { if (p.pid) process.kill(-p.pid, "SIGKILL"); } catch {} resolveP({ code: timedOut ? null : code, stdout, stderr, timedOut }); };
      const timer = setTimeout(() => { timedOut = true; finish(null); }, o.timeoutS * 1000);
      p.stdout?.on("data", (d) => { if (stdout.length < 1_000_000) stdout += d; }); p.stderr?.on("data", (d) => { if (stderr.length < 1_000_000) stderr += d; });
      p.on("error", (e) => { stderr += String(e); finish(127); }); p.on("exit", (code) => { setTimeout(() => finish(code), 50); });
    });
  } finally { if (net) o.egress!.close(token!); }
}

/**
 * The exit-code adapter (check-contract.md "Adapters for existing scripts"): run an
 * argv in the sandbox, pass on the listed exit codes, parse findings from the log.
 * The one executor for adapter checks and for a workflow's or project's `run` gates.
 */
export async function execAdapter(argv: string[], o: { cwd: string; out: string; tmp: string; timeoutS: number; network?: boolean; passOn?: number[]; regex?: string | null; cls?: string; severity?: string;
  ref: string; env?: Record<string, string>; reads?: string[]; dataDir?: string | null; stdin?: string; signal?: AbortSignal }): Promise<CheckOutput & { log: string }> {
  const r = await sandboxed(argv, { cwd: o.cwd, out: o.out, tmp: o.tmp, timeoutS: o.timeoutS, network: !!o.network, env: o.env, reads: o.reads, dataDir: o.dataDir, stdin: o.stdin, signal: o.signal });
  if (r.aborted) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: "stopped: the run ended", log: r.stdout + r.stderr };
  const log = r.stdout + r.stderr;
  if (r.refused) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `refused: ${r.refused}`, log };
  try { writeFileSync(join(o.out, "log.txt"), log); } catch {}
  if (r.timedOut) return { verdict: "error", score: null, findings: [], evidence: ["out/log.txt"], proves: [], error: `timeout after ${o.timeoutS} s`, log };
  const ok = (o.passOn ?? [0]).includes(r.code ?? -1);
  const findings: Finding[] = [];
  if (o.regex) for (const m of log.matchAll(jsRegex(o.regex))) {
    const g = m.groups ?? {}; const f = parseFinding({ locator: g.path ? { type: "file", path: g.path, line: g.line } : null, message: g.message ?? m[0], class: g.class ?? o.cls ?? "adapter", severity: o.severity ?? "blocking" }, "check", o.ref);
    if (f && findings.length < 50) findings.push(f);
  }
  if (!ok && !findings.length) findings.push({ locator: null, message: `${argv.join(" ")} exited ${r.code}: ${log.trim().split("\n").slice(-4).join(" | ").slice(0, 600)}`, expected: `exit ${(o.passOn ?? [0]).join(" or ")}`, class: o.cls ?? "adapter", severity: "blocking", source: "check", check: o.ref });
  return { verdict: ok ? "pass" : "fail", score: ok ? 1 : 0, findings, evidence: ["out/log.txt"], proves: [], log };
}

/** stdout must be one JSON object with a known verdict; anything else is an error, never a pass. */
export function parseOutput(stdout: string, ref: string): CheckOutput {
  const t = stdout.trim(); let o: any = null;
  try { o = JSON.parse(t); } catch { const last = t.split("\n").filter(Boolean).at(-1); try { o = JSON.parse(last ?? ""); } catch {} }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `bad JSON on stdout${t ? `: ${t.slice(0, 160)}` : " (empty)"}` };
  if (!VERDICTS.has(o.verdict)) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `unknown verdict ${JSON.stringify(o.verdict)}` };
  const findings = (Array.isArray(o.findings) ? o.findings : []).map((f: any) => parseFinding(f, "check", ref)).filter(Boolean) as Finding[];
  return { data: o.data && typeof o.data === "object" ? o.data : undefined, verdict: o.verdict, score: Number.isFinite(Number(o.score)) && o.score !== null ? Number(o.score) : null, findings, evidence: (Array.isArray(o.evidence) ? o.evidence : []).map(String).slice(0, 40),
    proves: (Array.isArray(o.proves) ? o.proves : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0) };
}
/** Python-style named groups (?P<x>…) become JavaScript's (?<x>…). */
export const jsRegex = (re: string) => new RegExp(re.replace(/\(\?P</g, "(?<"), "gm");

export const INPUT_HASH_ALGORITHM = "canonical-json-v2";
export function hashInput(input: CheckInput): string {
  const { out, workdir, run, ...rest } = input; void out; void workdir; void run;
  return createHash("sha256").update(JSON.stringify(rest, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex").slice(0, 16);
}

/** Studio's local signing key (data/ledger.key, 0600), made on first use. */
export function ledgerKey(dataDir: string): Buffer {
  const f = join(dataDir, "ledger.key");
  if (!existsSync(f)) { mkdirSync(dataDir, { recursive: true }); writeFileSync(f, randomBytes(32).toString("hex"), { mode: 0o600 }); }
  try { chmodSync(f, 0o600); } catch {}
  return Buffer.from(readFileSync(f, "utf8").trim(), "hex");
}
/**
 * The evidence ledger (architecture §3.5): every check result, review verdict,
 * plan acceptance and card answer, with input hash, head, version and actor,
 * HMAC-signed with Studio's local key and chained to the entry before it.
 *   data/evidence/<run>/ledger.jsonl
 */
export class Ledger {
  readonly dir: string;
  constructor(readonly dataDir: string, readonly run: string) { this.dir = join(dataDir, "evidence", run.replace(/[^\w-]/g, "")); }
  file() { return join(this.dir, "ledger.jsonl"); }
  all(): LedgerEntry[] { if (!existsSync(this.file())) return []; return readFileSync(this.file(), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  private sign(rec: any) { const { sig, ...rest } = rec; void sig; return createHmac("sha256", ledgerKey(this.dataDir)).update(JSON.stringify(rest)).digest("hex"); }
  add(e: Omit<LedgerEntry, "seq" | "at" | "sig" | "prev">): LedgerEntry {
    mkdirSync(this.dir, { recursive: true });
    // the seq and the chain link are read and written under a lock: two writers never share a seq
    return withLock(this.dir, "ledger", () => {
      const all = this.all(); const last = all.at(-1);
      const rec: any = { ...e, seq: (last?.seq ?? 0) + 1, at: now(), prev: last?.sig ?? null };
      rec.sig = this.sign(rec);
      appendFileSync(this.file(), JSON.stringify(rec) + "\n"); return rec;
    });
  }
  /** One raw snapshot; only consecutive authenticated objects enter prefix.
   * bad uses host-ordered nonblank positions, never an invalid payload's seq. */
  authenticatedPrefix(): { entries: LedgerEntry[]; prefix: LedgerEntry[]; bad: number[]; malformed: boolean } {
    const raw = existsSync(this.file()) ? readFileSync(this.file(), "utf8") : "";
    const entries: LedgerEntry[] = [], prefix: LedgerEntry[] = [], bad: number[] = [];
    let malformed = false, open = true, position = 0, prev: string | null = null;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      position++;
      let entry: any;
      try { entry = JSON.parse(line); } catch { malformed = true; open = false; bad.push(position); continue; }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) { malformed = true; open = false; bad.push(position); continue; }
      entries.push(entry);
      const valid = Number.isSafeInteger(entry.seq) && entry.seq > 0 && entry.seq === position && entry.run === this.run &&
        typeof entry.sig === "string" && /^[0-9a-f]{64}$/.test(entry.sig) &&
        (entry.prev ?? null) === prev && entry.sig === this.sign(entry);
      if (!valid) { bad.push(position); open = false; }
      if (open) prefix.push(entry);
      prev = typeof entry.sig === "string" ? entry.sig : null;
    }
    return { entries, prefix, bad, malformed };
  }
  /** Every raw row is structurally ordered, signed and chained. */
  verify(): number[] { return this.authenticatedPrefix().bad; }
}

/** The done-line map: each spec line is proved by a passing check whose proves names it at the final head, or goes to the human list. */
export function doneMap(done: string[], ledger: LedgerEntry[], head: string | null) {
  const latest = new Map<string, LedgerEntry>();
  for (const e of ledger) if (!e.record || e.record === "check") latest.set(`${e.check}|${e.node}|${e.edge ?? ""}`, e);
  const final = [...latest.values()].filter((e) => !head || !e.head || e.head === head);
  return done.map((text, i) => {
    const by = final.filter((e) => e.verdict === "pass" && e.proves.includes(i));
    const judgedOnly = by.length > 0 && by.every((e) => e.kind === "judged");
    return { index: i, text, proved: by.length > 0 && !judgedOnly, by: by.map((e) => ({ check: e.check, version: e.version, seq: e.seq, kind: e.kind })), note: judgedOnly ? "only a judged check proves it: needs your eye" : null };
  });
}
