# Crew seats: one Studio team, every workflow staffed from it

Status: approved by the captain (UX option C). Code: `src/domain/crew.ts`, `src/crew-routes.ts`, `public/team.js`.

## Problem

Staffing applied only to `code` and `coffee-kit` (`staffingApplies`), per project and per workflow version. Web, document,
image and video agents ran on one default model with no captain choice (R-071: design-a and design-b both on the same
Codex model). Every project × workflow version needed its own staffing card, an upgrade raised a keep-crew card, a
GitHub connect orphaned the approval (H2/H3), and nothing showed who finally runs each node or which skills it carries.

## Model

- **Team** (one, Studio-wide). Seats → member
  `{provider, model, effort, skills[]}`; the member's skills are library skills pinned `{id, v, sha256}` and go with the
  member everywhere. Built-in seats: `coordinator` (Firstmate's turns in a workflow), `maker`, `alt-maker`, `reviewer`,
  `design-reviewer`. Specialist seats are declared by a workflow: `{id, label, labelZh, reviews?, needs?, suggest?}`.
- **Image hooks.** An `image.generate` hook is a crew slot: its seat is `node.seat`, else its role's, else
  `image-maker`, and it needs `image-generation`. It runs its seat's member when that model can generate images, else
  the `image-maker` member (with a note); with neither, `image-maker` is missing (the seat card names the capability).
  The Task records the hook's pick in `crew-resolved`; the image adapter runs that model and effort (no team: its own
  Codex choice, as before). Coffee's image step already runs its signed staffing's `image-worker`, which the team
  derives from `image-maker`.
- **Seat of a node.** `node.seat`, else its role's `seat`, else a fallback by role id. Every built-in agent role has one
  (web-prototype design-b → `alt-maker`; reviewers → `reviewer`; designer reviews → `design-reviewer`).
- **Skills of a node** = member skills (read-only on the node) + the node's own skills (pinned, as before), minus the
  node skills a workflow override removed, plus those it added. The team never removes a node skill.
- **Project override** ("only this project"): per project, per seat, any of provider, model, effort, skills — the
  seat's member as that project sees it. Kept in the signed team (`projects`, absent while empty, so older team hashes
  stay valid); it changes only a seat the team fills, and never leaves a seat without a capability it needs (an image
  maker that cannot generate images is refused). A Task's project is its `project` parameter (a staffed
  workflow's: its staffing project id).
- **Resolution** per node: run override (dispatch card: effort only, this run only) > workflow override (seat, provider,
  model, effort, added/removed node skills; kept on the next version while the node's role and kind are unchanged) >
  the node's definition (provider/model/effort written on the node) > project override > team seat. The rules read
  the project's members. Result per node:
  `{seat, provider, model, effort, skills, source, notes}`.
- **Rules** (applied at resolution, deterministic, each with a note — never silent): a reviewing seat does not use the
  model of the seat it reviews; `alt-maker` ≠ `maker`; reviewing seats run at medium effort or more. The replacement
  model is the first other team member whose model differs; with none, the note says the review is not independent.

## Authority and ledger

- `CrewStore` (`data/crew/`): versioned team files, an HMAC-signed `current.json` pointer (same ledger key as staffing),
  compare-and-swap on the previous hash. Writes come from the captain only: the Crew page (desktop session), a captain
  answer on a crew card, or the one-time migration. Firstmate proposes; it never writes.
- Non-staffed workflows: a Task start resolves the crew (in its project) and records `crew-resolved` (team hash, project, per-node provider,
  model, effort, skills with pins, source, notes) in the signed run ledger; the engine's `approvedPick` /
  `approvedNodePins` read that record, so a later team edit never changes a running Task.
- Staffed workflows (code, coffee-kit): the signed staffing binding stays. When the team covers every role, Studio
  writes the project's staffing version derived from the team and that project's layer (`crew: {team}` in the draft, approval cites the team
  version). The staffing guard re-derives it from the signed team version and refuses any difference; role skill pins,
  hashes and CAS are unchanged. No team → the old per-project staffing flow, unchanged.
- Run override on a staffed Task: the dispatch card offers each node's effort for this run, like any workflow. The
  child Task carries `_crewRun`; at start Studio requires it to equal the captain's signed `card-answer` on that
  proposal's dispatch card, the proposal to be a `firstmate-proposal` for this workflow, version and definition, and no
  other Task to carry that proposal (else refused; a caller's `_` params never pass the Task API), records `crew-run-effort` (efforts, staffing hash, card) in the Task's
  ledger, and the staffed pick takes that effort for the node's own turns (judge turns and the signed staffing are
  untouched). Reviewing seats are offered, and run at, medium or more.

- What the captain approves is what runs: the dispatch card carries the team version it showed (`_crewTeam`); a team
  change before the start refuses it and raises the card again. A captain's own workflow confirms the full resolution
  at Run (`_ownStaffing` hashes it, team version included). A crew-derived staffing version cites the team's own
  approval (its crew card, or the team version for a page edit or the seed), never another project's card.
- Judged checks occupy their reviewing seat: resolved, recorded and shown like nodes.

## Cards (only these)

1. A workflow needs a seat the team has not filled (incl. a specialist): one card, suggestion filtered by the model
   capability tags the seat needs; with none qualifying, the card names the missing capability and where to add an
   account.
2. A workflow upgrade adds a role whose seat is unfilled (same card). Unchanged roles carry over without a card.
3. A Firstmate draft whose agent node has no seat is refused, naming the node.

No per-project staffing card when the team covers the workflow, no keep-crew card when roles are unchanged.

## Crew page (option C)

`#/team`: workflow cards (mini pipeline, member colour dots, ★ custom, red missing; badge 跟團隊 / N 項自訂 / 缺人) and
the selected workflow's editable table (member, model, effort, skills: member skills grey, node skills removable,
"+ skill" from the library; source column). A project selector shows one project's crew. Each model/effort change asks
"only this workflow", "the whole member (affects N nodes)" or, with a project selected, "只改這個專案"; a project can be
restored to the team. Restore to team. The member legend opens the member editor (model, effort, own skills; presets
省錢 / 均衡 / 品質).

## Firstmate

`studio_crew_assignments` (read: by workflow, by member, diff vs team, the project layer, any of these in one project,
impact of a hypothetical change) and `studio_propose_crew_change` (opens a captain card; never applies; can target a
project: `{kind:"project",project,seat,set}`, `{kind:"project-restore",project,seat?}`). The skill stays short; detail in the manual.

## Migration

The most recent approved code-firstmate staffing seeds the team; other approved workflows whose picks differ become
workflow overrides. Idempotent (a Studio that has a team is never touched); tested on fixture copies only.
`CREW_TEAM_SEED=0` skips the seeding: per-project staffing stays as it was until the captain sets up a team.
