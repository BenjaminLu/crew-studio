// Crew Studio's own store, separate from firstmate state. Studio writes only
// here (CREW_DATA, default ./data), and only intents.jsonl.
//   intents.jsonl       Studio appends one record per captured intent
//   intent-links.jsonl  firstmate appends {intent, task} once it drafts a spec for an intent
//   artifacts.json      non-code deliverables shown in the Library (files are served read-only)
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";
import type { FmState, Lineage } from "./fm";
import { withLock } from "./ids";
import type { MergedPr } from "./github";

export type Intent = {
  id: string; ts: string; goal: string; details: string; constraints: string | null; deadline: string | null;
  budget: string | null; text: string; status: "received"; source: string;
};
export type IntentLink = { intent: string; task?: string; status?: "declined"; reason?: string; ts?: string; by?: string };
export type Artifact = { id: string; type: "video" | "web" | "code" | "doc"; title: string; path?: string; url?: string;
  created?: string; approvedBy?: string | null; approvedAt?: string | null; note?: string; intent?: string | null };
export type Step = "received" | "spec" | "dispatch" | "running" | "merged";
export const STEPS: Step[] = ["received", "spec", "dispatch", "running", "merged"];

const readLines = (file: string): any[] => {
  if (!existsSync(file)) return [];
  const out: any[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
};
const expand = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

export class Store {
  constructor(readonly dir: string, readonly fileAllow: string[]) { mkdirSync(dir, { recursive: true }); }

  intents(): Intent[] { return readLines(join(this.dir, "intents.jsonl")); }
  links(): IntentLink[] { return readLines(join(this.dir, "intent-links.jsonl")); }

  capture(a: { goal: string; details?: string; constraints?: string; deadline?: string; budget?: string; text?: string; source?: string }): Intent {
    const goal = String(a.goal ?? "").trim().slice(0, 400);
    if (!goal) throw new Error("goal is required");
    return withLock(this.dir, "intents", () => {
    const n = this.intents().reduce((m, i) => Math.max(m, Number(/^I-(\d+)$/.exec(i.id)?.[1] ?? 0)), 0) + 1;
    const rec: Intent = { id: `I-${String(n).padStart(3, "0")}`, ts: new Date().toISOString(), goal,
      details: String(a.details ?? "").slice(0, 4000), constraints: a.constraints ? String(a.constraints).slice(0, 1000) : null,
      deadline: a.deadline ? String(a.deadline).slice(0, 100) : null, budget: a.budget ? String(a.budget).slice(0, 100) : null,
      text: String(a.text ?? "").slice(0, 4000), status: "received", source: a.source ?? "chat" };
    appendFileSync(join(this.dir, "intents.jsonl"), JSON.stringify(rec) + "\n");
    return rec;
    });
  }

  /** Each intent with its trail: links say which task firstmate drafted; the task's events say the rest. */
  intentView(fm: FmState) {
    const links = this.links();
    return this.intents().map((i) => {
      const mine = links.filter((l) => l.intent === i.id);
      const declined = mine.find((l) => l.status === "declined") ?? null;
      const tasks = [...new Set(mine.map((l) => l.task).filter((t): t is string => !!t && /^T-\d+$/.test(t)))];
      const per = tasks.map((t) => ({ task: t, title: fm.title(t), step: stepOf(fm.lineage(t), fm.known(t)), lineage: fm.lineage(t) }));
      const step: Step = per.length ? per.map((p) => p.step).sort((a, b) => STEPS.indexOf(b) - STEPS.indexOf(a))[0] : "received";
      return { ...i, step, tasks: per, declined };
    }).reverse();
  }

  artifacts(): Artifact[] {
    const f = join(this.dir, "artifacts.json");
    if (!existsSync(f)) return [];
    try { const a = JSON.parse(readFileSync(f, "utf8")); return Array.isArray(a) ? a : []; } catch { return []; }
  }

  /** A registered artifact's file, only when it sits under an allowed directory. */
  file(id: string): string | null {
    const a = this.artifacts().find((x) => x.id === id);
    if (!a?.path) return null;
    const p = normalize(resolve(expand(a.path)));
    if (!this.fileAllow.some((d) => p.startsWith(normalize(resolve(expand(d))) + "/"))) return null;
    try { if (!statSync(p).isFile()) return null; } catch { return null; }
    return p;
  }

  library(fm: FmState, merged: MergedPr[]) {
    const links = this.links();
    const intentOf = (task: string) => links.find((l) => l.task === task)?.intent ?? null;
    const code = merged.map((pr) => {
      const task = /^(T-\d+)\b/.exec(pr.title)?.[1] ?? null;
      const lin: Lineage | null = task && fm.known(task) ? fm.lineage(task) : null;
      return { kind: "code" as const, id: `PR-${pr.number}`, title: task ? fm.title(task) || pr.title.replace(/^T-\d+:\s*/, "") : pr.title,
        ts: pr.mergedAt, pr: pr.number, url: pr.url, commit: pr.commit, branch: pr.branch, checks: pr.checks, task, intent: task ? intentOf(task) : null,
        door: task ? fm.doorOf(task)?.door ?? null : null, lineage: lin };
    });
    const files = this.artifacts().map((a) => ({ kind: a.type, id: a.id, title: a.title, ts: a.approvedAt ?? a.created ?? null,
      url: a.url ?? (a.path ? `/files/${encodeURIComponent(a.id)}` : null), playable: a.type === "video" && !!this.file(a.id),
      external: !!a.url, note: a.note ?? null, approvedBy: a.approvedBy ?? null, intent: a.intent ?? null }));
    return { code, files };
  }
}

/** A linked task is at least "spec drafted"; its dispatch card, the captain's A on it, and the merge move it on. */
export function stepOf(l: Lineage, _known: boolean): Step {
  if (l.merged) return "merged";
  if (l.dispatch) return "running";
  if (l.dispatchAsked) return "dispatch";
  return "spec";
}
