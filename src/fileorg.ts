// The file-organization pack's engine: a dry-run plan (no file moves), the
// pack's gates, the captain's review (untick moves), then apply with a
// write-ahead undo log, and undo. It never deletes, never overwrites and never
// leaves the chosen folder; firstmate's checkout and Studio's data are refused.
//   data/fileorg/<plan id>/plan.json    data/fileorg/<plan id>/undo.jsonl
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import type { StudioLog } from "./rawlog";
import { allocate } from "./ids";

export type Rules = { skip_hidden?: boolean; recursive?: boolean; categories: Record<string, string[]>; other?: string };
export type Move = { id: number; from: string; to: string; category: string; size: number; mtimeMs: number; include: boolean; result?: "moved" | "skipped" | "undone" | "kept"; note?: string | null };
export type Plan = { id: string; root: string; createdAt: string; status: "planned" | "applied" | "undone" | "discarded"; moves: Move[]; skipped: { name: string; why: string }[];
  gates: { id: string; label: string; state: "pass" | "fail"; detail: string }[]; appliedAt: string | null; undoneAt: string | null; summary: Record<string, number> };

const BLOCKED = ["/", "/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/opt", "/Volumes"];

export function createFileOrg(o: { dataDir: string; refuse: string[]; rules: () => Rules; gates: () => { id: string; builtin?: string; label?: string; args?: any }[]; log: StudioLog; send: (t: string, d: unknown) => void }) {
  const dir = join(o.dataDir, "fileorg"); mkdirSync(dir, { recursive: true });
  const pdir = (id: string) => join(dir, id.replace(/[^\w-]/g, ""));
  const get = (id: string): Plan | null => { try { return JSON.parse(readFileSync(join(pdir(id), "plan.json"), "utf8")); } catch { return null; } };
  const save = (p: Plan) => { mkdirSync(pdir(p.id), { recursive: true }); writeFileSync(join(pdir(p.id), "plan.json"), JSON.stringify(p, null, 1)); o.send("fileorg", { id: p.id, status: p.status }); };
  const list = (): Plan[] => readdirSync(dir).map((d) => get(d)).filter(Boolean).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)) as Plan[];
  const emit = (p: Plan, type: string, summary: string) => o.log.emit({ type, workflow: "file-organization", task: p.id, summary, data: { root: p.root } });

  /** The chosen folder, if Studio may tidy it. */
  function checkRoot(raw: string): string {
    const p = normalize(String(raw ?? "").trim().replace(/^~(?=\/|$)/, homedir())).replace(/\/+$/, "");
    if (!p.startsWith("/")) throw new Error("give the folder's absolute path");
    if (!existsSync(p) || !statSync(p).isDirectory()) throw new Error(`no such folder: ${p}`);
    const real = realpathSync(p);
    if (BLOCKED.some((b) => real === b || (b !== "/" && real.startsWith(b + "/") && !real.startsWith(realpathSync(homedir()) + "/") && !real.startsWith("/private/var/folders/") && !real.startsWith("/private/tmp/")))) throw new Error("a system folder is not tidied");
    if (real === realpathSync(homedir())) throw new Error("pick a folder inside your home, not the home folder itself");
    for (const r of o.refuse) { if (!existsSync(r)) continue; const rr = realpathSync(r); if (real === rr || real.startsWith(rr + "/")) throw new Error(`that folder is inside ${r}, which Studio never changes`); }
    return real;
  }
  const inside = (root: string, p: string) => { const a = resolve(p); return a.startsWith(root + sep) && !relative(root, a).split(sep).includes(".."); };

  // the pack's gates, as builtins of this engine
  const GATES: Record<string, (p: Plan, a: any) => { ok: boolean; detail: string }> = {
    "fileorg-inside-root": (p) => { const bad = p.moves.filter((m) => m.include && !(inside(p.root, m.from) && inside(p.root, m.to))); return bad.length ? { ok: false, detail: `${bad.length} moves leave the folder` } : { ok: true, detail: "every move stays inside" }; },
    "fileorg-no-overwrite": (p) => { const seen = new Set<string>(); const bad = p.moves.filter((m) => { if (!m.include) return false; const clash = existsSync(m.to) || seen.has(m.to); seen.add(m.to); return clash; });
      return bad.length ? { ok: false, detail: `${bad.length} destinations are taken: ${bad.slice(0, 3).map((m) => relative(p.root, m.to)).join(", ")}` } : { ok: true, detail: "every destination is free" }; },
    "fileorg-max-moves": (p, a) => { const n = p.moves.filter((m) => m.include).length, max = Number(a?.max ?? 500); return n > max ? { ok: false, detail: `${n} moves (max ${max})` } : { ok: true, detail: `${n} moves` }; },
  };
  const runGates = (p: Plan) => { p.gates = o.gates().map((g) => { const f = GATES[g.builtin ?? ""]; const r = f ? f(p, g.args) : { ok: false, detail: `unknown gate ${g.builtin}` }; return { id: g.id, label: g.label ?? g.id, state: r.ok ? "pass" as const : "fail" as const, detail: r.detail }; }); return p.gates; };

  /** A dry run: nothing moves. */
  function plan(rootRaw: string): Plan {
    const root = checkRoot(rootRaw); const rules = o.rules();
    const byExt = new Map<string, string>(); for (const [cat, exts] of Object.entries(rules.categories ?? {})) for (const e of exts) byExt.set(String(e).toLowerCase(), cat);
    const cats = new Set([...Object.keys(rules.categories ?? {}), rules.other ?? "Other"]);
    const moves: Move[] = [], skipped: { name: string; why: string }[] = [], taken = new Set<string>();
    for (const name of readdirSync(root).sort((a, b) => a.localeCompare(b))) {
      const p = join(root, name); const st = lstatSync(p);
      if (rules.skip_hidden !== false && name.startsWith(".")) { skipped.push({ name, why: "hidden" }); continue; }
      if (st.isSymbolicLink()) { skipped.push({ name, why: "a link" }); continue; }
      if (st.isDirectory()) { if (!cats.has(name)) skipped.push({ name, why: "a folder" }); continue; }
      if (!st.isFile()) { skipped.push({ name, why: "not a regular file" }); continue; }
      const cat = byExt.get(extname(name).slice(1).toLowerCase()) ?? rules.other ?? "Other";
      const stem = basename(name, extname(name)), ext = extname(name);
      let to = join(root, cat, name), k = 1;
      while (existsSync(to) || taken.has(to)) to = join(root, cat, `${stem} (${++k})${ext}`);
      taken.add(to);
      moves.push({ id: moves.length + 1, from: p, to, category: cat, size: st.size, mtimeMs: st.mtimeMs, include: true, note: k > 1 ? `renamed: ${basename(to)} (the name was taken)` : null });
    }
    const id = allocate(dir, "P");
    const summary: Record<string, number> = {}; for (const m of moves) summary[m.category] = (summary[m.category] ?? 0) + 1;
    const pl: Plan = { id, root, createdAt: new Date().toISOString(), status: "planned", moves, skipped, gates: [], appliedAt: null, undoneAt: null, summary };
    runGates(pl); save(pl); emit(pl, "fileorg_planned", `${moves.length} moves planned in ${root}`);
    return pl;
  }
  function setIncluded(id: string, include: Record<string, boolean>) {
    const p = get(id); if (!p) throw new Error("no such plan"); if (p.status !== "planned") throw new Error(`this plan is ${p.status}`);
    for (const m of p.moves) if (String(m.id) in include) m.include = include[String(m.id)] === true;
    runGates(p); save(p); return p;
  }
  /** Apply: gates again, then each move after its undo line is written. */
  function apply(id: string) {
    const p = get(id); if (!p) throw new Error("no such plan"); if (p.status !== "planned") throw new Error(`this plan is ${p.status}`);
    checkRoot(p.root);
    runGates(p); const failed = p.gates.filter((g) => g.state === "fail");
    if (failed.length) { save(p); throw new Error(`a gate failed: ${failed.map((g) => `${g.label} (${g.detail})`).join("; ")}`); }
    const undo = join(pdir(p.id), "undo.jsonl");
    for (const m of p.moves) {
      if (!m.include) { m.result = "kept"; continue; }
      let st; try { st = lstatSync(m.from); } catch { m.result = "skipped"; m.note = "gone since the plan"; continue; }
      if (!st.isFile() || st.size !== m.size || st.mtimeMs !== m.mtimeMs) { m.result = "skipped"; m.note = "changed since the plan"; continue; }
      if (existsSync(m.to)) { m.result = "skipped"; m.note = "the destination appeared since the plan"; continue; }
      const madeDir = !existsSync(dirname(m.to));
      appendFileSync(undo, JSON.stringify({ id: m.id, from: m.from, to: m.to, madeDir: madeDir ? dirname(m.to) : null, at: new Date().toISOString() }) + "\n");
      if (madeDir) mkdirSync(dirname(m.to), { recursive: true });
      renameSync(m.from, m.to); m.result = "moved";
    }
    p.status = "applied"; p.appliedAt = new Date().toISOString(); save(p);
    emit(p, "fileorg_applied", `${p.moves.filter((m) => m.result === "moved").length} files moved in ${p.root}`);
    return p;
  }
  /** Undo from the log, last move first; a file that moved again since is left where it is. */
  function undo(id: string) {
    const p = get(id); if (!p) throw new Error("no such plan"); if (p.status !== "applied") throw new Error(`this plan is ${p.status}`);
    const file = join(pdir(p.id), "undo.jsonl");
    const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const dirs: string[] = [];
    for (const u of lines.reverse()) {
      const m = p.moves.find((x) => x.id === u.id);
      if (existsSync(u.to) && !existsSync(u.from)) { renameSync(u.to, u.from); if (m) m.result = "undone"; }
      else if (m) m.note = existsSync(u.from) ? "a file is back at the old name already; left both" : "not at its new place any more; left as is";
      if (u.madeDir) dirs.push(u.madeDir);
    }
    for (const d of [...new Set(dirs)]) { try { if (readdirSync(d).length === 0) rmdirSync(d); } catch {} }
    p.status = "undone"; p.undoneAt = new Date().toISOString(); save(p);
    emit(p, "fileorg_undone", `${p.moves.filter((m) => m.result === "undone").length} files moved back in ${p.root}`);
    return p;
  }
  function discard(id: string) { const p = get(id); if (!p) throw new Error("no such plan"); if (p.status !== "planned") throw new Error(`this plan is ${p.status}`); p.status = "discarded"; save(p); return p; }
  return { plan, setIncluded, apply, undo, discard, get, list, checkRoot };
}
