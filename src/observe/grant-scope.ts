// What an external CLI grant's "observe" scope may read (docs/units/cli-mcp-grant.md, docs/units/observe.md): the captain
// picks a preset on the board, "this project" (every grantable kind, that project's entities), "review only" (review rooms)
// or "custom" (kinds by group). External text (a pull request's body, a reviewer's comment, a tutor's answer: the untrusted
// fields) is left out unless the captain ticks "include external text"; an external CLI has a shell and the network, so
// private data, someone else's words and a way out must never meet there. Never grantable, whatever is asked: settings,
// grants, peers, terminals and focus.
import { NEVER_GRANTABLE, kindDefs } from "./registry";
import "./tools";

export const KIND_GROUPS: { id: string; en: string; zh: string; kinds: string[] }[] = [
  { id: "work", en: "Work", zh: "工作", kinds: ["task", "card", "workflow", "project"] },
  { id: "review", en: "Review", zh: "Review", kinds: ["room", "pr"] },
  { id: "outputs", en: "Outputs", zh: "產出", kinds: ["artifact", "doc"] },
  { id: "team", en: "Crew and skills", zh: "團隊與技能", kinds: ["crew", "skill"] },
  { id: "system", en: "System", zh: "系統", kinds: ["doctor"] },
];
export const OBSERVE_PRESETS = ["project", "review", "custom"] as const;
export type ObservePreset = (typeof OBSERVE_PRESETS)[number];
export type ObserveScope = { preset: ObservePreset; kinds: string[]; untrusted: boolean };
/** Every kind a grant may be given (the registry's grantable kinds). */
export const grantableKinds = () => kindDefs().filter((d) => d.grantable).map((d) => d.kind);
const REVIEW = ["room"];

/** The observe scope a request asks for, checked: the kinds a preset gives, a custom list's kinds each grantable. */
export function readObserve(o: unknown): ObserveScope {
  const b = (o && typeof o === "object" && !Array.isArray(o) ? o : {}) as Record<string, unknown>;
  const extra = Object.keys(b).find((k) => !["preset", "kinds", "untrusted"].includes(k)); if (extra) throw new Error(`observe takes preset, kinds and untrusted (not ${extra.slice(0, 40)})`);
  const preset = (b.preset ?? "project") as ObservePreset;
  if (!OBSERVE_PRESETS.includes(preset)) throw new Error(`choose what it reads: ${OBSERVE_PRESETS.join(", ")}`);
  if (b.untrusted !== undefined && typeof b.untrusted !== "boolean") throw new Error("untrusted is true or false");
  let kinds: string[];
  if (preset === "project") kinds = grantableKinds();
  else if (preset === "review") kinds = [...REVIEW];
  else {
    if (!Array.isArray(b.kinds) || !b.kinds.length || b.kinds.some((k) => typeof k !== "string")) throw new Error("a custom grant names the kinds it reads");
    const never = (b.kinds as string[]).filter((k) => (NEVER_GRANTABLE as readonly string[]).includes(k));
    if (never.length) throw new Error(`a grant never reads ${never.join(", ")} (settings, grants, peers, terminals and focus stay on the board)`);
    const unknown = (b.kinds as string[]).filter((k) => !grantableKinds().includes(k)); if (unknown.length) throw new Error(`no such kind: ${unknown.join(", ")}`);
    kinds = grantableKinds().filter((k) => (b.kinds as string[]).includes(k));
  }
  return { preset, kinds, untrusted: b.untrusted === true };
}
