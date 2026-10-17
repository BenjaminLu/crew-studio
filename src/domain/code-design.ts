// The designer round of code-firstmate (packs/firstmate, docs/code-firstmate-pipeline.md). A diff that touches UI paths
// (policy ui_paths, plus the paths the repository's .crew/app.json declares) gets a fresh-context designer after the
// reviewer, on the staffed designer role:
//   design-scope (check node)    route none (skipped; why it is not applicable is recorded), ui (the designer runs), or gap:
//                                the repository declares an app but a page's capture is missing after one recapture. A gap
//                                is a typed env gap (env.design-captures, an env_gap event) routed to Firstmate (design-gap),
//                                never to the worker and never a diff-only pass. With no app declared the designer reviews
//                                the diff only, and says so.
//   designer (agent node)        sees every before / after capture of the head as a picture (design_view), with the spec,
//                                the captain's notes and the UI diff, then one verdict: APPROVE, or REJECT with findings
//   design-verdict (its check)   a REJECT is a blocking fail, so the fix loop sends its findings to the worker like a reviewer
//                                REJECT; no verdict after the retry is design-unverified (the step-back card, whose "another
//                                model" reruns the designer on it)
//   gate-design (merge edge)     the merge needs design-scope's none, or a design APPROVE, on the exact head
// The merge card shows the verdicts, the open findings, what the designer saw and designer-compare's warnings.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "../agent";
import type { Engine, X } from "../runtime/engine";
import type { EnvGap } from "../env-preflight";
import { git } from "../git";

type Deps = {
  dataDir: string; shellOk: (x: X) => string; head: (wt: string) => string;
  /** the changed paths that are UI as the repository classifies them */
  uiPathsOf: (x: X, wt: string) => string[];
  /** the repository declares an app (.crew/app.json) whose pages Studio captures */
  appDeclared: (wt: string) => boolean;
  /** captures the app on the base and the head again (firstmate/ui-captures), storing x.ctx.captures */
  capture: (x: X) => Promise<unknown>;
  recordEnvGaps: (x: X, gaps: EnvGap[]) => void;
  specMd: (s: any) => string;
};
type View = { key: string; page: string; label: string; side: "before" | "after"; file: string; url: string };
export type DesignFinding = { n: number; page: string | null; element: string | null; problem: string; change: string; url: string | null };

/** the captures of head h the designer sees (each page's before and after picture on disk), and what is missing from them */
export function designViews(dataDir: string, x: X, h: string): { views: View[]; missing: string[] } {
  const cap = x.ctx.captures;
  if (!cap || cap.head !== h) return { views: [], missing: ["no capture of this head ran"] };
  if (cap.skipped) return { views: [], missing: [cap.skipped] };
  const dir = join(dataDir, "runs", x.run.id, "captures", h.slice(0, 12)); const views: View[] = [], missing: string[] = [];
  if (cap.rendered === false) missing.push("the pages were built but not shot: no headless browser (Doctor → Headless browser)");
  for (const p of cap.pages ?? []) for (const side of ["before", "after"] as const) {
    const file = join(dir, side, `${p.file}.png`);
    if (p[side] && existsSync(file)) views.push({ key: `${p.file}:${side}`, page: p.file, label: p.label, side, file, url: p[side] });
    // a page new on the head has no before; every page the head builds needs its after
    else if (side === "after" || p.built?.before) missing.push(`${p.label} (${p.file}) ${side}${p.built?.[side] === false ? ": the page did not build" : ": no picture"}`);
  }
  if (!(cap.pages ?? []).length) missing.push("no page was captured");
  return { views, missing: [...new Set(missing)] };
}

export function installCodeDesign(engine: Engine, d: Deps) {
  // ---------- design-scope: route none | ui | gap ----------
  engine.natives["design-scope"] = async (_i, hp) => {
    const x = hp.x as X; const wt = d.shellOk(x); const h = d.head(wt); const ui = d.uiPathsOf(x, wt);
    if (!ui.length) { x.ctx.designGap = null; return { verdict: "pass", score: 1, findings: [], data: { route: "none", head: h, ui: [], reason: "not applicable: no changed path is UI (policy ui_paths, or the paths .crew/app.json declares)" } } as any; }
    const why = `UI paths changed: ${ui.slice(0, 5).join(", ")}${ui.length > 5 ? ` (+${ui.length - 5})` : ""}`;
    // no app declared: nothing can be captured, so the designer reviews the diff only (and the card says so)
    if (!d.appDeclared(wt)) { x.ctx.designGap = null; return { verdict: "pass", score: 1, findings: [], data: { route: "ui", head: h, ui, captures: "diff-only", diffOnly: true, reason: `${why}; the repository declares no app (.crew/app.json): a diff-only review, no pictures` } } as any; }
    // an app is declared: every page needs its pictures. Studio captures the head once when no capture of it ran (a capture that
    // ran and missed a page is not rerun here: the build is code a round wrote), and again after a gap (Firstmate's or the
    // captain's recapture); a gap goes to Firstmate, never to a diff-only verdict
    if (x.ctx.captures?.head !== h || x.ctx.designGap) { try { await d.capture(x); } catch (e: any) { x.log(`design-scope: the capture failed: ${String(e?.message ?? e).slice(0, 300)}`); } }
    const { views, missing } = designViews(d.dataDir, x, h);
    if (missing.length) {
      const gap: EnvGap = { code: "env.design-captures", route: "firstmate", message: `the change touches UI paths and the repository declares an app, but the designer has no captures of: ${missing.slice(0, 6).join("; ")}`, expected: "every page of the app (.crew/app.json) built and captured on the base and the head, then a recapture" };
      x.ctx.designGap = { ...gap, head: h, ui, missing, at: new Date().toISOString() }; d.recordEnvGaps(x, [gap]);
      return { verdict: "fail", score: 0, findings: [{ locator: { type: "file", path: ".crew/app.json" }, message: gap.message, expected: gap.expected, class: gap.code, severity: "blocking" }], data: { route: "gap", head: h, ui, captures: "none-env-gap", missing, reason: `${why}; no captures: ${missing.slice(0, 3).join("; ")}` } } as any;
    }
    x.ctx.designGap = null;
    return { verdict: "pass", score: 1, findings: [], data: { route: "ui", head: h, ui, captures: "seen", views: views.map((v) => v.key), reason: why } } as any;
  };

  // ---------- the designer: a fresh context, the captures as pictures, one verdict ----------
  const captainNotes = (x: X): string[] => Object.entries(x.ctx.answers ?? {}).flatMap(([node, a]: [string, any]) => (a && typeof a.note === "string" && a.note.trim() ? [`${node} (${a.choice ?? "answer"}): ${a.note.trim().slice(0, 600)}`] : []));
  const lastReject = (x: X) => { const last = (x.ctx.designs ?? []).at(-1); return last?.verdict === "REJECT" ? last : null; };
  const findingText = (f: DesignFinding) => `${f.n}. ${f.page ?? "(any page)"}${f.element ? ` · ${f.element}` : ""}: ${f.problem}\n   Change: ${f.change}`;
  // the step-back card's "another model" after a design-unverified (provider/model in its note): the next designer round runs on it, once per answer
  const designSwap = (x: X) => { const a = x.ctx.answers?.["step-back"]; if (a?.choice !== "other-model" || x.ctx.stepBackFor !== "design" || x.ctx.designSwapAt === a.at) return;
    const [provider, ...rest] = String(a.note ?? "").trim().split("/").map((t: string) => t.trim()); x.ctx.designSwapAt = a.at;
    if (provider) { x.rn.agent = { provider, model: rest.join("/") || null }; x.log(`the step-back card's pick: this design review runs on ${provider}${rest.length ? ` · ${rest.join("/")}` : ""}`); } };
  engine.modes["design-review"] = {
    preparePick: designSwap,
    begin: (x: X) => {
      const sc = x.ctx.designScope; const h = d.head(d.shellOk(x));
      if (!sc || sc.route !== "ui" || sc.head !== h) throw new Error("the designer has no UI scope bound to this head (design-scope did not route it here)");
      // defence in depth: with an app declared, the designer never reviews without its pictures
      if (!sc.diffOnly && designViews(d.dataDir, x, h).missing.length) throw new Error("the app's captures of this head are incomplete: design-scope routes that to Firstmate, never to a diff-only review");
      x.ctx.designUnverified = null; x.rn.data.design = { head: h, diffOnly: !!sc.diffOnly, viewed: {}, verdict: null, refusals: [] }; x.save();
    },
    sandbox: () => null,
    tools: (x: X): AgentTool[] => {
      const D = () => x.rn.data.design; const views = D().diffOnly ? [] : designViews(d.dataDir, x, D().head).views;
      const refuse = (why: string) => { D().refusals.push(why); x.save(); return { error: why }; };
      return [
        { name: "design_view", description: "See one capture as a picture: page (its file, e.g. index.html) and side (before = the base, after = the head). Call it for every view the prompt lists before your verdict.",
          schema: { type: "object", properties: { page: { type: "string" }, side: { type: "string", enum: ["before", "after"] } }, required: ["page", "side"] },
          run: async (a) => { const v = views.find((y) => y.page === String(a.page ?? "") && y.side === (a.side === "before" ? "before" : "after"));
            if (!v) return { error: `no ${a.side ?? "after"} capture of ${a.page}; the views are: ${views.map((y) => `${y.page} ${y.side}`).join(", ") || "(none)"}` };
            let b: Buffer; try { b = readFileSync(v.file); } catch { return { error: `the capture ${v.url} cannot be read` }; }
            D().viewed[v.key] = { at: new Date().toISOString(), bytes: b.length }; x.save();
            return { page: v.page, label: v.label, side: v.side, viewport: { w: 1280, h: 800 }, url: v.url, note: "the picture is attached", __image: { mimeType: "image/png", data: b.toString("base64") } }; } },
        { name: "design_verdict", description: "Your verdict, once: APPROVE, or REJECT with its findings. Each finding: page (its file), element (a CSS selector, when there is one), problem (what is wrong on screen) and change (the exact change that fixes it).",
          schema: { type: "object", properties: { verdict: { type: "string", enum: ["APPROVE", "REJECT"] },
            findings: { type: "array", items: { type: "object", properties: { page: { type: "string" }, element: { type: "string" }, problem: { type: "string" }, change: { type: "string" } }, required: ["problem", "change"] } } }, required: ["verdict"] },
          run: (a) => {
            if (D().verdict) return refuse("the verdict was already given, once");
            const unseen = views.filter((v) => !D().viewed[v.key]).map((v) => `${v.page} ${v.side}`);
            if (unseen.length) return refuse(`a verdict needs every capture seen first; not yet viewed: ${unseen.join(", ")}`);
            const verdict = a.verdict === "APPROVE" ? "APPROVE" : a.verdict === "REJECT" ? "REJECT" : null; if (!verdict) return refuse("verdict is APPROVE or REJECT");
            const fs = (Array.isArray(a.findings) ? a.findings : []).slice(0, 20);
            if (verdict === "REJECT" && !fs.length) return refuse("a REJECT needs its findings");
            if (verdict === "APPROVE" && fs.length) return refuse("an APPROVE carries no finding");
            const pages = [...new Set(views.map((v) => v.page))]; const bad: string[] = [];
            const findings: DesignFinding[] = fs.map((f: any, i: number) => {
              const page = f?.page ? String(f.page) : null, problem = String(f?.problem ?? "").trim(), change = String(f?.change ?? "").trim();
              if (!problem || !change) bad.push(`finding ${i + 1}: problem and change are required`);
              if (page && pages.length && !pages.includes(page)) bad.push(`finding ${i + 1}: page ${page} is not one of ${pages.join(", ")}`);
              return { n: i + 1, page, element: f?.element ? String(f.element).slice(0, 200) : null, problem: problem.slice(0, 600), change: change.slice(0, 800), url: views.find((v) => v.page === page && v.side === "after")?.url ?? null };
            });
            if (bad.length) return refuse(bad.join(" · "));
            D().verdict = { verdict, head: D().head, findings, seen: views.map((v) => v.key), diffOnly: D().diffOnly, at: new Date().toISOString() }; x.save(); return { ok: true };
          } } as AgentTool];
    },
    maxTools: (x: X) => designViews(d.dataDir, x, x.rn.data.design?.head ?? "").views.length + 12,
    system: (x: X, skill: string) => `${skill}\n\nYou are the designer reviewer of one UI change, with a fresh context: you get the spec, the captain's notes, the UI diff and the before / after captures of the head, never the worker's reasoning. See every view the prompt lists with design_view (each comes back as a picture), then call design_verdict once: APPROVE, or REJECT with findings (page, element, what is wrong on screen, the exact change). Taste suggestions that do not block stay out of a REJECT. When the prompt says this is a diff-only review (the repository declares no app, so there are no pictures), judge from the diff and say in your last line that you saw no pictures. Then answer with APPROVE:${x.run.id} or REJECT:${x.run.id} as your last line.`,
    prompt: (x: X) => {
      const wt = d.shellOk(x); const h = x.rn.data.design?.head ?? d.head(wt); const sc = x.ctx.designScope ?? {}; const views = sc.diffOnly ? [] : designViews(d.dataDir, x, h).views;
      const diff = git(wt, ["diff", "--no-color", `${x.ctx.baseCommit}..HEAD`, "--", ...(sc.ui ?? [])]).out.slice(0, 16000);
      const notes = captainNotes(x); const prev = lastReject(x);
      const changed = (x.ctx.captures?.head === h ? x.ctx.captures.pages ?? [] : []).filter((p: any) => p.changed).map((p: any) => `- ${p.label} (${p.file}): ${(p.changed.removed ?? []).slice(0, 6).join(" · ") || "—"} → ${(p.changed.added ?? []).slice(0, 6).join(" · ") || "—"}`);
      return `DESIGN REVIEW\nRun ${x.run.id} · design review ${x.visit} · head ${h}${sc.diffOnly ? " · diff-only" : ""}\n${d.specMd(x.ctx.spec)}\n${notes.length ? `\nCaptain's notes:\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}`
        + `\nUI paths changed: ${(sc.ui ?? []).join(", ")}\n`
        + (sc.diffOnly ? "\nDiff-only review, no pictures: the repository declares no app (.crew/app.json), so nothing was captured. Judge from the diff.\n" : `\nViews (see each with design_view):\n${views.map((v) => `View: page=${v.page} side=${v.side} (${v.label})`).join("\n")}\n`)
        + (changed.length ? `\nText that changed on screen (base → head):\n${changed.join("\n")}\n` : "")
        + (prev ? `\nYour earlier REJECT (head ${String(prev.head).slice(0, 8)}): check each item on the new head.\n${prev.findings.map(findingText).join("\n")}\n` : "")
        + `\nUI diff (base..head):\n${diff || "(no diff)"}`;
    },
    after: (x: X, job: any) => {
      const D = x.rn.data.design;
      if (!D?.verdict) {
        if ((x.rn.attempt ?? 0) < (x.node.retries ?? 0)) throw new Error(`the designer gave no verdict${D?.refusals?.length ? `: ${D.refusals.at(-1)}` : ""}`);
        // still none after the retry: design-verdict fails with design-unverified and the fix loop routes to the step-back card
        const why = D?.refusals?.at(-1) ?? "the designer gave no verdict"; if (D) D.unverified = why; x.ctx.designUnverified = why;
        x.rn.note = "no design verdict after the retry"; x.save(); return "ok";
      }
      x.ctx.designUnverified = null;
      const by = `${job.provider}·${job.model} (designer #${x.visit})`;
      x.ctx.designs = [...(x.ctx.designs ?? []), { ...D.verdict, by, round: x.visit }];
      x.rn.note = `${D.verdict.verdict}${D.verdict.findings.length ? `: ${D.verdict.findings.length} finding${D.verdict.findings.length > 1 ? "s" : ""}` : ""} · ${D.verdict.diffOnly ? "diff-only, no pictures" : `saw ${D.verdict.seen.length} capture${D.verdict.seen.length === 1 ? "" : "s"}`}`; return "ok";
    },
  } as any;

  /** firstmate/design-verdict: the designer's verdict on this head; a REJECT's findings are blocking, so the fix loop takes them */
  engine.natives["design-verdict"] = (_i, hp) => {
    const x = hp.x as X; const D = x.rn.data.design;
    if (!D?.verdict) return { verdict: "fail", score: 0, findings: [{ locator: { type: "card", field: "designer" }, message: `the designer gave no verified verdict: ${D?.unverified ?? "none"}`, expected: "a design verdict after every capture is seen", class: "design-unverified", severity: "blocking" }], data: { head: D?.head ?? null, refusals: D?.refusals ?? [], viewed: Object.keys(D?.viewed ?? {}) } } as any;
    const v = D.verdict; const pass = v.verdict === "APPROVE";
    return { verdict: pass ? "pass" : "fail", score: pass ? 1 : 0,
      findings: pass ? [] : v.findings.map((f: DesignFinding) => ({ locator: f.url ? { type: "web", url: f.url, selector: f.element, viewport: { w: 1280, h: 800 } } : { type: "card", field: "designer" }, message: `design ${f.n}: ${f.page ?? "the UI"}${f.element ? ` ${f.element}` : ""}: ${f.problem}`, expected: f.change, class: "design", severity: "blocking" })),
      data: { head: D.head, verdict: v.verdict, findings: v.findings, viewed: Object.keys(D.viewed), diffOnly: !!v.diffOnly, refusals: D.refusals } } as any;
  };

  /** firstmate/gate-design: the merge edge needs design-scope's none, or a design APPROVE, on the exact head (or on a patch proven identical) */
  engine.natives["gate-design"] = (_i, hp) => {
    // the verified ledger only (signed entries, like gate-approval): an entry that does not verify, or a ledger cut short, proves nothing
    const x = hp.x as X; const h = d.head(d.shellOk(x)); x.ctx.gatedHead = h; const T = engine.trusted(x.run.id); const L = (T.ok ? T.entries : []) as any[];
    if (!T.ok) return { verdict: "fail", score: 0, findings: [{ locator: { type: "card", field: "design" }, message: "the evidence ledger does not verify: no design verdict can be trusted", expected: `a signed design APPROVE (or no UI path changed) on ${h.slice(0, 8)}`, class: "gate-design", severity: "blocking" }], data: { detail: "the evidence ledger does not verify", head: h } } as any;
    const scope = L.filter((e) => e.check === "firstmate/design-scope").at(-1); const ver = L.filter((e) => e.check === "firstmate/design-verdict").at(-1);
    const carry = L.filter((e) => e.record === "approval-carry").at(-1);
    const verHead = ver?.data?.head ?? ver?.head ?? null;
    const carried = ver?.verdict === "pass" && !!verHead && carry?.head === h && carry?.data?.proof?.fromHead === verHead && carry.data.proof.toHead === h && carry.data.proof.clean === true;
    let ok = false, detail: string;
    if (scope?.data?.route === "none" && scope.head === h) { ok = true; detail = `no UI path changed at ${h.slice(0, 8)}`; }
    else if (ver?.verdict === "pass" && verHead === h && scope?.data?.route === "ui") { ok = true; detail = `design APPROVE at ${h.slice(0, 8)}${ver.data?.diffOnly ? " (diff-only, no pictures)" : ""}`; }
    else if (carried && scope?.data?.route === "ui") { ok = true; detail = `design APPROVE at ${String(verHead).slice(0, 8)}, carried to ${h.slice(0, 8)} on a proven-identical patch`; }
    else detail = !scope ? "design-scope never ran" : scope.data?.route === "gap" ? `no captures of the app (${scope.data?.reason ?? "env gap"})`
      : scope.data?.route === "none" ? `design-scope ran on ${String(scope.head).slice(0, 8)}, not ${h.slice(0, 8)}`
      : ver ? `the last design verdict is ${ver.verdict} at ${String(verHead).slice(0, 8)}, not an APPROVE on ${h.slice(0, 8)}` : "UI paths changed and no designer reviewed them";
    return { verdict: ok ? "pass" : "fail", score: ok ? 1 : 0, findings: ok ? [] : [{ locator: { type: "card", field: "design" }, message: detail, expected: `a design APPROVE (or no UI path changed) on ${h.slice(0, 8)}`, class: "gate-design", severity: "blocking" }], data: { detail, head: h } } as any;
  };

  // ---------- design-gap: Firstmate gets the typed capture gap first ----------
  engine.modes["design-gap"] = {
    sandbox: () => null,
    tools: (x: X): AgentTool[] => [{ name: "design_gap_route", description: "Once: where this capture gap goes. recapture: the cause is fixed (or was transient), Studio captures again. escalate: only the captain can unblock it; name why (credential-permission, one-way or preference).",
      schema: { type: "object", properties: { route: { type: "string", enum: ["recapture", "escalate"] }, reason: { type: "string" }, why: { type: "string", enum: ["credential-permission", "one-way", "preference"] } }, required: ["route", "reason"] },
      run: (a) => { const route = String(a.route ?? ""); if (route !== "recapture" && route !== "escalate") return { error: "route is recapture or escalate" };
        if (route === "escalate" && !["credential-permission", "one-way", "preference"].includes(String(a.why))) return { error: "an escalation names why only the captain can answer: credential-permission, one-way or preference" };
        x.rn.data.gapRoute = { route, reason: String(a.reason ?? "").slice(0, 800), why: route === "escalate" ? String(a.why) : null }; x.save(); return { ok: true }; } } as AgentTool],
    maxTools: 4,
    system: (_x: X, skill: string) => `${skill}\n\nYou are the coordinator (firstmate). The designer review of a UI change cannot start: the app's captures are missing (a typed env gap). Decide where it goes with design_gap_route, once; the captain sees it only for a credential or permission, a one-way decision or a preference. Then one line.`,
    prompt: (x: X) => { const g = x.ctx.designGap ?? {}; return `DESIGN GAP\nRun ${x.run.id} · head ${g.head ?? x.ctx.head} · code ${g.code}\nFound: ${g.message}\nExpected: ${g.expected}\nMissing:\n${(g.missing ?? []).map((m: string) => `- ${m}`).join("\n")}\nUI paths changed: ${(g.ui ?? []).join(", ")}\n\nRoutes: recapture | escalate (why: credential-permission | one-way | preference)`; },
    after: (x: X) => { const r = x.rn.data.gapRoute; if (!r) throw new Error("firstmate gave no route for the capture gap");
      // Firstmate's recapture runs once per head: the same gap again on that head goes to the captain, never round and round
      const h = String(x.ctx.designGap?.head ?? ""); const tried = (x.ctx.designRecaptures ??= {})[h] ?? 0;
      const route = r.route === "recapture" && tried >= 1 ? "escalate" : r.route; if (route === "recapture") x.ctx.designRecaptures[h] = tried + 1;
      const fm = route === r.route ? r : { ...r, route, why: "credential-permission", reason: `a recapture on ${h.slice(0, 8)} already missed these pages: ${r.reason}` };
      x.ctx.designGap = { ...(x.ctx.designGap ?? {}), firstmate: fm }; x.rn.note = `${x.ctx.designGap.code} → ${route}: ${fm.reason}`.slice(0, 300); return route; },
  } as any;
}
