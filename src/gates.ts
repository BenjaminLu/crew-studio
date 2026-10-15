// Deterministic script gates. A workflow node lists its gates; a project may
// add its own per node. Two kinds:
//   builtin  a check inside Studio (no dependency):
//            no-conflict-markers, no-secrets, max-file-lines {glob,max}, max-diff-lines {max},
//            json-valid, not-empty, commit-mentions {pattern}, paths-allowed {globs}
//   run      an argv run in the change's worktree (exit 0 = pass): an exit-code adapter check, run by the
//            check runtime's sandboxed executor (read-only worktree, out/ only, no network, scrubbed
//            HOME, the process group killed at timeout_s); only from workflow or project config
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execAdapter } from "./runtime/checks";
import { looksSecret } from "./secure";
import { join } from "node:path";
import { matches, type ChangedPath, type Tier } from "./doors";
import type { GateDef } from "./workflows";

export type GateCtx = { dir: string; paths: ChangedPath[]; added: { path: string; line: string }[]; messages: string; tier: Tier };
export type GateResult = { id: string; label: string; node: string; state: "pass" | "fail" | "skip"; detail: string; ms: number; kind: "builtin" | "run" };

const lineCount = (f: string) => { try { return readFileSync(f, "utf8").split("\n").length - (readFileSync(f, "utf8").endsWith("\n") ? 1 : 0); } catch { return 0; } };

export const BUILTINS: Record<string, (c: GateCtx, a: any) => { ok: boolean; detail: string }> = {
  "no-conflict-markers": (c) => { const hit = c.added.find((x) => /^(<{7}|={7}|>{7})( |$)/.test(x.line)); return hit ? { ok: false, detail: `conflict marker in ${hit.path}` } : { ok: true, detail: "none" }; },
  "no-secrets": (c) => { for (const x of c.added) if (looksSecret(x.line)) return { ok: false, detail: `something that looks like a credential in ${x.path}` }; return { ok: true, detail: `${c.added.length} added lines scanned` }; },
  "max-file-lines": (c, a) => { const max = Number(a?.max ?? 1200), glob = String(a?.glob ?? "**");
    const over = c.paths.filter((p) => !p.status?.startsWith("D") && matches(glob, p.path)).map((p) => ({ p: p.path, n: lineCount(join(c.dir, p.path)) })).filter((x) => x.n > max);
    return over.length ? { ok: false, detail: over.map((x) => `${x.p} has ${x.n} lines (cap ${max})`).join("; ") } : { ok: true, detail: `every changed ${glob} file within ${max} lines` }; },
  "max-diff-lines": (c, a) => { const max = Number(a?.max ?? 400); const n = c.paths.reduce((s, p) => s + (p.added ?? 0) + (p.removed ?? 0), 0); return n > max ? { ok: false, detail: `${n} lines changed (max ${max})` } : { ok: true, detail: `${n} lines changed` }; },
  "json-valid": (c) => { for (const p of c.paths.filter((x) => x.path.endsWith(".json") && !x.status?.startsWith("D"))) { try { JSON.parse(readFileSync(join(c.dir, p.path), "utf8")); } catch (e: any) { return { ok: false, detail: `${p.path}: ${String(e?.message ?? e).slice(0, 120)}` }; } } return { ok: true, detail: "every changed JSON file parses" }; },
  "not-empty": (c) => c.paths.length ? { ok: true, detail: `${c.paths.length} paths changed` } : { ok: false, detail: "nothing changed" },
  "commit-mentions": (c, a) => new RegExp(String(a?.pattern ?? "."), "i").test(c.messages) ? { ok: true, detail: "the commit message says it" } : { ok: false, detail: `no commit message matches /${a?.pattern}/` },
  "paths-allowed": (c, a) => { const g: string[] = a?.globs ?? []; const bad = c.paths.filter((p) => !g.some((x) => matches(x, p.path))); return bad.length ? { ok: false, detail: `outside the allowed paths: ${bad.map((b) => b.path).join(", ")}` } : { ok: true, detail: "inside the allowed paths" }; },
};

export async function runGate(g: GateDef, node: string, c: GateCtx): Promise<GateResult> {
  const label = g.label ?? g.id, t0 = Date.now();
  if (g.when?.door && !g.when.door.includes(c.tier)) return { id: g.id, label, node, state: "skip", detail: `only for ${g.when.door.join(", ")}`, ms: 0, kind: g.run ? "run" : "builtin" };
  if (g.builtin) {
    const f = BUILTINS[g.builtin];
    if (!f) return { id: g.id, label, node, state: "fail", detail: `unknown builtin ${g.builtin}`, ms: 0, kind: "builtin" };
    try { const r = f(c, g.args ?? {}); return { id: g.id, label, node, state: r.ok ? "pass" : "fail", detail: r.detail, ms: Date.now() - t0, kind: "builtin" }; }
    catch (e: any) { return { id: g.id, label, node, state: "fail", detail: String(e?.message ?? e), ms: Date.now() - t0, kind: "builtin" }; }
  }
  if (Array.isArray(g.run) && g.run.length) {
    // a `run` gate is an exit-code adapter check: the check runtime's one sandboxed executor
    if (!existsSync(c.dir)) return { id: g.id, label, node, state: "fail", detail: "no worktree", ms: 0, kind: "run" };
    const box = mkdtempSync(join(tmpdir(), "crew-gate-"));
    const r = await execAdapter(g.run.map(String), { cwd: c.dir, out: join(box, "out"), tmp: join(box, "tmp"), timeoutS: g.timeout_s ?? 120, ref: `gate:${g.id}`, cls: g.id });
    const tail = r.log.trim().split("\n").slice(-12).join("\n").slice(-1500);
    rmSync(box, { recursive: true, force: true });
    return { id: g.id, label, node, state: r.verdict === "pass" ? "pass" : "fail", detail: r.verdict === "pass" ? tail.split("\n").at(-1) || "exit 0" : `${r.error ?? r.findings[0]?.message ?? "failed"}\n${tail}`, ms: Date.now() - t0, kind: "run" };
  }
  return { id: g.id, label, node, state: "fail", detail: "a gate needs builtin or run", ms: 0, kind: "builtin" };
}
