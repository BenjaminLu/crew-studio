// The tools the firstmate chat may call. All read Studio's data layer, except
// intent_capture, which appends to Studio's own intents.jsonl. None touches
// firstmate state, the board, a shell or the web. Every result carries Studio
// links the model cites, so an answer can be traced to its source.
import type { FmState, Card, Actor } from "./fm";
import type { GitHub } from "./github";
import type { Store } from "./store";

export type ToolCtx = { fm: FmState; gh: GitHub; store: Store; tasks: () => any[]; pending: () => Card[]; crew: () => Actor[]; crewTail: (a: string, n: number) => Actor | undefined;
  packs?: { draft: (description: string) => { id: string } };
  improve?: { roles: () => { workflow: string; role: string }[]; edit: (a: { workflow: string; role: string; request: string }) => { id: string } } };
type Tool = { name: string; label: string; description: string; schema: any; write?: boolean; run: (ctx: ToolCtx, a: any) => any };

const tLink = (t: string) => `#/task/${t}`;
const eLink = (seq: number) => `#/event/${seq}`;
const prLink = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;
const evOut = (e: any) => ({ seq: e.seq, ts: e.ts, type: e.type, task: e.task, actor: e.actor, pr: e.pr, summary: e.summary.en, link: eLink(e.seq) });
const lim = (v: any, d: number, max: number) => Math.min(max, Math.max(1, Number.isFinite(Number(v)) ? Number(v) : d));

export const TOOLS: Tool[] = [
  { name: "runs_list", label: "runs.list", description: "Recent tasks (last 3 days plus anything still moving or waiting on the captain): id, title, stage, status, door, PR, round, current crew, last event. Filter by status: needs-you, running, failed, done, idle.",
    schema: { type: "object", properties: { status: { type: "string", enum: ["needs-you", "running", "failed", "done", "idle"] } } },
    run: (c, a) => c.tasks().filter((t) => !a?.status || t.status === a.status).map((t) => ({ id: t.id, title: t.title, status: t.status, stage: t.node,
      door: t.door, pr: t.pr, round: t.round, crew: t.currentActor, lastEvent: t.lastSummary?.en, lastTs: t.lastTs, mergedTs: t.mergedTs, link: tLink(t.id) })) },
  { name: "task_get", label: "task.get", description: "One task in full: spec title, stage, status, door and reason, PR with its CI checks, round, crew, its cards (dispatch, merge) and the last 15 events.",
    schema: { type: "object", properties: { id: { type: "string", description: "Task id such as T-305" } }, required: ["id"] },
    run: (c, a) => {
      const id = String(a?.id ?? "").toUpperCase();
      if (!c.fm.known(id)) return { error: `not in the log: ${id}` };
      const t = c.tasks().find((x) => x.id === id);
      const pr = t?.pr ? c.gh.state.prs.find((p) => p.number === t.pr) : null;
      const lin = c.fm.lineage(id);
      return { id, title: c.fm.title(id), status: t?.status ?? "older than the board window", stage: t?.node ?? null, door: c.fm.doorOf(id),
        pr: t?.pr ?? lin.merged?.pr ?? null, prLink: t?.pr ? prLink(c.gh.state.repo, t.pr) : null,
        ci: pr ? { head: pr.head.slice(0, 8), pass: pr.checks.filter((x) => x.bucket === "pass").length, fail: pr.checks.filter((x) => x.bucket === "fail").map((x) => x.name),
          pending: pr.checks.filter((x) => x.bucket === "pending").map((x) => x.name), syncedAt: c.gh.state.lastSync } : null,
        round: t?.round ?? null, crew: t?.currentActor ?? null, failure: t?.failure ? { type: t.failure.type, summary: t.failure.summary.en, ts: t.failure.ts } : null,
        cards: lin.cards.map((x) => ({ id: x.id, kind: x.kind, chosen: x.chosen, by: x.by, ts: x.ts, link: eLink(x.seq) })),
        pendingCards: c.pending().filter((p) => p.task === id).map((p) => ({ id: p.id, title: p.title, link: `#/inbox/${p.id}` })),
        reviews: lin.reviews.map((r) => ({ ...r, link: eLink(r.seq) })), merged: lin.merged ? { ...lin.merged, link: eLink(lin.merged.seq) } : null,
        lastEvents: c.fm.activity({ task: id, limit: 15 }).map(evOut), link: tLink(id) };
    } },
  { name: "events_query", label: "events.query", description: "firstmate's event log, newest first. Filter by task, event type (e.g. merged, approved, review_failed, decision_made, gate_failed, commit_pushed, crew_status), actor substring, and since (ISO time).",
    schema: { type: "object", properties: { task: { type: "string" }, type: { type: "string" }, actor: { type: "string" }, since: { type: "string", description: "ISO 8601 time" }, limit: { type: "number", description: "max 100, default 30" } } },
    run: (c, a) => c.fm.activity({ task: a?.task ? String(a.task).toUpperCase() : undefined, type: a?.type || undefined, actor: a?.actor || undefined,
      since: a?.since || undefined, limit: lim(a?.limit, 30, 100) }).map(evOut) },
  { name: "pending_list", label: "pending.list", description: "Cards waiting on the captain right now.",
    schema: { type: "object", properties: {} },
    run: (c) => c.pending().map((p) => ({ id: p.id, task: p.task, pr: p.pr, kind: p.kind, purpose: p.purpose, title: p.title, ts: p.ts, link: `#/inbox/${p.id}` })) },
  { name: "crew_list", label: "crew.list", description: "Crew rounds from the last two days: actor, role, task, round, whether it is working now, what it is doing, when its log last moved.",
    schema: { type: "object", properties: {} },
    run: (c) => c.crew().slice(0, 30).map((x) => ({ actor: x.actor, role: x.role, task: x.task, round: x.round, working: x.alive, vendor: x.vendor, model: x.model,
      doing: x.activity?.en && !/^Work description unavailable/.test(x.activity.en) ? x.activity.en : x.lines.at(-1)?.text ?? null, lastLog: x.lastWrite,
      link: `#/crew/${encodeURIComponent(x.actor)}` })) },
  { name: "crew_tail", label: "crew.tail", description: "The last lines of one crew round's log, as readable lines (tool calls, text, errors, result).",
    schema: { type: "object", properties: { actor: { type: "string" }, n: { type: "number", description: "max 40, default 15" } }, required: ["actor"] },
    run: (c, a) => { const x = c.crewTail(String(a?.actor ?? ""), lim(a?.n, 15, 40)); return x ? { actor: x.actor, working: x.alive, lines: x.lines.slice(-lim(a?.n, 15, 40)), link: `#/crew/${encodeURIComponent(x.actor)}` } : { error: "no such crew round" }; } },
  { name: "pr_get", label: "pr.get", description: "A pull request from the GitHub cache: open PRs with their checks, or a merged PR with its merge commit.",
    schema: { type: "object", properties: { number: { type: "number" } }, required: ["number"] },
    run: (c, a) => {
      const n = Number(a?.number);
      const open = c.gh.state.prs.find((p) => p.number === n);
      if (open) return { state: "open", number: n, title: open.title, branch: open.branch, head: open.head.slice(0, 8), mergeState: open.mergeState,
        checks: open.checks.map((x) => ({ name: x.name, result: x.bucket })), syncedAt: c.gh.state.lastSync, link: prLink(c.gh.state.repo, n) };
      const m = c.gh.merged.find((p) => p.number === n);
      if (m) return { state: "merged", number: n, title: m.title, mergedAt: m.mergedAt, commit: m.commit?.slice(0, 8), checks: m.checks, link: prLink(c.gh.state.repo, n) };
      return { error: `PR #${n} is not in the cache (open PRs and the last 50 merged)` };
    } },
  { name: "library_list", label: "library.list", description: "Delivered work: merged PRs with their task, merge time and lineage, and registered files (video, web). Filter by kind and since (ISO time).",
    schema: { type: "object", properties: { kind: { type: "string", enum: ["code", "video", "web"] }, since: { type: "string" } } },
    run: (c, a) => {
      const lib = c.store.library(c.fm, c.gh.merged);
      const since = a?.since ? String(a.since) : "";
      const code = lib.code.filter((x) => (!since || x.ts >= since)).map((x) => ({ pr: x.pr, task: x.task, title: x.title, mergedAt: x.ts, commit: x.commit?.slice(0, 8),
        rounds: x.lineage?.rounds ?? null, reviews: x.lineage?.reviews.map((r) => r.verdict) ?? [], mergeCard: x.lineage?.merge?.id ?? null, link: x.task ? tLink(x.task) : x.url }));
      const files = lib.files.filter((x) => !since || (x.ts ?? "") >= since);
      if (a?.kind === "code") return { code };
      if (a?.kind) return { files: files.filter((x) => x.kind === a.kind) };
      return { code, files, mergedSyncedAt: c.gh.mergedSync };
    } },
  { name: "intent_capture", label: "intent.capture", write: true,
    description: "Record a NEW piece of work the captain asks for, so firstmate can draft its spec and dispatch card. Call once per new request, only when the captain states work to be done. This does not dispatch anything.",
    schema: { type: "object", properties: { goal: { type: "string", description: "one sentence: what should exist when done" }, details: { type: "string" },
      constraints: { type: "string" }, deadline: { type: "string" }, budget: { type: "string" } }, required: ["goal"] },
    run: (c, a) => { const i = c.store.capture({ ...a, source: "chat" }); return { id: i.id, goal: i.goal, status: "received", link: `#/intents/${i.id}`,
      next: "firstmate (the main session) drafts a spec and raises a dispatch card; the captain answers it on the board." }; } },
  { name: "skill_edit", label: "skill.edit", write: true,
    description: "Ask Studio's skill editor to change one workflow role's skill (for example the code workflow's worker). It edits Studio's own copy, runs replay evals, and offers the result to the captain on the Improve page; nothing is adopted without the captain. Call only when the captain asks to change how a role works.",
    schema: { type: "object", properties: { workflow: { type: "string", description: "workflow id, e.g. code" }, role: { type: "string", description: "role id, e.g. worker, reviewer" }, request: { type: "string", description: "what to change, in the captain's words" } }, required: ["workflow", "role", "request"] },
    run: (c, a) => { if (!c.improve) return { error: "skill edits are not available" };
      const ok = c.improve.roles().some((r) => r.workflow === a?.workflow && r.role === a?.role);
      if (!ok) return { error: `no such role; choose one of ${c.improve.roles().map((r) => `${r.workflow}/${r.role}`).join(", ")}` };
      const e = c.improve.edit({ workflow: a.workflow, role: a.role, request: String(a.request ?? "") });
      return { id: e.id, link: `#/edit/${e.id}`, next: "the editor drafts the change and replay evals run; the captain adopts or rejects it on the Improve page." }; } },
  { name: "pack_draft", label: "pack.draft", write: true,
    description: "Workflow genesis: when the captain describes a NEW way of working for the crew (a process with steps, roles and checks), draft a domain pack for it. Start a native Task: interview, captain sample labels, actual check measurements, refinement, advisory shadow Tasks, per-check promotion and immutable local publication. Nothing is published by this call.",
    schema: { type: "object", properties: { description: { type: "string", description: "the way of working, in the captain's words" } }, required: ["description"] },
    run: (c, a) => { if (!c.packs) return { error: "packs are not available" }; const d = c.packs.draft(String(a?.description ?? "")); return { id: d.id, link: d.native ? `#/tasks/${d.id}` : `#/pack-draft/${d.id}`, next: d.native ? "the native Task asks the captain one interview batch, then labels actual samples and measures checks before shadow, promotion and publication." : "this historical draft is reviewed on the Packs page." }; } },
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n || t.label === n);
