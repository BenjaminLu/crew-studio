// Library skills (skill:baton, skill:baton@v2): the Skills page as it reads them (src/skills.ts library(), the rows GET
// /api/skills returns) and, for a script skill, what its version needs before it runs (src/skillpkg SkillPackages.status: the
// captain's decision on its scripts and whether its environment is prepared). Reading never approves, prepares or runs a
// skill. A skill's name and description are its SKILL.md's (whoever wrote it), so they are untrusted unless Studio ships it.
import { registerKind, type Entity, type Sources } from "../registry";

const REF = /^([a-z0-9][a-z0-9-]{0,40})(?:@v([1-9]\d{0,5}))?$/;
const lib = (s: Sources): any[] => { try { return s.skills?.()?.library?.() ?? []; } catch { return []; } };
/** A script skill version's state for the captain: the decision on its scripts and its prepared environment. */
export function skillState(s: Sources, id: string, v: number) {
  let st: any = null; try { st = s.packages?.()?.status?.(id, v) ?? null; } catch { st = null; }
  if (!st || st.state === "markdown") return null;
  return { state: st.state, scripts: st.scripts, hosts: st.hosts ?? [], ready: st.state === "ready", blocking: !!st.blocking,
    decision: st.decision ? { scripts: st.decision.scripts, by: st.decision.by, via: st.decision.via, at: st.decision.at, card: st.decision.card ?? null, hosts: st.decision.hosts ?? [] } : null,
    env: st.env ? { at: st.env.at, npm: !!st.env.npm, python: !!st.env.python, runtimes: st.env.runtimes ?? {} } : null, preparedAt: st.at ?? null,
    reasons: (st.reasons ?? []).map((r: any) => r.en), warnings: st.warnings ?? [] };
}
/** One library row as an agent reads it (Skills.library(): GET /api/skills's rows), at one version. */
export function skillRow(s: Sources, k: any, v?: number) {
  const n = v ?? k.current, ver = (k.versions ?? []).find((x: any) => x.n === n), builtin = k.sourceKind === "builtin";
  return { id: k.id, version: n, current: k.current, latest: n === k.current, sourceKind: k.sourceKind, fits: k.fits ?? null, files: (k.files ?? []).length, bytes: ver?.bytes ?? k.bytes, createdAt: ver?.createdAt ?? null, by: ver?.by ?? null,
    versions: (k.versions ?? []).map((x: any) => ({ n: x.n, createdAt: x.createdAt, by: x.by })),
    ...(builtin ? { name: k.name, description: k.description } : { skillName: k.name, skillDescription: k.description }),
    // a script skill's hosts, warnings and reasons name what its author chose (files, modules, hosts): its words unless Studio ships it
    ...(() => { const p = skillState(s, k.id, n); if (!p || builtin) return { package: p };
      const { hosts, warnings, reasons, decision, ...rest } = p; const { hosts: approvedHosts, ...dec } = decision ?? ({} as any);
      return { package: { ...rest, decision: decision ? dec : null }, packageText: { hosts, warnings, reasons, approvedHosts: approvedHosts ?? [] } }; })() };
}
const entity = (s: Sources, k: any, v?: number): Entity => { const n = v ?? k.current;
  return { id: v ? `${k.id}@v${n}` : k.id, title: `${k.id}@v${n}`, updatedAt: (k.versions ?? []).find((x: any) => x.n === n)?.createdAt ?? null, project: null, data: skillRow(s, k, v) }; };

registerKind({
  kind: "skill", route: "#/skills/:id", listRoute: "#/skills", idPattern: REF, idExample: "baton@v2",
  routeId: (id) => id.replace(/@v(\d+)$/, "@$1"),
  pages: ["skill", "improve", "edit"],
  about: "A library skill at a version (skill:baton is its current one): its versions and, for a script skill, the captain's decision on its scripts and whether its environment is prepared.",
  scope: () => null, grantable: true, viewer: "desktop",
  filters: { scripts: { type: "boolean", description: "true: only skills with scripts" }, ready: { type: "boolean", description: "false: only script skills not ready to run" } },
  fields: [
    ...["id", "version", "current", "latest", "sourceKind", "fits", "files", "bytes", "createdAt", "by", "versions", "name", "description", "package"].map((path) => ({ path, trust: "studio" as const })),
    { path: "skillName", trust: "untrusted", source: "the skill's own SKILL.md name (its author)" },
    { path: "packageText", trust: "untrusted", source: "a script skill's hosts, warnings and readiness reasons (they name its author's files and modules)" },
    { path: "skillDescription", trust: "untrusted", source: "the skill's own SKILL.md description (its author)" },
  ],
  list: (s, filter) => lib(s).map((k) => entity(s, k)).filter((e) => { const p = (e.data as any).package; return (filter.scripts !== true || !!p) && (filter.ready !== false || (!!p && !p.ready)); }),
  get: (s, id) => { const m = REF.exec(id); if (!m) return null; const k = lib(s).find((x) => x.id === m[1]); if (!k) return null;
    const v = m[2] ? Number(m[2]) : undefined; if (v !== undefined && !(k.versions ?? []).some((x: any) => x.n === v)) return null; return entity(s, k, v); },
});
