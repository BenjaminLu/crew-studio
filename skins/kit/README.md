# Crew Studio skin compatibility kit

A skin is a folder with `manifest.json` and an HTML entry. Studio installs it
by copying it and pinning every file by sha256; a file that changes later is
refused. Installed skins must be reinstalled; built-ins are pinned at server
startup and require a restart after source edits.

## manifest.json

```json
{ "id": "my-skin", "name": "My skin", "version": "1.0.0", "entry": "index.html",
  "description": "…", "permissions": ["snapshot.tasks", "snapshot.crew", "snapshot.pending", "snapshot.flow", "events", "openCard"],
  "network": [] }
```

- `permissions` choose what the snapshot carries and whether events and
  `openCard` are allowed. Nothing else exists: a skin cannot answer a card,
  dispatch, merge or write anything.
- `network` is empty by default: the skin has no network at all (CSP
  `connect-src 'none'`, `img-src 'self' data:`). Origins listed here are allowed
  only when the captain grants them at install.

## The API

Load `/skin/_kit/skin-kit.js` and use `CrewSkin.onSnapshot`, `CrewSkin.onEvent`,
`CrewSkin.openCard(id)` and `CrewSkin.ready()` (call it once you have drawn).
A skin that never calls `ready()` within 5 seconds is closed and Studio returns
to pro mode.

## Rules the checker enforces (Skins → Check)

1. The manifest parses and names an existing entry.
2. Every file still matches its pinned sha256.
3. No file references the network (`http://`, `https://`, `//host`), unless listed and granted.
4. The entry references the kit and its HTML/JS contains `CrewSkin.ready()`
   (a static presence check, not proof that it executes).
5. Only known permissions.

## Pro mode always works

The skin runs below Studio's own bar, in an iframe it cannot leave. The
"Pro mode" button, the Escape key, and opening `/#/pro` always switch back.

## Snapshot contract and lifecycle

- Snapshots replace the current view; events are a bounded notification stream,
  not a complete task history. Reconcile removals and terminal states on every snapshot.
- `tasks` (at most 80): `id`, optional `rootTask`, `title`, `status`, `node`,
  `door`, `round`, `pr`, `lastTs`. Native `waiting` becomes `needs-you`, except a task whose agent question
  waits for Firstmate's answer: it stays `running` with `waitingOn: "firstmate"`;
  native `succeeded` and `cancelled` become `done`; `failed` remains `failed`.
  Do not infer success from `done`, or infer a live worker from task status.
- `crew` (at most 60): `name`, `role`, `task`, `alive`, `activity` (text or null).
  These are projected task workers, not every interactive Firstmate session.
- `pending`: `id`, `title`, `kind`, `task`. `openCard` only accepts a card in the
  host's current pending snapshot and opens it in pro mode; it never answers it.
- `flow`: `{nodes, edges}` or null. Without the relevant permission, task/crew/card
  arrays are empty and flow is null. Fields may be absent; use safe fallbacks.
- `permissions`, `at`, and host-added `lang` and `theme` accompany snapshots.
- Events expose only `seq`, `ts`, `type`, `task`, optional `actor`, `summary`.
  Private outcome payloads, run context, credentials and model configuration are
  not part of this API. Do not guess review outcomes from missing payloads.
- `CrewSkin.snapshot` reads the latest delivered snapshot. Registering
  `onSnapshot` also immediately receives that snapshot if one exists.

## Porting Captain (worked example)

- Source adapter: `scripts/captain-adapter.js`; import/build script:
  `scripts/import-captain.py`; output: `skins/captain/`. Keep upstream attribution
  in `ORIGIN.txt` and `LICENSE.txt`. Change the adapter/import script and rebuild;
  do not hand-edit the minified bundle or modify the upstream checkout.
- Build with an already installed esbuild:
  `ESBUILD=/absolute/path/to/esbuild python3 scripts/import-captain.py /path/to/firstmate-workflow`.
  The script copies renderer sources to a temporary directory and bundles local
  assets. It removes upstream write transport and external links. No CDN, direct
  Studio API polling, parent globals or upstream board mutation is needed.
- Captain requests tasks, crew, pending, events and openCard; it does not request
  flow. Group active child tasks by `rootTask || id` for one Firstmate per root.
  A completed proposal may identify a still-active child; it is not itself work.
- Terminal tasks (`done`, `succeeded`, `failed`, `cancelled`, `merged`, `closed`,
  `parked`) leave the deck. Stale cards/workers must not resurrect them. A failed
  child must not leave its completed proposal on deck or create a persistent
  kraken. Keep historical errors in Studio's task view. This is Captain's display
  policy, not a state change or deletion in the engine.
- Use task IDs for compact canvas pennants. Keep task descriptions in bounded,
  wrapping details. Clip unfocused accessibility controls to a 1px region rather
  than moving them a fixed distance offscreen; focused controls must be visible.
- Preserve keyboard focus across repeated snapshots. Pending input bubbles follow
  the relevant Firstmate and call only `CrewSkin.openCard(id)`.

## Updating and verifying a skin

- Installed skins: reinstall through Skins after changing their source folder.
  Built-in skins: hashes are pinned when Studio starts; restart the source server
  after edits. A compiled binary also needs rebuilding before restart. A stale
  pin returns HTTP 409; do not bypass the pin check.
- The compatibility checker is static: it checks manifest/entry, pins, known
  permissions, URL references, and the presence of the kit and ready call in
  HTML/JS. It does not execute the renderer or prove layout/lifecycle correctness.
  Its URL scan is not a security audit; the iframe sandbox and CSP enforce runtime
  restrictions. A network grant affects `connect-src`, not remote images/fonts/scripts.
- Browser acceptance must cover: initial ready, empty snapshot, active tasks,
  grouped parent/children, pending-card opening, terminal-task removal, stale
  events/cards, reload/restart, long labels, narrow screens, keyboard focus and
  returning to pro mode. Check actual rendering as well as DOM state.
- Captain focused checks: `node tests/captain-labels.mjs`,
  `bun tests/skins-native.ts`; `tests/captain-ui.mjs` contains renderer integration
  coverage. Static checks alone do not establish that these browser cases passed.
