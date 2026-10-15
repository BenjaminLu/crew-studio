// Code admission is a domain adapter; the generic runtime owns job lifetimes.
import { hashInput, INPUT_HASH_ALGORITHM } from "../runtime/checks";
import { scopesOverlap } from "../runtime/queue";
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
      !(data.version === 1 && data.hashAlgorithm === undefined || data.version === 2 && data.hashAlgorithm === INPUT_HASH_ALGORITHM) ||
      typeof data.project !== "string" || !data.project || typeof data.repo !== "string" || !data.repo || engine.queueRepo(data.repo) !== data.repo ||
      typeof data.specHash !== "string" || !/^[0-9a-f]{16}$/.test(data.specHash) ||
      !Array.isArray(data.scope) || !data.scope.length || data.scope.some((s: unknown) => typeof s !== "string" || !s.trim()) ||
      !Array.isArray(data.dependencies) || data.dependencies.length > 64 || data.dependencies.some((id: unknown) => typeof id !== "string" || !/^R-\d+$/.test(id) || id === run.id) || new Set(data.dependencies).size !== data.dependencies.length) throw new Error("signed scope binding is incomplete or uses an unknown algorithm; fresh preparation required");
    return data;
}
function signedReservation(engine: Engine, run: Run, trusted: ReturnType<Engine["trusted"]>) {
    const records = trusted.entries.filter(e => e.record === "scope-admission"), firstRecord = records[0];
    // Anchor only the actual object authenticated by the host's ordered scan.
    // Rejected sequence metadata never participates in a trust comparison.
    let first: any = null;
    if (firstRecord && trusted.prefix.includes(firstRecord)) {
      try { first = reservationData(engine, run, firstRecord); } catch {}
    }
    try {
      if (!trusted.ok) throw new Error("signed scope binding is unavailable; fresh preparation required");
      for (const record of records) {
        const data = reservationData(engine, run, record);
        if (first && (data.repo !== first.repo || data.project !== first.project || hashInput(data.scope) !== hashInput(first.scope) || hashInput(data.dependencies) !== hashInput(first.dependencies))) throw new Error("signed scope reservation lineage changed; fresh preparation required");
      }
      const prior = records.at(-1), signed: any = prior?.data;
      return { prior, signed };
    } catch (error) { throw new ReservationUnavailable((error as Error).message, first); }
}

function verifiedMerge(this: Engine, r: Run, expected?: { project: string; repo: string }) {
    if (r.status !== "succeeded" || r.result !== "done") return false;
    const trusted = this.trusted(r.id); if (!trusted.ok) return false;
    const rec = trusted.entries.filter(e => e.record === "native-merge" && e.verdict === "pass").at(-1), d: any = rec?.data;
    if (!d || d.version !== 1 || !/^[0-9a-f]{40}$/.test(d.head) || !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(d.base) || this.queueRepo(d.repo) !== d.repo || d.project !== this.queueProject(r)) return false;
    if (expected && (d.repo !== expected.repo || d.project !== expected.project)) return false;
    const current = Bun.spawnSync(["git", "rev-parse", "--verify", `refs/heads/${d.base}`], { cwd: d.repo, stdout: "pipe", stderr: "pipe" });
    const h = current.stdout.toString().trim(); if (current.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(h)) return false;
    return Bun.spawnSync(["git", "merge-base", "--is-ancestor", d.head, h], { cwd: d.repo, stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  }
function scopeState(this: Engine, x: X) {
    if (x.run.ctx.nativeQueueVersion !== 1) throw new Error("historical round has no native queue binding; fresh preparation required");
    const project = this.queueProject(x.run), repo = this.queueRepo(x.ctx.repo), trusted = this.trusted(x.run.id);
    const acceptance: any = trusted.entries.filter(e => e.record === "card-answer" && (((e.data as any)?.kind === "dispatch" && (e.data as any)?.choice === "dispatch") || ((e.data as any)?.queueRecovery === true && (e.data as any)?.choice === "retry"))).at(-1)?.data;
    const deps = this.queueDependencies(x.run), specHash = hashInput(x.ctx.spec);
    if (!acceptance || acceptance.queueHashAlgorithm !== INPUT_HASH_ALGORITHM) throw new Error("historical or unknown scope hash algorithm; fresh preparation required");
    if (!trusted.ok || !acceptance || acceptance.queueSpec !== specHash || acceptance.repo !== repo || acceptance.project !== project || hashInput(acceptance.dependencies) !== hashInput(deps) || !Array.isArray(acceptance.scope) || !acceptance.scope.length) throw new Error("accepted dependency/scope binding is unavailable or changed; fresh dispatch required");
    const { prior, signed } = signedReservation(this, x.run, trusted);
    if (x.ctx.nativeAdmission && (!prior || hashInput(signed) !== hashInput(x.ctx.nativeAdmission))) throw new Error("existing scope pin has no current signed binding; fresh preparation required");
    if (!x.ctx.nativeAdmission && prior && !acceptance.queueRecovery) throw new Error("existing scope binding is missing; fresh preparation required");
    const pin = x.ctx.nativeAdmission ?? signed;
    const sameReservation = pin && pin.repo === repo && pin.project === project && hashInput(pin.dependencies) === hashInput(deps) && hashInput(pin.scope) === hashInput(acceptance.scope);
    const upgradingLegacy = pin?.version === 1 && pin.hashAlgorithm === undefined && acceptance.queueRecovery === true && sameReservation;
    if (pin && (!sameReservation || !upgradingLegacy && (pin.version !== 2 || pin.hashAlgorithm !== INPUT_HASH_ALGORITHM || pin.specHash !== specHash))) throw new Error("native scope pin changed or uses unknown hash algorithm; fresh preparation required");
    for (const id of deps) { const parent = this.get(id); if (!parent || !this.verifiedMerge(parent, { project, repo })) return { ready: false, reason: `dependency ${id} has no verified authoritative merge` }; }
    for (const other of this.list()) {
      if (other.id === x.run.id) continue;
      const records = this.trusted(other.id), rec = records.entries.filter(e => e.record === "scope-admission").at(-1);
      if (records.ok && !rec && !other.ctx.nativeAdmission) continue;
      let held: any;
      try { held = signedReservation(this, other, records).signed; if (!held) throw new Error("no signed reservation"); }
      catch (error) {
        // Only the fully verified first reservation can establish a different
        // target. Rejected later fields and mutable context carry no authority.
        const first = error instanceof ReservationUnavailable ? error.first : null;
        if (first && (first.repo !== repo || first.project !== project || !scopesOverlap(acceptance.scope, first.scope))) continue;
        return { ready: false, reason: `scope identity unavailable for ${other.id}` };
      }
      if (held.repo !== repo || held.project !== project) continue;
      if (!this.verifiedMerge(other) && scopesOverlap(acceptance.scope, held.scope)) return { ready: false, reason: `scope held by ${other.id} until verified merge` };
    }
    return { ready: true };
  }

export function installCodeQueue(engine: Engine) {
  engine.queueDomain = {
    worker: (x, mode) => x.run.def.nodes.some(n => n.do === "git.merge") && ["plan", "build"].includes(mode),
    ready: x => scopeState.call(engine, x),
    merged: (r, expected) => verifiedMerge.call(engine, r, expected),
    admitted(x) {
        if (!x.ctx.nativeAdmission || x.ctx.nativeAdmission.version === 1 && x.ctx.nativeAdmission.hashAlgorithm === undefined) {
          const data: any = engine.trusted(x.run.id).entries.filter(e => e.record === "card-answer" && (((e.data as any)?.kind === "dispatch" && (e.data as any)?.choice === "dispatch") || ((e.data as any)?.queueRecovery === true && (e.data as any)?.choice === "retry"))).at(-1)!.data;
          x.ctx.nativeAdmission = { version: 2, hashAlgorithm: INPUT_HASH_ALGORITHM, project: data.project, repo: data.repo, specHash: data.queueSpec, scope: clone(data.scope), dependencies: clone(data.dependencies) };
          engine.record(x, "scope-admission", { data: clone(x.ctx.nativeAdmission) });
        }
    },
    answer(r, _node, rn, c) {
      const binding = (c.kind === "dispatch" && c.answer!.choice === "dispatch") || (c.kind === "scope" && rn.data.nativeQueueCapability && c.answer!.choice === rn.data.nativeQueueCapability.retryAction);
      if (!binding || !Array.isArray(r.ctx.spec?.scope)) return {};
      return { queueRecovery: !!rn.data.nativeQueueCapability, queueHashAlgorithm: INPUT_HASH_ALGORITHM, queueSpec: hashInput(r.ctx.spec), scope: clone(r.ctx.spec.scope), project: engine.queueProject(r), repo: engine.queueRepo(r.ctx.repo), dependencies: engine.queueDependencies(r) };
    }
  };
}
