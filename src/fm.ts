// Read-only view of a firstmate state directory. Nothing here writes to it:
// every file is opened for reading, and the only side effect is in-memory
// caches that follow the files as firstmate appends to them.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Text = { en: string; "zh-TW": string };
export type Ev = {
  seq: number; ts: string; actor: string; type: string; task: string | null; project: string | null;
  pr: number | null; summary: Text; activity: Text | null; role: string | null; round: number | null;
  decision: string | null; chosen: string | null; effect: string | null;
};
export type NodeId = "dispatch" | "door" | "plan" | "failfirst" | "build" | "ci" | "review" | "gates" | "merge" | "done";
export type Task = {
  id: string; project: string | null; title: string; door: "one-way" | "two-way" | null; doorReason: string | null;
  pr: number | null; node: NodeId; status: "needs-you" | "running" | "failed" | "done" | "idle";
  failure: { type: string; summary: Text; ts: string } | null; firstTs: string; lastTs: string; lastType: string;
  lastSummary: Text; actors: string[]; currentActor: string | null; round: number | null; pinVersion: number | null;
  mergedTs: string | null;
};
export type Card = {
  id: string; task: string | null; kind: string | null; purpose: string | null; project: string | null; pr: number | null;
  title: string; ts: string | null; details: { en?: any; "zh-TW"?: any } | null; boardOnly: string | null;
};
export type Actor = {
  actor: string; name: string; role: string; task: string | null; round: number | null; attempt: number | null;
  vendor: string | null; model: string | null; alive: boolean; started: string | null; lastWrite: string | null;
  activity: Text | null; lines: LogLine[];
  /** how the round ended (last-result.json), when it has; and whether it left a final report (final.txt) */
  result: { status: string; exitCode: number | null; at: string | null } | null; report: boolean;
};
export type LogLine = { t: string | null; kind: "text" | "tool" | "task" | "error" | "result" | "fm"; text: string };

const TASK_RE = /^T-\d+$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const text = (v: any): Text => ({ en: str(v?.en) || str(v), "zh-TW": str(v?.["zh-TW"]) || str(v?.en) || str(v) });

export class FmState {
  events: Ev[] = [];
  private offset = 0;
  private partial = "";
  private tasks = new Map<string, Agg>();
  private pinCache = new Map<string, { mtime: number; pin: PinInfo | null }>();
  private crewDirs: { dir: string; mtime: number }[] = [];
  private crewScan = 0;
  private lastActivity = new Map<string, Text>();

  constructor(readonly root: string) {}

  /** Read whatever was appended to events.jsonl since the last call. Returns the new events. */
  pollEvents(): Ev[] {
    const file = join(this.root, "events.jsonl");
    if (!existsSync(file)) return [];
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) { this.offset = 0; this.partial = ""; this.events = []; this.tasks.clear(); this.lastActivity.clear(); }
      if (size === this.offset) return [];
      const fresh: Ev[] = [];
      const chunk = 4 << 20;
      while (this.offset < size) {
        const buf = Buffer.alloc(Math.min(chunk, size - this.offset));
        const n = readSync(fd, buf, 0, buf.length, this.offset);
        if (n <= 0) break;
        this.offset += n;
        const lines = (this.partial + buf.subarray(0, n).toString("utf8")).split("\n");
        this.partial = lines.pop() ?? "";
        for (const line of lines) {
          const ev = this.parse(line);
          if (ev) { this.events.push(ev); this.fold(ev); if (ev.activity) this.lastActivity.set(ev.actor, ev.activity); fresh.push(ev); }
        }
      }
      return fresh;
    } finally { closeSync(fd); }
  }

  private parse(line: string): Ev | null {
    if (!line.trim()) return null;
    let o: any;
    try { o = JSON.parse(line); } catch { return null; }
    if (!o || typeof o.type !== "string") return null;
    const data = o.data ?? {};
    const pr = Number.isInteger(o.pr) ? o.pr : Number.isInteger(data.pr) ? data.pr : null;
    return {
      seq: this.events.length, ts: str(o.ts), actor: str(o.actor), type: o.type,
      task: typeof o.task === "string" && o.task ? o.task : null, project: str(o.project) || null, pr,
      summary: text(o.summary), activity: data.activity ? text(data.activity) : null,
      role: str(data.role) || str(data.identity?.role) || null,
      round: Number.isInteger(data.identity?.round) ? data.identity.round : null,
      decision: str(data.decision) || null, chosen: str(data.chosen) || null, effect: str(data.effect) || null,
    };
  }

  private fold(ev: Ev) {
    if (!ev.task || !TASK_RE.test(ev.task)) return;
    let a = this.tasks.get(ev.task);
    if (!a) {
      a = { id: ev.task, project: ev.project, firstTs: ev.ts, lastTs: ev.ts, lastType: ev.type, lastSummary: ev.summary,
        pr: null, node: "dispatch", failure: null, actors: new Set(), lastActor: null, round: null, merged: null, title: null };
      this.tasks.set(ev.task, a);
    }
    a.lastTs = ev.ts; a.lastType = ev.type; a.lastSummary = ev.summary;
    if (ev.project && !a.project) a.project = ev.project;
    if (ev.pr) a.pr = ev.pr;
    const isWorker = ev.actor.startsWith("worker-"), isReviewer = ev.actor.startsWith("reviewer-");
    if (isWorker || isReviewer) { a.actors.add(ev.actor); a.lastActor = ev.actor; if (ev.round) a.round = ev.round; }
    const en = ev.summary.en;
    switch (ev.type) {
      case "decision_requested":
        if (/^MERGE CARD/i.test(en)) a.node = "merge";
        else if (/^Dispatch/i.test(en)) { a.node = "dispatch"; a.title ??= en.replace(/^Dispatch\s+T-\d+:\s*/i, ""); }
        break;
      case "decision_made": if (a.node === "dispatch") a.node = "door"; break;
      case "spec_pinned": case "spec_repinned": if (a.node === "dispatch" || a.node === "door") a.node = "build"; break;
      case "dispatched": case "agent_finished": case "worker_crashed":
        if (isWorker && a.node !== "merge" && a.node !== "done") a.node = "build";
        if (ev.type === "dispatched") a.failure = null;
        if (ev.type === "worker_crashed") a.failure = { type: ev.type, summary: ev.summary, ts: ev.ts };
        break;
      case "crew_status":
        if (isWorker && !["merge", "done", "ci", "review", "gates"].includes(a.node)) a.node = "build";
        if (isReviewer && a.node !== "merge" && a.node !== "done") a.node = "review";
        break;
      case "pr_opened": case "commit_pushed": a.node = "ci"; a.failure = null; break;
      case "review_opened": a.node = "review"; break;
      case "review_failed": a.node = "build"; a.failure = { type: ev.type, summary: ev.summary, ts: ev.ts }; break;
      case "approved": case "gate_passed": a.node = "gates"; a.failure = null; break;
      case "gate_failed": case "protocol_violation": case "agent_lost":
        a.failure = { type: ev.type, summary: ev.summary, ts: ev.ts }; break;
      case "merged": a.node = "done"; a.merged = ev.ts; a.failure = null; break;
    }
  }

  private pin(task: string): PinInfo | null {
    const dir = join(this.root, "pins", task);
    let mtime = 0;
    try { mtime = statSync(dir).mtimeMs; } catch { return null; }
    const hit = this.pinCache.get(task);
    if (hit && hit.mtime === mtime) return hit.pin;
    let pin: PinInfo | null = null;
    try {
      const latest = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).sort((x, y) => parseInt(y) - parseInt(x))[0];
      if (latest) {
        const o = JSON.parse(readFileSync(join(dir, latest), "utf8"));
        let spec: any = {};
        try { spec = JSON.parse(o?.snapshots?.spec?.text ?? "{}"); } catch {}
        const kind = o?.door?.kind;
        pin = { version: Number.isInteger(o.version) ? o.version : parseInt(latest),
          title: str(spec.public_title) || str(spec.title),
          door: kind === "one-way" || kind === "two-way" ? kind : null, doorReason: str(o?.door?.reason) || null };
      }
    } catch {}
    this.pinCache.set(task, { mtime, pin });
    return pin;
  }

  pending(): Card[] {
    const dir = join(this.root, "pending");
    if (!existsSync(dir)) return [];
    const out: Card[] = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
      try {
        const o = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const d = o.details ?? null;
        const purpose = str(o.purpose) || null;
        // The board alone carries the confirmation steps of these cards.
        const boardOnly = purpose === "retro" ? "retro" : null; // a one-way door check is answered in Studio too (/api/answer/check-door)
        out.push({ id: str(o.id) || f.replace(/\.json$/, ""), task: str(o.task) || null, kind: str(o.kind) || null, purpose,
          project: str(o.project) || null, pr: Number.isInteger(o.pr) ? o.pr : null,
          title: str(o.title) || str(d?.en?.title) || str(o.question) || f, ts: str(o.ts) || null, details: d, boardOnly });
      } catch {}
    }
    return out;
  }

  taskList(alive: Set<string>, pending: Card[], recentDays = 3): Task[] {
    const needs = new Set(pending.map(c => c.task).filter(Boolean) as string[]);
    const cutoff = Date.now() - recentDays * 86400e3;
    const out: Task[] = [];
    for (const a of this.tasks.values()) {
      const merged = a.merged !== null;
      if (merged && Date.parse(a.merged!) < cutoff) continue;
      // an unmerged task nobody touched for three days is history, unless a card waits on it
      if (!merged && Date.parse(a.lastTs) < cutoff && !needs.has(a.id) && !live0(a, alive)) continue;
      if (!merged && a.lastType === "closed" && !needs.has(a.id)) continue;
      const pin = this.pin(a.id);
      const door = pin?.door ?? null;
      let node = a.node;
      if (node === "build" && door === "one-way" && a.pr === null) node = "plan";
      const live = [...a.actors].filter(x => alive.has(x));
      const status: Task["status"] = needs.has(a.id) ? "needs-you" : live.length ? "running" : merged ? "done" : a.failure ? "failed" : "idle";
      out.push({ id: a.id, project: a.project, title: pin?.title || a.title || "", door, doorReason: pin?.doorReason ?? null,
        pr: a.pr, node, status, failure: status === "failed" || status === "running" ? a.failure : null,
        firstTs: a.firstTs, lastTs: a.lastTs, lastType: a.lastType, lastSummary: a.lastSummary, actors: [...a.actors],
        currentActor: live[live.length - 1] ?? a.lastActor, round: a.round, pinVersion: pin?.version ?? null, mergedTs: a.merged });
    }
    const rank = { "needs-you": 0, running: 1, failed: 2, idle: 3, done: 4 } as const;
    return out.sort((x, y) => rank[x.status] - rank[y.status] || y.lastTs.localeCompare(x.lastTs));
  }

  activity(q: { task?: string; type?: string; actor?: string; limit?: number; before?: number; since?: string }): Ev[] {
    const limit = Math.min(500, Math.max(1, q.limit ?? 150));
    const out: Ev[] = [];
    for (let i = Math.min(q.before ?? this.events.length, this.events.length) - 1; i >= 0 && out.length < limit; i--) {
      const e = this.events[i];
      if (q.since && e.ts < q.since) break;
      if (q.task && e.task !== q.task) continue;
      if (q.type && e.type !== q.type) continue;
      if (q.actor && !e.actor.includes(q.actor)) continue;
      out.push(e);
    }
    return out;
  }

  /** Title of a task from its pin, else from its dispatch card. */
  title(task: string): string { return this.pin(task)?.title || this.tasks.get(task)?.title || ""; }
  doorOf(task: string) { const p = this.pin(task); return p ? { door: p.door, reason: p.doorReason, version: p.version } : null; }
  known(task: string) { return this.tasks.has(task); }

  /** How a task got from its dispatch card to its merge: the cards, the rounds, the reviews, the merge. */
  lineage(task: string): Lineage {
    const out: Lineage = { task, dispatchAsked: null, dispatch: null, rounds: 0, workers: [], reviews: [], merge: null, merged: null, cards: [] };
    const rounds = new Set<string>();
    const asked = new Map<string, { title: string; ts: string; kind: "dispatch" | "merge" | "other" }>();
    let lastAsk: { title: string; ts: string; kind: "dispatch" | "merge" | "other" } | null = null;
    for (const e of this.events) {
      if (e.task !== task) continue;
      if (e.type === "decision_requested") {
        const en = e.summary.en;
        lastAsk = { title: en, ts: e.ts, kind: /^MERGE CARD/i.test(en) ? "merge" : /^Dispatch/i.test(en) ? "dispatch" : "other" };
        if (lastAsk.kind === "dispatch") out.dispatchAsked ??= { ts: e.ts, seq: e.seq, title: en };
      } else if (e.type === "decision_made" && e.decision) {
        const ask = asked.get(e.decision) ?? lastAsk;
        const card = { id: e.decision, chosen: e.chosen, by: e.actor, ts: e.ts, seq: e.seq, title: ask?.title ?? "", kind: ask?.kind ?? "other", effect: e.effect };
        out.cards.push(card);
        if (card.kind === "dispatch" && card.chosen === "A") out.dispatch = card;
        if (card.kind === "merge" && card.chosen === "A") out.merge = card;
        lastAsk = null;
      } else if (e.actor.startsWith("worker-") && (e.type === "dispatched" || e.type === "agent_finished")) {
        const key = e.actor.replace(/[a-z]$/, "");
        rounds.add(key);
        if (!out.workers.includes(e.actor)) out.workers.push(e.actor);
      } else if (e.type === "approved" || e.type === "review_failed") {
        out.reviews.push({ verdict: e.type === "approved" ? "APPROVE" : "REJECT", actor: e.actor, ts: e.ts, seq: e.seq });
      } else if (e.type === "merged") {
        out.merged = { ts: e.ts, pr: e.pr, seq: e.seq };
      }
    }
    out.rounds = rounds.size;
    return out;
  }

  /** Crew rounds touched in the last two days, each with a liveness check. */
  crew(withLines = 12): Actor[] {
    const runs = join(this.root, "runs");
    if (!existsSync(runs)) return [];
    const now = Date.now();
    if (now - this.crewScan > 10_000) {
      this.crewScan = now;
      const dirs: { dir: string; mtime: number }[] = [];
      for (const name of readdirSync(runs)) {
        try { const m = statSync(join(runs, name)).mtimeMs; if (now - m < 2 * 86400e3) dirs.push({ dir: name, mtime: m }); } catch {}
      }
      this.crewDirs = dirs.sort((a, b) => b.mtime - a.mtime);
    }
    const out: Actor[] = [];
    for (const { dir } of this.crewDirs) {
      const base = join(runs, dir);
      const id = readJson(join(base, "identity.json"));
      if (!id) continue;
      const proc = readJson(join(base, "process.json"));
      const pid = Number(proc?.pid);
      const vendorDir = newestVendorDir(base);
      const log = vendorDir ? join(vendorDir, "cli.log") : null;
      const lr = readJson(join(base, "last-result.json"));
      let lrAt: string | null = null; try { lrAt = new Date(statSync(join(base, "last-result.json")).mtimeMs).toISOString(); } catch {}
      let lastWrite: string | null = null;
      try { if (log) lastWrite = new Date(statSync(log).mtimeMs).toISOString(); } catch {}
      out.push({
        actor: str(id.actor) || dir, name: str(id.name) || dir, role: str(id.role), task: str(id.task) || null,
        round: Number.isInteger(id.round) ? id.round : null, attempt: Number.isInteger(id.attempt) ? id.attempt : null,
        vendor: str(id.vendor) || null, model: str(id.model_requested) || null,
        // a round that wrote its result after it started has ended, whatever process now holds its old pid
        alive: Number.isInteger(pid) && pid > 1 && pidAlive(pid) && !(lr && mtimeMs(join(base, "last-result.json")) >= mtimeMs(join(base, "process.json"))),
        started: typeof id.created === "number" ? new Date(id.created * 1000).toISOString() : null, lastWrite,
        activity: this.lastActivity.get(str(id.actor)) ?? null,
        lines: withLines && log ? readableTail(log, withLines, vendorDir!) : [],
        result: lr ? { status: str(lr.status) || "finished", exitCode: Number.isInteger(lr.exit_code) ? lr.exit_code : null, at: lrAt } : null,
        report: !!vendorDir && existsSync(join(vendorDir, "final.txt")),
      });
    }
    // live rounds first, then the most recent
    return out.sort((a, b) => Number(b.alive) - Number(a.alive) || String(b.lastWrite ?? b.started).localeCompare(String(a.lastWrite ?? a.started)));
  }
}

/** The final report a finished round wrote (final.txt of its newest attempt), read only. */
export function crewReport(root: string, actor: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(actor)) return null; // a run name: no dots, no slashes
  const v = newestVendorDir(join(root, "runs", actor));
  if (!v) return null;
  try { return readFileSync(join(v, "final.txt"), "utf8").slice(0, 200_000); } catch { return null; }
}
const live0 = (a: Agg, alive: Set<string>) => [...a.actors].some(x => alive.has(x));
export type CardRef = { id: string; chosen: string | null; by: string; ts: string; seq: number; title: string; kind: "dispatch" | "merge" | "other"; effect: string | null };
export type Lineage = {
  task: string; dispatchAsked: { ts: string; seq: number; title: string } | null; dispatch: CardRef | null; rounds: number; workers: string[];
  reviews: { verdict: "APPROVE" | "REJECT"; actor: string; ts: string; seq: number }[];
  merge: CardRef | null; merged: { ts: string; pr: number | null; seq: number } | null; cards: CardRef[];
};
type PinInfo = { version: number; title: string; door: "one-way" | "two-way" | null; doorReason: string | null };
type Agg = {
  id: string; project: string | null; firstTs: string; lastTs: string; lastType: string; lastSummary: Text;
  pr: number | null; node: NodeId; failure: Task["failure"]; actors: Set<string>; lastActor: string | null;
  round: number | null; merged: string | null; title: string | null;
};

const mtimeMs = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
function readJson(file: string): any {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}
function newestVendorDir(base: string): string | null {
  let best: string | null = null, bestM = -1;
  try {
    for (const n of readdirSync(base)) {
      const p = join(base, n);
      if (!existsSync(join(p, "cli.log"))) continue;
      const m = statSync(join(p, "cli.log")).mtimeMs;
      if (m > bestM) { bestM = m; best = p; }
    }
  } catch {}
  return best;
}

/** The end of a round's log, as lines a person can read: what it said, which tool it ran and why. */
export function readableTail(log: string, max: number, vendorDir: string): LogLine[] {
  const raw = tail(log, 256 * 1024).split("\n");
  const out: LogLine[] = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    if (line.startsWith("[fm]")) { if (!/still running/.test(line)) out.push({ t: null, kind: "fm", text: line.slice(5).trim() }); continue; }
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const t = str(o.timestamp) || null;
    if (o.type === "assistant") {
      for (const c of o.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) out.push({ t, kind: "text", text: oneLine(c.text, 220) });
        else if (c.type === "tool_use") {
          const i = c.input ?? {};
          const what = str(i.description) || str(i.file_path) || str(i.pattern) || oneLine(str(i.command), 120);
          out.push({ t, kind: "tool", text: `${c.name}${what ? ": " + what : ""}` });
        }
      }
    } else if (o.type === "system" && o.subtype === "task_started" && o.description) {
      out.push({ t, kind: "task", text: str(o.description) });
    } else if (o.type === "user") {
      for (const c of o.message?.content ?? []) if (c.type === "tool_result" && c.is_error)
        out.push({ t, kind: "error", text: oneLine(typeof c.content === "string" ? c.content : JSON.stringify(c.content), 160) });
    } else if (o.type === "result") {
      const r = oneLine(str(o.result) || str(o.subtype), 220);
      // the final message usually repeats the last text block; keep one copy, marked as the result
      const last = out.at(-1);
      if (last?.kind === "text" && r.startsWith(last.text.replace(/…$/, "").slice(0, 60))) out.pop();
      out.push({ t, kind: "result", text: r });
    } else if (o.type === "item.completed" || o.msg?.type) {
      // codex exec --json: a finished item or a message event
      const it = o.item ?? o.msg ?? {};
      const s = str(it.text) || str(it.command) || str(it.message);
      if (s) out.push({ t, kind: it.type === "command_execution" || it.command ? "tool" : "text", text: oneLine(s, 200) });
    }
  }
  // drop a repeated task line that the tool call right before already named
  const dedup = out.filter((l, i) => !(l.kind === "task" && out[i - 1]?.kind === "tool" && out[i - 1].text.endsWith(l.text)));
  return dedup.slice(-max);
}
function oneLine(s: string, n: number) { const x = s.replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; }
function tail(file: string, bytes: number): string {
  try {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size, start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const s = buf.toString("utf8");
      return start > 0 ? s.slice(s.indexOf("\n") + 1) : s;
    } finally { closeSync(fd); }
  } catch { return ""; }
}
