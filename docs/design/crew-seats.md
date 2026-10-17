# Crew seats: one Studio team, every workflow staffed from it

Status: approved by the captain (UX option C). Code: `src/domain/crew.ts`, `src/crew-routes.ts`, `public/team.js`.

## Problem

Staffing applied only to `code` and `coffee-kit` (`staffingApplies`), per project and per workflow version. Web, document,
image and video agents ran on one default model with no captain choice (R-071: design-a and design-b both on the same
Codex model). Every project × workflow version needed its own staffing card, an upgrade raised a keep-crew card, a
GitHub connect orphaned the approval (H2/H3), and nothing showed who finally runs each node or which skills it carries.

## Model

- **Team** (one, Studio-wide; a per-project override can be added later). Seats → member
  `{provider, model, effort, skills[]}`; the member's skills are library skills pinned `{id, v, sha256}` and go with the
  member everywhere. Built-in seats: `coordinator` (Firstmate's turns in a workflow), `maker`, `alt-maker`, `reviewer`,
  `design-reviewer`. Specialist seats are declared by a workflow: `{id, label, labelZh, reviews?, needs?, suggest?}`.
- **Seat of a node.** `node.seat`, else its role's `seat`, else a fallback by role id. Every built-in agent role has one
  (web-prototype design-b → `alt-maker`; reviewers → `reviewer`; designer reviews → `design-reviewer`).
- **Skills of a node** = member skills (read-only on the node) + the node's own skills (pinned, as before), minus the
  node skills a workflow override removed, plus those it added. The team never removes a node skill.
- **Resolution** per node: run override (dispatch card: effort only, this run only) > workflow override (seat, provider,
  model, effort, added/removed node skills; kept on the next version while the node's role and kind are unchanged) >
  the node's definition (provider/model/effort written on the node) > team seat. Result per node:
  `{seat, provider, model, effort, skills, source, notes}`.
- **Rules** (applied at resolution, deterministic, each with a note — never silent): a reviewing seat does not use the
  model of the seat it reviews; `alt-maker` ≠ `maker`; reviewing seats run at medium effort or more. The replacement
  model is the first other team member whose model differs; with none, the note says the review is not independent.

## Authority and ledger

- `CrewStore` (`data/crew/`): versioned team files, an HMAC-signed `current.json` pointer (same ledger key as staffing),
  compare-and-swap on the previous hash. Writes come from the captain only: the Crew page (desktop session), a captain
  answer on a crew card, or the one-time migration. Firstmate proposes; it never writes.
- Non-staffed workflows: a Task start resolves the crew and records `crew-resolved` (team hash, per-node provider,
  model, effort, skills with pins, source, notes) in the signed run ledger; the engine's `approvedPick` /
  `approvedNodePins` read that record, so a later team edit never changes a running Task.
- Staffed workflows (code, coffee-kit): the signed staffing binding stays. When the team covers every role, Studio
  writes the project's staffing version derived from the team (`crew: {team}` in the draft, approval cites the team
  version). The staffing guard re-derives it from the signed team version and refuses any difference; role skill pins,
  hashes and CAS are unchanged. No team → the old per-project staffing flow, unchanged.

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
"+ skill" from the library; source column). Each model/effort change asks "only this workflow" or "the whole member
(affects N nodes)". Restore to team. The member legend opens the member editor (model, effort, own skills; presets
省錢 / 均衡 / 品質).

## Firstmate

`studio_crew_assignments` (read: by workflow, by member, diff vs team, impact of a hypothetical change) and
`studio_propose_crew_change` (opens a captain card; never applies). The skill stays short; detail in the manual.

## Migration

The most recent approved code-firstmate staffing seeds the team; other approved workflows whose picks differ become
workflow overrides. Idempotent (a marker plus a hash check); tested on fixture copies only.

## Deferred

Per-project team override; run override for staffed (code/coffee) Tasks; image hook nodes (the dedicated image adapter
keeps its own Codex choice).
