// API keys and endpoints for the direct-HTTP chat providers, so the status chat
// works with no vendor CLI installed. Environment wins; otherwise a key pasted in
// Studio is kept in CREW_DATA/keys.json (0600). Keys never reach the browser:
// the API only says whether one is set.
//   ANTHROPIC_API_KEY, OPENAI_API_KEY, CREW_COMPAT_BASE_URL, CREW_COMPAT_API_KEY
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerSecretValues } from "./secure";

export type Keys = { anthropic?: string; openai?: string; compatBaseUrl?: string; compatKey?: string };
let dataDir = "";
export const setKeysDir = (d: string) => { dataDir = d; };
const file = () => join(dataDir, "keys.json");

function saved(): Keys { if (!dataDir) return {}; try { return JSON.parse(readFileSync(file(), "utf8")) ?? {}; } catch { return {}; } }
/** Only the keys Studio keeps (keys.json), without the environment's: a source of its own after the environment's. */
export function keptKeys(): Keys { return saved(); }
export function keys(): Keys {
  const s = saved();
  return {
    anthropic: process.env.ANTHROPIC_API_KEY || s.anthropic || undefined,
    openai: process.env.OPENAI_API_KEY || s.openai || undefined,
    compatBaseUrl: process.env.CREW_COMPAT_BASE_URL || s.compatBaseUrl || undefined,
    compatKey: process.env.CREW_COMPAT_API_KEY || s.compatKey || undefined,
  };
}
// the key store's values are Studio secrets: the one redactor (secure.ts) removes them wherever they would be written
registerSecretValues(() => { const k = keys(); return [k.anthropic, k.openai, k.compatKey]; });
export function keyStatus() {
  const k = keys(), s = saved();
  const src = (env: string | undefined, v: string | undefined) => (env ? "env" : v ? "settings" : null);
  return {
    anthropic: src(process.env.ANTHROPIC_API_KEY, s.anthropic),
    openai: src(process.env.OPENAI_API_KEY, s.openai),
    compatBaseUrl: k.compatBaseUrl ?? null,
    compatKey: src(process.env.CREW_COMPAT_API_KEY, s.compatKey),
  };
}
export function saveKeys(patch: Keys) {
  const cur = saved();
  for (const [k, v] of Object.entries(patch) as [keyof Keys, string | undefined][]) {
    if (v === undefined) continue;
    const t = String(v).trim();
    if (!t) delete cur[k]; else cur[k] = t;
  }
  const tmp = file() + ".tmp";
  writeFileSync(tmp, JSON.stringify(cur, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}
