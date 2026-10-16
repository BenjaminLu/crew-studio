// Code admission is a domain adapter; the generic runtime owns job lifetimes.
import { hashInput, INPUT_HASH_ALGORITHM } from "../runtime/checks";
import { git } from "../git";
import { scopesOverlap } from "../runtime/queue";
import { existsSync } from "node:fs";
import type { Engine, Run, X } from "../runtime/engine";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
// Both recovery and competing Tasks read the same signed reservation authority.
// Mutable ctx caches are never reconstructed until actual fresh admission.
class ReservationUnavailable extends Error {
  constructor(message: string, readonly first: any = null) { super(message); }
}
function reservationData(engine: Engine, run: Run, record: any) {
    const data: any = record.data;
    if (record.kind !== "record" || record.verdict !== "pass" || !data ||
      !(data.version === 1 && data.hashAlgorithm === undefined || (data.version === 2 || data.version === 3) && data.hashAlgorithm === INPUT_HASH_ALGORITHM) ||
      typeof data.project !== "string" || !data.project || typeof data.repo !== "string" || !data.repo || engine.queueRepo(data.repo) !== data.repo ||
      typeof data.specHash !== "string" || !/^[0-9a-f]{16}$/.test(data.specHash) ||
      !Array.isArray(data.scope) || !data.scope.length || data.scope.some((s: unknown) => typeof s !== "string" || !s.trim()) ||
      !Array.isArray(data.dependencies) || data.dependencies.length > 64 || data.dependencies.some((id: unknown) => typeof id !== "string" || !/^R-\d+$/.test(id) || id === run.id) || new Set(data.dependencies).size !== data.dependencies.length) throw new Error("signed scope binding is incomplete or uses an unknown algorithm; fresh preparation required");
    return data;
}
export function signedReservation(engine: Engine, run: Run, trusted: ReturnType<Engine["trusted"]>) {
    const records = trusted.entries.filter(e => e.record === "scope-admission"), firstRecord = records[0];
    // Anchor only the actual object authenticated by the host's ordered scan.
    // Rejected sequence metadata never participates in a trust comparison.
    let first: any = null;
    if (firstRecord && trusted.prefix.includes(firstRecord)) {
      try { first = reservationData(engine, run, firstRecord); if(first.version===3)first=null; } catch {}
    }
    // Preserve every proven epoch's held scope when a later record is corrupt.
    // Otherwise a bad tail could make the recovery's added scope appear free.
    if(first){
      const prefix={...trusted,ok:true,entries:trusted.prefix};let previous:any=null;
      for(const record of trusted.prefix.filter(e=>e.record==="scope-admission")){
        try{
          const d=reservationData(engine,run,record);
          if(d.version===3){if(!previous||!validRecoveryTransition(prefix,previous,record))break;first={...first,scope:[...new Set([...first.scope,...reservedScope(d)])]};}
          else if(previous&&(previous.data.version===3||d.repo!==previous.data.repo||d.project!==previous.data.project||hashInput(d.scope)!==hashInput(previous.data.scope)||hashInput(d.dependencies)!==hashInput(previous.data.dependencies)))break;
          previous=record;
        }catch{break;}
      }
    }
    const anchor=firstRecord?.data;
    try {
      if (!trusted.ok) throw new Error("signed scope binding is unavailable; fresh preparation required");
      let previous:any=null;
      for (const record of records) {
        const data = reservationData(engine, run, record);
        if(data.version===3){
          if(!previous||!validRecoveryTransition(trusted,previous,record))throw new Error("signed rescope epoch has no bound captain recovery and dispatch");
        }else if(previous?.data.version===3||anchor&&(data.repo!==anchor.repo||data.project!==anchor.project||hashInput(data.scope)!==hashInput(anchor.scope)||hashInput(data.dependencies)!==hashInput(anchor.dependencies)))throw new Error("signed scope reservation lineage changed; fresh preparation required");
        previous=record;
      }
      const prior = records.at(-1), signed: any = prior?.data;
      return { prior, signed };
    } catch (error) { throw new ReservationUnavailable((error as Error).message, first); }
}

const reservedScope=(pin:any):string[]=>pin.version===3?pin.heldScope:pin.scope;
/** A v3 epoch replaces the pin only after a signed captain rescope, then a fresh
 * signed dispatch of the rewritten spec. The rescope is either a base refresh
 * (`local-rescope-applied`) or an ordinary captain "rescope" card answer.
 * The old reservation remains held, even when the new scope is narrower.
 */
const captainRescope=(e:any)=>e?.record==="card-answer"&&e.verdict==="pass"&&e.data?.choice==="rescope"&&!String(e.actor??"").startsWith("auth window");
function validRecoveryTransition(trusted:ReturnType<Engine["trusted"]>,prior:any,next:any){
  const p=prior.data,d=next.data;
  if(!trusted.ok||d.predecessor!==prior.seq||d.repo!==p.repo||d.project!==p.project||hashInput(d.dependencies)!==hashInput(p.dependencies)||
    hashInput(d.heldScope)!==hashInput([...new Set([...reservedScope(p),...d.scope])]))return false;
  const rescope=trusted.entries.find(e=>e.seq===d.recovery&&captainRescope(e));
  if(rescope)return rescope.seq>prior.seq&&validDispatch(trusted,d,next,rescope.seq);
  const applied=trusted.entries.find(e=>e.seq===d.recovery&&e.record==="local-rescope-applied"&&e.verdict==="pass");
  const request=trusted.entries.find(e=>e.seq===applied?.data?.request&&e.record==="local-rescope-request"&&e.verdict==="pass"),i:any=request?.data;
  if(!request||!applied)return false;
  const answer=trusted.entries.find(e=>e.record==="card-answer"&&e.data?.card===i?.card&&e.data?.choice==="rescope"&&!String(e.actor??"").startsWith("auth window")&&e.seq>request.seq&&e.seq<applied.seq);
  const dispatch=trusted.entries.find(e=>e.seq===d.dispatch&&e.record==="card-answer"&&e.data?.kind==="dispatch"&&e.data?.choice==="dispatch");
  return !!(request&&applied&&answer&&dispatch&&i?.version===1&&i.prior===prior.seq&&i.priorHash===hashInput(p)&&i.repo===p.repo&&i.project===p.project&&
    answer.data?.localRescope&&hashInput(answer.data.localRescope)===hashInput({version:1,card:i.card,visit:i.visit,base:i.base,from:i.from,target:i.target})&&
    i.from===request.head&&/^[a-f0-9]{40}$/.test(i.from)&&/^[a-f0-9]{40}$/.test(i.target)&&applied.head===i.target&&applied.data?.intentHash===hashInput(i)&&
    request.seq>prior.seq&&dispatch.head===i.target&&validDispatch(trusted,d,next,applied.seq));
}
/** The fresh dispatch after the recovery binds exactly the new epoch's spec, scope and identity. */
function validDispatch(trusted:ReturnType<Engine["trusted"]>,d:any,next:any,after:number){
  const dispatch=trusted.entries.find(e=>e.seq===d.dispatch&&e.record==="card-answer"&&e.data?.kind==="dispatch"&&e.data?.choice==="dispatch");
  return !!(dispatch&&dispatch.seq>after&&next.seq>dispatch.seq&&
    dispatch.data?.queueHashAlgorithm===INPUT_HASH_ALGORITHM&&dispatch.data?.queueSpec===d.specHash&&dispatch.data?.repo===d.repo&&dispatch.data?.project===d.project&&
    hashInput(dispatch.data?.scope)===hashInput(d.scope)&&hashInput(dispatch.data?.dependencies)===hashInput(d.dependencies));
}
/** The replacement pin for the latest signed dispatch, when a captain rescope came between the prior admission and it. */
function recoveryReplacement(trusted:ReturnType<Engine["trusted"]>,prior:any){
  const acceptance=trusted.entries.filter(e=>e.record==="card-answer"&&e.data?.kind==="dispatch"&&e.data?.choice==="dispatch").at(-1);
  if(!prior||!acceptance||acceptance.seq<prior.seq)return null;
  const a:any=acceptance.data,p=prior.data;
  if(p.specHash===a.queueSpec&&hashInput(p.scope)===hashInput(a.scope))return null;
  // A base refresh keeps its stricter evidence; otherwise the latest captain rescope answer is the authority.
  const between=(e:any)=>e.seq>prior.seq&&e.seq<acceptance.seq;
  const recovery=trusted.entries.filter(e=>e.record==="local-rescope-applied"&&between(e)).at(-1)??trusted.entries.filter(e=>captainRescope(e)&&between(e)).at(-1);
  if(!recovery)return null;
  const data={version:3,hashAlgorithm:INPUT_HASH_ALGORITHM,repo:a.repo,project:a.project,specHash:a.queueSpec,scope:clone(a.scope),dependencies:clone(a.dependencies),
    predecessor:prior.seq,recovery:recovery.seq,dispatch:acceptance.seq,heldScope:[...new Set([...reservedScope(p),...a.scope])]};
  return validRecoveryTransition(trusted,prior,{data,seq:Infinity})?data:null;
}

function verifiedMerge(this: Engine, r: Run, expected?: { project: string; repo: string }) {
    if (r.status !== "succeeded" || r.result !== "done") return false;
    const trusted = this.trusted(r.id); if (!trusted.ok) return false;
    const rec = trusted.entries.filter(e => e.record === "native-merge" && e.verdict === "pass").at(-1), d: any = rec?.data;
    if (!d || d.version !== 1 || !/^[0-9a-f]{40}$/.test(d.head) || !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(d.base) || this.queueRepo(d.repo) !== d.repo || d.project !== this.queueProject(r)) return false;
    if (expected && (d.repo !== expected.repo || d.project !== expected.project)) return false;
    const current = git(d.repo, ["rev-parse", "--verify", `refs/heads/${d.base}`]);
    const h = current.out.trim(); if (!current.ok || !/^[0-9a-f]{40}$/.test(h)) return false;
    return git(d.repo, ["merge-base", "--is-ancestor", d.head, h]).ok;
  }
export type ScopeBlocker = { run: string; title: string; scope: string[]; identityUnavailable?: boolean };
/** Read-only reservation projection shared by spec checks and build admission.
 * A spec is not a reservation. Terminal status is not proof of release either.
 * Unknown identity fails closed; only an authenticated prefix can narrow it.
 */
export function scopeBlockers(engine: Engine, run: Run): ScopeBlocker[] {
  const repo = engine.queueRepo(run.ctx.repo), project = engine.queueProject(run);
  const blockers: ScopeBlocker[] = [];
  for (const other of engine.list()) {
    if (other.id === run.id) continue;
    const records = engine.trusted(other.id), rec = records.entries.filter(e => e.record === "scope-admission").at(-1);
    if (records.ok && !rec && !other.ctx.nativeAdmission) {
      // A clean, never-admitted spec may coexist. Unexpected worktree edits
      // cannot silently acquire or release write authority through this path.
      // Normal terminal cleanup removes a never-admitted worktree but keeps
      // its context for history. No signed reservation exists to retain here.
      if (["succeeded", "failed", "cancelled"].includes(other.status) && other.ctx.worktree && !existsSync(other.ctx.worktree)) continue;
      if (other.ctx.worktree && engine.queueRepo(other.ctx.repo) === repo && engine.queueProject(other) === project) {
        let pristine = false;
        try {
          const head = git(other.ctx.worktree, ["rev-parse", "HEAD"]);
          const status = git(other.ctx.worktree, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"]);
          pristine = head.ok && status.ok && !status.out && head.out === other.ctx.baseCommit && head.out === other.ctx.head;
        } catch {}
        if (!pristine) blockers.push({ run: other.id, title: other.title, scope: [], identityUnavailable: true });
      }
      continue;
    }
    let held: any;
    try { held = signedReservation(engine, other, records).signed; if (!held) throw new Error("no signed reservation"); }
    catch (error) {
      const first = error instanceof ReservationUnavailable ? error.first : null;
      if (first && (first.repo !== repo || first.project !== project)) continue;
      // An authenticated prefix bounds unknown authority to its held paths.
      // Preserve those paths rather than trusting a later mutable cache.
      blockers.push({ run: other.id, title: other.title, scope: first?.scope ?? [], identityUnavailable: true });
      continue;
    }
    if (held.repo !== repo || held.project !== project || engine.verifiedMerge(other)) continue;
    blockers.push({ run: other.id, title: other.title, scope: reservedScope(held) });
  }
  return blockers;
}
function scopeState(this: Engine, x: X) {
    if (x.run.ctx.nativeQueueVersion !== 1) throw new Error("historical round has no native queue binding; fresh preparation required");
    const project = this.queueProject(x.run), repo = this.queueRepo(x.ctx.repo), trusted = this.trusted(x.run.id);
    const acceptanceRecord = trusted.entries.filter(e => e.record === "card-answer" && (((e.data as any)?.kind === "dispatch" && (e.data as any)?.choice === "dispatch") || ((e.data as any)?.queueRecovery === true && (e.data as any)?.choice === "retry"))).at(-1);
    const acceptance:any=acceptanceRecord?.data;
    const deps = this.queueDependencies(x.run), specHash = hashInput(x.ctx.spec);
    const staffing=this.deps.staffingBinding?.(x.run);if(staffing&&acceptance?.staffing!==staffing)throw new Error("staffing approval changed; explicit fresh preparation required");
    if (!acceptance || acceptance.queueHashAlgorithm !== INPUT_HASH_ALGORITHM) throw new Error("historical or unknown scope hash algorithm; fresh preparation required");
    if (!trusted.ok || !acceptance || acceptance.queueSpec !== specHash || acceptance.repo !== repo || acceptance.project !== project || hashInput(acceptance.dependencies) !== hashInput(deps) || !Array.isArray(acceptance.scope) || !acceptance.scope.length) throw new Error("accepted dependency/scope binding is unavailable or changed; fresh dispatch required");
    const { prior, signed } = signedReservation(this, x.run, trusted);
    if (x.ctx.nativeAdmission && (!prior || hashInput(signed) !== hashInput(x.ctx.nativeAdmission))) throw new Error("existing scope pin has no current signed binding; fresh preparation required");
    if (!x.ctx.nativeAdmission && prior && !acceptance.queueRecovery) throw new Error("existing scope binding is missing; fresh preparation required");
    const pin = x.ctx.nativeAdmission ?? signed;
    const sameReservation = pin && pin.repo === repo && pin.project === project && hashInput(pin.dependencies) === hashInput(deps) && hashInput(pin.scope) === hashInput(acceptance.scope);
    const upgradingLegacy = pin?.version === 1 && pin.hashAlgorithm === undefined && acceptance.queueRecovery === true && sameReservation;
    // A captain rescope + fresh dispatch (or the retry after it) re-pins; the
    // scope it adds still meets every other Task in the overlap check below.
    const replacement=recoveryReplacement(trusted,prior);
    if (replacement && replacement.specHash !== specHash) throw new Error("accepted dependency/scope binding is unavailable or changed; fresh dispatch required");
    if (pin && !replacement && (!sameReservation || !upgradingLegacy && (![2,3].includes(pin.version) || pin.hashAlgorithm !== INPUT_HASH_ALGORITHM || pin.specHash !== specHash))) throw new Error("native scope pin changed or uses unknown hash algorithm; fresh preparation required");
    for (const id of deps) { const parent = this.get(id); if (!parent || !this.verifiedMerge(parent, { project, repo })) return { ready: false, reason: `dependency ${id} has no verified authoritative merge` }; }
    for (const blocker of scopeBlockers(this, x.run)) {
      if (blocker.identityUnavailable && (!blocker.scope.length || scopesOverlap(acceptance.scope, blocker.scope))) return { ready: false, reason: `scope identity unavailable for ${blocker.run}` };
      if (scopesOverlap(acceptance.scope, blocker.scope)) return { ready: false, reason: `scope held by ${blocker.run} until verified merge` };
    }
    return { ready: true };
  }

export function installCodeQueue(engine: Engine) {
  engine.queueDomain = {
    worker: (x, mode) => x.run.def.nodes.some(n => n.do === "git.merge") && ["plan", "build"].includes(mode),
    ready: x => scopeState.call(engine, x),
    merged: (r, expected) => verifiedMerge.call(engine, r, expected),
    admitted(x) {
        const trusted=engine.trusted(x.run.id),{prior}=signedReservation(engine,x.run,trusted);
        const replacement=recoveryReplacement(trusted,prior);
        if(replacement){x.ctx.nativeAdmission=replacement;engine.record(x,"scope-admission",{data:clone(replacement)});return;}
        if (!x.ctx.nativeAdmission || x.ctx.nativeAdmission.version === 1 && x.ctx.nativeAdmission.hashAlgorithm === undefined) {
          const data: any = engine.trusted(x.run.id).entries.filter(e => e.record === "card-answer" && (((e.data as any)?.kind === "dispatch" && (e.data as any)?.choice === "dispatch") || ((e.data as any)?.queueRecovery === true && (e.data as any)?.choice === "retry"))).at(-1)!.data;
          x.ctx.nativeAdmission = { version: 2, hashAlgorithm: INPUT_HASH_ALGORITHM, project: data.project, repo: data.repo, specHash: data.queueSpec, scope: clone(data.scope), dependencies: clone(data.dependencies) };
          engine.record(x, "scope-admission", { data: clone(x.ctx.nativeAdmission) });
        }
    },
    answer(r, _node, rn, c) {
      const binding = (c.kind === "dispatch" && c.answer!.choice === "dispatch") || (c.kind === "scope" && rn.data.nativeQueueCapability && c.answer!.choice === rn.data.nativeQueueCapability.retryAction);
      if (!binding || !Array.isArray(r.ctx.spec?.scope)) return {};
      return { ...(engine.deps.staffingBinding?.(r)?{staffing:engine.deps.staffingBinding(r)}:{}), queueRecovery: !!rn.data.nativeQueueCapability, queueHashAlgorithm: INPUT_HASH_ALGORITHM, queueSpec: hashInput(r.ctx.spec), scope: clone(r.ctx.spec.scope), project: engine.queueProject(r), repo: engine.queueRepo(r.ctx.repo), dependencies: engine.queueDependencies(r) };
    }
  };
}
