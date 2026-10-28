// C3: only known identities and proven capability select a native round.
import type { Provider } from "./types";
import {isClaudeExecutionAdmission} from './claude-native';
export class ProviderRefusal extends Error { readonly providerRefusal = true; }
export type ProviderCapability = { provider: string; available: boolean; auth: "verified" | "unverified" | "missing"; quota: "available" | "exhausted" | "unknown"; models: { id: string; efforts?: string[] }[]; at: number; expires: number; reason?: string; refusal?: "unavailable" | "missing-login" | "exhausted" | "unverified" };
export type ProviderSelection = { role: string; host: string | null; explicit: boolean; provider: string; model: string | null; effort?: string | null; configured: Record<string, { model: string | null; effort?: string | null }>; fallback: string[]; roleModel?: string | null; known: string[];
  /** an explicit provider's stand-ins, tried in order only when it is not installed or not signed in (the reviewer's policy vendor) */
  alternates?: string[] };
/** The host whose rules a native step selects under, and the policy reviewer's stand-ins. The chain is the attached Firstmate's
 *  host; with none attached it is Cursor only when Cursor is the one vendor signed in (Codex and Claude are not), so a Codex or
 *  Claude Studio selects as it always did, whatever its chat vendor. Only under Cursor does the policy reviewer stand in along
 *  the configured fallback, then Cursor, when it is not installed or not signed in; under Codex or Claude it still holds. */
export function nativeChain(o: { host: string | null; logins: Record<string, string>; role: string; explicit: boolean; fixture: boolean; fallback: string[] }): { chain: string | null; alternates?: string[] } {
  const cursorOnly = o.logins.cursor === "logged-in" && o.logins.codex !== "logged-in" && o.logins.claude !== "logged-in";
  const chain = o.host ?? (cursorOnly ? "cursor" : null);
  return { chain, alternates: !o.explicit && !o.fixture && o.role === "reviewer" && chain === "cursor" ? [...o.fallback, "cursor"] : undefined };
}
export type SelectedProvider = { provider: Provider; evidence: { role: string; rule: string; provider: string; model: string; effort: string | null; unavailable: { provider: string; reason: string }[] } };
export async function selectNativeProvider(i: ProviderSelection, probe: (id: string,pair:{model:string;effort:string|null}) => Promise<ProviderCapability>, make: (id: string, model: string, effort: string | null) => Provider): Promise<SelectedProvider> {
  if (!Array.isArray(i.known) || !i.known.every(x => typeof x === "string") || !Array.isArray(i.fallback) || !i.fallback.every(x => typeof x === "string") || !i.configured || typeof i.configured !== "object") throw new ProviderRefusal("provider policy configuration is invalid");
  const known = new Set(i.known), validate = (id: string) => { if (!known.has(id)) throw new ProviderRefusal(`unknown provider identity: ${id}`); return id; };
  const explicit = i.explicit || i.role !== "worker";
  // a Cursor host's opposite is whichever of Codex and Claude is ready (each optional), else Cursor itself
  const pair = i.host === "claude" ? ["codex", "claude"] : i.host === "codex" ? ["claude", "codex"] : i.host === "cursor" ? ["codex", "claude", "cursor"] : [];
  const optional = new Set<string>(!explicit && i.host === "cursor" ? ["codex", "claude"] : []);
  const alternates = explicit && Array.isArray(i.alternates) ? [...new Set(i.alternates.map(validate))].filter((id) => id !== i.provider) : [];
  const chain = [...new Set((explicit ? [i.provider] : [...pair, ...i.fallback]).map(validate))];
  if (!chain.length) throw new ProviderRefusal("worker fallback chain is not configured");
  const unavailable: { provider: string; reason: string }[] = [];
  let standIn = false;
  for (let k = 0; k < chain.length; k++) {
    const id = chain[k];
    // an optional candidate that is not ready is passed over (recorded), never a hold: the next one decides
    const skip = (reason: string) => { if (!optional.has(id)) return false; unavailable.push({ provider: id, reason }); return true; };
    const selected = explicit && !standIn ? { model: i.model ?? i.configured[id]?.model ?? null, effort: Object.hasOwn(i,"effort") ? i.effort ?? null : i.configured[id]?.effort ?? null } : i.roleModel && id === chain[0] ? { ...i.configured[id], model: i.roleModel } : i.configured[id];
    if (!selected?.model || typeof selected.model !== "string") { if (skip("no approved model configured")) continue; throw new ProviderRefusal(`no approved model configured for ${id}`); }
    let cap: ProviderCapability; try { cap = await probe(id,{model:selected.model,effort:selected.effort??null}); } catch(error) { if (skip("capability probe failed")) continue; if(error instanceof ProviderRefusal)throw error;throw new ProviderRefusal(`capability probe failed for ${id}; verification unavailable`); }
    if (optional.has(id) && cap && cap.provider === id && !(cap.available && cap.auth === "verified" && (cap.quota === "available" || id === "claude" && isClaudeExecutionAdmission(cap, { model: selected.model, effort: selected.effort ?? null })) && cap.models.some((m) => m?.id === selected.model))) { skip(cap.reason ?? "not ready"); continue; }
    if (!cap || !Array.isArray(cap.models) || cap.models.some(m => !m || typeof m.id !== "string" || m.efforts !== undefined && (!Array.isArray(m.efforts) || m.efforts.some(e => typeof e !== "string"))) || typeof cap.available !== "boolean" || !["verified", "unverified", "missing"].includes(cap.auth) || !["available", "exhausted", "unknown"].includes(cap.quota) || cap.provider !== id || !Number.isFinite(cap.at) || !Number.isFinite(cap.expires) || cap.at > Date.now() || cap.expires <= Date.now() || cap.expires - cap.at > 300_000) throw new ProviderRefusal(`provider capability identity or freshness unavailable: ${id}`);
    const classifiedUnavailable = cap.refusal === "unavailable" && !cap.available;
    const classifiedMissingLogin = cap.refusal === "missing-login" && cap.auth === "missing";
    const classifiedExhaustion = cap.refusal === "exhausted" && cap.auth === "verified" && cap.quota === "exhausted";
    const fallbackAllowed = classifiedUnavailable || classifiedMissingLogin || classifiedExhaustion;
    const execution=id==='claude'&&isClaudeExecutionAdmission(cap,{model:selected.model,effort:selected.effort??null});
    // signed in is enough for Claude: its quota is not knowable before a run, and a run that hits a limit fails with that
    // cause (claudeFailureCode); a separate execution check per model and effort is not required first
    const admittedQuota=cap.quota==='available'||execution||(id==='claude'&&cap.available&&cap.auth==='verified'&&cap.quota==='unknown');
    if ((!cap.available || cap.auth !== "verified" || !admittedQuota) && !fallbackAllowed) throw new ProviderRefusal(`provider capability is unverified: ${id}; hold without fallback`);
    if (cap.refusal !== undefined && !["unavailable", "missing-login", "exhausted", "unverified"].includes(cap.refusal)) throw new ProviderRefusal("provider refusal classification is invalid");
    // Model typos never change vendor or silently use a CLI default.
    const model = cap.models.find(m => m.id === selected.model);
    if (cap.available && cap.auth === "verified" && admittedQuota && !model) throw new ProviderRefusal(`unknown or unavailable configured model for ${id}`);
    if (model && selected.effort && !model.efforts?.includes(selected.effort)) throw new ProviderRefusal(`configured reasoning effort is not supported by ${id}'s model`);
    if (!cap.available || cap.auth !== "verified" || !admittedQuota) {
      const reason = cap.reason ?? (!cap.available ? "adapter unavailable" : cap.auth !== "verified" ? "login is not verified" : cap.quota === "exhausted" ? "quota exhausted" : "quota is unverified");
      unavailable.push({ provider: id, reason });
      // the explicit vendor is not installed or not signed in: its configured stand-ins, each only if it is ready
      if (explicit && !standIn && alternates.length && (classifiedUnavailable || classifiedMissingLogin)) { standIn = true; for (const a of alternates) { if (!chain.includes(a)) chain.push(a); optional.add(a); } continue; }
      if (explicit && !standIn) break; continue;
    }
    const provider = make(id, selected.model, selected.effort ?? null);
    if (provider.id !== id || provider.model !== selected.model) throw new ProviderRefusal("actual provider/model identity does not match verified selection");
    return { provider, evidence: { role: i.role, rule: standIn ? "explicit vendor unavailable: configured stand-in" : explicit ? "explicit" : pair.length ? "opposite-of-host" : "configured fallback: unknown host", provider: id, model: selected.model, effort: selected.effort ?? null, unavailable } };
  }
  throw new ProviderRefusal(`no verified provider is available (${unavailable.map(v => `${v.provider}: ${v.reason}`).join("; ")})`);
}
