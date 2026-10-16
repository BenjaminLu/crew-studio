# Projects in the sidebar (phase 1)

Read only. It adds no new authority.

## Routes

- `GET /api/projects/overview` returns the sidebar: each registered project and the Studio row (Tasks in no registered project).
- `GET /api/projects/<id>/overview` returns one project's page. `<id>` may be `studio`.
- Code: `src/project-overview.ts`, `public/projects.js`, `public/projects.css`.

## Who can read

- A desktop request needs Studio's session (cookie or `x-crew-session`); without it the reply is 401.
- A paired phone reads, as it reads Tasks.
- **A phone receives local paths by design**: the project's `path` and each worktree `path` are in the page payload, so the
  page can show and copy them. Nothing else about the Mac's file system is sent, and no exception text is ever sent: a
  section or tile that cannot be read says so in fixed words (en / zh-TW).

## What the page reads

- The registry: the strict reader (never the migrating one).
- Git: refs read as files, as `staffingIdentity` reads them; git is never run. `.crew/gates.json` is read size-capped, without following links.
- Crew: the real `staffingIdentity`, the same check dispatch runs. When it refuses because another registration's folder is
  missing or broken (checked read-only: the folder, its `.git`, a `gitdir:` file's directory, `commondir`), the Crew tile
  says "No task can start" and names that registration by id, never by path.
- No cost fields.

## Writes

Only the existing sensitive-path routes (propose, approve, decline). Cards, crew changes and the Tasks list are links.
