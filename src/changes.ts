// Changes (the flagship): a branch of a local repository goes through Studio's
// change workflow. The door classifier picks its risk tier; each node's script
// gates run; a failing gate (or a reviewer's REJECT) starts a worker/reviewer
// cycle in the change's own worktree until everything passes or the round
// budget runs out. The captain merges (a local fast-forward); a one-way change
// needs an explicit confirm. Everything is local git: nothing is pushed.
//   data/changes/<id>.json   data/gates/wt/<id> (the worktree, on branch crew/<id>)
import { addPaths, changedPaths, git, must } from "./git";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allocate } from "./ids";
import { folderTools, type Agents, type AgentTool } from "./agent";
import { classify, orgDefaults, Projects, type ChangedPath, type DoorResult, type Rule } from "./doors";
import { runGate, type GateCtx, type GateResult } from "./gates";
import type { StudioLog } from "./rawlog";
import type { Skills } from "./skills";
import type { Flow, GateDef, Workflows } from "./workflows";
import type { Provider } from "./providers";

export type Round = { n: number; why: string[]; worker: { job: string | null; status: string; said: string | null; commit: string | null } | null;
  gates: { pass: number; fail: number } | null; review: { verdict: "APPROVE" | "REJECT" | null; findings: string[]; job: string | null } | null };
export type Change = {
  id: string; title: string; project: string | null; repo: string; base: string; baseCommit: string; source: string; branch: string; workflow: string; hint: string | null;
  createdAt: string; status: "classifying" | "needs-door" | "running" | "fixing" | "reviewing" | "ready" | "failed" | "merged" | "closed";
  door: DoorResult | null; gates: GateResult[]; rounds: Round[]; head: string | null; error: string | null; mergedAt: string | null; paths: ChangedPath[]; maxRounds: number;
};


const WORKER = (skill: string) => `${skill}\n\nYou work ONLY through the fs_* tools on the change's worktree. When done, answer in 2 short lines: what you changed.`;
const REVIEWER = (skill: string) => `${skill}\n\nYou have no file tools. Call review_verdict exactly once (APPROVE or REJECT with numbered findings), then answer in one line.`;

export function createChanges(o: { dataDir: string; flows: Workflows; skills: Skills; agents: Agents; log: StudioLog; provider: (id?: string, model?: string) => Provider; send: (t: string, d: unknown) => void }) {
  const dir = join(o.dataDir, "changes"); mkdirSync(dir, { recursive: true });
  const wtRoot = join(o.dataDir, "gates", "wt"); mkdirSync(wtRoot, { recursive: true });
  const projects = new Projects(o.dataDir);
  const file = (id: string) => join(dir, `${id.replace(/[^\w-]/g, "")}.json`);
  const get = (id: string): Change | null => { try { return JSON.parse(readFileSync(file(id), "utf8")); } catch { return null; } };
  const save = (c: Change) => { writeFileSync(file(c.id), JSON.stringify(c, null, 1)); o.send("changes", { id: c.id, status: c.status }); };
  const list = (): Change[] => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } })
    .filter(Boolean).sort((a: Change, b: Change) => b.createdAt.localeCompare(a.createdAt));
  for (const c of list()) if (["classifying", "running", "fixing", "reviewing"].includes(c.status)) { c.status = "failed"; c.error = "Studio restarted during this change; Re-run to continue"; save(c); }
  const emit = (c: Change, type: string, summary: string, data: any = {}) => o.log.emit({ type, workflow: c.workflow, task: c.id, summary, data: { project: c.project, ...data } });
  const wt = (c: Change) => join(wtRoot, c.id);
  const flowOf = (c: Change): Flow => { const f = o.flows.get(c.workflow)?.flow; if (!f) throw new Error(`no workflow ${c.workflow}`); return f; };

  /** What changed between the base commit and the worktree's head. */
  function collect(c: Change): GateCtx & { top: Set<string> } {
    const d = wt(c);
    const ns = must(d, ["diff", "--name-status", "-M", `${c.baseCommit}..HEAD`]).split("\n").filter(Boolean);
    const num = must(d, ["diff", "--numstat", "-M", `${c.baseCommit}..HEAD`]).split("\n").filter(Boolean);
    const paths: ChangedPath[] = ns.map((l, i) => { const parts = l.split("\t"); const st = parts[0]; const path = parts.at(-1)!; const from = st.startsWith("R") ? parts[1] : null;
      const n = num[i]?.split("\t") ?? []; return { path, status: st, from, added: Number(n[0]) || 0, removed: Number(n[1]) || 0 }; });
    const added: { path: string; line: string }[] = []; let cur = "";
    for (const l of must(d, ["diff", "-U0", "--no-color", `${c.baseCommit}..HEAD`]).split("\n")) {
      if (l.startsWith("+++ b/")) cur = l.slice(6); else if (l.startsWith("+") && !l.startsWith("+++")) added.push({ path: cur, line: l.slice(1) });
    }
    const messages = git(d, ["log", "--format=%B", `${c.baseCommit}..HEAD`]).out;
    const top = new Set(must(d, ["ls-tree", "--name-only", c.baseCommit]).split("\n").filter(Boolean));
    return { dir: d, paths, added, messages, tier: c.door?.tier ?? "two-way", top };
  }
  const gatesFor = (c: Change, f: Flow) => {
    const proj = c.project ? projects.get(c.project) : null; const door = c.door?.door;
    return f.nodes.filter((n) => !n.lane || n.lane === door).map((n) => ({ node: n, gates: [...(n.gates ?? []), ...((proj?.gates?.[n.id] as GateDef[]) ?? [])] })).filter((x) => x.gates.length);
  };
  async function runAll(c: Change, ctx: GateCtx) {
    const out: GateResult[] = [];
    for (const { node, gates } of gatesFor(c, flowOf(c))) for (const g of gates) {
      const r = await runGate(g, node.id, ctx); out.push(r);
      if (r.state !== "skip") emit(c, r.state === "pass" ? "gate_passed" : "gate_failed", `${r.label}: ${r.state}`, { gate: r.id, node: r.node, detail: r.detail.slice(0, 300) });
    }
    c.gates = out; c.head = git(wt(c), ["rev-parse", "HEAD"]).out; save(c);
    return out;
  }
  const cycleOf = (c: Change) => gatesFor(c, flowOf(c)).map((x) => x.node.cycle).find(Boolean) ?? null;

  async function workerRound(c: Change, round: Round, failing: GateResult[], findings: string[]) {
    const cyc = cycleOf(c)!;
    let skill = ""; try { skill = o.skills.text(c.workflow, cyc.worker); } catch {}
    const tools: AgentTool[] = folderTools(wt(c), () => {}, "fs");
    const text = `GATE FIX\nChange ${c.id}: ${c.title}\nRound ${round.n} of ${c.maxRounds}. Door: ${c.door?.tier}.\n` +
      (failing.length ? `Failing gates:\n${failing.map((g) => `- ${g.label} (${g.node}): ${g.detail}`).join("\n")}\n` : "") +
      (findings.length ? `Reviewer findings to address:\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n` : "") +
      (c.hint ? `Fix hint: ${c.hint}\n` : "") + `\nStart with fs_list, read what you need, fix it, then answer.`;
    c.status = "fixing"; round.worker = { job: null, status: "running", said: null, commit: null }; save(c);
    emit(c, "round_started", `round ${round.n}: ${round.why.join("; ").slice(0, 200)}`, { round: round.n });
    const j = await o.agents.run({ kind: "gate-fix", title: `${c.id} round ${round.n}`, system: WORKER(skill), text, tools, provider: o.provider(), ref: c.id, maxTools: 60, project: c.project });
    round.worker = { job: j.id, status: j.status, said: j.said.trim().slice(0, 600) || null, commit: null };
    if (git(wt(c), ["status", "--porcelain"]).out) {
      addPaths(wt(c), changedPaths(wt(c))); must(wt(c), ["commit", "-q", "-m", `crew: ${c.id} round ${round.n} fixes\n\n${round.why.join("\n")}`]);
      round.worker.commit = git(wt(c), ["rev-parse", "HEAD"]).out;
    }
    save(c);
  }
  async function review(c: Change, round: Round, prev: string) {
    const cyc = cycleOf(c)!;
    let skill = ""; try { skill = o.skills.text(c.workflow, cyc.reviewer); } catch {}
    let verdict: { verdict: "APPROVE" | "REJECT"; findings: string[] } | null = null;
    const tools: AgentTool[] = [{ name: "review_verdict", description: "Your verdict, once: APPROVE or REJECT, with numbered findings for a REJECT.", schema: { type: "object", properties: { verdict: { type: "string", enum: ["APPROVE", "REJECT"] }, findings: { type: "array", items: { type: "string" } } }, required: ["verdict"] },
      run: (a) => { verdict = { verdict: a.verdict === "APPROVE" ? "APPROVE" : "REJECT", findings: (Array.isArray(a.findings) ? a.findings : []).map((x: any) => String(x).slice(0, 400)).slice(0, 12) }; return { ok: true }; } }];
    const diff = git(wt(c), ["diff", "--no-color", `${prev}..HEAD`]).out.slice(0, 20000);
    const text = `GATE REVIEW\nChange ${c.id}: ${c.title}\nDoor: ${c.door?.tier}. Round ${round.n}.\nGates now:\n${c.gates.map((g) => `- ${g.state.toUpperCase()} ${g.label}: ${g.detail.split("\n")[0]}`).join("\n")}\n\nDiff of this change${prev === c.baseCommit ? "" : " (this round)"}:\n${diff || "(no diff)"}`;
    c.status = "reviewing"; save(c);
    const j = await o.agents.run({ kind: "gate-review", title: `${c.id} review ${round.n}`, system: REVIEWER(skill), text, tools, provider: o.provider(), ref: c.id, maxTools: 4, project: c.project });
    const v = verdict as { verdict: "APPROVE" | "REJECT"; findings: string[] } | null;
    round.review = { verdict: v?.verdict ?? null, findings: v?.findings ?? (j.status === "done" ? ["the reviewer gave no verdict"] : [`the review failed: ${j.error}`]), job: j.id };
    emit(c, v?.verdict === "APPROVE" ? "review_approved" : "review_rejected", `review ${round.n}: ${v?.verdict ?? "no verdict"}`, { round: round.n, findings: round.review.findings.length });
    save(c);
    return v?.verdict === "APPROVE";
  }

  async function drive(c: Change) {
    try {
      c.status = "classifying"; c.error = null; save(c);
      let ctx = collect(c);
      c.paths = ctx.paths;
      if (!c.door || c.door.decidedBy !== "captain") {
        c.door = classify(ctx.paths, { defaults: orgDefaults(o.dataDir), project: c.project ? projects.get(c.project) : null, topLevel: ctx.top });
        emit(c, "door_decided", `${c.door.tier}: ${c.door.reasons.slice(0, 3).map((r) => r.path).join(", ") || "no listed path"}`, { tier: c.door.tier });
      }
      if (c.door.tier === "undecided") { c.status = "needs-door"; save(c); return; }
      ctx = { ...ctx, tier: c.door.tier };
      c.status = "running"; save(c);
      let res = await runAll(c, ctx);
      const cyc = cycleOf(c);
      let approved = false, prev = c.baseCommit, findings: string[] = [];
      if (cyc && !res.some((g) => g.state === "fail")) { const r0: Round = { n: 0, why: ["first review"], worker: null, gates: { pass: res.filter((g) => g.state === "pass").length, fail: 0 }, review: null };
        c.rounds.push(r0); approved = await review(c, r0, prev); findings = r0.review?.findings ?? []; }
      while (cyc && (res.some((g) => g.state === "fail") || !approved)) {
        const n = c.rounds.filter((r) => r.n > 0).length + 1;
        if (n > c.maxRounds) { c.status = "failed"; c.error = `still failing after ${c.maxRounds} rounds: ${res.filter((g) => g.state === "fail").map((g) => g.label).join(", ") || "the reviewer rejects it"}`;
          emit(c, "change_failed", c.error); save(c); return; }
        const failing = res.filter((g) => g.state === "fail");
        const round: Round = { n, why: [...failing.map((g) => `${g.label}: ${g.detail.split("\n")[0]}`), ...findings.map((f) => `review: ${f}`)], worker: null, gates: null, review: null };
        c.rounds.push(round);
        const before = git(wt(c), ["rev-parse", "HEAD"]).out;
        await workerRound(c, round, failing, findings);
        ctx = { ...collect(c), tier: c.door.tier }; c.paths = ctx.paths;
        res = await runAll(c, ctx);
        round.gates = { pass: res.filter((g) => g.state === "pass").length, fail: res.filter((g) => g.state === "fail").length };
        prev = before;
        approved = res.some((g) => g.state === "fail") ? false : await review(c, round, prev);
        findings = round.review?.findings ?? [];
        save(c);
      }
      if (!cyc && res.some((g) => g.state === "fail")) { c.status = "failed"; c.error = "a gate failed and this workflow has no worker/reviewer cycle"; save(c); return; }
      c.status = "ready"; save(c); emit(c, "change_ready", `ready to merge (${c.door.tier})`);
    } catch (e: any) { c.status = "failed"; c.error = String(e?.message ?? e).slice(0, 500); save(c); }
  }

  function create(b: { project?: string; repo?: string; branch?: string; base?: string; title?: string; hint?: string; workflow?: string }): Change {
    const proj = b.project ? projects.get(String(b.project)) : null;
    if (b.project && !proj) throw new Error("no such project");
    const repo = String(proj?.path ?? b.repo ?? "");
    if (!repo || !existsSync(join(repo, ".git"))) throw new Error("the project needs a local git repository path");
    const source = String(b.branch ?? "").trim(); if (!source) throw new Error("name the branch to check");
    if (!git(repo, ["rev-parse", "--verify", `${source}^{commit}`]).ok) throw new Error(`no branch ${source}`);
    const base = String(b.base ?? proj?.base ?? "main");
    const baseCommit = git(repo, ["merge-base", base, source]); if (!baseCommit.ok) throw new Error(`no common base between ${base} and ${source}`);
    const wfId = String(b.workflow ?? "change"); const f = o.flows.get(wfId)?.flow; if (!f) throw new Error(`no workflow ${wfId}`);
    const id = allocate(dir, "C");
    const branch = `crew/${id.toLowerCase()}`;
    must(repo, ["worktree", "add", "-q", "-b", branch, join(wtRoot, id), source]);
    const cyc = f.nodes.map((x) => x.cycle).find(Boolean);
    const c: Change = { id, title: String(b.title ?? source).slice(0, 200), project: proj?.id ?? null, repo, base, baseCommit: baseCommit.out, source, branch, workflow: wfId, hint: b.hint ? String(b.hint).slice(0, 500) : null,
      createdAt: new Date().toISOString(), status: "classifying", door: null, gates: [], rounds: [], head: null, error: null, mergedAt: null, paths: [], maxRounds: cyc?.max_rounds ?? 3 };
    save(c); emit(c, "change_opened", `${c.title} (${source} → ${base})`);
    void drive(c);
    return c;
  }
  function merge(c: Change, confirm: unknown) {
    if (c.status !== "ready") throw new Error(`only a ready change merges (this one is ${c.status})`);
    if (c.door?.door === "one-way" && confirm !== "one-way") throw new Error("a one-way change cannot be undone by a revert: confirm it first");
    const head = must(wt(c), ["rev-parse", "HEAD"]);
    if (head !== c.head) throw new Error("the branch moved since the gates ran; re-run them");
    if (!git(c.repo, ["merge-base", "--is-ancestor", c.base, head]).ok) throw new Error(`${c.base} moved since this change started: it no longer fast-forwards`);
    const cur = git(c.repo, ["symbolic-ref", "--short", "HEAD"]).out;
    if (cur === c.base) { if (git(c.repo, ["status", "--porcelain", "--untracked-files=no"]).out) throw new Error(`${c.repo} has uncommitted changes on ${c.base}`); must(c.repo, ["merge", "--ff-only", "-q", head]); }
    else must(c.repo, ["update-ref", `refs/heads/${c.base}`, head, must(c.repo, ["rev-parse", c.base])]);
    c.status = "merged"; c.mergedAt = new Date().toISOString(); save(c); emit(c, "change_merged", `${c.base} → ${head.slice(0, 8)}`);
    cleanup(c);
  }
  function cleanup(c: Change) { git(c.repo, ["worktree", "remove", "--force", wt(c)]); rmSync(wt(c), { recursive: true, force: true }); }

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const view = (c: Change) => ({ ...c, flow: c.workflow });
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!p.startsWith("/api/changes") && !p.startsWith("/api/projects") && !p.startsWith("/api/doors")) return null;
    if (writing && who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    let b: any = {}; if (writing) { try { b = await req.json(); } catch {} }
    try {
      if (p === "/api/doors" && !writing) return json({ defaults: orgDefaults(o.dataDir), projects: projects.list() });
      if (p === "/api/doors/classify" && writing) {
        const paths: ChangedPath[] = (Array.isArray(b?.paths) ? b.paths : String(b?.paths ?? "").split(/\n/)).map((x: any) => typeof x === "string" ? { path: x.trim() } : { path: String(x.path), status: x.status, added: x.added, removed: x.removed, from: x.from ?? null }).filter((x: ChangedPath) => x.path);
        return json(classify(paths, { defaults: orgDefaults(o.dataDir), project: b?.project ? projects.get(String(b.project)) : null }));
      }
      if (p === "/api/projects" && !writing) return json(projects.list());
      if (p === "/api/projects" && writing) return json(projects.add({ name: b?.name, path: b?.path || null, base: b?.base, propose: Array.isArray(b?.propose) ? (b.propose as Rule[]) : undefined }));
      let m = /^\/api\/projects\/([\w-]+)\/(propose|approve|decline)$/.exec(p);
      if (m && writing) return json(m[2] === "propose" ? projects.propose(m[1], Array.isArray(b?.rules) ? b.rules : []) : m[2] === "approve" ? projects.approve(m[1]) : projects.decline(m[1]));
      if (p === "/api/changes" && !writing) return json({ changes: list().map(view), projects: projects.list(), defaults: orgDefaults(o.dataDir) });
      if (p === "/api/changes" && writing) return json(view(create(b)));
      m = /^\/api\/changes\/([\w-]+)(?:\/(door|merge|close|rerun))?$/.exec(p);
      if (m) {
        const c = get(m[1]); if (!c) return json({ error: "no such change" }, 404);
        if (!writing) return json({ ...view(c), jobs: [...o.agents.jobs.values()].filter((j) => j.ref === c.id).map((j) => ({ id: j.id, kind: j.kind, status: j.status, provider: j.provider, model: j.model, tools: j.tools, said: j.said.slice(0, 600) })) });
        if (m[2] === "door") {
          if (c.status !== "needs-door") return json({ error: `this change is ${c.status}` }, 409);
          const d = b?.door === "one-way" ? "one-way" : b?.door === "two-way" ? "two-way" : null; if (!d) return json({ error: "door must be one-way or two-way" }, 400);
          c.door = { ...(c.door as DoorResult), tier: d, door: d, decidedBy: "captain" }; emit(c, "door_decided", `captain picked ${d}`, { tier: d, by: "captain" }); save(c); void drive(c); return json(view(c));
        }
        if (m[2] === "merge") { merge(c, b?.confirm); return json(view(c)); }
        if (m[2] === "close") { if (c.status === "merged" || c.status === "closed") return json({ error: `already ${c.status}` }, 409); if (["classifying", "running", "fixing", "reviewing"].includes(c.status)) return json({ error: "wait for the step to finish" }, 409);
          c.status = "closed"; save(c); cleanup(c); emit(c, "change_closed", "closed by the captain"); return json(view(c)); }
        if (m[2] === "rerun") { if (!["failed", "ready"].includes(c.status)) return json({ error: `this change is ${c.status}` }, 409); if (!existsSync(wt(c))) return json({ error: "the worktree is gone" }, 409);
          c.rounds = []; void drive(c); return json(view(c)); }
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e), ...(e?.code === "policyUnreadable" ? { code: e.code } : {}) }, e?.code === "policyUnreadable" ? 409 : 400); }
  }
  return { handle, list, get, projects, create };
}
