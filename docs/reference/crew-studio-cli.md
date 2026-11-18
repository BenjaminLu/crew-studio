# crew-studio CLI reference

Generated from the command table (`src/cli.ts`) and the tools' specs by `bun scripts/cli-reference.ts --write`; do not edit by hand. How it works: docs/units/cli.md.

## Commands

### `crew-studio now [--depth …]`

What needs the captain now, within this grant: the cards waiting for them (most urgent first), the work running with its progress and cost, and what changed in the last hour.

Tool: `studio_now`.

| Flag | Type | |
| --- | --- | --- |
| `--depth` | string | summary (default, about 4 KB) or full (up to 24 KB) |

### `crew-studio list <kind> [--cursor …] [--depth …] [--<filter> value …]`

List one kind of Studio entity with each one's summary: task (Tasks, newest first), card (cards waiting for the captain, most urgent first), room (review rooms), pr (watched pull requests; merged ones until production), workflow, project, skill (versions; a script skill's approval and environment), crew (seats), terminal (state only), artifact, doc, doctor, settings, peer. Any other --key value is a filter of that kind (e.g. --tab merged, --open true).

Tool: `studio_list`.

| Flag | Type | |
| --- | --- | --- |
| `--cursor` | string |  |
| `--depth` | string | summary (default, about 4 KB) or full (up to 24 KB) |

### `crew-studio get <ref> [--depth …]`

Read one Studio entity by ref (task:R-162, card:SC-248, room:PR-0123456789ab-1645, pr:owner/repo#1645, skill:baton@v2; or studio://kind/id): its state, what it waits on, why it failed, the room's questions and lesson, the pull request's environments, a skill version's approval and environment.

Tool: `studio_get`.

| Flag | Type | |
| --- | --- | --- |
| `--depth` | string | summary (default, about 4 KB) or full (up to 24 KB) |

### `crew-studio find <text> [--kind a,b] [--cursor …]`

Search Studio by id or name across every kind: Tasks, cards, review rooms, pull requests, workflows, projects, skills, documents and more (kinds: task, card, room, pr, workflow, project, skill, crew, artifact, doc, doctor).

Tool: `studio_find`.

| Flag | Type | |
| --- | --- | --- |
| `--kind` | list |  |
| `--cursor` | string |  |

### `crew-studio logs <ref> [--tail N] [--since CURSOR]`

Log and progress of one task, room, pr, terminal by ref: a Task's steps (round, model, cost, checks) and events; a room's tutor rounds and Explain-with runs (cost, why each stopped); a pull request's go-live timeline; a terminal's state (its screen only when the captain asked for it this turn).

Tool: `studio_logs`.

| Flag | Type | |
| --- | --- | --- |
| `--tail` | integer | at most this many of the newest entries (default 20) |
| `--since` | string | the cursor studio_logs returned (seq:N), or an ISO time |

### `crew-studio events [--since CURSOR] [--kind a,b] [--ref …]`

Studio's event stream, oldest first: Tasks that failed, review room rounds that failed, pull requests merged and going live per environment, the captain's notes for the retro, grants used.

Tool: `studio_events`.

| Flag | Type | |
| --- | --- | --- |
| `--since` | string | the nextCursor a previous call returned (seq:N), or an ISO time; none: the latest events |
| `--kind` | list |  |
| `--ref` | string |  |

### `crew-studio read <studio://kind/id> [--depth …]`

Read one Studio resource by its URI (studio://task/R-012): what get reads.

Tool: `studio_get`.

| Flag | Type | |
| --- | --- | --- |
| `--depth` | string | summary (default, about 4 KB) or full (up to 24 KB) |

### `crew-studio run workflows`

List the Studio workflows this grant may start (those that run in its project), with their declared inputs.

Tool: `list_workflows`.

### `crew-studio run start <workflow> --text "…" [--title …] [--version N]`

Propose a run of a workflow in this grant's project.

Tool: `start_run`.

| Flag | Type | |
| --- | --- | --- |
| `--text` | string | what you want done (required) |
| `--title` | string | a title |
| `--version` | integer | a workflow version |

### `crew-studio run status <run>`

The state of a run this grant started: state, current node, rounds and tokens so far, and its result when done.

Tool: `run_status`.

### `crew-studio cards read <run>`

The open captain cards of a run this grant started.

Tool: `read_cards`.

### `crew-studio prs list`

Studio's pull request list: every watched open pull request in the captain's order, with CI, approvals (what is still missing, per required team), reviews, test evidence, environments, dependencies, linked issues and the next step; the merged ones followed until production (merged or live, with each environment).

Tool: `prs_list`.

### `crew-studio prs get <pr>`

One pull request of the list in full: everything prs_list has plus the merge-box facts Studio read.

Tool: `prs_get`.

### `crew-studio prs refresh`

Read GitHub again now (Studio also refreshes every 5 minutes), then return the list.

Tool: `prs_refresh`.

### `crew-studio prs watch <url>`

Watch a repository (its open pull requests the captain opened or is assigned to) or one pull request, by its GitHub address.

Tool: `prs_watch`.

### `crew-studio prs unwatch [--repo …] [--pr …]`

Stop watching a repository ({repo: owner/repo}) or leave one pull request out of the list ({pr: owner/repo#N}).

Tool: `prs_unwatch`.

| Flag | Type | |
| --- | --- | --- |
| `--repo` | string |  |
| `--pr` | string |  |

### `crew-studio prs restore [--pr …]`

Bring back a pull request left out of the list ({pr}), or all of them ({}).

Tool: `prs_restore`.

| Flag | Type | |
| --- | --- | --- |
| `--pr` | string |  |

### `crew-studio prs settings [--settings …]`

Change the list's settings.

Tool: `prs_settings`.

| Flag | Type | |
| --- | --- | --- |
| `--settings` | object |  |

### `crew-studio prs order <order>`

Set the release order: pull request ids first to last (owner/repo#N).

Tool: `prs_order`.

### `crew-studio prs deps <pr> <on>`

Set what one pull request waits for: {pr, on: [ids]} (an empty list clears it).

Tool: `prs_deps`.

### `crew-studio prs group <pr> <group>`

Put a pull request in one of the release groups from the settings ({pr, group}); an empty group takes it out.

Tool: `prs_group`.

### `crew-studio help [--json]`

Every command, its arguments, the kinds, the exit codes and what this grant can use (--json for agents).

### `crew-studio whoami`

Which grant this is: its scopes, kinds, project, expiry and what is left of its hourly budget.

### `crew-studio call <tool> ['{json args}']`

Call any tool this grant lists by its name (for one with no command, such as the pull request list's).

### `crew-studio skill install [--claude] [--codex] [--project <dir>] [--yes]`

Teach Claude Code and/or Codex to use this CLI: write the short crew-studio skill for you (default) or one project, after asking once.

### `crew-studio skill show`

Print the crew-studio skill (what skill install writes).

### `crew-studio mcp`

The same tools as an MCP server over stdio, for a client without a shell (its grant is found as the CLI finds it).

## Kinds a grant may read

`task`, `card`, `room`, `pr`, `workflow`, `project`, `skill`, `crew`, `artifact`, `doc`, `doctor`

## Exit codes

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | the tool failed (see error) |
| 2 | usage: the command or its arguments are wrong (the right usage is printed) |
| 3 | not in this grant: a kind, project or tool the grant does not reach, or one no grant ever reaches |
| 4 | the grant's hourly budget is used up (freesAt says when; every call holds 24 KB up front) |
| 5 | not found: no such ref (or one outside this grant) |
| 6 | Studio is not answering: start it with `crew-studio launch` |
| 7 | no grant, or it was revoked or expired: issue one on Studio's board (Settings → External CLI grants) |
