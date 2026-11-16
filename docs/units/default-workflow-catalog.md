# Keep the default workflow catalog useful

Stop seeding refine-demo (unimplemented draft mode) and trivial-lane (README banner demonstration) by default. Hide unchanged retired built-ins already on disk without deleting definitions, pinned tasks, history or captain-edited versions. Keep internal Firstmate proposal, registration and staffing workflows installed for engine-owned tools but out of public workflow selection and creation.

One source-owned catalog policy must govern the UI list, keyword classification, Firstmate's list/proposal admission and public task creation. Exact historical workflow reads remain available. Captain-authored seed-null definitions, including copies using a retired demo ID, remain selectable. Hidden definitions show a read-only start explanation rather than a misleading Start button. No paid model/browser account operation is needed.

Scope: src/runtime/defs.ts; src/runtime/index.ts; src/firstmate.ts; public/runtime.js; tests/default-workflow-catalog.ts; tests/default-workflow-catalog-ui.mjs; tests/non-code-workflows.ts (explicit lane fixture); tests/graph-tidy-ui.mjs (exact public catalog plus explicit fixture expectation only); package.json; this document.

Raw demo definitions remain in source for explicit tests and historical compatibility. Their presence is not a claim that the default product offers those demos. All remaining workflow catalog entries still require separate real-account end-to-end verification; this cleanup proves selection and preservation only.

Personal workflows whose immutable origin is `starter` or `firstmate-draft` offer “Move to Trash” from the workflow list and editor. An explicit confirmation moves only their catalog state; Trash provides a confirmed Restore action. `trash.json` is a recoverable tombstone with an increasing revision. Both operations compare the latest saved version and tombstone revision under the same lock as version saves. Built-ins and internal workflows cannot be trashed.

Trashed workflows stay readable at every saved version and existing pinned Tasks continue. They leave the public/default selection catalog, Start form and Firstmate proposals, and cannot start a new Task or save another version until restored. The desktop session guard governs Trash mutations; phone writes are refused. No saved version or Task is deleted. `test:workflow-trash` verifies preservation, admission refusals and the real list/editor confirmation and restore journeys.

## Internal workflows shown read-only

One internal workflow is shown on the Workflows page: `pr-follow`, the Pull requests page's follow-through
(`VISIBLE_INTERNAL` in `src/runtime/defs.ts`; every other internal workflow stays hidden). `GET /api/wf` lists it under
`internal`, apart from `workflows` (the startable catalog), `held` and `trash`, with what Studio says about it (`about`:
where it is started, whether that is on, and its branches, from `RuntimeDeps.internalAbout`). The page shows its card
under "Built in and started by Studio itself" with no Rename or Trash, and its page (`#/workflows/pr-follow`, or any
internal workflow opened by its address) is read-only: the graph in the Task page's viewer, no palette, Save, Tidy, Run
or Start, and for pr-follow the branch table and a link to the Pull requests page.

It stays internal. It is never selectable (no Start form, Firstmate proposal, CLI grant or peer take), never held, and
every write is refused: `POST /api/wf/<id>` and `/layout` (409 `workflow_internal`), a package export (it would adopt as a startable copy), a rename, a copy and Trash. The
same refusal is in `WorkflowDefs.save`, `setLayout` and `rename`, so no other caller edits an internal workflow either.
Studio itself still starts pr-follow Tasks (`engine.start`). `test:internal-workflow-visible` covers the list, the
read-only page, every refusal and the hidden internal workflows.
