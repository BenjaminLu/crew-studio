// Native non-code workflows share the persisted scheduler, sandboxed agent rounds,
// check ledger and refine loop. No domain agent owns a human decision or a merge.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { folderTools } from "../agent";
import type { ArtifactStore } from "../artifacts";
import { bundledText } from "../bundled";
import { mdToDocHtml, toDocx, toPdf } from "../docrender";
import { runRender, renderEnv } from "../render";
import { briefFor } from "../runtime/refine";
import { mergeDetail } from "./mergecard";
import type { Engine, X } from "../runtime/engine";

type Deps = { dataDir: string; artifacts: ArtifactStore; lane: any; fileorg: any; docs: any };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export function installDeliver(engine: Engine, d: Deps) {
  const st = d.artifacts;
  engine.actions["deliver.intake"] = x => { x.ctx.intent = { text: x.run.text, workflow: x.run.workflow }; x.ctx.spec ??= { done: [x.run.workflow === "trivial-lane" ? "The local image recipe passes its deterministic checks" : x.run.workflow === "file-organization" ? "The planned moves stay inside the folder without overwrite" : "Every delivered source passes its deterministic readiness check", "The content and presentation match the captain's intent"] }; return "ok"; };
  const refs = (x: X): any[] => Object.values(x.ctx.deliver ?? {}).sort((a: any, b: any) => a.producer.localeCompare(b.producer));
  const ref = (x: X) => { const p = String(x.node.args?.producer ?? "draft"); const r = x.ctx.deliver?.[p]; if (!r || !st.version(r.id, r.n)) throw new Error("no pinned artifact output"); return r; };
  const kind = (x: X) => String(x.node.args?.format ?? "web");
  const entry = (f: string) => f === "document" ? "doc.md" : f === "video" ? "film.html" : "index.html";
  engine.actions["deliver.round"] = x => {
    const producers = x.run.def.nodes.filter(n => n.mode === "deliver"), source = producers.map(n => x.ctx.briefs?.[n.id]).find(b => b && b.head === x.ctx.head);
    if (source) for (const n of producers) (x.ctx.briefs ??= {})[n.id] = { ...source, producer: n.id, round: x.run.nodes[n.id].visits };
    return "ok";
  };
  engine.modes.deliver = {
    begin(x) {
      const dir = join(d.dataDir, "work", "deliver", x.run.id, `${x.node.id}-${x.visit}-${x.rn.attempt ?? 0}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const old = x.ctx.deliver?.[x.node.id]; if (old) cpSync(st.filesDir(old.id, old.n), dir, { recursive: true });
      if (kind(x) === "video" && !old) { const tpl = bundledText("workflows/v2/templates/film.html"); if (!tpl) throw new Error("film template unavailable"); writeFileSync(join(dir, "film.html"), tpl.replaceAll(/\{\{(?:TITLE|LINE[123])\}\}/g, "Crew Studio")); }
      x.rn.data.brief = briefFor(x); x.rn.data.dir = dir; x.rn.data.parent = old ?? null; x.rn.data.notes = old ? st.notes(old.id, old.n).filter(n => n.status === "open") : []; x.save();
    },
    sandbox: x => ({ writes: [x.rn.data.dir], cwd: x.rn.data.dir }),
    tools: x => folderTools(x.rn.data.dir, () => {}, "work").filter(t => t.name !== "work_search"), maxTools: 30,
    system: (x, skill) => `${skill}\nProduce ${entry(kind(x))} in the isolated work folder using work_* tools only. No shell, network or external assets. Preserve existing content unless the brief changes it.${kind(x) === "video" ? " Keep the renderer contract: #stage, DUR, render(t), build() and schedule()." : ""}`,
    prompt: x => `DELIVER ${kind(x)}\nVariant: ${x.node.args?.variant ?? "A"}\nIntent: ${x.run.text || x.run.title}\n${x.rn.data.brief?.text ?? ""}\nOpen annotations: ${JSON.stringify(x.rn.data.notes ?? [])}\nWrite ${entry(kind(x))}.`,
    after(x, job) {
      if (x.cancelled()) throw new Error("cancelled");
      const f = kind(x), dir = x.rn.data.dir, e = entry(f); if (!existsSync(join(dir, e))) throw new Error(`the agent wrote no ${e}`);
      const id = x.ctx.deliver?.[x.node.id]?.id ?? `out-${x.run.id.toLowerCase()}-${x.node.id}`;
      if (!st.get(id)) st.create({ id, title: `${x.run.title} ${x.node.args?.variant ?? ""}`.trim(), type: f === "document" ? "doc" : f === "video" ? "video" : "web", source: f === "document" ? "md" : f === "video" ? "film" : "html", entry: e });
      if (f === "document") writeFileSync(join(dir, "doc.html"), mdToDocHtml(readFileSync(join(dir, e), "utf8"), x.run.title));
      const v = st.addVersion(id, { from: dir, primary: e, parent: x.rn.data.parent?.n ?? null, annotations: (x.rn.data.notes ?? []).map((n: any) => n.id), createdBy: { kind: "agent", provider: job.provider, model: job.model, run: job.id }, source: { run: x.run.id }, cost: job.cost, summary: job.said.slice(0, 300) });
      (x.ctx.deliver ??= {})[x.node.id] = { id, n: v.n, sha256: v.sha256, format: f, producer: x.node.id };
      // Approval evidence binds to the complete set, not a mutable global latest pointer.
      x.ctx.head = hash(refs(x)); x.ctx.spec ??= { done: ["Every delivered source passes its deterministic readiness check", "The content and presentation match the captain's intent"] };
      x.rn.note = `${id} v${v.n}`; return "ok";
    },
    end(x) { if (x.rn.data.dir) rmSync(x.rn.data.dir, { recursive: true, force: true }); },
  } as any;
  const previousRunInput = engine.artifacts.run;
  engine.artifacts.run = x => x.ctx.deliver ? ({ type: "run", data: refs(x), version: x.ctx.head }) : previousRunInput?.(x) ?? ({ type: "run", id: x.run.id });
  for (const t of ["web", "document", "video"]) engine.artifacts[t] = x => { const r = x.node.args?.producer === "all" ? refs(x)[0] : ref(x); return { type: t, path: st.file(r.id, r.n, entry(r.format)), version: r.n, data: r }; };
  const readiness = (x: X, r: any) => {
    const a = st.get(r.id), v = st.version(r.id, r.n); const findings: any[] = [];
    const bad = (message: string, expected: string, cls: string) => findings.push({ locator: r.format === "document" ? { type: "text", section: "source", start: 0, end: 1 } : r.format === "video" ? { type: "timeline", from: 0, to: 1 } : { type: "web", url: `#/review/${r.id}/${r.n}`, selector: "body", viewport: { width: 1280, height: 720 } }, message, expected, class: cls, severity: "blocking" });
    if (!a || !v || st.latest(r.id)?.n !== r.n || v.sha256 !== r.sha256 || st.verify(r.id, r.n).length) bad("artifact source changed or disappeared", "restore the exact version source", "artifact-integrity");
    const file = a && st.file(r.id, r.n, entry(r.format)); const s = file ? readFileSync(file, "utf8") : "";
    if (r.format === "document") { if (!/^#\s+\S/m.test(s) || s.trim().split(/\s+/).length < 4) bad("document needs a title and content", "write a # title followed by document content", "document-content"); }
    else if (!/<(?:html|body|main|div|h1|p)\b/i.test(s)) bad("page has no content element", "write a self-contained HTML page", "html-content");
    if (r.format !== "document" && /(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i.test(s)) bad("external resource URL", "embed required resources locally", "external-resource");
    if (st.notes(r.id, r.n).some(n => n.status === "open")) bad("artifact has unresolved notes", "produce a new version addressing the annotations", "open-note");
    if (r.format === "video" && (v?.render?.state !== "done" || !st.file(r.id, r.n, "render.mp4"))) bad("rendered MP4 is unavailable", "render this exact film version with the optional local renderer", "renderer-unavailable");
    return findings;
  };
  engine.natives["artifact-ready"] = (_i, h) => { const x = h.x as X; const rs = x.node.args?.producer === "all" ? refs(x) : [ref(x)]; const findings = rs.length ? rs.flatMap(r => readiness(x, r)) : [{ locator: { type: "card", field: "output" }, message: "No pinned artifact output exists", expected: "produce a versioned artifact before readiness checks", class: "missing-output", severity: "blocking" }]; return { verdict: findings.length ? "fail" : "pass", score: findings.length ? 0 : 1, findings, data: { artifacts: rs }, proves: findings.length ? [] : [0] } as any; };
  engine.actions["deliver.render"] = async x => {
    const r = ref(x), html = st.file(r.id, r.n, "film.html"); if (!html) throw new Error("film source unavailable");
    if (!renderEnv().canFilm) { st.setRender(r.id, r.n, { state: "failed", detail: "optional renderer unavailable: node, Playwright browser and ffmpeg required", ms: null }); x.rn.note = "MP4 unverified: optional renderer unavailable"; return "unavailable"; }
    const out = join(x.dir, `render-${r.id}-v${r.n}.mp4`); const job = runRender(d.dataDir, "film", { html, out });
    st.setRender(r.id, r.n, { state: "running", ms: null });
    let settled = false; job.done.finally(() => settled = true); while (!settled) { if (x.cancelled()) { job.cancel(); await job.done; throw new Error("cancelled"); } await sleep(40); }
    const result = await job.done; if (x.cancelled()) throw new Error("cancelled");
    st.setRender(r.id, r.n, { state: result.ok ? "done" : "failed", detail: result.error ?? null, ms: result.ms });
    if (result.ok && existsSync(out)) st.attach(r.id, r.n, "render.mp4", out);
    return result.ok ? "ok" : "unavailable";
  };
  const acceptanceDetail = (x: X, offered: any[] = [], kind: "artifact" | "file-plan" | "lane" = "artifact") => ({
    ...mergeDetail({ run: x.run.id, intent: x.run.text, spec: x.ctx.spec, ctx: x.ctx, ledger: engine.trusted(x.run.id).entries, doneMap: engine.doneLines(x.run), diff: "", stat: "", cost: null }, { intents: [], walk: [], done: (x.ctx.spec?.done ?? []).map((_: string, i: number) => i ? "內容和呈現方式符合船長的意圖" : kind === "file-plan" ? "搬移不出資料夾且不覆寫檔案" : kind === "lane" ? "本機修改通過必要檢查" : "作品原始檔與必要輸出通過完整性檢查") }),
    artifactAcceptance: { kind, offered },
  });
  const finalCard = async (x: X, error = "") => {
    const offered = refs(x); if (!offered.length) throw new Error("no output to accept");
    const done = engine.doneLines(x.run), proved = done.filter(l => l.proved), eye = done.filter(l => !l.proved);
    const c = await engine.card(x, "acceptance", { captainOnly: true, title: `Accept ${x.run.title}`, zhTitle: `驗收 ${x.run.title}`, body: `${error}\nProved by checks:\n${proved.map(l => `✓ ${l.text}`).join("\n") || "None"}\n\nNeeds your eye:\n${eye.map(l => `· ${l.text}`).join("\n") || "Content and presentation"}`, detail: acceptanceDetail(x, offered), links: offered.map(r => ({ label: `${r.producer} v${r.n}`, href: `/#/review/${r.id}/${r.n}` })), options: [...offered.map(r => ({ id: `approve-${r.producer}`, label: `Approve ${r.producer.startsWith("design-") ? `direction ${r.producer.slice(-1).toUpperCase()} ` : ""}v${r.n}`, labelZh: `核准${r.producer.startsWith("design-") ? `方向 ${r.producer.slice(-1).toUpperCase()} ` : ""}版本 ${r.n}`, primary: true })), { id: "changes", label: "Request changes", labelZh: "要求修改", note: true, hold: true }, { id: "reject", label: "Reject", labelZh: "不採用", hold: true }] });
    x.rn.data.offered = offered; x.rn.data.offerVisit = x.visit; x.rn.data.offerCard = c.id; x.save(); return { wait: true, note: `final acceptance ${c.id}` };
  };
  engine.cardModes["deliver-accept"] = {
    start: x => finalCard(x),
    async answer(x, c) {
      if (c.answer!.choice === "reject") return { outcome: "rejected" };
      const offers = c.detail?.artifactAcceptance?.offered; const selected = Array.isArray(offers) && offers.find((r: any) => c.answer!.choice === `approve-${r.producer}`);
      // Old in-flight cards lack pins: never synthesize pins; require a fresh card.
      if (c.id !== x.rn.data.offerCard || c.visit !== x.rn.data.offerVisit || !Array.isArray(offers) || hash(offers) !== hash(refs(x))) return finalCard(x, "The output changed or this card predates pinned acceptance. Review a fresh card.");
      if (c.answer!.choice === "changes") { if (!c.answer!.note?.trim() && !refs(x).some(r => st.notes(r.id, r.n).some(n => n.status === "open"))) return finalCard(x, "Write a change request or add an annotation first.");
        for (const r of offers) if (c.answer!.note) st.addNote(r.id, r.n, r.format === "video" ? { kind: "range", t0: 0, t1: 1, comment: c.answer!.note } : { kind: "pin", selector: r.format === "document" ? null : "body", comment: c.answer!.note });
        return { outcome: "changes" }; }
      if (!selected || readiness(x, selected).length || !engine.trusted(x.run.id).ok) return finalCard(x, "Checks or annotations need attention before approval.");
      st.approve(selected.id, selected.n, c.answer!.by); x.ctx.approved = { artifact: selected.id, version: selected.n, sha256: selected.sha256, by: c.answer!.by }; return { outcome: "approved" };
    },
  };
  engine.actions["library.publish"] = x => { const a = x.ctx.approved; if (!a || st.version(a.artifact, a.version)?.status !== "approved" || st.verify(a.artifact, a.version).length) throw new Error("no intact pinned approval"); x.ctx.library = { ...a, href: `#/artifact/${a.artifact}` }; return "ok"; };
  engine.actions["doc.export"] = x => { const a = x.ctx.approved; if (!a) throw new Error("no approved document"); const md = readFileSync(st.file(a.artifact, a.version, "doc.md")!, "utf8"), title = st.get(a.artifact)!.title; const out = join(x.dir, "exports"); mkdirSync(out, { recursive: true }); const pdf = toPdf(md, title);
    const bodies: Record<string, any> = { md, html: mdToDocHtml(md, title), docx: toDocx(md, title), pdf: pdf.pdf };
    for (const [ext, body] of Object.entries(bodies)) writeFileSync(join(out, `${a.artifact}-v${a.version}.${ext}`), body);
    x.ctx.exports = Object.keys(bodies); x.ctx.exportWarnings = pdf.lossy ? ["PDF uses ? for non-Latin text; use HTML or DOCX to preserve it"] : []; x.rn.note = `exported md, html, docx, pdf${pdf.lossy ? " (PDF character limitation)" : ""}`; return "ok";
  };
  const safePlan = (p: any) => {
    if (!p || p.status !== "planned") throw new Error("no current move plan"); d.fileorg.checkRoot(p.root);
    for (const m of p.moves.filter((m: any) => m.include)) {
      if (!m.from.startsWith(p.root + "/") || !m.to.startsWith(p.root + "/") || relative(p.root, m.to).startsWith("..")) throw new Error("move escapes folder");
      let parent = dirname(m.to); while (!existsSync(parent)) parent = dirname(parent);
      if (realpathSync(parent) !== p.root && !realpathSync(parent).startsWith(p.root + "/")) throw new Error("move destination escapes through a link");
      const s = lstatSync(m.from); if (!s.isFile() || s.isSymbolicLink() || s.size !== m.size || s.mtimeMs !== m.mtimeMs || existsSync(m.to)) throw new Error("move source or destination changed since planning");
    }
    if (!p.gates.length || p.gates.some((g: any) => g.state !== "pass")) throw new Error("move plan has no passing gates"); return p;
  };
  const moveIdentity = (p: any) => hash({ id: p.id, root: p.root, moves: p.moves.map(({ id, from, to, category, size, mtimeMs, include }: any) => ({ id, from, to, category, size, mtimeMs, include })) });
  engine.actions["fileorg.plan"] = x => { const p = safePlan(d.fileorg.plan(x.run.params.folder)); x.ctx.plan = { id: p.id, hash: hash(p), identity: moveIdentity(p) }; x.ctx.head = hash(p); return "ok"; };
  engine.natives["fileorg-plan"] = (_i, h) => { const x = h.x as X; try { const p = safePlan(d.fileorg.get(x.ctx.plan.id)); if (hash(p) !== x.ctx.plan.hash) throw new Error("plan changed"); return { verdict: "pass", score: 1, findings: [], proves: [0] } as any; } catch (e: any) { return { verdict: "fail", score: 0, findings: [{ locator: { type: "card", field: "moves" }, message: e.message, expected: "prepare a safe current move plan", class: "move-plan", severity: "blocking" }] } as any; } };
  engine.cardBodies.fileorg = x => { const p = safePlan(d.fileorg.get(x.ctx.plan.id)); return { captainOnly: true, title: `Apply ${p.moves.length} planned moves`, zhTitle: `套用 ${p.moves.length} 項搬移計畫`, body: `Plan / 搬移計畫: ${p.id}\nPlan hash / 計畫雜湊: ${x.ctx.plan.hash}\nProved by checks: moves stay inside the folder; no overwrite; move cap.\nNeeds your eye: the chosen categories.\n${p.moves.map((m: any) => `${relative(p.root, m.from)} → ${relative(p.root, m.to)}`).join("\n")}`, detail: acceptanceDetail(x, [], "file-plan"), options: [{ id: "apply", label: "Apply moves", labelZh: "套用搬移" }, { id: "discard", label: "Discard", labelZh: "捨棄", hold: true }] }; };
  engine.actions["fileorg.apply"] = x => { const stored = d.fileorg.get(x.ctx.plan.id); if (!x.ctx.plan.identity || moveIdentity(stored) !== x.ctx.plan.identity) throw new Error("reviewed move identity changed or predates pinning; prepare a new task"); const p = stored.status === "applied" ? stored : safePlan(stored); if (p.status !== "applied" && hash(p) !== x.ctx.plan.hash) throw new Error("reviewed plan changed"); const a = p.status === "applied" ? p : d.fileorg.apply(p.id); x.ctx.applied = { moved: a.moves.filter((m: any) => m.result === "moved").length, undo: `#/fileorg/${p.id}` }; return "ok"; };
  engine.actions["fileorg.discard"] = x => { d.fileorg.discard(x.ctx.plan.id); return "ok"; };
  engine.actions["lane.recipe"] = x => { const r = d.lane.repo(x.run.params.repo), a = st.approved(x.run.params.artifact); if (!r || r.remote || r.github) throw new Error("native trivial lane requires a registered local-only repository"); const target = realpathSync(r.path); for (const root of engine.deps.protectedRoots ?? []) if (existsSync(root)) { const protectedRoot = realpathSync(root); if (target === protectedRoot || target.startsWith(protectedRoot + "/")) throw new Error("lane target is protected"); } if (!a || st.verify(a.artifact, a.n).length) throw new Error("an intact approved image is required"); const c = d.lane.run({ artifact: a.artifact, repo: r.id }); if (c.state !== "ready") throw new Error(c.error ?? "recipe checks did not pass"); x.ctx.lane = { id: c.id, artifact: a.artifact, version: a.n, sha256: a.sha256, pin: c.pin }; return "ok"; };
  engine.natives["lane-ready"] = (_i, h) => { const x = h.x as X; const a = x.ctx.lane, c = a && d.lane.card(a.id), v = a && st.approved(a.artifact);
    let identity = false; try { d.lane.assertPin(c, a?.pin); identity = true; } catch {}
    const valid = identity && c?.state === "ready" && c.checks.length > 0 && c.checks.every((k: any) => k.ok !== false) && v?.n === a.version && v?.sha256 === a.sha256 && !st.verify(a.artifact, a.version).length;
    return { verdict: valid ? "pass" : "fail", score: valid ? 1 : 0, findings: valid ? [] : [{ locator: { type: "file", path: "README.md", line: 1 }, message: "recipe or approved image changed", expected: "prepare the recipe from the exact intact approved image", class: "lane-readiness", severity: "blocking" }], data: { card: c?.id, checks: c?.checks ?? [], artifact: a?.artifact, version: a?.version }, proves: valid ? [0] : [] } as any;
  };
  engine.cardBodies.lane = x => { const c = d.lane.card(x.ctx.lane.id); return { captainOnly: true, title: "Merge approved image into local README", zhTitle: "將已核准圖片合併到本機 README", body: `Repository / 儲存庫: ${c.pin.repo}\nBase / 基底: ${c.pin.base} @ ${c.pin.baseCommit}\nReviewed commit / 已審閱提交: ${c.pin.commit}\nRecipe / 修改計畫: ${c.id}\nProved by checks:\n${c.checks.filter((k: any) => k.ok).map((k: any) => k.label).join("\n")}\nNeeds your eye: README presentation.\n${c.diff}`, detail: acceptanceDetail(x, [], "lane"), options: [{ id: "merge", label: "Merge locally", labelZh: "本機合併" }, { id: "close", label: "Close", labelZh: "關閉", hold: true }] }; };
  engine.actions["lane.merge"] = async x => { const a = x.ctx.lane, v = st.approved(a.artifact); if (!v || v.n !== a.version || v.sha256 !== a.sha256 || st.verify(a.artifact, a.version).length) throw new Error("approved lane image changed"); const existing = d.lane.card(a.id); const repo = existing && d.lane.assertPin(existing, a.pin, true); if (!repo || repo.remote || repo.github) throw new Error("lane target is no longer local-only"); const c = existing.state === "merged" ? existing : await d.lane.merge(a.id, x.ctx.answers?.["merge-card"]?.by ?? "captain"); x.ctx.merged = { head: c.commit }; return "ok"; };
  engine.actions["lane.close"] = x => { d.lane.close(x.ctx.lane.id); return "ok"; };
}
