// A round's skill tools (docs/units/skill-packages.md §5). Rounds have no native shell or file tools, so a skill's folder and
// scripts reach the agent only through Studio:
//   skill_files(skill)                  the files of the round's read-only copy of a pinned skill
//   skill_read(skill, path)             one text file of it
//   skill_run(skill, script, args)      one of its detected scripts, run in the round's own sandbox: it writes only what the
//                                       round writes, reads the copy, its prepared env, the runtimes and Studio's tools read-only,
//                                       and reaches only the hosts the captain approved for that exact version, through a
//                                       credential of its own (the agent's other commands never get them)
// skill_run exists only for an approved script skill; package managers fail with a clear error (an install at run time
// would be code nobody approved); each call is recorded with the skill, version, both hashes, the script and its hash.
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { roundExec } from "../runtime/checks";
import type { EgressEvent } from "../egress";
import type { SkillPackages, SkillStatus } from "./index";
import { envDir } from "./prepare";

export type SkillRunRecord = { skill: string; v: number; sha256: string; filesSha256: string; script: string; scriptSha256: string; argv: string[]; cwd: string; exit: number | null; ms: number; timedOut: boolean;
  stdoutTail: string; stderrTail: string; egress: { allowed: string[]; refused: { host: string; why: string }[] } };
export type RoundSkill = { id: string; v: number; sha256: string; filesSha256: string; dir: string; status: SkillStatus; run: boolean };
type Egress = { port: number; open(t: string, h: string[], meta?: any): void; close(t: string): void; listen?(f: (e: EgressEvent) => void): () => void };
export const SKILL_RUN_MAX = 30;
const TAIL = 64 * 1024;
/** Package managers a skill's script may try: each answers with why it cannot run here. */
const MANAGERS = ["npm", "npx", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "uvx", "pipx", "brew", "apt-get", "apt", "gem", "cargo", "go"];

export function skillTools(o: { skills: RoundSkill[]; packages: SkillPackages; round: { cwd: string; writes: string[]; tmp: string; dataDir: string; protect: string[]; egress: Egress | null; run: string; node: string; visit: number; signal?: AbortSignal };
  record: (r: SkillRunRecord) => void; max?: number }) {
  const by = (id: unknown) => { const s = o.skills.find((x) => x.id === String(id ?? "")); if (!s) throw new Error(`no skill ${String(id)} on this step (pinned: ${o.skills.map((x) => x.id).join(", ") || "none"})`); return s; };
  const inside = (s: RoundSkill, rel: unknown) => {
    const r = String(rel ?? ""); if (!r || r.length > 400 || r.startsWith("/") || r.includes("\\") || r.split("/").some((x) => !x || x === "." || x === "..")) throw new Error("a path inside the skill, relative, with no ..");
    const p = join(s.dir, r); for (let at = s.dir, i = 0, parts = r.split("/"); i < parts.length; i++) { at = join(at, parts[i]); const st = lstatSync(at, { throwIfNoEntry: false }); if (!st) throw new Error(`${r} is not in ${s.id}`); if (st.isSymbolicLink()) throw new Error(`${r} is a link`); }
    return p;
  };
  // the shims: a package manager on PATH before any real one, failing with the reason
  const shims = join(o.round.tmp, "skill-shims"); mkdirSync(shims, { recursive: true });
  for (const m of MANAGERS) writeFileSync(join(shims, m), `#!/bin/sh\necho "Studio: ${m} is not available when a skill runs. A skill's dependencies come from the lockfiles inside it (package-lock.json, uv.lock, requirements with hashes) and Studio installs them before the round; nothing is installed at run time. Use what is already installed, or ask for a new skill version whose lockfile has the package." >&2\nexit 127\n`, { mode: 0o755 });
  let calls = 0;
  const list = (s: RoundSkill) => { const out: { path: string; bytes: number }[] = []; const walk = (rel: string) => { for (const e of readdirSync(join(s.dir, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(r); else if (e.isFile()) out.push({ path: r, bytes: lstatSync(join(s.dir, r)).size }); } }; walk(""); return out.sort((a, b) => a.path.localeCompare(b.path)); };
  const tools = [
    { name: "skill_files", description: "List the files of a skill this step pins (its read-only copy). Paths are relative to the skill's folder.",
      schema: { type: "object", properties: { skill: { type: "string" } }, required: ["skill"] },
      run: (a: any) => { const s = by(a?.skill); const files = list(s); return { skill: `${s.id}@v${s.v}`, folder: s.dir, files: files.slice(0, 500), more: Math.max(0, files.length - 500) }; } },
    { name: "skill_read", description: "Read one text file of a skill this step pins (relative path, e.g. references/x.md). Up to 256 KiB per call; offset continues a longer file.",
      schema: { type: "object", properties: { skill: { type: "string" }, path: { type: "string" }, offset: { type: "number" } }, required: ["skill", "path"] },
      run: (a: any) => { const s = by(a?.skill), p = inside(s, a?.path); const st = lstatSync(p); if (!st.isFile()) throw new Error(`${a.path} is not a file`);
        const b = readFileSync(p); if (b.subarray(0, 8000).includes(0)) throw new Error(`${a.path} is a binary file`);
        const off = Math.max(0, Math.floor(Number(a?.offset ?? 0)) || 0), chunk = b.subarray(off, off + 256 * 1024);
        return { skill: `${s.id}@v${s.v}`, path: a.path, bytes: b.length, offset: off, text: chunk.toString("utf8"), more: off + chunk.length < b.length ? b.length - off - chunk.length : 0 }; } },
  ];
  if (!o.skills.some((s) => s.run)) return tools;
  tools.push({ name: "skill_run", description: `Run one script of an approved skill this step pins, in this round's sandbox: it can write where this step writes (its cwd), reads the skill's folder and its prepared dependencies, and reaches only the hosts approved for that skill version. No package installs. args: the script's arguments. At most ${o.max ?? SKILL_RUN_MAX} calls per round; output is cut to its last 64 KiB.`,
    schema: { type: "object", properties: { skill: { type: "string" }, script: { type: "string" }, args: { type: "array", items: { type: "string" } }, timeout_s: { type: "number" } }, required: ["skill", "script"] },
    run: async (a: any) => {
      const s = by(a?.skill); if (!s.run) throw new Error(`${s.id}@v${s.v}'s scripts are not enabled here (${s.status.state === "text-only" ? "the captain chose text only" : s.status.state})`);
      if (s.status.blocking) throw new Error(`${s.id}@v${s.v} is not ready: ${s.status.reasons.map((r) => r.en).join("; ")}`);
      const pkg = o.packages.pkg(s.id, s.v)!; const script = pkg.scripts.find((x) => x.path === String(a?.script ?? "").replace(/^\.\//, ""));
      if (!script) throw new Error(`${a?.script} is not a script of ${s.id}@v${s.v} (scripts: ${pkg.scripts.map((x) => x.path).slice(0, 20).join(", ")})`);
      const args = a?.args ?? []; if (!Array.isArray(args) || args.length > 64 || args.some((x: unknown) => typeof x !== "string" || x.length > 4096 || x.includes("\0"))) throw new Error("args: up to 64 strings, each under 4096 characters");
      if (++calls > (o.max ?? SKILL_RUN_MAX)) throw new Error(`skill_run limit reached (${o.max ?? SKILL_RUN_MAX} per round)`);
      const st = s.status, env = st.envKey ? envDir(o.round.dataDir, st.envKey) : null;
      const venv = env && st.env?.python ? join(env, "py", "venv") : null, nodeModules = env && st.env?.npm ? join(env, "node", "node_modules") : null;
      const path = join(s.dir, script.path);
      const argv = script.lang === "python" ? [venv ? join(venv, "bin", "python") : st.runtimes.python?.bin ?? "", path, ...args]
        : script.lang === "node" ? [st.runtimes.node?.bin ?? "", path, ...args] : script.lang === "shell" ? ["/bin/bash", path, ...args] : [];
      if (!argv[0]) throw new Error(`${script.path}: Studio runs Python, Node and shell scripts; this one is ${script.lang}${script.lang !== "other" ? " and its runtime is missing" : ""}`);
      const binDirs = [...new Set(st.bins.filter((b) => b.path && b.state !== "missing").map((b) => dirname(b.path!)))];
      const PATH = [shims, venv ? join(venv, "bin") : null, nodeModules ? join(nodeModules, ".bin") : null, st.runtimes.node ? dirname(st.runtimes.node.bin) : null, st.runtimes.python ? dirname(st.runtimes.python.bin) : null, ...binDirs, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(":");
      const tmp = join(o.round.tmp, `skill-run-${calls}`); mkdirSync(tmp, { recursive: true });
      const heard: EgressEvent[] = []; const tag = `${s.id}@v${s.v}`;
      const stop = o.round.egress?.listen?.((e) => { if (e.skill === tag && e.script === script.path && e.run === o.round.run) heard.push(e); }) ?? (() => {});
      const t0 = Date.now();
      let r;
      try {
        r = await roundExec(argv, { cwd: o.round.cwd, writes: o.round.writes, tmp, dataDir: o.round.dataDir, protect: o.round.protect, timeoutS: Math.min(300, Math.max(5, Number(a?.timeout_s) || 300)),
          egress: o.round.egress, hosts: st.decision?.hosts ?? [], egressMeta: { purpose: "skill", run: o.round.run, node: o.round.node, visit: o.round.visit, skill: tag, script: script.path, strict: true },
          reads: [s.dir, shims], readOnly: [s.dir, shims, ...o.packages.runReads(st)], signal: o.round.signal, stdoutCap: TAIL,
          env: { PATH, SKILL_DIR: s.dir, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1", PIP_NO_INDEX: "1", npm_config_offline: "true", ...(venv ? { VIRTUAL_ENV: venv } : {}), ...(nodeModules ? { NODE_PATH: nodeModules } : {}) } });
      } finally { stop(); }
      const refused = heard.filter((e) => !e.allowed).map((e) => ({ host: e.host, why: e.why ?? "refused" })), allowed = [...new Set(heard.filter((e) => e.allowed).map((e) => e.host))];
      const rec: SkillRunRecord = { skill: s.id, v: s.v, sha256: s.sha256, filesSha256: s.filesSha256, script: script.path, scriptSha256: script.sha256, argv: args, cwd: o.round.cwd, exit: r.code, ms: Date.now() - t0, timedOut: r.timedOut,
        stdoutTail: r.stdout.slice(-2000), stderrTail: r.stderr.slice(-2000), egress: { allowed, refused } };
      try { o.record(rec); } catch {}
      if (r.refused) throw new Error(`the script could not run in the sandbox: ${r.refused}`);
      const hostNote = refused.length ? `skill ${tag} tried ${[...new Set(refused.map((x) => x.host))].join(", ")}, not in its approved hosts${st.decision?.hosts.length ? ` (${st.decision.hosts.join(", ")})` : " (it has none)"}; Studio refused it. A new skill version (or a team change) is the way to change that; nobody is asked during a run.` : null;
      return { skill: tag, script: script.path, exit: r.code, timedOut: r.timedOut, ms: rec.ms, stdout: r.stdout.slice(-TAIL), stderr: r.stderr.slice(-TAIL), ...(hostNote ? { refusedHosts: refused, note: hostNote } : {}) };
    } } as any);
  return tools;
}
/** The prompt footer for a pinned skill: where its files are and which tools reach them (none of this for a text skill). */
export function skillFooter(s: { id: string; v: number; dir: string | null; state: string; run: boolean; missing: string[] }): string {
  if (s.state === "text-only") return `\n\n(Studio: this skill's scripts are not enabled here; do not try to run or recreate them.)`;
  if (!s.dir) return "";
  return `\n\n(Studio: this skill's files are a read-only folder: ${s.dir}. List: skill_files("${s.id}"). Read: skill_read("${s.id}", "<path>").${s.run ? ` Run a script: skill_run("${s.id}", "<script path>", [args]); its dependencies are installed, so never install packages.` : ""}${s.missing.length ? ` Not available on this Mac: ${s.missing.join(", ")}; steps that need them will fail, so say so instead of working around it.` : ""})`;
}
