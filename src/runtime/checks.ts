import { openScopedProxy } from "../egress-client";
import { BROKER_PORTS, DEFAULT_STUDIO_PORT } from "../loopback-ports";
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
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { spawn as spawnChild } from "node:child_process";
import { bundledBytes, bundledList, bundledText, parseYaml } from "../bundled";
import { withLock } from "../ids";
import { appendLines, endCleanly } from "./durable-log";
import { runtimeDir } from "../instance";
import type { AgentTool } from "../agent";
import { parseFinding, type Finding } from "./locator";

export type Verdict = "pass" | "fail" | "warn" | "error"; // exactly the contract's set
export type Schema = { type?: string; properties?: Record<string, Schema & { default?: any; description?: string; enum?: any[]; minimum?: number; maximum?: number; items?: Schema }>; required?: string[]; items?: Schema; default?: any; enum?: any[]; minimum?: number; maximum?: number; description?: string };
export type CheckManifest = {
  id: string; pack: string; ref: string; version: string; title: { en: string; "zh-TW"?: string }; description?: string;
  applies_to: string[]; kind: "deterministic" | "judged" | "hook"; blocking: boolean; needs: string[];
  params: Schema; policy_bind: Record<string, string>; timeout_s: number; network: boolean; /** the check runs the project's tests: a test run's loopback (architecture §10) */ test_run: boolean;
  adapter?: { command: string[]; optional?: boolean; pass_on?: number[]; findings_from?: { regex: string; class?: string; severity?: string } } | null;
  native?: string | null; run?: string | null; at?: string | null; proves?: number[] | null;
  /** role: the workflow role the judge works as (its skill is the judge's role skill); none: the role of the node the check sits on */
  judge?: { prompt: string; role?: string | null; provider?: string | null; model?: string | null; quorum?: { n: number; of: number } | null; vendors?: string[] | null; distinct_providers?: boolean; from_node?: string | null } | null;
  sample?: any; dir: string; runtime?: "studio" | null;
};
export type CheckRef = { use: string; params?: Record<string, any>; blocking?: boolean; quorum?: { n: number; of: number }; proves?: number[]; prompt?: string; model?: string; provider?: string; skills?: { id: string; v: number; sha256: string }[] };
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
/** The catch-all line that makes every path one-way while a policy file cannot be read. */
export const unreadableRule = (level: string) => ({ glob: "**", why: `policy file unreadable (${level}): every path is one-way until it is fixed` });
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
      // a policy file that cannot be read may hold sensitive paths nobody can see: every path is one-way until it is fixed (fail closed)
      if (path === "sensitive_paths") { const why = this.orgUnreadable() ? "org" : o.project && this.projectUnreadable(o.project) ? `project ${o.project}` : null;
        if (why) { out.unshift(unreadableRule(why)); from ??= why === "org" ? "org" : "project"; } }
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
  /** The org policy file exists but cannot be read. */
  orgUnreadable(): boolean { try { this.forWrite(join(this.dataDir, "policies", "org.yaml")); return false; } catch (e) { return e instanceof PolicyUnreadable; } }
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
        params: y.params ?? { type: "object", properties: {} }, policy_bind: y.policy_bind ?? {}, timeout_s: Number(y.timeout_s ?? 120), network: y.network === true, test_run: y.test_run === true,
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
// tmp/; no network (unless the manifest asks; a test run gets loopback, see below), no unix sockets, no LaunchServices or
// AppleEvents. Studio's data (ledger.key, keys, policies, session token), its launch token folder and the user's secret folders
// are denied last, so even an input inside them is not readable. Off macOS there is no
// equivalent sandbox: a check is refused, and the Doctor says so.
/** macOS seatbelt, present and not forced off: the sandbox every check and round runs under. */
const seatbeltAvailable = () => process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && process.env.CREW_FORCE_NO_SANDBOX !== "1";
/** Linux bwrap, present: a test run (not a round) can run under it (v1's layout, a private loopback). */
const bwrapAvailable = () => process.platform === "linux" && process.env.CREW_FORCE_NO_SANDBOX !== "1" && !!Bun.which("bwrap");
export function sandboxInfo(testRun = false) {
  if (seatbeltAvailable()) return { kind: "sandbox-exec" as const, ok: true, detail: "macOS sandbox (default deny): checks read only their inputs and the system, write only out/, no network" };
  if (testRun && bwrapAvailable()) return { kind: "bwrap" as const, ok: true, detail: "Linux bwrap: a test run gets its own pid/net namespaces (a private loopback) with read-only reads; agent rounds are not yet wired to bwrap, so they are refused here" };
  const linux = process.platform === "linux";
  return { kind: "none" as const, ok: false, detail: linux
    ? (testRun ? "no OS sandbox: Linux test runs need bwrap on PATH (install bubblewrap); without it a test run is refused" : "no OS sandbox: Linux agent rounds are not wired to bwrap yet and are refused (macOS runs them under seatbelt)")
    : "no OS sandbox on this platform: checks and rounds are refused (they need read-only inputs, out/ only and no network)" };
}
const q = (p: string) => JSON.stringify(p);
// Named sysctl allowlist for runtime OS/CPU facts. This is defense in depth only:
// macOS KERN_PROCARGS2 (MIB 1.49.<pid>) bypasses Seatbelt's named sysctl filter,
// even with deny sysctl-read, and exposes another same-uid process's argv/env.
// No secret may rely on this filter for confidentiality; see docs/w29-local-sandbox.md.
const SYSCTL_READ = `(allow sysctl-read
  (sysctl-name-prefix "hw.")
  (sysctl-name "kern.ostype") (sysctl-name "kern.osrelease") (sysctl-name "kern.osrevision") (sysctl-name "kern.version") (sysctl-name "kern.osversion") (sysctl-name "kern.osproductversion") (sysctl-name "kern.iossupportversion")
  (sysctl-name "kern.hostname") (sysctl-name "kern.maxfilesperproc") (sysctl-name "kern.maxproc") (sysctl-name "kern.argmax") (sysctl-name "kern.tcsm_available") (sysctl-name "kern.tcsm_enable")
  (sysctl-name "kern.osvariant_status") (sysctl-name "kern.secure_kernel") (sysctl-name "kern.safeboot") (sysctl-name "kern.boottime") (sysctl-name "kern.clockrate") (sysctl-name "kern.usrstack64") (sysctl-name "kern.saved_ids")
  (sysctl-name "security.mac.sandbox.sentinel")
  (sysctl-name "vm.overcommit") (sysctl-name "vm.footprint_interval_reset")
  (sysctl-name "user.cs_path"))`;
const SYSTEM_READ = ["/usr", "/bin", "/sbin", "/System", "/Library", "/opt", "/private/etc", "/etc", "/dev", "/private/var/db/timezone", "/private/var/db/dyld", "/var/db/timezone", "/Applications/Xcode.app", "/private/var/select"];
/** Folders whose files must never reach a check, even as an input. Cursor's: its login, settings, MCP servers, chats and
 *  transcripts, never the whole ~/.cursor, whose worktrees/ holds checkouts (Studio's own may run from one). */
const CURSOR_SECRETS = ["auth.json", "cli-config.json", "mcp.json", "chats", "projects", "prompt_history.json", "agent-cli-state.json"].map((x) => `.cursor/${x}`);
/** Cursor's private files in a home (the project and data-root checks refuse them too). */
export const cursorSecretPaths = (h = homedir()) => CURSOR_SECRETS.map((x) => join(h, x));
const HOME_SECRETS = [".ssh", ".aws", ".gnupg", ".netrc", ".config", ".claude", ".claude.json", ".codex", ...CURSOR_SECRETS, ".docker", ".kube", ".npmrc", ".git-credentials", "Library/Keychains"];
export const SECRET_DIRS = (dataDir?: string | null) => { const h = homedir(); return [...(dataDir ? [join(dataDir, "ledger.key"), join(dataDir, "keys.json"), join(dataDir, "github-token"), join(dataDir, "policies"), join(dataDir, "remote-devices.json"), join(dataDir, "session-token")] : []), runtimeDir(),
  ...HOME_SECRETS.map((x) => join(h, x))]; };
/** The deny list a profile ends with: SECRET_DIRS, and the same folders of the account's own home when Studio runs with another
 *  HOME (the acceptance harness, a launcher that sets HOME): those hold the real logins. */
const denyList = (dataDir?: string | null) => { const a = accountHomeDir(); return [...SECRET_DIRS(dataDir), ...(a !== homedir() ? HOME_SECRETS.map((x) => join(a, x)) : [])]; };
const realIf = (p: string) => { try { return realpathSync(p); } catch { return null; } };
/** The folders the interpreters on PATH live in (node under a version manager, python, ffmpeg), so a check's shebang works.
 *  A bin folder's parent is added only when it is an install prefix (it has lib/: node's and python's own modules live
 *  there). Any other parent is a tool's private folder (~/.orbstack holds ssh keys, ~/.cache/lm-studio credentials,
 *  ~/.local/share and ~/.foundry caches): its bin stays runnable, the rest is not the round's. Never a home folder. */
function interpreterDirs(): string[] {
  const out = new Set<string>(), homes = new Set([homedir(), accountHomeDir()].map((h) => realIf(h) ?? h));
  for (const d of (process.env.PATH ?? "").split(":")) { const r = realIf(d); if (!r || homes.has(r)) continue; out.add(r);
    if (/\/bin$/.test(r)) { const parent = r.slice(0, -4); if (parent && !homes.has(parent) && parent !== "/" && existsSync(join(parent, "lib"))) out.add(parent); } }
  return [...out];
}
/** The account's own home from the directory service (Studio may run with another HOME, as the acceptance harness does). */
let acctHome: string | null = null;
export function accountHomeDir(): string {
  if (acctHome) return acctHome;
  try { const user = Bun.spawnSync(["/usr/bin/id", "-un"], { env: {PATH:"/usr/bin:/bin"}, stdout: "pipe" }).stdout.toString().trim();
    const r = Bun.spawnSync(["/usr/bin/dscl", ".", "-read", `/Users/${user}`, "NFSHomeDirectory"], { env: {PATH:"/usr/bin:/bin"}, stdout: "pipe", stderr: "ignore" });
    const m = /NFSHomeDirectory:\s*(\S+)/.exec(r.stdout.toString()); if (m) return (acctHome = m[1]); } catch {}
  return (acctHome = homedir());
}
// ---------- loopback for test runs ----------
// Test servers can bind ephemeral local ports. Explicit denies carve out existing
// listeners, the Studio port and the entire reserved capability-listener range.
// The snapshot is not isolation against unrelated host applications started later.
export const LOCAL_BINDING_RULES = `(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))`;
export function parseListeningPorts(output: string): number[] {
  if (!/^Proto\s+Recv-Q\s+Send-Q\s+Local Address\s+Foreign Address\s+\(state\)/m.test(output)) throw new Error("listener inspection returned an unrecognized netstat header");
  const ports = new Set<number>();
  for (const line of output.split("\n")) {
    if (!/\bLISTEN\s*$/.test(line)) continue;
    const fields = line.trim().split(/\s+/), m = /\.(\d+)$/.exec(fields[3] ?? "");
    if (!/^tcp(?:4|6|46)?$/.test(fields[0] ?? "") || !m || +m[1] < 1 || +m[1] > 65535) throw new Error("listener inspection could not parse a listening address");
    ports.add(+m[1]);
  }
  return [...ports].sort((a,b)=>a-b);
}
export function inspectListeningPorts(): number[] {
  const r = Bun.spawnSync(["/usr/sbin/netstat", "-an", "-p", "tcp"], { stdout:"pipe", stderr:"pipe", env:{PATH:"/usr/bin:/bin:/usr/sbin"} });
  if (!r.success) throw new Error(`listener inspection unavailable (netstat exit ${r.exitCode})`);
  return parseListeningPorts(r.stdout.toString());
}
function closedTestPorts(snapshot: number[]): number[] {
  const configured = Number(process.env.CREW_PORT ?? DEFAULT_STUDIO_PORT);
  if (!Number.isInteger(configured) || configured < 1 || configured > 65535) throw new Error("invalid Studio listener port");
  if (snapshot.some(n=>!Number.isInteger(n)||n<1||n>65535)) throw new Error("invalid listener snapshot port");
  return [...new Set([...snapshot, DEFAULT_STUDIO_PORT, configured, ...BROKER_PORTS])].sort((a,b)=>a-b);
}
function closedPortRules(snapshot: number[]) {
  return closedTestPorts(snapshot).map(n=>`(deny network-outbound (remote ip "localhost:${n}"))\n(deny network-bind network-inbound (local ip "localhost:${n}"))`).join("\n");
}
/** The env a test run gets on top of its own: bind dev servers to loopback, and keep Java on IPv4 (sandbox-runtime does the
 *  same: an IPv4-mapped ::ffff:127.0.0.1 connect does not match "localhost"). */
export const LOCAL_BINDING_ENV: Record<string, string> = { HOST: "127.0.0.1", JAVA_TOOL_OPTIONS: "-Djava.net.preferIPv4Stack=true" };
/** Linux: no Seatbelt. A test command runs under bwrap with v1's linux() layout (firstmate fm_sandbox_policy.py): its own
 *  pid, ipc, uts and network namespaces (a private loopback: its own servers answer, nothing of the host's does), the
 *  reads bound read-only, the writes bound read-write, every denied path under them covered (a folder by an empty tmpfs, a
 *  file by /dev/null), a fresh /tmp; a round's proxy socket, when given, bound in. null: bwrap is not installed. */
export function linuxBwrapArgv(argv: string[], o: { cwd: string; reads: string[]; writes: string[]; deny: string[]; sock?: string | null },
  which: (cmd: string) => string | null = (c) => Bun.which(c), exists: (p: string) => "dir" | "file" | null = (p) => { try { return statSync(p).isDirectory() ? "dir" : "file"; } catch { return null; } }): string[] | null {
  const bwrap = which("bwrap"); if (!bwrap) return null;
  const a = ["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-net", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
  for (const r of o.reads) if (!["/dev", "/proc"].some((m) => r === m || r.startsWith(m + "/"))) a.push("--ro-bind-try", r, r);
  for (const w of o.writes) a.push("--bind", w, w);
  const bound = [...o.reads, ...o.writes], under = (x: string) => bound.some((b) => x === b || x.startsWith(b.replace(/\/$/, "") + "/"));
  for (const n of o.deny.filter(under)) { const k = exists(n); if (k === "dir") a.push("--tmpfs", n); else if (k === "file") a.push("--ro-bind", "/dev/null", n); }
  if (o.sock) a.push("--bind", o.sock, o.sock);
  return [bwrap, ...a, "--chdir", o.cwd, "--", ...argv];
}
/** What a sandboxed test run's profile is checked to enforce before the run (the self-probe), and what it does not. */
export const TEST_RUN_ENFORCES = "Studio's data keys, session token and launch token folder are unreadable; no connection leaves this machine; Studio, existing listeners and reserved broker ports are inaccessible";
export const TEST_RUN_DOES_NOT = "unrelated host services started after the listener snapshot may be reachable; a test server bound to every interface is reachable from the LAN while it runs; and another same-uid process's argv and environment are readable via KERN_PROCARGS2, which the OS sandbox cannot block (so no secret is ever placed on a round's argv or in its env)";
/**
 * v1's self-probe: before a test run, try the profile on itself. Under the same profile a shell tries to read each existing
 * protected path (the deny list, Studio's runtime folder among them) and to open a connection off this machine (1.1.1.1:443,
 * by IP: no DNS). Anything that gets through means the profile does not enforce what Studio claims: the run is refused with
 * the reason, never run on a weaker sandbox. null: the profile holds.
 */
/** A positive control must not choose a port the same immutable profile explicitly denies. */
export function loopbackPositiveScript(blockedPorts: number[]): string {
  return `const http=require('node:http');const blocked=new Set(${JSON.stringify(blockedPorts)});
const loopbackProbe=(async()=>{for(const host of ['127.0.0.1','::1']){
  let proved=false;
  for(let attempt=0;attempt<32;attempt++){
    const s=http.createServer((q,r)=>r.end('loopback-ok'));
    await new Promise((r,j)=>{s.once('error',j);s.listen(0,host,r)});
    const port=s.address().port;
    if(blocked.has(port)){await new Promise(r=>s.close(r));continue;}
    const url='http://'+(host.includes(':')?'['+host+']':host)+':'+port;
    let body;try{body=await new Promise((r,j)=>http.get(url,x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>r(b))}).on('error',j));}
    finally{await new Promise(r=>s.close(r));}
    if(body!=='loopback-ok')throw Error('bad response');
    proved=true;break;
  }
  if(!proved)throw Error('no unblocked loopback control port after 32 attempts');
}console.log('LOOPBACK_POSITIVE_OK')})();
loopbackProbe.catch(e=>{console.error(e);process.exit(1)});setTimeout(()=>process.exit(2),5000).unref();`;
}
export function selfProbe(profile: string, protectedPaths: string[], blockedPorts: number[] = []): string | null {
  if (process.env.CREW_TEST_SELF_PROBE_LEAK === "1") return "the sandbox self-probe failed (test): the profile let the probe read a protected path";
  const paths = protectedPaths.filter((p) => existsSync(p)).slice(0, 40);
  const script = `echo PROBE_STARTED; for p in "$@"; do if [ -d "$p" ]; then /bin/ls "$p" >/dev/null 2>&1 && echo "READ $p"; else /bin/cat "$p" >/dev/null 2>&1 && echo "READ $p"; fi; done
/usr/bin/nc -z -G 2 1.1.1.1 443 >/dev/null 2>&1 && echo "EGRESS 1.1.1.1:443";\n${closedTestPorts(blockedPorts).filter(n=>n!==DEFAULT_STUDIO_PORT).map(n=>`/usr/bin/nc -z -G 1 127.0.0.1 ${n} >/dev/null 2>&1 && echo "EGRESS 127.0.0.1:${n}"`).join("\n")}\nexit 0`;
  const r = Bun.spawnSync(["/usr/bin/sandbox-exec", "-f", profile, "/bin/sh", "-c", script, "probe", ...paths], { stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin" } });
  const leaks = r.stdout.toString().split("\n").filter((l) => /^(READ|EGRESS) /.test(l));
  if ((!r.success || !r.stdout.toString().includes("PROBE_STARTED")) && !leaks.length) return `the sandbox self-probe could not run (exit ${r.exitCode}: ${r.stderr.toString().trim().slice(0, 200)})`;
  if (leaks.length) return `the sandbox self-probe failed: the profile let a test run ${leaks.map((l) => l.startsWith("READ") ? `read ${l.slice(5)}` : `connect to ${l.slice(7)}`).join(", ")}`;
  // A sandbox that never starts (or denies all networking) is not a successful
  // negative probe. Require real HTTP request/response inside the same profile.
  const positive = loopbackPositiveScript(closedTestPorts(blockedPorts));
  const control = Bun.spawnSync(["/usr/bin/sandbox-exec", "-f", profile, process.execPath, "-e", positive], {stdout:"pipe",stderr:"pipe",env:{PATH:"/usr/bin:/bin"}, cwd:"/", timeout:7000});
  return control.success && control.stdout.toString().includes("LOOPBACK_POSITIVE_OK") ? null : `the sandbox self-probe positive loopback control failed (exit ${control.exitCode}: ${control.stderr.toString().slice(0,200)})`;
}
export function profileFor(o: { out: string; tmp: string; reads: string[]; network: boolean; dataDir?: string | null; cwd?: string | null; localBinding?: boolean; blockedPorts?: number[] | null }) {
  const ports = o.localBinding ? (o.blockedPorts === null ? (()=>{throw new Error("listener inspection unavailable");})() : o.blockedPorts ?? inspectListeningPorts()) : [];
  const reads = [...SYSTEM_READ, ...interpreterDirs(), ...o.reads].map((p) => realIf(p) ?? p);
  // the listings (not the files) of the folders above the working folder: bun reads them while it loads its environment
  const ancestors: string[] = []; { let d = o.cwd ? realIf(o.cwd) ?? o.cwd : null; while (d && d !== "/") { d = dirname(d); ancestors.push(d); } }
  return `(version 1)
(deny default)
(import "system.sb")
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
${SYSCTL_READ}
(allow process-info* (target self))
(allow ipc-posix-shm-read-data ipc-posix-shm-write-data)
(allow file-read-metadata)
(allow file-read* ${reads.map((p) => `(subpath ${q(p)})`).join(" ")} (literal "/") (subpath ${q(o.out)}) (subpath ${q(o.tmp)}))
${ancestors.length ? `(allow file-read-data ${ancestors.map((p) => `(literal ${q(p)})`).join(" ")})` : ""}
(allow file-write* (subpath ${q(o.out)}) (subpath ${q(o.tmp)}) (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))
${o.network ? '(allow network-outbound (remote ip))\n(allow network-inbound (local ip))\n(allow system-socket)' : "(deny network*)"}
${o.localBinding ? LOCAL_BINDING_RULES + "\n" + closedPortRules(ports) : ""}
(deny appleevent-send)
(deny file-read* ${denyList(o.dataDir).map((p) => `(subpath ${q(realIf(p) ?? p)})`).join(" ")})
`;
}
/**
 * The profile of an agent round (architecture §10): writes only to the round's
 * worktree, its tmp and the provider's own config; reads the system, interpreters,
 * the worktree and the provider's install and config; the network only through
 * Studio's egress proxy (and Studio's own tool route); never Studio's data or the
 * user's other secret folders.
 */
export function roundProfile(o: { cwd: string; tmp: string; writes: string[]; reads: string[]; proxyPort: number; toolPort: number; dataDir?: string | null; protect?: string[];
  /** folders the round reads and executes but never writes (a skill's round copy, its prepared env, Studio's runtimes and tools), even inside Studio's data */
  readOnly?: string[];
  /** the captain's own account context the provider's CLI signs in from (SandboxNeeds.account): opened after the secret deny
   *  list, and only that context; the login keychain only when `keychain` */
  account?: AccountContext | null;
  /** the only programs the round may execute (SandboxNeeds.exec); unset: any */
  exec?: string[] | null }) {
  // Studio's data folder is closed to the round, its file metadata included, except what the runtime materialized for it
  // (its worktree, its tmp, its throwaway home); a protected root (firstmate's checkout) is closed entirely; the user's
  // secret folders are denied last, the login keychain among them
  const R = (p: string) => realIf(p) ?? p;
  const data = o.dataDir ? R(o.dataDir) : null;
  const protect = (o.protect ?? []).map(R);
  const writes = [...o.writes.map(R), R(o.tmp)];
  const readOnly = (o.readOnly ?? []).map(R);
  const reads = [...SYSTEM_READ, ...interpreterDirs(), ...o.reads, ...o.writes, o.cwd, ...readOnly].map(R);
  const opened = [...writes, R(o.cwd)];
  const ancestors = new Set<string>(); for (const p of [...opened, ...readOnly]) { let d = p; while (d && d !== "/") { d = dirname(d); ancestors.add(d); } }
  const deny = denyList(o.dataDir).map(R); // the login keychain included: a round never reaches it (v1 option A)
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
${SYSCTL_READ}
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
(allow file-read* file-read-metadata ${sub(opened)})${readOnly.length ? `\n(allow file-read* file-read-metadata ${sub(readOnly)})` : ""}
(allow file-write* ${sub(writes)})
(allow file-read-metadata ${lit([...ancestors].filter((p) => p === data || p.startsWith(data + "/")))})` : ""}
${protect.length ? `(deny file-read* file-read-metadata file-write* ${sub(protect)})` : ""}
(deny file-write* ${lit(gitLinks)} ${gitLinks.map((g) => `(subpath ${q(g)})`).join(" ")})
${readOnly.length ? `(deny file-write* ${sub(readOnly)})` : ""}
${deny.length ? `(deny file-read* file-write* ${sub(deny)})` : ""}
${accountRules(o.account, [...(data ? [data] : []), ...protect])}${execRules(o.exec)}`;
}
/** The captain's own account context, opened last (after the secret deny list) to the CLI that signs in from it: its folders,
 *  the files beside them, and the login keychain when the CLI keeps its sign-in there. Nothing of it is ever Studio's to read. */
/** What of the captain's own account a vendor CLI needs to sign in by itself (SandboxNeeds.account): only its credential, never
 *  a folder of the captain's. `writeFiles`: a login file it reads and refreshes in place (codex's auth.json, linked into the
 *  round's private home); `writeRegex`: SBPL patterns for the same (the login keychain database, where claude keeps its sign-in
 *  on macOS); `deny`: account folders named for the CLI's sake (a captain's own CLAUDE_CONFIG_DIR) that stay closed. */
export type AccountContext = { writeFiles?: string[]; writeRegex?: string[]; deny?: string[] };
const sbplRegex = (r: string) => `(regex #"${r.replace(/"/g, '\\"')}")`;
function accountRules(a: AccountContext | null | undefined, closed: string[]): string {
  if (!a) return "";
  const inside = (p: string, root: string) => p === root || p.startsWith(root.replace(/\/$/, "") + "/");
  const R = (p: string) => realIf(p) ?? p;
  const files = (a.writeFiles ?? []).filter((f) => isAbsolute(f)).map(R).filter((f) => !closed.some((c) => inside(f, c)));
  const rw = [...files.map((f) => `(literal ${q(f)})`), ...(a.writeRegex ?? []).map(sbplRegex)];
  const deny = (a.deny ?? []).filter((d) => isAbsolute(d)).map(R);
  return `${rw.length ? `(allow file-read* file-write* ${rw.join(" ")})\n` : ""}${deny.length ? `(deny file-read* file-write* ${deny.map((d) => `(subpath ${q(d)})`).join(" ")})\n` : ""}`;
}
/** Only these programs may start (the round's own CLI, Studio's runtime, the few helpers the CLI runs itself). */
function execRules(exec?: string[] | null): string {
  if (!exec) return "";
  const R = (p: string) => realIf(p) ?? p;
  const allowed = [...new Set(exec.filter((p) => isAbsolute(p) && p !== "/").map(R))];
  const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  return `(deny process-exec)\n${allowed.length ? `(allow process-exec ${allowed.map((p) => isDir(p) ? `(subpath ${q(p)})` : `(literal ${q(p)})`).join(" ")})\n` : ""}`;
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
// The marker env var that tags every process a sandboxed run starts (its descendants inherit it). killGroup kills the
// process group, but a child that calls setsid() makes its own group and escapes it (esc.ts). So when a run ends, Studio —
// unsandboxed, so it can still read other same-uid processes' env — finds every process still carrying this run's marker and
// kills it. This is best-effort cleanup, not a security boundary: an escapee can re-exec without the marker.
// macOS KERN_PROCARGS2 also exposes argv/env despite the seatbelt sysctl rule; credentials must never be placed there.
export function reapMarked(marker: string) {
  if (!marker || process.platform !== "darwin") return;
  try {
    const r = Bun.spawnSync(["/bin/ps", "-Aww", "-E", "-o", "pid=", "-o", "command="], { env: {PATH:"/usr/bin:/bin"}, stdout: "pipe", stderr: "ignore" });
    for (const line of r.stdout.toString().split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (!m || !m[2].includes(`CREW_RUN_KILL=${marker}`)) continue;
      const pid = Number(m[1]); if (pid > 1 && pid !== process.pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
    }
  } catch {}
}
export async function sandboxed(argv: string[], o: { cwd: string; out: string; tmp: string; stdin?: string; timeoutS: number; network: boolean; env?: Record<string, string>; reads?: string[]; dataDir?: string | null; signal?: AbortSignal;
  /** false: argv is untrusted (a reviewer's command), so its program's folder is never added to the reads; the caller resolved it on a fixed PATH */
  argvRead?: boolean;
  /** a run of the project's tests: loopback with sandbox-runtime's allowLocalBinding rules, HOST=127.0.0.1, and the self-probe first */
  testRun?: boolean }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number; refused?: string; aborted?: boolean;
  /** a test run's sandbox, as the self-probe checked it: what it enforces and what it does not */
  sandbox?: { enforced: string; notEnforced: string } }> {
  const t0 = Date.now();
  const unrestricted = localUnrestricted();           // CREW_LOCAL_UNRESTRICTED: no OS sandbox at all, on any platform
  const seatbelt = !unrestricted && seatbeltAvailable();
  const bwrap = !unrestricted && !seatbelt && !!o.testRun && !o.network && bwrapAvailable();
  if (!unrestricted && !seatbelt && !bwrap) return { code: null, stdout: "", stderr: "", timedOut: false, ms: 0, refused: sandboxInfo(!!o.testRun).detail };
  mkdirSync(o.out, { recursive: true }); mkdirSync(o.tmp, { recursive: true });
  const out = realpathSync(o.out), tmp = realpathSync(o.tmp);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmp, TMPDIR: tmp, LANG: "C.UTF-8", CI: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PYTHONDONTWRITEBYTECODE: "1", ...(o.testRun ? LOCAL_BINDING_ENV : {}), ...(o.env ?? {}) };
  const prof = join(tmp, "..", "profile.sb");
  const reads = [o.cwd, ...(o.reads ?? []), ...(o.argvRead !== false && argv[0]?.startsWith("/") ? [dirname(argv[0])] : [])];
  let full = argv;
  if (seatbelt) {
    let ports: number[] = [];
    try {
      ports = o.testRun ? inspectListeningPorts() : [];
      writeFileSync(prof, profileFor({ out, tmp, reads, network: o.network, dataDir: o.dataDir ?? null, cwd: o.cwd, localBinding: !!o.testRun, blockedPorts: ports }));
    } catch (e) { return { code: null, stdout:"", stderr:"", timedOut:false, ms:Date.now()-t0, refused:`test sandbox listener inspection failed: ${String(e)}` }; }
    // a test run is checked first: the profile must hold what Studio claims for it, or the run is refused with the reason
    if (o.testRun) { const leak = selfProbe(prof, denyList(o.dataDir).map((p) => realIf(p) ?? p), ports); if (leak) return { code: null, stdout: "", stderr: "", timedOut: false, ms: Date.now() - t0, refused: leak }; }
    full = ["/usr/bin/sandbox-exec", "-f", prof, ...argv];
  } else if (bwrap) {
    // Linux has no Seatbelt: a test run without network runs under bwrap (v1's layout: private pid/net namespaces, read-only reads)
    full = linuxBwrapArgv(argv, { cwd: o.cwd, reads: [...SYSTEM_READ, ...interpreterDirs(), ...reads], writes: [out, tmp], deny: denyList(o.dataDir) }) ?? argv;
  }
  const sandbox = (seatbelt || bwrap) && o.testRun ? { enforced: TEST_RUN_ENFORCES, notEnforced: bwrap ? "another same-uid process's argv and environment are readable via /proc, so no secret is on a round's argv or in its env (the loopback itself is private under bwrap)" : TEST_RUN_DOES_NOT } : undefined;
  const marker = randomBytes(12).toString("hex"); env.CREW_RUN_KILL = marker; // best effort only: descendants can re-exec without this marker
  return await new Promise((resolveP) => {
    let stdout = "", stderr = "", done = false, timedOut = false, aborted = false;
    const p = spawnChild(full[0], full.slice(1), { cwd: o.cwd, env, detached: true, stdio: [o.stdin != null ? "pipe" : "ignore", "pipe", "pipe"] });
    const killGroup = () => { try { if (p.pid) process.kill(-p.pid, "SIGKILL"); } catch {} reapMarked(marker); };
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); killGroup(); try { p.stdout?.destroy(); p.stderr?.destroy(); } catch {} resolveP({ code: timedOut ? null : code, stdout, stderr, timedOut, ms: Date.now() - t0, aborted, ...(sandbox ? { sandbox } : {}) }); };
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
  egress?: { port: number; open(t: string, h: string[], meta?: any): void; close(t: string): void } | null; hosts?: string[]; env?: Record<string, string>;
  /** more folders to read, and folders to read and execute but never write (src/skillpkg: a skill's copy, its env, Studio's runtimes and tools) */
  reads?: string[]; readOnly?: string[];
  /** what the credential is for (a skill_run call, a prepare): the proxy logs it, a strict one reaches names only and no private address */
  egressMeta?: Record<string, unknown>; signal?: AbortSignal; stdoutCap?: number }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; refused?: string }> {
  const info = sandboxInfo(); if (!info.ok && !localUnrestricted()) return { code: null, stdout: "", stderr: "", timedOut: false, refused: info.detail };
  mkdirSync(join(o.tmp, "home"), { recursive: true }); const tmp = realpathSync(o.tmp);
  const net = !localUnrestricted() && !!o.egress && !!o.hosts?.length;
  const lease = net ? await openScopedProxy(o.egress!, o.hosts!, o.egressMeta) : null;
  try {
  const proxy = lease?.url ?? null;
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(tmp, "home"), TMPDIR: tmp, LANG: "C.UTF-8", CI: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: "localhost,127.0.0.1,::1", NODE_USE_ENV_PROXY: "1" } : {}), ...(o.env ?? {}) };
  const prof = join(tmp, "round.sb");
  writeFileSync(prof, roundProfile({ cwd: o.cwd, tmp, writes: o.writes, reads: [o.cwd, ...(argv[0]?.startsWith("/") ? [dirname(argv[0])] : []), ...(o.reads ?? [])], readOnly: o.readOnly ?? [], proxyPort: lease?.port ?? 1, toolPort: 1, dataDir: o.dataDir ?? null, protect: o.protect ?? [] }));
    return await new Promise((resolveP) => {
      let stdout = "", stderr = "", done = false, timedOut = false;
      const full=localUnrestricted()?argv:["/usr/bin/sandbox-exec","-f",prof,...argv];
      const marker = randomBytes(12).toString("hex"); env.CREW_RUN_KILL = marker;
      const p = spawnChild(full[0],full.slice(1), { cwd: o.cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); try { if (p.pid) process.kill(-p.pid, "SIGKILL"); } catch {} reapMarked(marker); resolveP({ code: timedOut ? null : code, stdout, stderr, timedOut }); };
      const timer = setTimeout(() => { timedOut = true; finish(null); }, o.timeoutS * 1000);
      if (o.signal) { if (o.signal.aborted) setTimeout(() => { timedOut = true; finish(null); }, 0); else o.signal.addEventListener("abort", () => { timedOut = true; finish(null); }, { once: true }); }
      // stdoutCap: keep the tail (a skill_run's last lines); otherwise the first megabyte, as before
      const cap = o.stdoutCap;
      if (cap) { p.stdout?.on("data", (d) => { stdout += d; if (stdout.length > cap * 2) stdout = stdout.slice(-cap); }); p.stderr?.on("data", (d) => { stderr += d; if (stderr.length > cap * 2) stderr = stderr.slice(-cap); }); }
      else { p.stdout?.on("data", (d) => { if (stdout.length < 1_000_000) stdout += d; }); p.stderr?.on("data", (d) => { if (stderr.length < 1_000_000) stderr += d; }); }
      p.on("error", (e) => { stderr += String(e); finish(127); }); p.on("exit", (code) => { setTimeout(() => finish(code), 50); });
    });
  } finally { lease?.close(); }
}

/**
 * The exit-code adapter (check-contract.md "Adapters for existing scripts"): run an
 * argv in the sandbox, pass on the listed exit codes, parse findings from the log.
 * The one executor for adapter checks and for a workflow's or project's `run` gates.
 */
export async function execAdapter(argv: string[], o: { cwd: string; out: string; tmp: string; timeoutS: number; network?: boolean; passOn?: number[]; regex?: string | null; cls?: string; severity?: string;
  ref: string; env?: Record<string, string>; reads?: string[]; dataDir?: string | null; stdin?: string; signal?: AbortSignal; testRun?: boolean }): Promise<CheckOutput & { log: string }> {
  const r = await sandboxed(argv, { cwd: o.cwd, out: o.out, tmp: o.tmp, timeoutS: o.timeoutS, network: !!o.network, env: o.env, reads: o.reads, dataDir: o.dataDir, stdin: o.stdin, signal: o.signal, testRun: o.testRun });
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
      // a torn last entry (a crash inside its write) is cut first, so this entry never lands behind half a line
      endCleanly(this.file());
      const all = this.all(); const last = all.at(-1);
      const rec: any = { ...e, seq: (last?.seq ?? 0) + 1, at: now(), prev: last?.sig ?? null };
      rec.sig = this.sign(rec);
      appendLines(this.file(), [JSON.stringify(rec)]); return rec; // one write, one fsync
    });
  }
  /** One raw snapshot; only consecutive authenticated objects enter prefix.
   * bad uses host-ordered nonblank positions, never an invalid payload's seq. */
  authenticatedPrefix(): { entries: LedgerEntry[]; prefix: LedgerEntry[]; bad: number[]; malformed: boolean } {
    const raw = existsSync(this.file()) ? readFileSync(this.file(), "utf8") : "";
    const entries: LedgerEntry[] = [], prefix: LedgerEntry[] = [], bad: number[] = [];
    let malformed = false, open = true, position = 0, prev: string | null = null;
    const lines = raw.split("\n");
    // a last line with no newline that is not JSON is a write a crash cut short (its add never returned): not an entry,
    // and the next add cuts it off. Any other line that does not parse breaks the chain and is reported in bad.
    if (lines.length && lines.at(-1)!.trim()) { try { JSON.parse(lines.at(-1)!); } catch { lines.pop(); } }
    for (const line of lines) {
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
