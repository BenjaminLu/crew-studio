// How work from a peer runs on this Studio (docs/units/lan-relay.md): the taker's own workflow, started by the runtime
// (src/runtime/index.ts startLan, the same staffing and start path as the board) with Studio's marks for the restricted
// profile (src/lan/profile.ts), and what the taker may hand back: the output of that Task and nothing else. A Task works
// in a fresh folder of its own: its round's work folder (the artifact versions a deliver step makes) or, for a code
// workflow, its own git worktree under Studio's data (branch lan-untrusted/…). What goes back:
//   - a deliver workflow: the files its steps wrote (text only; Studio's own rendering doc.html is left out);
//   - a code workflow: one patch, changes.patch, of everything the worktree changed against its base (committed or not,
//     new files included), which the dispatcher reviews and applies on its own side (src/lan/apply.ts).
// Every file is read without following a link: a symbolic link (or anything not a regular file) is refused, and a real
// path must stay inside the folder it came from, so an agent cannot point the hand-back at a file outside its sandbox.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { git } from "../git";
import { defHash, LIMITS, type WorkflowRef } from "./protocol";
import { lanOf, nodeNotRun, spent, workflowRefusals } from "./profile";
import { protectedHit } from "./paths";
import type { LanRunner } from "./relay";

export { protectedHit };
const utf8 = (b: Buffer): string | null => { try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return null; } };
/** A regular file inside root, read without following a link: its bytes, or the reason it is refused. */
export function readInside(root: string, rel: string): { bytes: Buffer } | { refused: string } | { gone: true } {
  const abs = join(root, rel);
  let st; try { st = lstatSync(abs); } catch { return { gone: true }; }
  if (st.isSymbolicLink()) return { refused: "a symbolic link" };
  if (!st.isFile()) return { refused: "not a regular file" };
  let real: string, top: string; try { real = realpathSync(abs); top = realpathSync(root); } catch { return { refused: "its real path cannot be read" }; }
  if (!real.startsWith(top + sep)) return { refused: "its real path is outside the Task's folder" };
  if (st.nlink > 1) return { refused: "a hard link" };
  if (st.size > LIMITS.blob) return { refused: "larger than a result may be" };
  return { bytes: readFileSync(real) };
}

export type RunnerDeps = {
  engine: any; defs: any;
  /** the artifact store the deliver steps version their output in (m3.store) */
  artifacts: { version(id: string, n: number): any; filesDir(id: string, n: number): string } | null;
  /** start a Task through the runtime's own start path; throws a refusal */
  start: (o: { workflow: string; text: string; title: string; params: Record<string, string>; profile: { name: "lan"; mark: { item: string; usd: number | null; rounds: number } }; by: string; staffingConfirm?: string | null; project?: string | null; base?: string | null }) => Promise<any>;
  /** an own workflow's staffing plan (its hash is confirmed with the take), or null */
  staffing?: (def: any) => { hash: string; plan: unknown[]; missing: unknown[] } | null;
  /** whether a workflow needs a registered project (a code workflow) */
  needsProject?: (def: any) => boolean;
};

export function lanRunner(d: RunnerDeps): LanRunner {
  const manifest = (ref: string) => { try { return d.engine.registry?.get?.(ref) ?? null; } catch { return null; } };
  const ref = (def: any): WorkflowRef => ({ id: def.id, version: Number(def.version), defHash: defHash(def) });
  return {
    workflows() {
      // every installed workflow, each with the reasons it cannot take work from a peer (internal, retired and held ones too),
      // so a take names its reason instead of "no such workflow"
      const ids = [...new Set<string>((d.defs.list?.() ?? d.defs.catalog?.() ?? []).map((w: any) => String(w.id)))];
      return ids.map((id) => d.defs.get(id)).filter(Boolean).filter((def: any) => !d.defs.trashed?.(def.id)).map((def: any) => {
        const off = d.defs.unavailable?.(def.id) ?? (d.defs.held?.(def.id) ? "held" : null);
        const why = [...(off ? [`${def.id} is ${off}`] : []), ...workflowRefusals(def)], notRun = (def.nodes ?? []).flatMap((n: any) => nodeNotRun(n, manifest));
        return { id: def.id, version: Number(def.version), name: d.defs.displayName?.(def.id) ?? def.name ?? def.id, defHash: defHash(def), eligible: !why.length, why, notRun, staffing: d.staffing?.(def) ?? null, needsProject: !!d.needsProject?.(def) };
      });
    },
    async start(o) {
      const def = d.defs.get(o.workflow); if (!def) throw Object.assign(new Error("no such workflow"), { code: "workflow_unavailable" });
      const off = d.defs.unavailable?.(def.id) ?? null, why = [...(off ? [`${def.id} is ${off}`] : []), ...workflowRefusals(def)];
      if (why.length) throw Object.assign(new Error(why.join("; ")), { code: "profile" });
      // the profile is the runtime's own start option, never a param (src/runtime/engine.ts start)
      const params: Record<string, string> = {}; if (o.provider) params.provider = o.provider;
      const run = await d.start({ workflow: o.workflow, text: o.text, title: o.title, params, profile: { name: "lan", mark: { item: o.item, usd: o.cap.usd, rounds: o.cap.rounds } }, by: o.by, staffingConfirm: o.staffingConfirm ?? null, project: o.project ?? null, base: o.base ?? null });
      return { run: run.id, workflow: ref(run.def) };
    },
    status(id) {
      const r = d.engine.get(id); if (!r) return null;
      // a step the profile refused carries code "profile" (the engine sets it from the refusal, never from its message)
      const stopped = r.steps?.filter((s: any) => s.state === "error" && s.code === "profile").map((s: any) => String(s.error)).at(-1) ?? null;
      const s = spent(d.engine, r);
      return { state: r.status, result: r.result ?? null, spent: { usd: s.usd, rounds: s.rounds }, stopped, ready: r.status === "succeeded" || !!r.ctx?.taintedReady };
    },
    async output(id) {
      const r = d.engine.get(id); if (!r) throw new Error("no such Task");
      if (!lanOf(r)) throw new Error("this Task was not started from a peer's work");
      const files: { path: string; text: string | null; bytes: number }[] = [], changed = new Set<string>(), hits = new Set<string>();
      // a deliver step's versions: every file the round wrote, each read inside its version's folder without following a link
      for (const v of Object.values<any>(r.ctx?.deliver ?? {})) {
        const ver = d.artifacts?.version(v.id, v.n); if (!ver) continue; const root = d.artifacts!.filesDir(v.id, v.n);
        for (const f of ver.files ?? []) { if (v.format === "document" && f.path === "doc.html") continue;
          changed.add(f.path); const got = readInside(root, f.path);
          if ("refused" in got) { hits.add(`${f.path} (${got.refused})`); files.push({ path: f.path, text: null, bytes: 0 }); continue; }
          const b = "bytes" in got ? got.bytes : null; files.push({ path: f.path, text: b ? utf8(b) : null, bytes: b?.length ?? 0 });
          const hit = protectedHit(f.path, b ? utf8(b) : null, null); if (hit) hits.add(hit); }
      }
      // a code workflow's own worktree: everything it changed against its base, as one patch
      const wt = r.ctx?.worktree, base = r.ctx?.baseCommit;
      if (wt && base && existsSync(wt)) {
        const tracked = git(wt, ["diff", "--name-only", "-z", "--no-renames", base]).out.split("\0").filter(Boolean);
        const untracked = git(wt, ["ls-files", "--others", "--exclude-standard", "-z"]).out.split("\0").filter(Boolean);
        const all = [...new Set([...tracked, ...untracked])];
        if (all.length > LIMITS.files * 4) hits.add(`${all.length} changed files (more than ${LIMITS.files * 4} are not handed back)`);
        for (const n of all) {
          changed.add(n); const got = readInside(wt, n), before = git(wt, ["show", `${base}:${n}`]);
          if ("refused" in got) { hits.add(`${n} (${got.refused})`); continue; }
          const after = "bytes" in got ? utf8(got.bytes) : null;
          const hit = protectedHit(n, after, before.ok ? before.out : null); if (hit) hits.add(hit);
        }
        // the patch: tracked changes against the base (links shown as links, never followed), then each new regular file
        const parts = [git(wt, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", base, "--"]).out];
        for (const n of untracked) { const got = readInside(wt, n); if (!("bytes" in got)) continue;
          const p = git(wt, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--binary", "--no-index", "--", "/dev/null", n]); parts.push(p.out); }
        const patch = parts.filter(Boolean).join("\n") + "\n";
        if (Buffer.byteLength(patch) > LIMITS.blob) hits.add("changes.patch (larger than a result may be)");
        files.push({ path: "changes.patch", text: patch.trim() ? patch : null, bytes: Buffer.byteLength(patch) });
      }
      const ledger = (d.engine.ledger?.(id) ?? []).filter((e: any) => e.check && e.kind !== "record" && !String(e.check).startsWith("runtime/"));
      const pass = ledger.filter((e: any) => e.verdict === "pass").length, fail = ledger.filter((e: any) => e.verdict === "fail").length, other = ledger.length - pass - fail;
      return { files: files.slice(0, LIMITS.files), changed: [...changed], protectedHits: [...hits], checks: { pass, fail, other, summary: `${pass}/${ledger.length} checks pass on the taker's Studio (the taker's own report: run them again before relying on it)` }, workflow: ref(r.def), kind: wt ? "patch" : "files", base: wt && base ? String(base) : null };
    },
    findByItem(item) {
      for (const r of d.engine.list?.() ?? []) if (r.profile?.name === "lan" && (r.profile.mark as any)?.item === item) return String(r.id);
      return null;
    },
    cancel(id, why) { try { d.engine.cancel?.(id, "studio (LAN)", why); } catch {} },
  };
}
