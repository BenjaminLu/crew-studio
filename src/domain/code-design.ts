// The designer round of code-firstmate (packs/firstmate, docs/code-firstmate-pipeline.md). A diff that touches UI paths
// (policy ui_paths, plus the paths the repository's .crew/app.json declares) gets a fresh-context designer after the
// reviewer, on the staffed designer role:
//   design-scope (check node)    route ui (the designer runs) or none (skipped; the reason it is not applicable is recorded)
//   designer (agent node)        sees every before / after capture of the head as a picture (design_view), with the spec,
//                                the captain's notes and the UI diff, then one verdict: APPROVE, or REJECT with findings
//   design-verdict (its check)   a REJECT is a blocking fail, so the fix loop sends its findings to the worker like a reviewer
//                                REJECT; no verdict after the retry is design-unverified (the step-back card)
// The merge card shows the verdicts, the open findings and designer-compare's warnings beside the captures.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "../agent";
import type { Engine, X } from "../runtime/engine";
import { git } from "../git";

type Deps = {
  dataDir: string; shellOk: (x: X) => string; head: (wt: string) => string;
  /** the changed paths that are UI as the repository classifies them */
  uiPathsOf: (x: X, wt: string) => string[];
  specMd: (s: any) => string;
};
type View = { key: string; page: string; label: string; side: "before" | "after"; file: string; url: string };
export type DesignFinding = { n: number; page: string | null; element: string | null; problem: string; change: string; url: string | null };

/** the captures of head h the designer sees: each page's before (base) and after (head) picture that exists on disk */
export function designViews(dataDir: string, x: X, h: string): { views: View[]; missing: string | null } {
  const cap = x.ctx.captures;
  if (!cap || cap.head !== h) return { views: [], missing: "no capture of this head ran" };
  if (cap.skipped) return { views: [], missing: cap.skipped };
  const dir = join(dataDir, "runs", x.run.id, "captures", h.slice(0, 12)); const views: View[] = [];
  for (const p of cap.pages ?? []) for (const side of ["before", "after"] as const) {
    const file = join(dir, side, `${p.file}.png`);
    if (p[side] && existsSync(file)) views.push({ key: `${p.file}:${side}`, page: p.file, label: p.label, side, file, url: p[side] });
  }
  return { views, missing: views.length ? null : cap.rendered === false ? "the pages were built but not shot: no headless browser (Doctor → Headless browser)" : "no page was captured" };
}

export function installCodeDesign(engine: Engine, d: Deps) {
  // ---------- design-scope: route ui | none ----------
  engine.natives["design-scope"] = (_i, hp) => {
    const x = hp.x as X; const wt = d.shellOk(x); const h = d.head(wt); const ui = d.uiPathsOf(x, wt);
    if (!ui.length) return { verdict: "pass", score: 1, findings: [], data: { route: "none", head: h, ui: [], reason: "not applicable: no changed path is UI (policy ui_paths, or the paths .crew/app.json declares)" } } as any;
    return { verdict: "pass", score: 1, findings: [], data: { route: "ui", head: h, ui, reason: `UI paths changed: ${ui.slice(0, 5).join(", ")}${ui.length > 5 ? ` (+${ui.length - 5})` : ""}` } } as any;
  };

  // ---------- the designer: a fresh context, the captures as pictures, one verdict ----------
  const captainNotes = (x: X): string[] => Object.entries(x.ctx.answers ?? {}).flatMap(([node, a]: [string, any]) => (a && typeof a.note === "string" && a.note.trim() ? [`${node} (${a.choice ?? "answer"}): ${a.note.trim().slice(0, 600)}`] : []));
  const lastReject = (x: X) => { const last = (x.ctx.designs ?? []).at(-1); return last?.verdict === "REJECT" ? last : null; };
  const findingText = (f: DesignFinding) => `${f.n}. ${f.page ?? "(any page)"}${f.element ? ` · ${f.element}` : ""}: ${f.problem}\n   Change: ${f.change}`;
  engine.modes["design-review"] = {
    begin: (x: X) => {
      const sc = x.ctx.designScope; const h = d.head(d.shellOk(x));
      if (!sc || sc.route !== "ui" || sc.head !== h) throw new Error("the designer has no UI scope bound to this head (design-scope did not route it here)");
      x.rn.data.design = { head: h, viewed: {}, verdict: null, refusals: [] }; x.save();
    },
    sandbox: () => null,
    tools: (x: X): AgentTool[] => {
      const D = () => x.rn.data.design; const { views } = designViews(d.dataDir, x, D().head);
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
            D().verdict = { verdict, head: D().head, findings, seen: views.map((v) => v.key), at: new Date().toISOString() }; x.save(); return { ok: true };
          } } as AgentTool];
    },
    maxTools: (x: X) => designViews(d.dataDir, x, x.rn.data.design?.head ?? "").views.length + 12,
    system: (x: X, skill: string) => `${skill}\n\nYou are the designer reviewer of one UI change, with a fresh context: you get the spec, the captain's notes, the UI diff and the before / after captures of the head, never the worker's reasoning. See every view the prompt lists with design_view (each comes back as a picture), then call design_verdict once: APPROVE, or REJECT with findings (page, element, what is wrong on screen, the exact change). Taste suggestions that do not block stay out of a REJECT. When the prompt says there are no captures, judge from the diff and the text that changed, and say in your last line what you could not see. Then answer with APPROVE:${x.run.id} or REJECT:${x.run.id} as your last line.`,
    prompt: (x: X) => {
      const wt = d.shellOk(x); const h = x.rn.data.design?.head ?? d.head(wt); const { views, missing } = designViews(d.dataDir, x, h); const sc = x.ctx.designScope ?? {};
      const diff = git(wt, ["diff", "--no-color", `${x.ctx.baseCommit}..HEAD`, "--", ...(sc.ui ?? [])]).out.slice(0, 16000);
      const notes = captainNotes(x); const prev = lastReject(x);
      const changed = (x.ctx.captures?.head === h ? x.ctx.captures.pages ?? [] : []).filter((p: any) => p.changed).map((p: any) => `- ${p.label} (${p.file}): ${(p.changed.removed ?? []).slice(0, 6).join(" · ") || "—"} → ${(p.changed.added ?? []).slice(0, 6).join(" · ") || "—"}`);
      return `DESIGN REVIEW\nRun ${x.run.id} · design review ${x.visit} · head ${h}\n${d.specMd(x.ctx.spec)}\n${notes.length ? `\nCaptain's notes:\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}`
        + `\nUI paths changed: ${(sc.ui ?? []).join(", ")}\n`
        + (views.length ? `\nViews (see each with design_view):\n${views.map((v) => `View: page=${v.page} side=${v.side} (${v.label})`).join("\n")}\n` : `\nNo captures of this head: ${missing}.\n`)
        + (changed.length ? `\nText that changed on screen (base → head):\n${changed.join("\n")}\n` : "")
        + (prev ? `\nYour earlier REJECT (head ${String(prev.head).slice(0, 8)}): check each item on the new head.\n${prev.findings.map(findingText).join("\n")}\n` : "")
        + `\nUI diff (base..head):\n${diff || "(no diff)"}`;
    },
    after: (x: X, job: any) => {
      const D = x.rn.data.design;
      if (!D?.verdict) {
        if ((x.rn.attempt ?? 0) < (x.node.retries ?? 0)) throw new Error(`the designer gave no verdict${D?.refusals?.length ? `: ${D.refusals.at(-1)}` : ""}`);
        if (D) D.unverified = D.refusals?.at(-1) ?? "the designer gave no verdict"; x.rn.note = "no design verdict after the retry"; x.save(); return "ok";
      }
      const by = `${job.provider}·${job.model} (designer #${x.visit})`;
      x.ctx.designs = [...(x.ctx.designs ?? []), { ...D.verdict, by, round: x.visit }];
      x.rn.note = `${D.verdict.verdict}${D.verdict.findings.length ? `: ${D.verdict.findings.length} finding${D.verdict.findings.length > 1 ? "s" : ""}` : ""} · saw ${D.verdict.seen.length} capture${D.verdict.seen.length === 1 ? "" : "s"}`; return "ok";
    },
  } as any;

  /** firstmate/design-verdict: the designer's verdict on this head; a REJECT's findings are blocking, so the fix loop takes them */
  engine.natives["design-verdict"] = (_i, hp) => {
    const x = hp.x as X; const D = x.rn.data.design;
    if (!D?.verdict) return { verdict: "fail", score: 0, findings: [{ locator: { type: "card", field: "designer" }, message: `the designer gave no verified verdict: ${D?.unverified ?? "none"}`, expected: "a design verdict after every capture is seen", class: "design-unverified", severity: "blocking" }], data: { head: D?.head ?? null, refusals: D?.refusals ?? [], viewed: Object.keys(D?.viewed ?? {}) } } as any;
    const v = D.verdict; const pass = v.verdict === "APPROVE";
    return { verdict: pass ? "pass" : "fail", score: pass ? 1 : 0,
      findings: pass ? [] : v.findings.map((f: DesignFinding) => ({ locator: f.url ? { type: "web", url: f.url, selector: f.element, viewport: { w: 1280, h: 800 } } : { type: "card", field: "designer" }, message: `design ${f.n}: ${f.page ?? "the UI"}${f.element ? ` ${f.element}` : ""}: ${f.problem}`, expected: f.change, class: "design", severity: "blocking" })),
      data: { head: D.head, verdict: v.verdict, findings: v.findings, viewed: Object.keys(D.viewed), refusals: D.refusals } } as any;
  };
}
