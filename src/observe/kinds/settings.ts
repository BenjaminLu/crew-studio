// Settings (settings:studio): the non-secret part of the Settings page, as one entity: the chat provider and models, which
// keys are present (never a key, an endpoint's credentials or a token), whether the captain shares their screen with
// Firstmate, whether a paired phone may drive. No external CLI grant ever reaches it.
import { registerKind, type Entity, type Sources } from "../registry";

/** Only these keys of the settings source are ever emitted; a value that looks like a secret is dropped as well. */
const KEYS = ["language", "chat", "keys", "sharing", "phoneDrive", "labs", "lan", "execution"] as const;
const SECRETISH = /(sk-|ghp_|github_pat_|xox[bp]-|csg_|BEGIN [A-Z ]*PRIVATE KEY)/;
export function settingsData(raw: Record<string, unknown> | null) {
  const out: Record<string, unknown> = {}; if (!raw) return out;
  for (const k of KEYS) if (raw[k] !== undefined && !SECRETISH.test(JSON.stringify(raw[k]))) out[k] = raw[k];
  return out;
}
const entity = (s: Sources): Entity | null => { let raw: Record<string, unknown> | null = null; try { raw = s.settings?.() ?? null; } catch {} if (!raw) return null;
  return { id: "studio", title: "Studio settings", updatedAt: null, project: null, data: settingsData(raw) }; };

registerKind({
  kind: "settings", route: "#/settings", listRoute: "#/settings", idPattern: /^studio$/, idExample: "studio",
  pages: ["skins", "pro"],
  about: "Studio's settings, the non-secret part: chat provider and models, which keys are present, screen sharing with Firstmate, phone driving.",
  scope: () => null, grantable: false, viewer: "desktop",
  fields: [...["chat", "keys", "sharing", "phoneDrive", "labs", "lan", "execution"].map((path) => ({ path, trust: "studio" as const })), { path: "language", trust: "captain" }],
  list: (s) => { const e = entity(s); return e ? [e] : []; },
  get: (s, id) => (id === "studio" ? entity(s) : null),
});
