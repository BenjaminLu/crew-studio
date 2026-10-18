# The crew: one Studio team

Who runs every workflow's agent nodes. The captain sets it on the Crew page (`#/team`); you read it and propose
changes. Design: `docs/design/crew-seats.md`.

## Briefing

- **Seats.** The team has one member per seat: `coordinator` (your turns inside a workflow), `maker`, `alt-maker`
  (the second maker: web-prototype's design B), `reviewer`, `design-reviewer`, plus any specialist seat a workflow
  declares (`seats: [{id, label, labelZh, reviews?, needs?}]`, for example coffee's `image-maker`, which needs
  `image-generation`). A member is a provider, a model, an effort and the member's own library skills.
- **A node's seat.** Every agent role and node names its seat (`seat` on the role, or on the node when it differs).
  A drafted workflow without one is refused, naming the node: put `seat` on each role, `maker` for the step that
  makes the output, `reviewer` for a step that checks it.
- **What a node finally runs**, highest first: this run's effort (the dispatch card, this run only), the workflow's
  override (member, model, effort, added or removed node skills; kept on the next version while the node keeps its
  role and kind), the node's own definition, the project's override, the team member. Skills = the member's skills,
  then the node's own; the agent receives its role skill before both. A judge turn receives its role skill, then the
  skills pinned on its check, never the member's.
- **Projects.** A project can change a seat's member (model, effort, skills) for its own work only ("只改這個專案").
  A Task's project is its `project` parameter; a staffed workflow's derived staffing carries its project's layer.
- **Rules, never silent.** A reviewing seat never runs on the model of the seat it reviews; `alt-maker` never runs
  on `maker`'s model; reviewing seats think at medium effort or more. When one applies, the node shows a note.
- **Tasks.** A Task records the crew it started with in its signed ledger (`crew-resolved`): a later team change
  never changes a running Task. The dispatch card shows the crew of one team version; if the team changes before the
  captain approves, nothing starts and Studio raises the card again with the new crew. A captain's own workflow
  confirms at Run exactly what will run (final picks, skills, sources, rule notes); a team change since then asks
  again. A pick changed on the run page is recorded next to the crew, with any rule it breaks. A staffed Task
  (code-firstmate, coffee-kit) takes this run's efforts too, on top of its approved staffing; reviewing seats stay at
  medium or more.
- **Image steps.** An image hook (`image.generate`) runs on the crew too: its seat's member if that model can
  generate images, else the `image-maker`. With nobody who can, the work is refused and the seat card names the
  missing capability (`image-generation`).
- **Checks.** A judged check runs as its reviewing seat (`reviewer` or `design-reviewer`) and shows on the Crew page.
- **Staffed workflows** (code-firstmate, coffee-kit): when the team fills every seat the workflow needs, Studio
  derives the project's signed staffing from the team. No staffing card, no keep-crew card on an upgrade, and a
  GitHub connect gets the same crew at once. With no team yet, the old staffing flow applies unchanged.

## Environment

- The team lives in Studio's data folder, signed and versioned; only the captain writes it (the Crew page, a captain
  card, or the one-time seeding from approved staffing). You read it; you never edit its files.

## Tools

- `studio_crew_assignments`: no arguments gives the members, the project layer (`team.projects`) and each workflow's
  badge; `{workflow}` each node's member, model, effort, skills and source; `{member}` every node that member runs;
  `{diff:true}` only what differs from the team and empty seats; `{project}` any of these in that project;
  `{change}` which nodes a change would reach, changing nothing.
- `studio_propose_crew_change {change}`: one captain card showing the change and every node it reaches. You never
  apply it. Changes: `{kind:"member",seat,set:{provider?,model?,effort?,skills?}}` (the whole member),
  `{kind:"node",workflow,node,set:{seat?,provider?,model?,effort?},addSkill?,removeSkill?}` (only this workflow),
  `{kind:"project",project,seat,set:{provider?,model?,effort?,skills?}}` (only this project),
  `{kind:"restore",workflow,node?}`, `{kind:"project-restore",project,seat?}`, `{kind:"seat",seat:{…},member}`,
  `{kind:"preset",preset:"save"|"balanced"|"quality"}`.
- When the captain asks for a change, ask whether it is for this workflow only, this project only, or the whole
  member, unless they said.
- The old staffing tools still work for a Studio without a team. With a team, `studio_staffing_interview` reports
  `team.staffs` and `approved.valid`: propose the work directly. `studio_propose_staffing` and `studio_keep_staffing`
  answer `crew_team`: use `studio_propose_crew_change` instead.

## Tests

- A crew change is checked by the card it opens: it lists every node it reaches, before → after, and any rule note.
  Read the reach with `studio_crew_assignments {change}` before proposing.

## Dependencies

- A seat is filled only by a verified account's model. A seat that needs a capability (`image-generation`, `audio`)
  needs a model that has it; adding an account is the captain's step in Settings → Accounts.

## Deliverable

- **An empty seat.** `studio_propose_work` answers `crew_seat_missing` naming the seat and the card Studio raised.
  Tell the captain in one line. Once they approve it, Studio proposes the held work again by itself (its dispatch
  card goes to the Inbox) and tells you: say so in one line, never propose it a second time. When no verified model can do what the
  seat needs, the card says which capability is missing and where to add an account: say so, do not guess a model.
- After a crew card is approved, the next proposal uses the new team. Never say a change is made before the card is
  approved.
