import {Onboarding} from '../onboarding';
import {ArtifactStore} from '../artifacts';
import {StaffingStore,staffingHash,installStaffingGuard,coffeeStaffingProject,type StaffingProject} from '../domain/staffing';
import {installFirstmateStaffing,staffingQuotaReady,type StaffingFacts,type StaffingAdmission} from '../firstmate-staffing';
import {installFirstmate} from "../firstmate";
// Studio's native runtime, wired: versioned workflow definitions, the engine,
// the check runtime, Studio-owned cards, and the steps each workflow uses.
// Routes (all under /api/wf, /api/wruns, /api/scards, /api/checks, /api/policies, /api/intake):
//   GET  /api/wf                         every workflow (latest version) and the check catalogue
//   GET  /api/wf/<id>[?v=N]              one version, its problems, every version's meta and diff
//   POST /api/wf/<id>                    save an edit as a new version (refused with errors or no change)
//   POST /api/wf/<id>/layout             node positions for one version (no new version)
//   POST /api/wf/validate                problems of an unsaved definition
//   GET  /api/checks                     every check manifest with its effective parameters
//   POST /api/checks/try                 run one check on its sample input (the editor's "try on sample")
//   GET/POST /api/policies               org and project policy
//   POST /api/intake                     classify an intent into a workflow (+ door hint)
//   GET/POST /api/wruns                  runs; start one from an intent
//   GET  /api/wruns/<id>                 a run with its events, ledger, done-line map and cards
//   POST /api/wruns/<id>/(pause|resume|cancel)    POST /api/wruns/<id>/nodes/<node>/agent  (hot swap)
//   GET  /api/wruns/<id>/file?path=…     a file from the run folder (spec, briefs, hand-offs, check evidence)
//   GET  /api/wruns/agents               the agent node runs working now (the Crew page)
//   GET  /api/wruns/<id>/captures/<head>/(before|after)/<page>.(html|png)   the app's captures; the head's pages are "Open the app"
//   GET  /api/wruns/<id>/evidence?seq=N&file=…  one evidence file a ledger entry lists (a merge card's proof link)
//   GET  /api/scards, POST /api/scards/<id>/answer   Studio's own cards
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { CAPTURE_PATH, captureResponse } from "./captures";
import { redactText } from "../secure";
import { join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import type { Agents } from "../agent";
import { bundledText } from "../bundled";
import { realInside } from "../secure";
import { classify, loadDefaults, Projects } from "../doors";
import type { Provider } from "../providers";
import type { StudioLog } from "../rawlog";
import { schemaDefaults } from "./checks";
import { validate, normalize as normDef, WorkflowDefs } from "./defs";
import { Engine, type AgentPick } from "./engine";
import {COFFEE_DESIGN_FIELDS,validateCoffeeDesign,coffeeDesignJSON} from "../domain/coffee-design";
import { installCoffeeKit } from "../domain/coffee-kit";
import { installDeliver } from "../domain/deliver";

export type RuntimeDeps = {
  dataDir: string; agents: Agents; provider: (id?: string, model?: string) => Provider; defaultProvider: () => AgentPick; log: StudioLog; send: (t: string, d: unknown) => void;
  fmRoot: string; /** the roots nothing may read or write (default: the firstmate checkout) */ protectedRoots?: string[]; store?: any; m3?: { store: any; runs: any; lane: any; useArtifactReviewPolicy?: (policy:(id:string)=>import("../m3").ArtifactReviewPolicy|null)=>void } | null; fileorg?: any; docs?: any; improve?: any; studioUrl: () => string;
  /** domain steps (packs' actions, agent modes, natives) installed onto the engine before runs load */
  install?: ((engine: Engine, ctx: { projects: Projects; dataDir: string }) => void)[];
  /** the skill library (src/skills.ts): agent nodes' enabled skills are pinned against it and read from it */
  skills?: import("../skills").Skills | null;
  coffeeVideo?:Parameters<typeof installCoffeeKit>[1]["video"];
  coffeeFilmStatus?:{ready:boolean;reason:string|null};
  coffeeChoice?:()=>{provider:"codex";model:string;effort:string|null}|null;
  generateImage?: (prompt: string, authorize: () => void, signal: AbortSignal, reference?:import("../providers/codex-image").CodexImageReference) => Promise<import("../providers/codex-image").CodexImage>;
  staffingFacts?: () => Promise<StaffingFacts[]>;
  staffingAdmission?: StaffingAdmission;
  staffingProject?: (id:string) => StaffingProject;
  staffingPending?: (intent:any) => void;

  selectProvider?: (x: import("./engine").X, pick: AgentPick, context?: { role: string; explicit: boolean }) => Promise<Provider>;
};

export function skillTextFor(fmRoot: string) {
  return (ref: string): string => {
    if (ref.startsWith("pack:")) { const t = bundledText(`packs/${ref.slice(5)}`); if (t == null) throw new Error(`no skill ${ref}`); return t; }
    if (ref.startsWith("bundled:")) { const t = bundledText(ref.slice(8)); if (t == null) throw new Error(`no skill ${ref}`); return t; }
    if (ref.startsWith("fm:")) return readFileSync(join(fmRoot, ref.slice(3)), "utf8");
    throw new Error(`unknown skill source ${ref}`);
  };
}

/** Which workflow an intent belongs to: keyword scores over each definition's intent block, and a door hint from the paths and words it names. */
export function classifyIntent(defs: WorkflowDefs, text: string, sensitive: { glob: string; why: string }[] = [], oneWayWords: string[] = []) {
  const t = ` ${text.toLowerCase()} `;
  const scores = defs.catalog().map((d) => { const kw: string[] = d.intent?.keywords ?? []; const hits = kw.filter((k) => new RegExp(`[^a-z0-9]${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?[^a-z0-9]`).test(t));
    return { workflow: d.id, name: d.name, score: hits.length, hits }; }).sort((a, b) => b.score - a.score);
  const paths = [...text.matchAll(/(?:^|\s|`)((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:sql|env|pem|key|proto|ya?ml|json|js|ts|mjs|md))(?=$|\s|`|[,.;:])/g)].map((m) => ({ path: m[1], added: 1 }));
  // words that hint at a one-way change come from policy (intake.one_way_words), not from the runtime
  const ow: string[] = Array.isArray(oneWayWords) ? oneWayWords : [];
  const words = ow.length ? new RegExp(`\\b(${ow.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i").exec(text) : null;
  const dd = loadDefaults(); const door = paths.length ? classify(paths, { defaults: { ...dd, base: [...dd.base, ...sensitive.filter((r) => !dd.base.some((b) => b.glob === r.glob))] } }) : null;
  const tier = door?.door === "one-way" || words ? "one-way" : door?.door ?? "two-way";
  const top = scores[0]?.score ? scores[0] : null;
  return { workflow: top?.workflow ?? null, scores: scores.slice(0, 6), door: { tier, paths: paths.map((p) => p.path), reasons: door?.reasons.filter((r) => r.list !== "trivial") ?? [], word: words?.[1] ?? null }, confident: !!top && top.score >= 1 && (scores[1]?.score ?? 0) < top.score };
}

export function createRuntime(d: RuntimeDeps) {
  const defs = new WorkflowDefs(d.dataDir);
  if (d.skills) defs.skillInfo = (id, v) => d.skills!.pinInfo(id, v);
  const engine = new Engine({ dataDir: d.dataDir, agents: d.agents, provider: d.provider, defaultProvider: d.defaultProvider, selectProvider: d.selectProvider, log: d.log, send: d.send, skillText: skillTextFor(d.fmRoot), store: d.store, protectedRoots: d.protectedRoots ?? [d.fmRoot], library: d.skills ?? null }, defs);
  const projects = new Projects(d.dataDir);
  if (d.m3?.store && d.m3?.lane && d.fileorg && d.docs) installDeliver(engine, { dataDir: d.dataDir, artifacts: d.m3.store, lane: d.m3.lane, fileorg: d.fileorg, docs: d.docs, generateImage: d.generateImage });
  let coffee:ReturnType<typeof installCoffeeKit>|undefined;
  if(d.m3?.store){coffee=installCoffeeKit(engine,{artifacts:d.m3.store,choice:d.coffeeChoice,staffing:(def,params)=>{const config=staffingGuard.verified(def,params),role=config.roles['image-worker'];if(!role||role.provider!=='codex')throw new Error('The dedicated image adapter requires an explicitly approved available Codex image-worker; no vendor fallback');return {provider:'codex',model:role.model,effort:role.effort};},video:d.coffeeVideo});d.m3.useArtifactReviewPolicy?.(coffee.artifactReview);}
  // Base artifact providers precede domain wrappers that bind their own pinned outputs.
  for (const f of d.install ?? []) f(engine, { projects, dataDir: d.dataDir });
  const staffing=new StaffingStore(d.dataDir);
  const staffingProject=(id:string)=>d.staffingProject?d.staffingProject(id):projects.staffingIdentity(id,d.protectedRoots??[]);
  let staffingCapabilities:StaffingFacts[]=[];
  const staffingFacts=async()=>{staffingCapabilities=await(d.staffingFacts??(async()=>[]))();return staffingCapabilities;};
  const staffingGuard=installStaffingGuard(engine,staffing,staffingProject,config=>{for(const role of Object.values(config.roles)){const cap=staffingCapabilities.find(c=>c.provider===role.provider),model=cap?.models.find(m=>m.id===role.model);if(!cap||cap.support!=='supported'||cap.auth!=='verified'||!staffingQuotaReady(role,cap,d.staffingAdmission)||cap.expires<=Date.now()||!model||role.effort!==null&&!model.efforts.includes(role.effort))throw new Error('Refresh staffing facts and confirm available role models before work / 請先更新派工能力並確認可用的角色模型');}});
  const staffingTools=installFirstmateStaffing(engine,staffing,staffingProject,staffingFacts,d.staffingAdmission);
  const onboarding=new Onboarding(engine,d.m3?.store??new ArtifactStore(d.dataDir));
  const originalFirstmate=installFirstmate(engine,projects,{onCoffeeProposal:id=>{try{onboarding.proposal(id);}catch{}},onCoffeeDispatch:(proposal,task)=>{try{onboarding.dispatch(proposal,task);}catch{}},protectedRoots:d.protectedRoots??[],staffingProject,staffingPending:d.staffingPending});
  const firstmate={specs:[...originalFirstmate.specs,...staffingTools.specs],call:(name:string,args:any,owner:any)=>name==='studio_change_staffing'||name==='studio_staffing_facts'||name==='studio_staffing_interview'||name==='studio_propose_staffing'?staffingTools.call(name,args,owner):originalFirstmate.call(name,args,owner)};
  engine.load();

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const runView = (id: string) => {
    const r = engine.get(id); if (!r) return null;
    const ledger = engine.ledger(id);
    const t = engine.trusted(id);
    return { ...r, walked: [...new Set(engine.events(id).filter((e) => e.type === "edge_taken").map((e) => e.edge))], events: engine.timeline(id).slice(-400), ledger, ledgerOk: t.ok, ledgerBad: [...t.bad], ledgerTruncated: t.truncated, done: engine.doneLines(r), cards: engine.cards.list({ run: id }).map(c=>engine.cards.view(c)) };
  };
  const checkView = (m: any) => { const p = engine.params(m, null, {}); return { ref: m.ref, id: m.id, pack: m.pack, version: m.version, title: m.title, description: m.description, applies_to: m.applies_to, kind: m.kind, blocking: m.blocking, needs: m.needs,
    params: m.params, policy_bind: m.policy_bind, effective: p.params, from: p.from, timeout_s: m.timeout_s, network: m.network, impl: m.native ? "native" : m.adapter ? "adapter" : m.kind === "judged" ? "judge" : "executable", quorum: m.judge?.quorum ?? null, hasSample: !!m.sample, at: m.at }; };

  const grantNonces = new Map<string, number>();
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!/^\/api\/(wf|wruns|scards|checks|policies|intake|coffee|onboarding)(\/|$)/.test(p)) return null;
    let b: any = {}; if (writing) { try { b = await req.json(); } catch {} }
    const by = who.kind === "phone" ? "captain (phone)" : "captain";
    if (writing && who.kind === "phone" && !/^\/api\/scards\//.test(p)) return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    try {
      if(p==='/api/onboarding'){
        if(who.kind!=='desktop')return json({error:'Use onboarding on the authenticated desktop'},403);
        if(!writing)return json(onboarding.view());
        if(req.method!=='POST')return json({error:'POST required'},405);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','choice'].includes(k)))return json({error:'Invalid onboarding request'},400);
        if(b.action==='choose')return json(onboarding.choose(b.choice));
        if(b.action==='skip'&&b.choice===undefined)return json(onboarding.pause(true));
        if(b.action==='resume'&&b.choice===undefined)return json(onboarding.pause(false));
        return json({error:'Unknown onboarding action'},400);
      }
      if(p==='/api/intake/staffing'){
        const args=writing?b:{project:url.searchParams.get('project'),workflow:url.searchParams.get('workflow'),version:Number(url.searchParams.get('version'))};
        const operation=writing&&b?.confirm===true?'studio_propose_staffing':'studio_staffing_interview';
        if(writing&&Object.hasOwn(args,'confirm')){delete args.confirm;}
        return json(await staffingTools.call(operation,args,{key:`desktop:${randomBytes(16).toString('hex')}`,captain:true,text:'Captain staffing configuration request',live:()=>!req.signal.aborted}));
      }
      // ---------- definitions ----------
      if(p==="/api/coffee/design"&&writing){if(req.method!=="POST")return json({error:"POST required"},405);if(who.kind!=="desktop")return json({error:"Review coffee design on the desktop"},403);return json({plan:validateCoffeeDesign(b?.plan),canonical:coffeeDesignJSON(b?.plan)});}
      if (p === "/api/wf" && !writing) return json({ workflows: defs.catalog(), checks: engine.registry.all().map(checkView) });
      if (p === "/api/wf" && writing) {
        if(req.method!=="POST")return json({error:"use POST to create a workflow"},405);
        const def=defs.create(b?.id,b?.name,by,b?.locale??"en",b?.template);
        d.log.emit({type:"workflow_created",workflow:def.id,summary:`${def.id} v1 created by ${by}`});
        return json({def},201);
      }
      if (p === "/api/wf/validate" && writing) return json({ problems: validate(normDef(b?.def ?? {}), defs.known, undefined, defs.skillInfo ?? undefined) });
      let m = /^\/api\/wf\/([a-z0-9-]+)(?:\/(layout))?$/.exec(p);
      if (m) {
        const id = m[1];
        if (m[2] === "layout" && writing) return json({ layout: defs.setLayout(id, Number(b?.version), b?.positions ?? {}) });
        if (!writing) {
          const v = url.searchParams.get("v"); const def = defs.get(id, v ? Number(v) : undefined); if (!def) return json({ error: "no such workflow" }, 404);
          return json({ def, selectable:defs.selectable(id,def.version), coffeeFilmStatus:def.kind==="coffee-kit"?d.coffeeFilmStatus??{ready:false,reason:"Local film capability is unavailable"}:null, coffeeDesign:def.kind==="coffee-kit"?COFFEE_DESIGN_FIELDS:null, coffeeChoice:def.kind==="coffee-kit" ? d.coffeeChoice?.() ?? null : null, problems: validate(def, defs.known, undefined, defs.skillInfo ?? undefined), versions: defs.versions(id).map((x) => ({ version: x.version, createdAt: x.createdAt, by: x.by, note: x.note, parent: x.parent, diff: x.diff })),
            runs: engine.list().filter((r) => r.workflow === id).map((r) => ({ id: r.id, version: r.version, status: r.status, result: r.result, merged: !!r.ctx?.merged, title: r.title, createdAt: r.createdAt })) });
        }
        const saved = defs.save(id, b, by, b?.note);
        d.log.emit({ type: "workflow_saved", workflow: id, summary: `${id} v${saved.version} saved by ${by}`, data: { diff: saved.diff } });
        return json({ def: saved, diff: saved.diff });
      }
      // ---------- checks and policies ----------
      if (p === "/api/checks" && !writing) return json({ checks: engine.registry.all().map(checkView) });
      if (p === "/api/checks/try" && writing) {
        const man = engine.registry.get(String(b?.use ?? "")); if (!man) return json({ error: "no such check" }, 404);
        if (man.native || man.kind === "judged" || man.kind === "hook") return json({ error: `${man.ref} reads a live run (${man.native ? "native" : man.kind}); try it on a run instead` }, 409);
        const dir = join(d.dataDir, "try", `${Date.now().toString(36)}-${man.id}`); mkdirSync(join(dir, "out"), { recursive: true });
        const sample = b?.sample && typeof b.sample === "object" ? b.sample : man.sample ?? {};
        const pr = engine.params(man, { use: man.ref, params: b?.params ?? {} }, {});
        if (pr.errors.length) return json({ error: `params: ${pr.errors.join("; ")}` }, 400);
        const input = { run: "try", node: "try", round: 1, artifact: null, previous: null, spec: null, workdir: null, ...sample, params: pr.params, out: join(dir, "out") } as any;
        const res = await engine.exec({} as any, man, { use: man.ref }, input, dir);
        return json({ input: { ...input, out: "out/" }, result: res });
      }
      if (p === "/api/policies" && !writing) return json({ org: engine.policies.org(), projects: projects.list().map((x) => ({ id: x.id, name: x.name, policy: engine.policies.project(x.id) })) });
      // opening a window takes a fresh confirmation: the page fetches a one-time code (same origin only) and the captain confirms with it
      if (p === "/api/policies/auth-window/confirm" && !writing) {
        if (who.kind !== "desktop") return json({ error: "open an authorization window on the Mac", code: "desktopOnly" }, 403);
        const nonce = randomBytes(12).toString("hex"); grantNonces.set(nonce, Date.now() + 120_000); return json({ confirm: nonce, expires_s: 120 });
      }
      if (p === "/api/policies/auth-window" && writing) {
        if (who.kind !== "desktop") return json({ error: "open an authorization window on the Mac", code: "desktopOnly" }, 403);
        const exp = grantNonces.get(String(b?.confirm ?? "")); grantNonces.delete(String(b?.confirm ?? ""));
        if (!b?.revoke && !(exp && exp > Date.now())) return json({ error: "confirm the window in Studio first (a fresh, one-time confirmation)", code: "confirm" }, 403);
        if (b?.revoke) return json(engine.grants.revoke(String(b.revoke), "captain (desktop)"));
        return json(engine.grants.add({ kinds: Array.isArray(b?.kinds) ? b.kinds : [], until: String(b?.until ?? ""), project: b?.project ?? null }, "captain (desktop)"));
      }
      if (p === "/api/policies/auth-window" && !writing) return json({ grants: engine.grants.all() });
      if (p === "/api/policies" && writing) { if (b?.patch && "auth" in b.patch) return json({ error: "authorization windows are opened with /api/policies/auth-window" }, 400);
        if (b?.level === "project" && b?.project) engine.policies.setProject(String(b.project), b.patch ?? {}); else engine.policies.setOrg(b?.patch ?? {}); return json({ ok: true, org: engine.policies.org() }); }
      // ---------- intake ----------
      if (p === "/api/intake" && writing) return json(classifyIntent(defs, String(b?.text ?? ""), engine.policies.get("sensitive_paths", { project: b?.project ? String(b.project) : null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []));
      const coffeeRecovery=/^\/api\/wruns\/(R-\d+)\/coffee-recovery$/.exec(p);
      if(coffeeRecovery&&writing){if(req.method!=='POST')return json({error:'POST required'},405);if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length)return json({error:'Recovery refresh accepts no production choices'},400);if(who.kind!=='desktop')return json({error:'Refresh recovery on the Mac'},403);if(!coffee)return json({error:'Coffee workflow unavailable'},409);return json(await coffee.refreshRecovery(coffeeRecovery[1]));}
      // ---------- runs ----------
      // the default list hides archived runs; ?archived=1 lists them too
      if (p === "/api/wruns" && !writing) return json({ runs: engine.list().filter((r) => url.searchParams.get("archived") === "1" || !r.archived).map((r) => ({ id: r.id, workflow: r.workflow, version: r.version, title: r.title, status: r.status, result: r.result, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt, error: r.error,
        archived: !!r.archived, merged: !!r.ctx?.merged, cancelReason: r.cancelReason ?? null,
        current: Object.entries(r.nodes).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => ({ node: k, state: n.state, waiting: n.waiting ?? null, label: r.def.nodes.find((x) => x.id === k)?.label ?? k })), door: engine.cards.list({ run: r.id }).find((c) => c.door)?.door ?? null, recovered: r.recovered })),
        cards: engine.cards.list({ open: true }).map(c=>engine.cards.view(c)) });
      if (p === "/api/wruns" && writing) {
        const text = String(b?.text ?? "").trim(); if (!text && !b?.workflow) return json({ error: "say what you want done" }, 400);
        const cls = classifyIntent(defs, text, engine.policies.get("sensitive_paths", { project: b?.params?.project ? String(b.params.project) : b?.project ? String(b.project) : null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []);
        const wf = b?.workflow || cls.workflow; if (!wf) return json({ error: "Studio could not tell which workflow this is: pick one", classifier: cls }, 409);
        if(!defs.selectable(wf,b?.version?Number(b.version):undefined))return json({error:"This workflow is internal or retired. Choose an available workflow. / 此流程為內部或已退役流程，請選擇可用流程。",code:"workflow_unavailable"},409);
        let params=b?.params??{};
        const chosenDef=defs.get(wf,b?.version?Number(b.version):undefined);
        if(chosenDef?.kind==="coffee-kit") {
          let config;try{config=staffing.current(coffeeStaffingProject(params.project));}catch{return json({error:'Discuss and approve each coffee role before starting',code:'coffee-staffing-required'},409);}const image=config.roles['image-worker'];
          if(!image||image.provider!=='codex')return json({error:"Confirm an available dedicated Codex image role; no vendor fallback",code:"coffee-staffing-required"},409);
          params={...params,_staffing:config.hash};
        }
        const r = engine.start({ workflow: wf, version: b?.version ? Number(b.version) : undefined, title: b?.title, text, params, by, classifier: cls });
        return json(runView(r.id));
      }
      // an app's before / after captures (a domain check makes them): the PNGs, and the built pages ("Open the app"), served sandboxed: no script, no request out
      // the agent node runs working now, for the Crew page: run, node, role, model, round, elapsed, last activity (redacted)
      if (p === "/api/wruns/agents" && !writing) {
        const out: any[] = [];
        for (const r of engine.list()) { if (["succeeded", "failed", "cancelled"].includes(r.status)) continue;
          for (const [nid, rn] of Object.entries(r.nodes)) { if (rn.state !== "running" || !rn.job) continue;
            const def = r.def.nodes.find((n: any) => n.id === nid) as any; const j = d.agents.jobs.get(rn.job); if (!j || j.status !== "running") continue; const last = j.log.at(-1);
            out.push({ run: r.id, runTitle: r.title, workflow: r.workflow, node: nid, label: def?.label ?? nid, role: def?.role ?? null, provider: j.provider, model: j.model, round: rn.visits, attempt: rn.attempt,
              startedAt: j.started, tools: j.tools, lastActivity: last ? { at: last.ts, kind: last.kind, text: redactText(last.text).slice(0, 240) } : null }); } }
        return json({ agents: out });
      }
      m = CAPTURE_PATH.exec(p);
      if (m && !writing) return engine.get(m[1]) ? captureResponse(engine.rdir(m[1]), m[2], m[3], m[4]) : json({ error: "no such run" }, 404);
      m = /^\/api\/wruns\/(R-\d+)(?:\/(pause|resume|cancel|file|events|evidence|archive|delete)|\/nodes\/([a-z0-9-]+)\/agent)?$/.exec(p);
      if (m) {
        const id = m[1]; if (!engine.get(id)) return json({ error: "no such run" }, 404);
        if (m[3] && writing) return json(engine.setAgent(id, m[3], { provider: String(b?.provider ?? ""), model: b?.model ? String(b.model) : null, ...(b?.effort!==undefined?{effort:b.effort===null?null:String(b.effort)}:{}) }) && runView(id));
        if (m[2] === "file") {
          const root = realpathSync(engine.rdir(id)); const rel = String(url.searchParams.get("path") ?? "");
          // realpath of the file itself, not only the root: a symlink inside the folder never leads out of it
          const f = normalize(join(root, rel)); if (!f.startsWith(root + "/") || !existsSync(f) || !realInside(root, f) || statSync(f).isDirectory()) return new Response("not found", { status: 404 });
          return new Response(Bun.file(f), { headers: { "content-type": /\.png$/.test(f) ? "image/png" : /\.mp4$/.test(f) ? "video/mp4" : "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'" } });
        }
        if (m[2] === "evidence" && !writing) {
          // one evidence file of one ledger entry (a merge card's proof link): only a file the entry lists, inside the entry's folder
          const e: any = engine.ledger(id).find((l) => l.seq === Number(url.searchParams.get("seq"))); const rel = String(url.searchParams.get("file") ?? "");
          if (!e?.dir || !(e.evidence ?? []).includes(rel) || !existsSync(e.dir)) return new Response("not found", { status: 404 });
          const root = realpathSync(e.dir); const f = normalize(join(root, rel)); if (!f.startsWith(root + "/") || !existsSync(f) || !realInside(root, f) || statSync(f).isDirectory()) return new Response("not found", { status: 404 });
          return new Response(Bun.file(f), { headers: { "content-type": /\.png$/.test(f) ? "image/png" : /\.jpe?g$/.test(f) ? "image/jpeg" : /\.webp$/.test(f) ? "image/webp" : "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src 'self'", "x-content-type-options": "nosniff" } });
        }
        if (m[2] === "events") return json(engine.timeline(id, Number(url.searchParams.get("after") ?? 0)));
        if (!writing) return json(runView(id));
        if (m[2] === "pause") return json(engine.pause(id) && runView(id));
        if (m[2] === "resume") return json(engine.resume(id) && runView(id));
        if (m[2] === "cancel") return json(engine.cancel(id, by, b?.reason ? String(b.reason) : null) && runView(id));
        // archive and delete: an ended run only (409 for a live one); delete needs the typed id (400)
        if (m[2] === "archive" || m[2] === "delete") {
          try { if (m[2] === "archive") return json(engine.archive(id, b?.archived !== false, by) && runView(id)); return json(engine.remove(id, String(b?.confirm ?? ""), by)); }
          catch (e: any) { const msg = String(e?.message ?? e); return json({ error: msg }, /only an ended run|still finishing/.test(msg) ? 409 : 400); }
        }
      }
      // ---------- Studio cards ----------
      if (p === "/api/scards" && !writing) return json({ cards: engine.cards.list({ open: url.searchParams.get("open") === "1" }).map(c=>engine.cards.view(c)) });
      m = /^\/api\/scards\/(SC-\d+)(?:\/(answer))?$/.exec(p);
      if (m) {
        if (!writing) { const c = engine.cards.get(m[1]); return c ? json(engine.cards.view(c)) : json({ error: "no such card" }, 404); }
        const c = await engine.answer(m[1], { choice: String(b?.choice ?? ""), note: b?.note ?? null, by, confirm: b?.confirm ?? null, aligned: Array.isArray(b?.aligned) ? b.aligned : null });
        return json(c);
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e), problems: e?.problems ?? undefined }, 400); }
  }
  return { handle, engine, defs, projects, firstmate, onboarding, classify: (t: string, project?: string | null) => classifyIntent(defs, t, engine.policies.get("sensitive_paths", { project: project ?? null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []) };
}
export { schemaDefaults };
