// M7 routes: domain packs (list, validate, install with hash pins, uninstall),
// workflow genesis (chat describes a way of working → a drafted pack + evals),
// and the file-organization pack's engine (plan → review → apply → undo).
import { join } from "node:path";
import type { Agents } from "./agent";
import type { Evals } from "./evals";
import { createFileOrg, type Rules } from "./fileorg";
import { checkDraft, Packs, startGenesis, validate } from "./packs";
import type { StudioLog } from "./rawlog";
import type { Skills } from "./skills";
import type { Workflows } from "./workflows";
import { parseYaml } from "./bundled";
import type { Provider } from "./providers";

export function createM7(o: { dataDir: string; flows: Workflows; skills: Skills; evals: Evals; agents: Agents; log: StudioLog; refuse: string[]; provider: (id?: string, model?: string) => Provider; send: (t: string, d: unknown) => void }) {
  const packs = new Packs(o.dataDir);
  o.flows.extra = () => packs.flows();
  // pack eval cases become replay cases for the pack's roles (so M6 edits of pack skills are evaluated too)
  const seed = () => { for (const p of packs.active()) if (p.v.ok && !p.tampered.length) for (const c of p.v.cases) {
    try { o.evals.add({ id: c.id, workflow: p.v.flows[0].id, role: c.role, title: c.title ?? c.id, from: { task: null, actor: null, seq: null, ts: null }, situation: c.situation ?? "", ask: c.ask, terms: c.terms ?? [], expect: c.expect }); } catch {} } };
  seed();
  packs.onChange = () => { seed(); o.send("packs", { at: Date.now() }); };
  const fo = packs.get("file-organization");
  const fileorg = createFileOrg({ dataDir: o.dataDir, refuse: o.refuse, log: o.log, send: o.send,
    rules: () => parseYaml(packs.get("file-organization")?.src.read("rules.yaml") ?? "categories: {}") as Rules,
    gates: () => packs.get("file-organization")?.v.manifest?.gates ?? [] });
  void fo;
  let nativeGenesis: ((description: string, id: string | undefined, by: string) => any) | null = null;
  const genesis = (description: string, id: string | undefined, by: string) => {
    if (nativeGenesis) return nativeGenesis(description, id, by);
    let skill = ""; try { skill = o.skills.text("genesis", "author"); } catch {}
    return startGenesis({ packs, agents: o.agents, evals: o.evals, provider: o.provider(), authorSkill: skill, description, id, by });
  };
  const measured=(p:ReturnType<Packs['active']>[number])=>{if(p.src.kind!=='published'||p.tampered.length)return null;try{const e=JSON.parse(p.src.read('eval-set.json')??'');return {samples:e.samples.length,evalHash:e.evalHash,metrics:e.metrics.map((m:any)=>({check:m.check,precision:m.precision,recall:m.recall,errors:m.errors,agreement:m.agreement})),promotion:e.promotion};}catch{return null;}};
  const summary = (p: ReturnType<Packs["active"]>[number]) => ({ id: p.src.id, kind: p.src.kind, ok: p.v.ok && !p.tampered.length, errors: p.v.errors, warnings: p.v.warnings, tampered: p.tampered, manifest: p.v.manifest,
    flows: p.src.nativeFlows??p.v.flows.map((f) => ({ id: f.id, name: f.name, nodes: f.nodes.length, gates: f.nodes.reduce((n, x) => n + (x.gates?.length ?? 0), 0), roles: f.roles })), cases: measured(p)?.samples??p.v.cases.length, measurement:measured(p), files: p.src.files(),
    lock: ["installed","published"].includes(p.src.kind) ? packs.lock(p.src.id) : null });

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!p.startsWith("/api/packs") && !p.startsWith("/api/fileorg")) return null;
    if (writing && who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    let b: any = {}; if (writing) { try { b = await req.json(); } catch {} }
    try {
      if (p === "/api/packs" && !writing) return json({ packs: packs.active().map(summary), drafts: packs.drafts() });
      if (p === "/api/packs/genesis" && writing) return json(genesis(String(b?.description ?? ""), b?.id ? String(b.id) : undefined, "captain"));
      let m = /^\/api\/packs\/drafts\/([\w-]+)(?:\/(install|discard|recheck|file))?$/.exec(p);
      if (m) {
        const d = packs.draft(m[1]); if (!d) return json({ error: "no such draft" }, 404);
        if (!writing && m[2] === "file") { const t = packs.draftSource(d.id).read(url.searchParams.get("path") ?? ""); return t == null ? json({ error: "no such file" }, 404) : json({ path: url.searchParams.get("path"), text: t }); }
        if (!writing) { const src = packs.draftSource(d.id); return json({ ...d, files: src.files().map((f) => ({ path: f, text: src.read(f) })), job: d.job ? o.agents.jobs.get(d.job) ?? null : null }); }
        if (m[2] === "install") { if (d.status !== "drafted") return json({ error: `the draft is ${d.status}` }, 409); const lock = packs.install(d.id); d.status = "installed"; packs.saveDraft(d);
          o.log.emit({ type: "pack_installed", workflow: "genesis", task: d.id, summary: `installed ${d.id} ${lock.version}`, data: { sha256: lock.sha256 } }); return json({ ...d, lock }); }
        if (m[2] === "discard") { d.status = "discarded"; packs.saveDraft(d); return json(d); }
        if (m[2] === "recheck") { await checkDraft(packs, o.evals, d); return json(d); }
      }
      m = /^\/api\/packs\/([\w-]+)(?:\/(uninstall|file))?$/.exec(p);
      if (m) {
        const pk = packs.get(m[1]); if (!pk) return json({ error: "no such pack" }, 404);
        if (!writing && m[2] === "file") { const t = pk.src.read(url.searchParams.get("path") ?? ""); return t == null ? json({ error: "no such file" }, 404) : json({ path: url.searchParams.get("path"), text: t }); }
        if (!writing) return json(summary(pk));
        if (m[2] === "uninstall") { if (pk.src.kind !== "installed") return json({ error: "a built-in pack stays" }, 409); packs.uninstall(pk.src.id); return json({ ok: true }); }
      }
      // --- file organization ---
      if (p === "/api/fileorg" && !writing) return json({ plans: fileorg.list().map((x) => ({ ...x, moves: undefined, moveCount: x.moves.length, moved: x.moves.filter((m) => m.result === "moved").length })) });
      if (p === "/api/fileorg/plan" && writing) return json(fileorg.plan(String(b?.root ?? "")));
      m = /^\/api\/fileorg\/([\w-]+)(?:\/(include|apply|undo|discard))?$/.exec(p);
      if (m) {
        const pl = fileorg.get(m[1]); if (!pl) return json({ error: "no such plan" }, 404);
        if (!writing) return json(pl);
        if (m[2] === "include") return json(fileorg.setIncluded(pl.id, b?.include ?? {}));
        if (m[2] === "apply") return json(fileorg.apply(pl.id));
        if (m[2] === "undo") return json(fileorg.undo(pl.id));
        if (m[2] === "discard") return json(fileorg.discard(pl.id));
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
  }
  return { handle, packs, fileorg, genesis, validate, useNativeGenesis: (start: NonNullable<typeof nativeGenesis>) => { nativeGenesis = start; } };
}
