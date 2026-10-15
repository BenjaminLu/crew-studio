// The skill library's routes (unit agent-skills):
//   GET  /api/skills          library skills (name, description, source, current version, sha256, ignored keys,
//                             the workflow nodes pinning each) and the role skills, with the caps
//   GET  /api/skills/homes    the skills homes (~/.claude/skills, ~/.codex/skills) and the skill folders in each
//   POST /api/skills/import   {kind: "folder", path} | {kind: "home", home, name} | {kind: "git", url, path?}
// An import is the captain's act in Studio's page: on top of the write guard every
// route has, it needs the session COOKIE (a script's x-crew-session header is not
// enough), an Origin header that is Studio's own, and this Mac (never a phone).
// Skill text is never served here: it goes only into a run's provider prompt.
import { hasSessionCookie } from "./csrf";
import { SKILL_CAPS, SkillImportError, type Skills } from "./skills";
import type { WorkflowDefs } from "./runtime/defs";
import type { StudioLog } from "./rawlog";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function createSkillRoutes(o: { skills: Skills; defs: () => WorkflowDefs | null; session: string; log: StudioLog }) {
  /** where each library skill is pinned: the latest version of every workflow, node by node */
  const usedBy = () => {
    const out: Record<string, { workflow: string; version: number; node: string; v: number }[]> = {};
    const defs = o.defs(); if (!defs) return out;
    for (const w of defs.list()) { const d = defs.get(w.id); for (const n of d?.nodes ?? []) for (const p of n.skills ?? []) (out[p.id] ??= []).push({ workflow: w.id, version: d!.version, node: n.id, v: p.v }); }
    return out;
  };
  /** the role skills: the versioned roles of every workflow (v1 is taken from the source on first listing, as on first use) */
  const roles = () => {
    const seen = new Set<string>(); const out: any[] = [];
    const add = (workflow: string, role: string, label: string, source: string) => {
      const key = `${workflow}/${role}`; if (seen.has(key)) return; seen.add(key);
      let current: number | null = null, hash: string | null = null;
      try { const idx = o.skills.ensure(workflow, role); current = idx.at(-1)!.n; hash = idx.at(-1)!.sha256; } catch {}
      out.push({ id: key, workflow, role, name: label, description: `The ${label} role's own skill in ${workflow}`, source, sourceKind: "role", current, sha256: hash });
    };
    for (const f of o.skills.flows.list()) for (const r of f.roles ?? []) add(f.id, r.id, r.label, r.skill);
    const defs = o.defs(); for (const w of defs?.list() ?? []) for (const r of defs!.get(w.id)?.roles ?? []) add(w.id, r.id, r.label, r.skill);
    return out;
  };
  return async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!/^\/api\/skills(\/|$)/.test(p)) return null;
    if (p === "/api/skills" && !writing) { const u = usedBy(); return json({ skills: o.skills.library().map((s) => ({ ...s, usedBy: u[s.id] ?? [] })), roles: roles(), caps: SKILL_CAPS }); }
    if (p === "/api/skills/homes" && !writing) return json({ homes: o.skills.homes() });
    if (p === "/api/skills/import" && writing) {
      if (who.kind !== "desktop") return json({ error: "import a skill on the Mac, in Studio's page", code: "desktopOnly" }, 403);
      if (!hasSessionCookie(req, o.session)) return json({ error: "an import is the captain's act in Studio's page: this request carries no Studio session cookie", code: "session" }, 403);
      const origin = req.headers.get("origin");
      if (!origin) return json({ error: "an import needs an Origin header from Studio's page", code: "origin" }, 403);
      if (origin !== url.origin) return json({ error: "a request from another site cannot import a skill", code: "crossSite" }, 403);
      let b: any = {}; try { b = await req.json(); } catch {}
      try {
        const r = b?.kind === "folder" ? o.skills.importFolder(String(b?.path ?? ""), "captain")
          : b?.kind === "home" ? o.skills.importHome(String(b?.home ?? ""), String(b?.name ?? ""), "captain")
          : b?.kind === "git" ? await o.skills.importGit(String(b?.url ?? ""), b?.path ? String(b.path) : null, "captain")
          : (() => { throw new SkillImportError("say where the skill comes from: a folder, a skills home or a git URL"); })();
        // the event names the skill and its version only: never its text or its source path
        o.log.emit({ type: "skill_imported", workflow: "studio", summary: r.created ? `skill ${r.skill.id} v${r.version.n} imported (${r.version.sourceKind})` : `skill ${r.skill.id}: unchanged, still v${r.version.n}`, data: { id: r.skill.id, v: r.version.n, sha256: r.version.sha256, kind: r.version.sourceKind } });
        return json({ skill: { ...r.skill, usedBy: usedBy()[r.skill.id] ?? [] }, version: r.version, created: r.created });
      } catch (e: any) { return json({ error: e instanceof SkillImportError ? e.message : `the import failed: ${String(e?.message ?? e).slice(0, 200)}` }, 400); }
    }
    return json({ error: "not found" }, 404);
  };
}
