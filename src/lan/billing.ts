// How each provider's sign-in is billed (docs/units/lan-relay.md, Spend): a subscription (the resource is its quota,
// no dollars are shown) or an API key billed per token (the take dialog and the daily ceilings say "billed per token",
// and a round's dollar figure is shown where the provider reports one). Studio learns it from the sign-in checks it
// already makes: Claude's `auth status` (authMethod) and Codex's `account/read` (account type). Cursor's sign-in does not
// say how it is billed, so nothing is shown for it (null), and so for any provider Studio has not checked yet.
export type Billing = "per-token" | "subscription" | null;
const seen = new Map<string, Billing>();
/** what a sign-in check found (null: it could not tell) */
export function noteBilling(provider: string, b: Billing) { if (b) seen.set(provider, b); else seen.delete(provider); }
export const billingOf = (provider: string | null | undefined): Billing => (provider ? seen.get(provider) ?? null : null);
export const billingAll = (): Record<string, Billing> => Object.fromEntries(["codex", "claude", "cursor"].map((p) => [p, billingOf(p)]));
/** Claude's `auth status --json` authMethod: an API key is billed per token; a claude.ai or OAuth-token login is a subscription */
export const claudeBilling = (authMethod: unknown): Billing => authMethod === "api_key" ? "per-token" : authMethod === "claude.ai" || authMethod === "oauth_token" ? "subscription" : null;
/** Codex's account/read type: apiKey is billed per token; chatgpt is a ChatGPT plan */
export const codexBilling = (type: unknown): Billing => type === "apiKey" ? "per-token" : type === "chatgpt" ? "subscription" : null;
