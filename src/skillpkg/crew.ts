// The captain's one decision on a script skill (docs/units/skill-packages.md §3), folded into the team change it comes with:
// the team-change card (Firstmate's proposal) and the Crew page's own change. Every script skill version the changed team
// (or a workflow it reaches) would load and the captain never decided is listed with its scripts, flags and the hosts approving
// it allows; the captain approves it with scripts or as text only, or does not make the change. Studio-wide per version hash:
// a version decided once is never asked again; a new version (any changed file) is.
import type { SkillPackages } from "./index";

type Pin = { id: string; v: number; sha256: string; filesSha256?: string };
export type PendingSkill = { id: string; v: number; sha256: string; filesSha256: string; scripts: { path: string; lang: string; flags: string[] }[]; hosts: string[]; bins: string[]; locks: string[] };
/** Every library pin a team names: members, project seats, workflow node additions. */
export function teamPins(team: any): Pin[] {
  const out: Pin[] = [];
  for (const m of Object.values<any>(team?.members ?? {})) out.push(...(m.skills ?? []));
  for (const p of Object.values<any>(team?.projects ?? {})) for (const s of Object.values<any>(p.seats ?? {})) out.push(...(s.skills ?? []));
  for (const w of Object.values<any>(team?.workflows ?? {})) for (const n of Object.values<any>(w.nodes ?? {})) out.push(...(n.add ?? []));
  return out;
}
/** Every library pin a workflow definition names on its nodes (and its judged checks). */
export const defPins = (def: any): Pin[] => (def?.nodes ?? []).flatMap((n: any) => [...(n.skills ?? []), ...(n.checks ?? []).flatMap((c: any) => c.skills ?? [])]);
/** The script skill versions among these pins the captain has not decided yet (each once). */
export function pendingScripts(pk: SkillPackages | null | undefined, pins: Pin[]): PendingSkill[] {
  if (!pk) return [];
  const seen = new Set<string>(), out: PendingSkill[] = [];
  for (const p of pins) {
    const k = `${p.id}@v${p.v}`; if (seen.has(k)) continue; seen.add(k);
    if (!pk.isScript(p.id, p.v) || pk.decision(p.id, p.v)) continue;
    const lv = pk.o.skills.libVersion(p.id, p.v), f = pk.cardFacts(p.id, p.v); if (!lv || !f) continue;
    out.push({ id: p.id, v: p.v, sha256: lv.rec.sha256, filesSha256: lv.rec.filesSha256, scripts: f.scripts.map((s) => ({ path: s.path, lang: s.lang, flags: s.flags })), hosts: f.hosts, bins: f.bins, locks: f.locks });
  }
  return out;
}
/** The card's section for them (en, zh-TW): what approving each allows, exactly. */
export function pendingText(list: PendingSkill[]): string {
  if (!list.length) return "";
  const one = (s: PendingSkill) => {
    const scripts = s.scripts.slice(0, 12).map((x) => `    ${x.path} (${x.lang}${x.flags.length ? `; ${x.flags.join(", ")}` : ""})`).join("\n") + (s.scripts.length > 12 ? `\n    … ${s.scripts.length - 12} more` : "");
    return [`  ${s.id}@v${s.v} · ${s.sha256.slice(0, 12)} / files ${s.filesSha256.slice(0, 12)}: ${s.scripts.length} script${s.scripts.length === 1 ? "" : "s"} / 含 ${s.scripts.length} 個 script`, scripts,
      `    Network when it runs / 執行時可連: ${s.hosts.length ? s.hosts.join(", ") : "none / 不連網"}`,
      s.locks.length ? `    Dependencies from its lockfiles, installed by Studio before it runs / 依賴照它的 lockfile，由 Studio 事先安裝: ${s.locks.join(", ")}` : "",
      s.bins.length ? `    Programs it uses / 會用到的程式: ${s.bins.join(", ")}` : ""].filter(Boolean).join("\n");
  };
  return `\n\nScript skills this change brings / 這個變更帶來的 script skill:\n${list.map(one).join("\n")}\nApproving covers exactly these versions, Studio-wide; a new version asks again. Pick “Approve with scripts” or “Text only” (the agent gets the text, never runs the scripts). / 核准只適用於這些版本（全 Studio）；新版本會再問。選「核准（含 script）」或「只當文字」（agent 只拿到文字，不跑 script）。`;
}
export const SKILL_CHOICES = [{ value: "scripts", label: "Approve with scripts · 核准（含 script）" }, { value: "text-only", label: "Text only, no scripts · 只當文字，不跑 script" }];
