// C3: only known identities and proven capability select a native round.
import type { Provider } from "./types";
export class ProviderRefusal extends Error { readonly providerRefusal = true; }
export type ProviderCapability = { provider: string; available: boolean; auth: "verified" | "unverified" | "missing"; quota: "available" | "exhausted" | "unknown"; models: { id: string; efforts?: string[] }[]; at: number; expires: number; reason?: string; refusal?: "unavailable" | "missing-login" | "exhausted" | "unverified" };
export type ProviderSelection = { role: string; host: string | null; explicit: boolean; provider: string; model: string | null; effort?: string | null; configured: Record<string, { model: string | null; effort?: string | null }>; fallback: string[]; roleModel?: string | null; known: string[] };
export type SelectedProvider = { provider: Provider; evidence: { role: string; rule: string; provider: string; model: string; effort: string | null; unavailable: { provider: string; reason: string }[] } };
export async function selectNativeProvider(i: ProviderSelection, probe: (id: string) => Promise<ProviderCapability>, make: (id: string, model: string, effort: string | null) => Provider): Promise<SelectedProvider> {
  if (!Array.isArray(i.known) || !i.known.every(x => typeof x === "string") || !Array.isArray(i.fallback) || !i.fallback.every(x => typeof x === "string") || !i.configured || typeof i.configured !== "object") throw new ProviderRefusal("provider policy configuration is invalid");
  const known = new Set(i.known), validate = (id: string) => { if (!known.has(id)) throw new ProviderRefusal(`unknown provider identity: ${id}`); return id; };
  const explicit = i.explicit || i.role !== "worker";
  const pair = i.host === "claude" ? ["codex", "claude"] : i.host === "codex" ? ["claude", "codex"] : [];
  const chain = [...new Set((explicit ? [i.provider] : [...pair, ...i.fallback]).map(validate))];
  if (!chain.length) throw new ProviderRefusal("worker fallback chain is not configured");
  const unavailable: { provider: string; reason: string }[] = [];
  for (const id of chain) {
    const selected = explicit ? { model: i.model ?? i.configured[id]?.model ?? null, effort: i.effort ?? i.configured[id]?.effort ?? null } : i.roleModel && id === chain[0] ? { ...i.configured[id], model: i.roleModel } : i.configured[id];
    if (!selected?.model || typeof selected.model !== "string") throw new ProviderRefusal(`no approved model configured for ${id}`);
    let cap: ProviderCapability; try { cap = await probe(id); } catch { throw new ProviderRefusal(`capability probe failed for ${id}; verification unavailable`); }
    if (!cap || !Array.isArray(cap.models) || cap.models.some(m => !m || typeof m.id !== "string" || m.efforts !== undefined && (!Array.isArray(m.efforts) || m.efforts.some(e => typeof e !== "string"))) || typeof cap.available !== "boolean" || !["verified", "unverified", "missing"].includes(cap.auth) || !["available", "exhausted", "unknown"].includes(cap.quota) || cap.provider !== id || !Number.isFinite(cap.at) || !Number.isFinite(cap.expires) || cap.at > Date.now() || cap.expires <= Date.now() || cap.expires - cap.at > 300_000) throw new ProviderRefusal(`provider capability identity or freshness unavailable: ${id}`);
    const classifiedUnavailable = cap.refusal === "unavailable" && !cap.available;
    const classifiedMissingLogin = cap.refusal === "missing-login" && cap.auth === "missing";
    const classifiedExhaustion = cap.refusal === "exhausted" && cap.auth === "verified" && cap.quota === "exhausted";
    const fallbackAllowed = classifiedUnavailable || classifiedMissingLogin || classifiedExhaustion;
    if ((!cap.available || cap.auth !== "verified" || cap.quota !== "available") && !fallbackAllowed) throw new ProviderRefusal(`provider capability is unverified: ${id}; hold without fallback`);
    if (cap.refusal !== undefined && !["unavailable", "missing-login", "exhausted", "unverified"].includes(cap.refusal)) throw new ProviderRefusal("provider refusal classification is invalid");
    // Model typos never change vendor or silently use a CLI default.
    const model = cap.models.find(m => m.id === selected.model);
    if (cap.available && cap.auth === "verified" && cap.quota === "available" && !model) throw new ProviderRefusal(`unknown or unavailable configured model for ${id}`);
    if (model && selected.effort && !model.efforts?.includes(selected.effort)) throw new ProviderRefusal(`configured reasoning effort is not supported by ${id}'s model`);
    if (!cap.available || cap.auth !== "verified" || cap.quota !== "available") {
      const reason = cap.reason ?? (!cap.available ? "adapter unavailable" : cap.auth !== "verified" ? "login is not verified" : cap.quota === "exhausted" ? "quota exhausted" : "quota is unverified");
      unavailable.push({ provider: id, reason }); if (explicit) break; continue;
    }
    const provider = make(id, selected.model, selected.effort ?? null);
    if (provider.id !== id || provider.model !== selected.model) throw new ProviderRefusal("actual provider/model identity does not match verified selection");
    return { provider, evidence: { role: i.role, rule: explicit ? "explicit" : pair.length ? "opposite-of-host" : "configured fallback: unknown host", provider: id, model: selected.model, effort: selected.effort ?? null, unavailable } };
  }
  throw new ProviderRefusal(`no verified provider is available (${unavailable.map(v => `${v.provider}: ${v.reason}`).join("; ")})`);
}
