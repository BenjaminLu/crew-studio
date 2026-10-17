// M6 self-improvement: chat-driven skill edits for any workflow role, replay
// evals before every offer (before vs after), and the generalized retro whose
// repeat classes become proposal cards with an expected metric and its evals.
// A rejected proposal is never proposed again (by class and role); an adopted
// one is tracked before vs after from the event log.
//   data/improve/edits/<id>.json (+ <id>.after.md)   edits and proposals
//   data/improve/rejected.json                         fingerprints never to re-propose
//   data/improve/settings.json                         {evalMode: static|model, provider, model}
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agents, folderTools, type AgentTool } from "./agent";
import { diffLines, diffStat, hunks } from "./diff";
import { Evals, type EvalCase, type SuiteResult } from "./evals";
import { beforeAfter, detect, Retros, type Detector, type Hit, type Report, type RetroConfig } from "./retro";
import type { RawEv } from "./rawlog";
import { insertRule, Skills } from "./skills";
import type { Workflows } from "./workflows";
import type { Provider } from "./providers";

export type Edit = {
  id: string; kind: "chat" | "proposal"; workflow: string; role: string; base: number; request: string; by: string; createdAt: string;
  status: "drafting" | "evaluating" | "offered" | "adopted" | "rejected" | "failed" | "no-change"; job: string | null; summary: string | null;
  stat: { added: number; removed: number } | null; evalMode: "static" | "model"; evals: { before: SuiteResult; after: SuiteResult; cases: number; own: { total: number; before: number; after: number }; others: { total: number; before: number; after: number }; regressions: string[] } | null; error: string | null;
  class?: string; retro?: string; title?: string; rationale?: string; evidence?: Hit[]; fingerprint?: string;
  expected?: { metric: string; baselinePerWeek: number; target: number; windowDays: number };
  decidedAt?: string | null; decidedBy?: string | null; adoptedVersion?: number | null; rejectReason?: string | null;
};
type Settings = { evalMode: "static" | "model"; provider: string | null; model: string | null };

const SKILL_EDITOR = `You edit ONE skill file (SKILL.md: a role's working instructions) for the captain in Crew Studio, using ONLY the skill_* tools. No shell, no web.
- Do exactly what the captain asks; keep everything else as it is. Prefer small, exact edits with skill_replace.
- Keep the file's voice and structure: short rules under the right heading.
- When done, call skill_report once with a one-line summary and the effect you expect, then answer in 2 short lines.`;

export function createImprove(o: { dataDir: string; flows: Workflows; agents: Agents; events: (src: "firstmate" | "studio") => RawEv[]; provider: (id?: string, model?: string) => Provider;
  send: (type: string, data: unknown) => void }) {
  const dir = join(o.dataDir, "improve"); mkdirSync(join(dir, "edits"), { recursive: true });
  const skills = new Skills(o.dataDir, o.flows);
  const evals = new Evals(o.dataDir, o.agents);
  const retros = new Retros(o.dataDir);
  const file = (id: string) => join(dir, "edits", `${id.replace(/[^\w-]/g, "")}.json`);
  const get = (id: string): Edit | null => { try { return JSON.parse(readFileSync(file(id), "utf8")); } catch { return null; } };
  const save = (e: Edit) => { writeFileSync(file(e.id), JSON.stringify(e, null, 1)); o.send("improve", { edit: e.id, status: e.status }); };
  const list = (): Edit[] => readdirSync(join(dir, "edits")).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(dir, "edits", f), "utf8")); } catch { return null; } })
    .filter(Boolean).sort((a: Edit, b: Edit) => b.createdAt.localeCompare(a.createdAt));
  const afterText = (id: string) => { try { return readFileSync(join(dir, "edits", `${id}.after.md`), "utf8"); } catch { return null; } };
  let seq = list().length;
  const newId = () => { let id: string; do { id = `E-${String(++seq).padStart(3, "0")}`; } while (existsSync(file(id))); return id; };
  const rejected = (): { fingerprint: string; edit: string; at: string; reason: string | null }[] => { try { return JSON.parse(readFileSync(join(dir, "rejected.json"), "utf8")); } catch { return []; } };
  const settings = (): Settings => { try { const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")); return { evalMode: s.evalMode === "model" ? "model" : "static", provider: s.provider ?? null, model: s.model ?? null }; } catch { return { evalMode: "static", provider: null, model: null }; } };
  // a Studio restart leaves no edit stuck
  for (const e of list()) if (e.status === "drafting" || e.status === "evaluating") { e.status = "failed"; e.error = "Studio restarted during this step"; save(e); }

  async function evaluate(e: Edit, before: string, after: string) {
    e.status = "evaluating"; save(e);
    const cases = evals.cases(e.workflow, e.role);
    const s = settings();
    const prov = s.evalMode === "model" ? o.provider(s.provider ?? undefined, s.model ?? undefined) : undefined;
    try {
      const b = await evals.run(cases, before, s.evalMode, prov, e.id);
      const a = await evals.run(cases, after, s.evalMode, prov, e.id);
      const own = new Set(cases.filter((c) => e.class && c.from.class === e.class).map((c) => c.id));
      const pick = (r: SuiteResult, mine: boolean) => r.results.filter((x) => own.has(x.case) === mine && x.pass).length;
      e.evals = { before: b, after: a, cases: cases.length,
        own: { total: own.size, before: pick(b, true), after: pick(a, true) },
        others: { total: cases.length - own.size, before: pick(b, false), after: pick(a, false) },
        regressions: b.results.filter((x, i) => x.pass && !a.results[i]?.pass).map((x) => x.case) }; e.evalMode = b.mode;
      e.status = "offered";
    } catch (err: any) { e.status = "failed"; e.error = `evals failed: ${err?.message ?? err}`; }
    save(e);
  }
  const finishText = (e: Edit, before: string, after: string) => {
    writeFileSync(join(dir, "edits", `${e.id}.after.md`), after);
    e.stat = diffStat(diffLines(before, after));
  };

  /** A chat request: an editor agent changes a copy of the current skill; evals run; the result is offered. */
  function startChatEdit(a: { workflow: string; role: string; request: string; provider?: string; model?: string; by?: string }): Edit {
    const request = String(a.request ?? "").trim().slice(0, 4000);
    if (!request) throw new Error("say what to change");
    const idx = skills.ensure(a.workflow, a.role);
    if (list().some((x) => x.workflow === a.workflow && x.role === a.role && (x.status === "drafting" || x.status === "evaluating"))) throw new Error("an edit of this skill is already running");
    const base = idx.at(-1)!.n, before = skills.text(a.workflow, a.role, base);
    const e: Edit = { id: newId(), kind: "chat", workflow: a.workflow, role: a.role, base, request, by: a.by ?? "captain", createdAt: new Date().toISOString(), status: "drafting",
      job: null, summary: null, stat: null, evalMode: settings().evalMode, evals: null, error: null };
    save(e);
    const work = join(dir, "work", e.id); mkdirSync(work, { recursive: true }); writeFileSync(join(work, "SKILL.md"), before);
    let report: { summary?: string; expected?: string } = {};
    const tools: AgentTool[] = [...folderTools(work, () => {}, "skill"),
      { name: "skill_report", description: "Call once when done: a one-line summary of the change and the effect you expect.", schema: { type: "object", properties: { summary: { type: "string" }, expected: { type: "string" } }, required: ["summary"] },
        run: (x) => { report = { summary: String(x.summary ?? "").slice(0, 500), expected: String(x.expected ?? "").slice(0, 500) }; return { ok: true }; } }];
    const prov = o.provider(a.provider, a.model);
    (async () => {
      const text = `SKILL EDIT REQUEST\nWorkflow: ${a.workflow}, role: ${a.role}, Studio version v${base} (file SKILL.md, ${before.split("\n").length} lines).\nCaptain's request: ${request}\n\nStart with skill_search or skill_read, make the change, then call skill_report.`;
      const p = o.agents.run({ kind: "skill-edit", title: `edit ${a.workflow}/${a.role}`, system: SKILL_EDITOR, text, tools, provider: prov, ref: e.id, maxTools: 40 });
      e.job = [...o.agents.jobs.values()].find((j) => j.ref === e.id)?.id ?? null; save(e);
      const j = await p; e.job = j.id;
      if (j.status !== "done") { e.status = "failed"; e.error = j.error; save(e); return; }
      const after = readFileSync(join(work, "SKILL.md"), "utf8");
      rmSync(work, { recursive: true, force: true });
      e.summary = report.summary || j.said.trim().slice(0, 500) || null;
      if (after === before) { e.status = "no-change"; save(e); return; }
      finishText(e, before, after);
      await evaluate(e, before, after);
    })();
    return e;
  }

  /** Eval cases replayed from a class's recorded hits (one per task or round, up to 3). */
  function casesFor(d: Detector, hits: Hit[], wf: string, retroId: string): EvalCase[] {
    if (!d.propose?.eval) return [];
    const ev = d.propose.eval; const out: EvalCase[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      if (seen.has(h.group)) continue; seen.add(h.group); if (out.length >= 3) break;
      const round = /-r(\d+)/.exec(h.actor)?.[1] ?? "2";
      const fill = (s: string) => s.replace(/\{task\}/g, h.task ?? "the task").replace(/\{round\}/g, round).replace(/\{actor\}/g, h.actor);
      out.push(evals.add({ id: `EV-${d.id}-${(h.task ?? h.actor).replace(/[^\w-]/g, "")}`, workflow: wf, role: d.propose.role, title: `${d.title} (${h.task ?? h.actor})`,
        from: { task: h.task, actor: h.actor, seq: h.seq, ts: h.ts, class: d.id, retro: retroId }, situation: `Recorded at ${h.ts} by ${h.actor}: ${h.text}`, ask: fill(ev.ask), terms: ev.terms, expect: ev.expect }));
    }
    return out;
  }

  /** Run a retro now; each class found with a remedy becomes a proposal (unless it was rejected or is already open/adopted). */
  async function runRetro(wf: string, trigger: string, days?: number, to?: string): Promise<Report> {
    const cfg = o.flows.retro(wf); if (!cfg) throw new Error(`workflow ${wf} has no retro config`);
    const events = o.events(cfg.source ?? "firstmate");
    const r = retros.run(cfg, events, { trigger, days, to });
    const rej = rejected();
    const jobs: Promise<void>[] = [];
    for (const c of r.classes) {
      const d = cfg.classes.find((x) => x.id === c.id)!;
      if (!c.found || !d.propose) continue;
      const fp = `${wf}/${d.propose.role}/${d.id}`;
      const was = rej.find((x) => x.fingerprint === fp);
      if (was) { r.skipped.push({ class: d.id, why: `rejected before (${was.edit}); not proposed again` }); continue; }
      const open = list().find((x) => x.fingerprint === fp && x.status !== "rejected" && x.status !== "failed" && x.status !== "no-change");
      if (open) { r.skipped.push({ class: d.id, why: `${open.status === "adopted" ? "adopted" : "already proposed"} as ${open.id}` }); continue; }
      let base: number, before: string;
      try { const idx = skills.ensure(wf, d.propose.role); base = idx.at(-1)!.n; before = skills.text(wf, d.propose.role, base); }
      catch (err: any) { r.skipped.push({ class: d.id, why: String(err?.message ?? err) }); continue; }
      const hits = detect(d, events.filter((e) => e.ts >= r.window.from && e.ts <= r.window.to));
      casesFor(d, hits, wf, r.id);
      const after = insertRule(before, d.propose.section, d.propose.rule);
      const e: Edit = { id: newId(), kind: "proposal", workflow: wf, role: d.propose.role, base, request: d.propose.rule, by: `retro ${r.id}`, createdAt: new Date().toISOString(), status: "evaluating",
        job: null, summary: `Add a ${d.propose.role} rule for: ${d.title}`, stat: null, evalMode: settings().evalMode, evals: null, error: null,
        class: d.id, retro: r.id, title: d.title, rationale: d.explain ?? null as any, evidence: c.examples, fingerprint: fp,
        expected: { metric: `“${d.title}” per week`, baselinePerWeek: c.perWeek, target: d.propose.target ?? 0, windowDays: r.window.days } };
      finishText(e, before, after); save(e);
      r.proposals.push(e.id);
      jobs.push(evaluate(e, before, after));
    }
    retros.save(r);
    o.send("improve", { retro: r.id });
    await Promise.all(jobs);
    return r;
  }

  function adopt(id: string, by: string) {
    const e = get(id); if (!e) throw new Error("no such edit");
    if (e.status !== "offered") throw new Error(`only an offered edit can be adopted (this one is ${e.status})`);
    const cur = skills.ensure(e.workflow, e.role).at(-1)!.n;
    let text = afterText(e.id)!;
    if (cur !== e.base) {
      if (e.kind !== "proposal") throw new Error(`the skill moved to v${cur} since this edit was made from v${e.base}; ask again`);
      text = insertRule(skills.text(e.workflow, e.role, cur), o.flows.retro(e.workflow)?.classes.find((c) => c.id === e.class)?.propose?.section, e.request);
    }
    const v = skills.write(e.workflow, e.role, text, { by, reason: e.summary ?? e.request.slice(0, 200), edit: e.id, parent: cur });
    e.status = "adopted"; e.adoptedVersion = v.n; e.decidedAt = new Date().toISOString(); e.decidedBy = by; save(e);
    return e;
  }
  function reject(id: string, by: string, reason?: string) {
    const e = get(id); if (!e) throw new Error("no such edit");
    if (e.status !== "offered" && e.status !== "failed" && e.status !== "no-change") throw new Error(`this edit is ${e.status}`);
    e.status = "rejected"; e.decidedAt = new Date().toISOString(); e.decidedBy = by; e.rejectReason = reason ?? null; save(e);
    if (e.fingerprint) writeFileSync(join(dir, "rejected.json"), JSON.stringify([...rejected(), { fingerprint: e.fingerprint, edit: e.id, at: e.decidedAt, reason: e.rejectReason }], null, 1));
    return e;
  }
  /** Before vs after adoption, per week, from the event log. */
  function tracking(e: Edit) {
    if (e.status !== "adopted" || !e.class || !e.decidedAt) return null;
    const cfg = o.flows.retro(e.workflow); const d = cfg?.classes.find((c) => c.id === e.class); if (!cfg || !d) return null;
    return beforeAfter(d, o.events(cfg.source ?? "firstmate"), e.decidedAt, cfg.window_days ?? 14);
  }
  function view(e: Edit, full = false) {
    const out: any = { ...e, tracking: tracking(e) };
    if (full) {
      let before = ""; try { before = skills.text(e.workflow, e.role, e.base); } catch {}
      const after = afterText(e.id);
      out.hunks = after != null ? hunks(diffLines(before, after), 3) : [];
      out.job = e.job ? o.agents.jobs.get(e.job) ?? null : null;
    }
    return out;
  }

  // ---------- triggers: a background check, a retro when one fires ----------
  let checking = false;
  async function checkTriggers(now?: string) {
    if (checking) return []; checking = true;
    const ran: string[] = [];
    try {
      for (const f of o.flows.list()) {
        const cfg = o.flows.retro(f.id); if (!cfg) continue;
        const why = retros.due(cfg, o.events(cfg.source ?? "firstmate"), now);
        if (why) { const r = await runRetro(f.id, `trigger: ${why}`); ran.push(r.id); }
      }
    } finally { checking = false; }
    return ran;
  }
  if (process.env.CREW_RETRO_AUTO !== "0") setInterval(() => { void checkTriggers().catch(() => {}); }, Number(process.env.CREW_RETRO_CHECK_MS ?? 15 * 60_000));

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!p.startsWith("/api/improve")) return null;
    if (writing && who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    let b: any = {}; if (writing) { try { b = await req.json(); } catch {} }
    const by = "captain";
    try {
      if (p === "/api/improve" && !writing) {
        const flows = o.flows.list().map((f) => ({ id: f.id, name: f.name, pack: f.pack ?? null, roles: f.roles, retro: !!o.flows.retro(f.id) }));
        return json({ flows, skills: skills.overview(), edits: list().map((e) => view(e)), reports: retros.list().map((r) => ({ id: r.id, workflow: r.workflow, createdAt: r.createdAt, trigger: r.trigger,
          window: r.window, found: r.classes.filter((c) => c.found).length, classes: r.classes.length, proposals: r.proposals })), settings: settings(), rejected: rejected(),
          cases: evals.all().length });
      }
      if (p === "/api/improve/settings" && writing) {
        const s: Settings = { evalMode: b?.evalMode === "model" ? "model" : "static", provider: typeof b?.provider === "string" && b.provider ? b.provider : null, model: typeof b?.model === "string" && b.model ? b.model : null };
        writeFileSync(join(dir, "settings.json"), JSON.stringify(s, null, 1)); return json(s);
      }
      if (p === "/api/improve/retro" && writing) {
        const wf = String(b?.workflow ?? "code");
        const to = typeof b?.to === "string" && !Number.isNaN(Date.parse(b.to)) ? new Date(b.to).toISOString() : undefined;
        const r = await runRetro(wf, "manual", b?.days ? Math.max(1, Math.min(90, Number(b.days))) : undefined, to);
        return json({ ...retros.get(r.id), edits: r.proposals.map((id) => view(get(id)!)) });
      }
      if (p === "/api/improve/triggers" && writing) return json({ ran: await checkTriggers(b?.now) });
      let m = /^\/api\/improve\/retro\/([\w-]+)$/.exec(p);
      if (m && !writing) { const r = retros.get(m[1]); if (!r) return json({ error: "no such retro" }, 404);
        const cfg = o.flows.retro(r.workflow);
        return json({ ...r, edits: list().filter((e) => e.retro === r.id).map((e) => view(e)), config: cfg ? { triggers: cfg.triggers, source: cfg.source, window_days: cfg.window_days } : null }); }
      if (p === "/api/improve/edits" && writing) return json(view(startChatEdit({ workflow: String(b?.workflow ?? ""), role: String(b?.role ?? ""), request: b?.request, provider: b?.provider || undefined, model: b?.model || undefined, by })));
      m = /^\/api\/improve\/edits\/([\w-]+)(?:\/(adopt|reject|reeval))?$/.exec(p);
      if (m) {
        const e = get(m[1]); if (!e) return json({ error: "no such edit" }, 404);
        if (!writing) return json(view(e, true));
        if (m[2] === "adopt") return json(view(adopt(e.id, by), true));
        if (m[2] === "reject") return json(view(reject(e.id, by, b?.reason ? String(b.reason).slice(0, 400) : undefined), true));
        if (m[2] === "reeval") { if (e.status !== "offered" && e.status !== "failed") return json({ error: `this edit is ${e.status}` }, 409); const after = afterText(e.id); if (after == null) return json({ error: "nothing to evaluate" }, 409);
          e.error = null; void evaluate(e, skills.text(e.workflow, e.role, e.base), after); return json(view(e)); }
      }
      m = /^\/api\/improve\/skills\/([\w-]+)\/([\w-]+)(\/patch)?$/.exec(p);
      if (m && !writing) {
        const idx = skills.ensure(m[1], m[2]);
        if (m[3]) return new Response(skills.patch(m[1], m[2]) || "# no change from the imported source\n", { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${m[1]}-${m[2]}.patch"` } });
        const n = url.searchParams.get("v") ? Number(url.searchParams.get("v")) : idx.at(-1)!.n;
        // the current version is the text agents receive (Skills.current); sourceChanged: an adopted edit is current and its source moved on since
        const cur = skills.current(m[1], m[2]);
        return json({ workflow: m[1], role: m[2], versions: idx, n, current: cur.n, sha256: idx.find((v) => v.n === n)?.sha256 ?? null, sourceChanged: cur.sourceChanged, text: skills.text(m[1], m[2], n),
          source: o.flows.sourceSkill(m[1], m[2])?.source ?? skills.extraSource?.(m[1], m[2])?.source ?? null,
          edits: list().filter((e) => e.workflow === m![1] && e.role === m![2]).map((e) => view(e)), cases: evals.cases(m[1], m[2]) });
      }
      m = /^\/api\/improve\/evals\/([\w-]+)\/([\w-]+)$/.exec(p);
      if (m && !writing) return json(evals.cases(m[1], m[2]));
      if (m && writing) return json(evals.add({ workflow: m[1], role: m[2], title: String(b?.title ?? "case"), from: { task: b?.task ?? null, actor: b?.actor ?? null, seq: b?.seq ?? null, ts: null },
        situation: String(b?.situation ?? ""), ask: String(b?.ask ?? ""), terms: Array.isArray(b?.terms) ? b.terms.map(String) : [], expect: Array.isArray(b?.expect) ? b.expect : [], forbid: Array.isArray(b?.forbid) ? b.forbid : [] }));
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
  }
  return { handle, skills, evals, retros, runRetro, startChatEdit, adopt, reject, get, list, checkTriggers };
}
