# Milestones M6, door/gates, M7, M8, M4/M5: done lines (retroactive, for review)

These units shipped before the adversarial review rule (architecture.md section 11). Each unit is reviewed against these lines.

## M6 self-improvement (27e1b39)
1. Chat-driven skill edits for any workflow role's worker or reviewer skill, not only firstmate's.
2. Every proposed edit runs replay evals on recorded tasks before it is offered, and shows before and after.
3. Retro: triggers, metrics from the event log, a report viewer, and proposal cards with the expected metric and its eval. A rejected proposal is never re-proposed. Before/after is tracked after adoption.
4. A retro over firstmate's last 2 weeks (read-only) surfaces: a test file over the 1200-line cap repeating, CI shard overruns, a round killed at the ~3600 s cap, and a brief bound to the wrong round. A class not provable from the data is labelled as inferred.

## Door and gates (1a5044f)
1. A classifier sorts each change into one-way or two-way risk tiers from sensitive path lists per project, with org defaults.
2. Configurable deterministic script gates per workflow node, with a worker/reviewer cycle and a round cap.
3. The door and the gate results show on cards and in the workflow view. A one-way merge needs an explicit confirmation.

## M7 domain packs (5ed45f8)
1. Pack format: manifest, skills, gates, artifact types, workflow templates. Packs are hash-pinned, and a tampered pack is refused.
2. Workflow genesis drafts a pack plus its evals from a chat description.
3. The file-organization pack has a dry-run plan, review, apply with an undo log, and refuses firstmate's directories.

## M8 documents (4ac85eb)
1. Draft, annotate, revise and approve documents, reusing the M3 annotation loop.
2. Export to md and html, and to docx and pdf without external dependencies. A known limit (CJK in pdf) is shown to the user.

## M4/M5 skins (b9e878d)
1. Skin API: a read-only snapshot and event hooks. A skin can request a card to open, and can never answer one.
2. A sandboxed iframe with no network by default, manifest permissions and hash-pinned installs.
3. The Voyage skin and a terminal skin, plus a compatibility kit. Switching back to pro mode always works (button, Esc, /#/pro).

## All units
- No real company, product or person names in seed or demo data. Never modifies firstmate. Light and dark, 1440 and 390 px.
