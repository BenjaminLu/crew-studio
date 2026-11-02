// How work from a peer runs on this Studio (docs/units/lan-relay.md): the taker's own workflow, started by the runtime
// (src/runtime/index.ts startLan, the same staffing and start path as the board) with Studio's marks for the restricted
// profile (src/lan/profile.ts), and what the taker may hand back: the output of that Task and nothing else. A Task works
// in a fresh folder of its own: its round's work folder (the artifact versions a deliver step makes) or, for a code
// workflow, its own git worktree under Studio's data. The hand-back gate reads what the Task actually changed.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "../git";
import { defHash, LIMITS, type WorkflowRef } from "./protocol";
import { lanOf, nodeNotRun, spent, workflowRefusals } from "./profile";
import type { LanRunner } from "./relay";

/** Paths an output from a peer may never change (CSO B1.3): CI configuration, git hooks, package scripts and install config. */
const PROTECTED: RegExp[] = [/^\.github\//, /^\.gitlab-ci\.ya?ml$/, /^\.gitlab\//, /^\.circleci\//, /^\.buildkite\//, /^\.travis\.ya?ml$/, /^azure-pipelines\.ya?ml$/, /^\.azure-pipelines\//, /^bitbucket-pipelines\.ya?ml$/,
  /(^|\/)Jenkinsfile$/, /^\.drone\.ya?ml$/, /^\.woodpecker(\/|\.ya?ml$)/, /^\.husky\//, /^\.githooks\//, /^\.git\//, /^\.?lefthook(-local)?\.ya?ml$/, /^\.pre-commit-config\.ya?ml$/, /(^|\/)\.npmrc$/, /(^|\/)\.yarnrc(\.ya?ml)?$/, /(^|\/)bunfig\.toml$/];
const SCRIPT_KEYS = ["scripts", "husky", "simple-git-hooks", "lint-staged", "pre-commit", "gitHooks"];
/** Why a changed path is refused at hand-back, or null. package.json counts only when its scripts or hook keys changed (or, with no base, exist). */
export function protectedHit(path: string, after: string | null, before: string | null): string | null {
  const p = path.replace(/^\.\//, "");
  if (PROTECTED.some((re) => re.test(p))) return p;
  if (/(^|\/)package\.json$/.test(p)) {
    const keys = (t: string | null) => { if (t === null) return "{}"; try { const j = JSON.parse(t); return JSON.stringify(Object.fromEntries(SCRIPT_KEYS.map((k) => [k, j?.[k] ?? null]))); } catch { return "unparsable"; } };
    const a = keys(after), b = keys(before);
    if (a !== b && !(before === null && a === JSON.stringify(Object.fromEntries(SCRIPT_KEYS.map((k) => [k, null]))))) return `${p} (scripts or git hooks)`;
  }
  return null;
}
const utf8 = (b: Buffer): string | null => { try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return null; } };

export type RunnerDeps = {
  engine: any; defs: any;
  /** the artifact store the deliver steps version their output in (m3.store) */
  artifacts: { version(id: string, n: number): any; file(id: string, n: number, rel: string): string | null } | null;
  /** start a Task through the runtime's own start path; throws a refusal */
  start: (o: { workflow: string; text: string; title: string; params: Record<string, string>; by: string; staffingConfirm?: string | null }) => Promise<any>;
  /** an own workflow's staffing plan (its hash is confirmed with the take), or null */
  staffing?: (def: any) => { hash: string; plan: unknown[]; missing: unknown[] } | null;
};

export function lanRunner(d: RunnerDeps): LanRunner {
  const manifest = (ref: string) => { try { return d.engine.registry?.get?.(ref) ?? null; } catch { return null; } };
  const ref = (def: any): WorkflowRef => ({ id: def.id, version: Number(def.version), defHash: defHash(def) });
  return {
    workflows() {
      return (d.defs.catalog?.() ?? []).map((w: any) => d.defs.get(w.id)).filter(Boolean).filter((def: any) => !d.defs.held?.(def.id)).map((def: any) => {
        const why = workflowRefusals(def), notRun = (def.nodes ?? []).flatMap((n: any) => nodeNotRun(n, manifest));
        const staffing = d.staffing?.(def) ?? null;
        return { id: def.id, version: Number(def.version), name: d.defs.displayName?.(def.id) ?? def.name ?? def.id, defHash: defHash(def), eligible: !why.length, why, notRun, staffing };
      });
    },
    async start(o) {
      const def = d.defs.get(o.workflow); if (!def) throw Object.assign(new Error("no such workflow"), { code: "workflow_unavailable" });
      const why = workflowRefusals(def); if (why.length) throw Object.assign(new Error(why.join("; ")), { code: "profile" });
      const params: Record<string, string> = { _lan: JSON.stringify({ item: o.item, usd: o.cap.usd, rounds: o.cap.rounds }), _tainted: "lan" };
      if (o.provider) params.provider = o.provider;
      const run = await d.start({ workflow: o.workflow, text: o.text, title: o.title, params, by: o.by, staffingConfirm: o.staffingConfirm ?? null });
      return { run: run.id, workflow: ref(run.def) };
    },
    status(id) {
      const r = d.engine.get(id); if (!r) return null;
      const stopped = r.steps?.filter((s: any) => s.state === "error" && /spend cap|not allowed on work from a peer|not on the LAN profile/.test(String(s.error ?? ""))).map((s: any) => String(s.error)).at(-1) ?? null;
      return { state: r.status, result: r.result ?? null, spent: spent(d.engine, r), stopped };
    },
    async output(id) {
      const r = d.engine.get(id); if (!r) throw new Error("no such Task");
      if (!lanOf(r)) throw new Error("this Task was not started from a peer's work");
      const files: { path: string; text: string | null; bytes: number }[] = [], changed = new Set<string>(), hits = new Set<string>();
      const add = (path: string, b: Buffer | null, before: string | null) => {
        changed.add(path); const text = b && b.length <= LIMITS.blob ? utf8(b) : null;
        files.push({ path, text, bytes: b?.length ?? 0 });
        const hit = protectedHit(path, b ? utf8(b) : null, before); if (hit) hits.add(hit);
      };
      // a deliver step's versions: every file the round wrote (Studio's own rendering of doc.md, doc.html, is left out)
      for (const v of Object.values<any>(r.ctx?.deliver ?? {})) {
        const ver = d.artifacts?.version(v.id, v.n); if (!ver) continue;
        for (const f of ver.files ?? []) { if (v.format === "document" && f.path === "doc.html") continue;
          const abs = d.artifacts!.file(v.id, v.n, f.path); add(f.path, abs && existsSync(abs) ? readFileSync(abs) : null, null); }
      }
      // a code workflow's own worktree: what changed against its base commit, committed or not, and new files
      const wt = r.ctx?.worktree, base = r.ctx?.baseCommit;
      if (wt && base && existsSync(wt)) {
        const names = [...new Set([...git(wt, ["diff", "--name-only", "-z", base]).out.split("\0"), ...git(wt, ["ls-files", "--others", "--exclude-standard", "-z"]).out.split("\0")].filter(Boolean))];
        for (const n of names.slice(0, LIMITS.files * 4)) {
          const abs = join(wt, n), before = git(wt, ["show", `${base}:${n}`]);
          add(n, existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : null, before.ok ? before.out : null);
        }
      }
      const ledger = (d.engine.ledger?.(id) ?? []).filter((e: any) => e.check && e.kind !== "record" && !String(e.check).startsWith("runtime/"));
      const pass = ledger.filter((e: any) => e.verdict === "pass").length, fail = ledger.filter((e: any) => e.verdict === "fail").length, other = ledger.length - pass - fail;
      return { files: files.slice(0, LIMITS.files), changed: [...changed], protectedHits: [...hits], checks: { pass, fail, other, summary: `${pass}/${ledger.length} checks pass on the taker's Studio (the taker's own report: run them again before relying on it)` }, workflow: ref(r.def) };
    },
    cancel(id, why) { try { d.engine.cancel?.(id, "studio (LAN)", why); } catch {} },
  };
}
