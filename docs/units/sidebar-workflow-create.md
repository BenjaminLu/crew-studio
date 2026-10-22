# Sidebar controls and workflow creation

## What and why

On the approved 058 baseline, the sidebar footer's theme segment has an intrinsic width wider than its expanded inner column. Collapsed language labels can wrap vertically; they must remain readable in their bounded controls. Actual screenshots confirm the SVG icons and language labels remain present; they must remain accessible after the sizing repair. Narrow mobile layouts combine the footer with the workspace heading without a bounded responsive arrangement. Keep every action accessible; do not clip overflow or hide controls as the repair.

The Workflows list has no New workflow action. This is a missing native operation: the existing POST /api/wf/<id> calls save(), which rejects a new id. Introduce an explicit desktop create operation rather than implying the existing editor can already create definitions.

## Approved exact scope

- `public/styles.css`: constrain sidebar footer/segment children to their actual column; expanded equal flexible theme buttons; collapsed visible icon/language controls with bounded button widths; mobile footer arrangement that fits 320/390 with all actions retained.
- `public/runtime.js`, `public/runtime.css`: visible bilingual New workflow button on Workflows and a compact name/id modal, clear validation errors, cancel preserving state, successful navigation to the actual saved v1 editor and refreshed list. Reuse existing modal and form patterns.
- `src/runtime/defs.ts`, `src/runtime/index.ts`: explicit desktop POST /api/wf create, strict canonical id/name, atomically refuse existing/built-in id without overwriting, current authentication/CSRF and phone refusal unchanged. Create only a fixed safe starter: a captain confirmation card leading to a terminal hook. No agent, native handler, tools, capability, automatic dispatch or arbitrary JSON import. Existing save/version and pinned Task semantics remain unchanged.
- New `tests/native-workflow-create.ts`, new `tests/sidebar-workflow-create-ui.mjs`; existing `tests/backbone-ui.mjs` only if a grounded assertion requires updating. `package.json` aliases/main membership exactly once. `docs/units/sidebar-workflow-create.md`. Regenerate tracked `src/assets.gen.ts` / `src/bundled.gen.ts` from final source only if build requires changes.

## Provable done

Actual isolated native server/browser, not manufactured page JSON. Capture 320/390/1440, EN/zh, light/dark, expanded/collapsed where supported. All footer buttons have usable nonempty icon/label, accessible names, visible hit targets contained within sidebar/viewport, and no document horizontal overflow. Language/theme/gear actions still work. Show the New workflow button and modal at phone/desktop sizes. Enter a captain name/id, create through real authenticated API, open the saved graph, edit/save v2, preserve v1 and a Task's pinned version. Invalid/duplicate/built-in id and unauthorized/phone creation must create zero records and preserve prior bytes. Cancel creates nothing. The fixed starter does not dispatch itself. Retain actual 058 fail-first overflow rectangles and missing-create responses; no timeout inflation or geometry threshold relaxation.

The attempted live-browser bridge was unavailable; live UI was not observed. All product evidence will use the isolated actual server. The C4 self-update checkout is separately preserved and paused, with no managed restart completion claim.

## Deferred intake planner

The subsequent user correction requires LLM-first multi-workflow DAG planning, not a manual-only classifier repair. It is specified in the separate native-intake-planner unit. This immediate unit does not change Task intake or its provider policy.

## Current evidence and remaining verification

Actual isolated 058 baseline: 24 screenshots and rectangle metadata (320/390/1440 × EN/zh × light/dark × open/collapsed). Expanded desktop theme right edge 236.39 exceeds its sidebar right edge 232. An early measurement of collapsed width 78–89px was taken during the existing CSS transition; the settled original width is correctly 64px. The settled baseline also shows Chinese language text wrapped across two lines. The New workflow action is absent. The old actual native POST /api/wf returns 404 and creates no record (meaningful fail-first EXIT1).

Current native suite: 17/0 EXIT0, including fixed starter, localized saved Chinese labels, strict unknown-locale refusal, built-in/duplicate identity preservation, captain card wait, no auto-start, v1 bytes preserved after v2, existing Task v1 pin, phone refusal and one winner for duplicate create. Syntax and whitespace checks pass. Existing tracked privacy scan is 4/0 but new files remain unstaged and therefore are not represented by that scan.

The approval-system account failure was reported and work requiring escalation stopped. Root later supplied changed-auth evidence from a successfully reviewed worktree creation. Authorized isolated verification then resumed without changing auth/configuration or bypassing review.

Final implementation evidence collected:

- `/tmp/sidebar-workflow-create-ui-final.log/.exit`: actual matrix 188/0 EXIT0; 24 viewport/language/theme/sidebar cells, all footer controls contained/named/readable, settings/theme actions, actual create/editor/save-v2, cancel and pending duplicate click guards, unauthenticated HTTP refusal. Fresh 54 PNGs and `geometry.json` in `tests/out/sidebar-workflow-create/`: 24 list, 24 creation dialog, 6 saved editors.
- `/tmp/sidebar-workflow-create-final-build.log/.exit`: build EXIT0, binary25/0, standalone24/0, compiled pack helper19/0, native creation17/0. Regenerated tracked import manifests remain byte-identical; compiled assets embed current edited source.
- `/tmp/sidebar-workflow-create-backbone.log/.exit`: navigation/backbone51/0. `/tmp/sidebar-workflow-create-editor.log/.exit`: existing editor ownership73/0. These precede only the final footer nowrap declaration; editor/backend/event source bytes are identical, and the final 24-cell matrix plus rebuilt binary verifies the affected controls.
- Native creation17/0 includes selected Chinese metadata, unknown-locale refusal, no automatic Task start, exact v1 bytes and Task pin after v2, duplicate/built-in id protection and concurrent no-overwrite.

Preserved failed controls: old real create API404/no record EXIT1 `/tmp/sidebar-create-058-control.log/.exit`; original stable expanded footer overflow in `/tmp/sidebar-baseline-058-settled.json` with fresh 8 desktop screenshots. Original 24-cell screenshots remain separately retained. UI fixture7/1 attempts used pointer selection without the edit panel; the test now uses the editor's established documented keyboard Enter selection. UI160/4 measured the existing180ms column transition; it now awaits actual animation completion with unchanged64px threshold. No timeout inflation or geometry threshold weakening.

Staged privacy includes every new file and passes 4/0 EXIT0 (`/tmp/sidebar-workflow-create-privacy-final.log/.exit`); staged whitespace checks pass. The implementation is ready for clean freeze and independent code/designer review. Root owns full suite and integration; no live deployment or user record changes occurred. LLM planning and C4 self-update remain separate unfinished work.

## Blank-workflow connection editing follow-up

A real native pointer click on the starter's horizontal connection did not select it. The SVG captured every non-node/port press as a pan; only node pointerup explicitly restored selection. Existing tests used focus+Enter and therefore missed that pointer path. The horizontal SVG group's zero-height geometric box also prevented ordinary locator clicks.

The pan owner now remembers the pressed edge and selects it only on a non-drag owner release; dragging still pans. A bounded20-unit transparent midpoint target gives the same single accessible edge owner finite geometry without covering its full route. This is not a44px touch-target claim. The newly drawn edge receives focus, so immediate Delete works; deleting centrally clears its old inspector. Text editing does not dispatch graph deletion.

The existing view segment is visible beside the upper version/save controls as Overview/Edit graph. It is moved out of More rather than duplicated. The adjacent inspector names the connected steps and places a sticky Delete connection action before advanced fields. Existing keyboard selection, node/wire gestures, versions, saved Task semantics, validation and authorizations remain unchanged.

The existing sidebar UI command now follows actual creation→node addition→connection→native pointer selection→text-key safety→selected deletion→back-edge deletion→pan→keyboard selection/deletion→reconnection→save/reload, across320/390/1440 and English/Chinese. It preserves v2 while storing v3, checks that no Task starts, and asserts keyboard deletion removes its stale inspector. No API graph seeding, force click or synthetic pointer/drop replaces the user journey.

## Editor-session Undo and Redo

Undo/Redo is a bounded100-operation draft history, exposed beside the upper editing controls (and moved with the existing Save controls into a phone inspector). Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z redoes. Native text/select/contenteditable and composition handling retain browser ownership. The handler belongs only to the active editor, and ignores modal/viewer interactions.

The history contains editable nodes, edges, roles and graph layout, never saved version identity, approvals or Task/run state. A completed drag is one operation; cancelled gestures restore local coordinates without writing layout or adding history. Text edits in one focus session coalesce; discrete selections remain separate operations. New edits clear Redo. Saving, opening a version or reloading starts a new history checkpoint, stated in the UI. History controls are unavailable while Save is pending, while later ordinary edits remain possible under the existing draft-ownership rules.

Per-version position writes are serialized with immutable version/coordinate snapshots. Undo queues a compensating write after earlier moves. Only acknowledged writes update the matching saved base. Save waits for its existing layout queue, captures its own content snapshot, and preserves later draft edits after the response. A late old-version layout acknowledgment cannot overwrite a newer saved version or its status. Failed position writes remain visibly failed and Save retries them before creating a version.

The existing creation UI command now exercises native Undo/Redo across all six creation journeys, plus real delayed layout compensation, Redo invalidation, native input Undo, edge conditions, model/effort changes, removal/restoration and navigation boundaries. The ownership command adds genuine held-layout A→Save→drag B→Save acknowledgment→late B acknowledgment→Save/reload ordering, cancelled-touch zero-write checks and an explicit position-write refusal/retry. Transport controls hold genuine responses; no successful backend result is fabricated.

## Single-node deletion and disconnected-step visibility

Removing one node removes only that exact ID and its incident edges. Previously Overview then projected only the entry-to-end path: disconnected downstream steps still existed in the editable definition but silently disappeared from the canvas. Edit graph exposed the surviving nodes, so the screen looked like a cascading deletion even though the data was retained.

Editable Overview now represents all actual steps and connections from the outset, using compact layout without the run's main-path projection. Removing a node cannot promote a previously hidden close branch into the editing view: the visible ID set changes only by that node. Actual node/settings objects and non-incident edge objects remain unchanged; no node or reconnecting edge is added. Original parallel conditions/checks and loop/back/self-edge indices are retained. Collapsed stage members retain their explicit expandable representation. Run Overview keeps its existing folded projection and badges. Compact wrapping can send a back-edge bus in either horizontal direction; its obstacle bounds include every source and destination channel endpoint, preserving node positions and actual connection data while keeping the arc off unrelated nodes. Empty editor graphs have finite geometry and remain undoable.

The existing creation E2E constructs a four-node graph through UI, gives two steps the same label, and deletes entry/middle/terminal nodes in both views. It compares exact surviving objects and incident edges, verifies surviving nodes are inside the canvas and individually selectable, and checks exact Undo/Redo restoration. Keyboard deletion and deleting through the final node are included. Geometry properties delete every node in the existing nine bundled/two retained-fixture catalog and require exact surviving projected IDs and original edge indices, with separate fork, isolated cycle/loop, parallel-edge and collapsed-stage controls. Existing close-branch UI cases compare exact definition objects and projected IDs before/after deletion; old run loop/escalation badge assertions remain in the run view. These projection checks do not claim complete agent execution of all20 workflows.
