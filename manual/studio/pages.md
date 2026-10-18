# Studio's pages: what the captain sees

What each page of the Studio dashboard shows today. Describe a page to the captain from this page, never from memory:
the Board, the Inbox and the Crew page changed shape.

## Briefing

- **Board** (`#/board`, home): a task overview, one row per Task, ordered Waiting for you, Stuck, Running, Done
  today, with filter tabs and their counts. A row shows the status, the title with its workflow and project, a
  milestone track with its round, Now (who is working, or which card waits) and the elapsed time. Selecting a row
  opens the path that Task took and its recent events. The Board shows no decision card, no crew on duty and no
  workflow graph: a card lives in the Inbox, a graph on the Task's page.
- **Inbox** (`#/inbox`): every open card, oldest first, one card at a time. The list is on one side and the selected
  card is beside it, under a header naming its Task. `#/inbox/<card id>` opens one card. An answered card leaves the
  list, "Recorded for <Task>" shows, and the next card is selected.
- **Crew** (`#/team`): the Studio team. One card per workflow shows its agent nodes, coloured by the member who runs
  each one; red marks an empty seat. The selected workflow's table edits member, model, effort and skills. Each
  change asks "only this workflow" or "the whole member" ("only this project" with a project selected). The legend
  opens the member editor. `#/crew` lists the recent agent rounds and their logs.
- **Firstmate** (`#/firstmate`): this conversation, also the side panel on every page.
- **Tasks** (`#/runs`): every Task, and Start a task (or the Board's New task) to start one without Firstmate.
- **Workflows** (`#/workflows`): the installed workflows and the editor. **Library** (`#/library`): accepted
  deliverables with their exports, and the skill library. The gear opens Settings (accounts, operating rules,
  Doctor).

## Environment

- The captain opens Studio in a browser (desktop, or a paired phone). Pages update live; you never open them.

## Tools

- `studio_work_status` for what the Board and the Inbox show now; `studio_crew_assignments` for what the Crew page
  shows. Point the captain to a page by its name and its `#/` link.

## Tests

- A status you report matches `studio_work_status` read in the same turn.

## Dependencies

- None: these pages ship with Studio.

## Deliverable

- One or two sentences naming the page, what the captain does there, and its link.
