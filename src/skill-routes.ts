// The skill library's routes (unit agent-skills):
//   GET  /api/skills          library skills (name, description, source, current version, sha256, ignored keys,
//                             the workflow nodes pinning each) and the role skills, with the caps
//   GET  /api/skills/homes    the skills homes (~/.claude/skills, ~/.codex/skills) and the skill folders in each
//   GET  /api/skills/<id>?version=N   one library skill, read-only: its SKILL.md exactly as stored (that version; the latest
//                             when no version is given), its frontmatter, every version, its supporting files, where it is used
//   GET  /api/skills/<id>/files/<path>?version=N   one supporting file as text (only a file that version recorded; no link,
//                             text only, under SKILL_VIEW_FILE_CAP)
//   POST /api/skills/import   {kind: "folder", path} | {kind: "home", home, name} | {kind: "git", url, path?}
// An import is the captain's act in Studio's page: on top of the write guard every
// route has, it needs the session COOKIE (a script's x-crew-session header is not
// enough), an Origin header that is Studio's own, and this Mac (never a phone).
// The viewer routes only read: the captain reads a skill's exact text in Studio's page (public/skills.js), the same bytes
// a pinned node loads. They never write, and never follow a link inside a skill's folder.
import { hasSessionCookie } from "./csrf";
import { SKILL_CAPS, SKILL_VIEW_FILE_CAP, SkillImportError, SkillViewError, splitFrontmatter, type Skills } from "./skills";
import { seatLabel, type Team } from "./domain/crew";
import type { WorkflowDefs } from "./runtime/defs";
import type { StudioLog } from "./rawlog";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function createSkillRoutes(o: { skills: Skills; defs: () => WorkflowDefs | null; session: string; log: StudioLog; team?: () => Team | null }) {
  /** where each library skill is pinned: the latest version of every workflow, node by node */
  const usedBy = () => {
    const out: Record<string, { workflow: string; version: number; node: string; v: number }[]> = {};
    const defs = o.defs(); if (!defs) return out;
    for (const w of defs.list()) { const d = defs.get(w.id); for (const n of d?.nodes ?? []) for (const p of n.skills ?? []) (out[p.id] ??= []).push({ workflow: w.id, version: d!.version, node: n.id, v: p.v }); }
    return out;
  };
  /** where the team pins a library skill (the Crew page): a member's own skills, a project's seat, a workflow node's added skill */
  const seatsUsing = (id: string) => {
    const out: { seat?: string; label?: { en: string; zh: string }; project?: string; workflow?: string; node?: string; v: number }[] = [];
    let t: Team | null = null; try { t = o.team?.() ?? null; } catch {} if (!t) return out;
    for (const [seat, m] of Object.entries(t.members ?? {})) for (const p of m.skills ?? []) if (p.id === id) out.push({ seat, label: seatLabel(t, seat), v: p.v });
    for (const [project, pr] of Object.entries(t.projects ?? {})) for (const [seat, s] of Object.entries(pr.seats ?? {})) for (const p of s.skills ?? []) if (p.id === id) out.push({ project, seat, label: seatLabel(t, seat), v: p.v });
    for (const [workflow, w] of Object.entries(t.workflows ?? {})) for (const [node, n] of Object.entries(w.nodes ?? {})) for (const p of n.add ?? []) if (p.id === id) out.push({ workflow, node, v: p.v });
    return out;
  };
  /** the version a viewer request asks for: the latest when none is given; NaN for anything but a whole number */
  const versionOf = (asked: string | null, latest: number) => asked == null || asked === "" ? latest : /^[1-9]\d{0,5}$/.test(asked) ? Number(asked) : NaN;
  /** one library skill for the viewer: the version asked for, its exact text and what is known of it */
  const view = (id: string, asked: string | null) => {
    const lib = o.skills.library().find((s) => s.id === id); if (!lib) throw new SkillViewError(`no skill ${id} in the library`, 404);
    const n = versionOf(asked, lib.current); if (!Number.isFinite(n)) throw new SkillViewError("version is a whole number", 400);
    const got = o.skills.libText(id, n); if (!got) throw new SkillViewError(`skill ${id} has no version ${n}`, 404);
    const { rec, text } = got;
    return { id, name: rec.name, description: rec.description, fits: lib.fits, source: rec.source, sourceKind: rec.sourceKind, version: rec.n, latest: lib.current,
      versions: lib.versions, sha256: rec.sha256, bytes: rec.bytes, createdAt: rec.createdAt, by: rec.by, text, frontmatter: splitFrontmatter(text).fm, ignored: rec.ignored,
      files: o.skills.libFiles(id, rec.n), skipped: rec.skipped, fileCap: SKILL_VIEW_FILE_CAP, usedBy: usedBy()[id] ?? [], usedBySeats: seatsUsing(id) };
  };
  /** one supporting file: the path as the page sent it, each segment decoded once (an encoded "/" or ".." is refused, never resolved) */
  const file = (id: string, rawPath: string, asked: string | null) => {
    let rel: string; try { rel = rawPath.split("/").map(decodeURIComponent).join("/"); } catch { throw new SkillViewError("the file path is not valid", 400); }
    if (rel.startsWith("/") || rel.includes("\\") || rel.split("/").some((x) => x === ".." || x === ".")) throw new SkillViewError("a supporting file is a relative path inside the skill, with no ..", 400);
    const lib = o.skills.library().find((s) => s.id === id); if (!lib) throw new SkillViewError(`no skill ${id} in the library`, 404);
    const n = versionOf(asked, lib.current); if (!Number.isFinite(n)) throw new SkillViewError("version is a whole number", 400);
    return { id, version: n, ...o.skills.libFile(id, n, rel) };
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
    const vm = /^\/api\/skills\/([a-z0-9][a-z0-9-]{0,40})(?:\/files\/(.+))?$/.exec(p);
    if (vm && vm[1] !== "import" && !writing) {
      try { return json(vm[2] == null ? view(vm[1], url.searchParams.get("version")) : file(vm[1], vm[2], url.searchParams.get("version"))); }
      catch (e: any) { return e instanceof SkillViewError ? json({ error: e.message }, e.status) : json({ error: `the skill could not be read: ${String(e?.message ?? e).slice(0, 200)}` }, 500); }
    }
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
