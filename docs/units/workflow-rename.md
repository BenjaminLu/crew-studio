# Workflow rename: a display name kept apart from the definition

## What and why

The captain asked: "code-firstmate 改名成 coding，workflow 都要可以改名。" Two things:

1. The built-in workflow `code-firstmate` is shown as **coding**.
2. Every workflow (built-in, pack and the captain's own) can be renamed from the UI.

A rename cannot edit the definition's `name`. A crew approval is signed over `staffingHash(def)`
(src/domain/staffing.ts), the hash of the whole canonical definition, so a changed `name` would invalidate every approved
crew of that workflow, the pinned definitions (src/issue-triage-workflow.ts), the Tasks kept on an earlier definition,
and every export and package. The id `code-firstmate` is also referenced by code, Firstmate's tools, tests and docs.
So no workflow id and no definition `name` changes. A rename is a **display name**, stored by Studio beside the
definitions.

## How

- **Store.** `data/workflow-names.json` (src/runtime/workflow-names.ts): `{ schema: 1, names: { <id>: { name, by, at } } }`,
  written atomically (`writeAtomic`) under a lock. A name is trimmed, 1–80 characters, with no control characters or
  bidirectional overrides; the page renders it as a text node only. A blank name or Reset removes the rename. A name
  equal to the shipped default keeps no rename. An unreadable file shows the defaults and refuses renames, so a rename
  never overwrites what the captain had.
- **Default.** `DEFAULT_DISPLAY_NAMES` in the same file ships `code-firstmate` → `coding`: a fresh Studio shows "coding".
  The captain can still rename it (even back to "code-firstmate") or reset it to "coding".
- **Serving.** `WorkflowDefs.displayName(id)` and `names.map()` are the one server-side source. `/api/wf` lists each
  workflow with `displayName` and `renamed` beside its definition's `name`, plus `names` (id → display name);
  `/api/wf/<id>` returns `displayName`, `renamed` and `defaultName` **beside** `def`, never inside it, because the editor
  saves `def` back. The Crew page's workflows carry `displayName`. Firstmate's `studio_list_workflows` gives the display
  name as `name` (the id stays `id`) and `studio_work_status` gives each Task's `workflowName`.
- **Rename.** `POST /api/workflow-names {workflow, name}` (blank or null resets). Desktop captain only, behind the same
  session and origin gate as the other workflow edits; the phone and any other caller get 403. Each rename and reset is
  recorded in the Studio event log as `workflow_renamed` with the captain, the name before and after.
- **Board.** `public/app.js` keeps the id → display name map (`wfName(id, fallback)`), read at load, from `/api/wf`, and
  again when another tab's rename arrives on the event stream. The Workflows list, the editor header, the Start form,
  the Runs list, a Task page, the Board's task rows, the Inbox, cards, the project page's crew ("coding v12"), the Crew
  page and the staffing picker all show it. Workflows list cards and the editor header have **Rename / 改名**, a dialog
  with Save and, when renamed, **Reset to default / 恢復預設名稱**.

## What does not change

- No definition version is written and no saved byte changes; `staffingHash`, approvals, pinned definitions, the
  Tasks' own copies, workflow ids and every hash or signature read the definition as saved.
- **Exports and packages keep the definition's own name.** A display name is local to this Studio: exporting
  `code-firstmate` still says `"name": "code-firstmate"`, and importing it elsewhere shows that Studio's own name for it.
- A Task's title and its "started" event keep the text they were written with.
- The operating manual, Firstmate's tools and docs keep using the id `code-firstmate` wherever an id is meant.

## Tests

- `tests/workflow-rename.ts`: fresh Studio shows coding (list, editor, Firstmate); rename persists across a store
  restart and shows in the list, the editor and Firstmate's tools; reset and blank; validation (length, NUL, tab,
  newline, bidi, non-text); unknown id; phone and non-desktop refused; ledger events; staffing hash, saved versions and
  the export unchanged; an unreadable file is kept.
- `tests/board-start.ts`: a renamed code-firstmate keeps its approved crew on the Start form.
- `tests/workflow-rename-ui.mjs`: real server and Chromium, list and editor rename, reset, inline refusal, markup shown
  as text, the Start form and a Task page, zh-TW at 390px, unauthenticated rename refused.
