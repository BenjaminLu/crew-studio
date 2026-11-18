# External CLI grants: a plain agent CLI starts and follows runs over MCP

The captain opens `claude` (or codex) in their own terminal and wants it to run a Studio workflow and follow it. An
**external CLI grant** lets that CLI start and read runs in one project for a bounded time, over Studio's MCP helper.
Every captain decision stays on the board: through the grant, the CLI can propose, follow and read, never approve.

Code: `CliGrants`, `createGrantTools`, `installGrantViews` in `src/cli-grants.ts`; the routes `/api/cli-grants` and the
grant branch of `/api/tools` in `src/server.ts`; `--grant-file` / `--url` in `src/mcp.ts`; the proposal's `by` and the
dispatch card's wording in `src/firstmate.ts` (`owner.origin`); `origin` on run views in `src/runtime/index.ts`; the
Settings section in `public/backbone.js`, the labels in `public/board.js`, `public/runtime.js`, `public/scard.js`.
Tests: `tests/cli-grant.ts` (store and tools on an engine), `tests/cli-grant-mcp.ts` (a booted Studio, the board routes
and `bun src/mcp.ts --grant-file` over stdio), `tests/cli-grant-ui.mjs` (the Settings section).

## The grant

Issued in **Settings → External CLI grants / 外部 CLI 授權**: a registered project and an expiry (1 hour, 8 hours, or the
end of the local day). Issuing and revoking take the captain's own page: the session cookie on a same-origin request
from this Mac (`origin` and `sec-fetch-site: same-origin`), as the operating-rules editor does. A script's
`x-crew-session` header, a phone, a request without Origin, another site, and any request that carries an
`x-crew-tool-token` are refused (`captainOnly`, 403).

| Field | Meaning |
| --- | --- |
| `id` | `g-` and 8 hex characters |
| `project` | the one registered project its runs are in |
| `expiresAt`, `createdAt`, `lastUsedAt`, `revokedAt` | lifetime; `state` is `active`, `expired` or `revoked` |
| `calls` | tool calls so far, bounded per grant (`CREW_CLI_GRANT_MAX_CALLS`, default 2000; over it: 429) |
| `runs` | the proposals it started, each with the staffing preference it asked for |

The token (`csg_<id>_<64 hex>`) is written once to `data/grants/<id>`, mode 0600, in a 0700 folder. `data/cli-grants.json`
keeps only its SHA-256; no route ever returns the token or the hash. Revoke removes the token file; so does the first call or board listing after the grant expired. The board shows the
line to copy, which names the file and never the token:

```
claude mcp add studio -- crew-studio mcp --grant-file <data>/grants/g-1a2b3c4d
```

From source the helper is `bun src/mcp.ts --grant-file …`; Studio adds `--url http://127.0.0.1:<port>` when it is not on
4210. The helper refuses to start (exit 2) when the file cannot be read.

## The four tools

A project grant's token reaches exactly these, through `/api/tools` (never the sandbox's tools-only listener):

| Tool | What it does |
| --- | --- |
| `list_workflows` | the selectable workflows that take a `project` parameter, with their declared inputs |
| `start_run` | `{workflow, version?, input: {text, title?, params?}, staffing?}`: a proposal in the grant's project, waiting for the captain |
| `run_status` | `{run}`: state (`awaiting_captain`, `running`, `done`, `failed`, `cancelled`, `declined_by_captain`), current node, cards waited on, rounds, tokens, and `result` when ended |
| `read_cards` | `{run}`: the open cards of the run and of the Task it dispatched; read-only, `answer_on: "board"` |

Any other name, `approve_card` included, is **404 `no such tool`**: there is no tool to answer a card, change staffing or
merge, so an agent that tries gets "no such tool", not "permission denied". A revoked, expired or unknown token gets
**403** on its next call, `tools/list` included.

## The authority boundary

- **start_run is a proposal, not a start.** It goes through `studio_propose_work`, the same path Firstmate's proposals
  take: Studio's `firstmate-proposal` run with a `captainOnly` dispatch card. Nothing runs until the captain answers that
  card on the board; `firstmate.launch` starts the pinned Task only from that answer. An authorization window never
  answers it. Staffing, project registration and seat cards apply exactly as for Firstmate's proposals.
- **The staffing preference is shown, never applied.** The dispatch card (and every card of the run) shows what the CLI
  asked for; the crew is the one the captain approved on the Crew page, with the efforts the captain picks on the card.
- **A grant sees only its own runs in its own project.** A run is readable when the grant recorded it, its proposal's
  `by` names the grant (`External CLI grant g-… (captain approval required)`, set only by `start_run`), and its project is
  the grant's. The Task a dispatch card started, and a proposal Studio raised again when the crew changed, follow it.
  `params.project` is pinned to the grant's project; another project is refused.
- **The board labels it.** A grant's runs carry `origin: {kind: "external-cli", grant, staffing}` in `/api/wruns` and
  `/api/wruns/<id>`; their cards carry the same on read (`engine.cards.view`) and say "From an external CLI · grant … ·
  answered here only / 來自外部 CLI · 授權 … · 只能在這裡決定"; the dispatch card's why names the grant.
- **Audit.** Every issue (`cli_grant_issued`), use (`cli_grant_used`), proposal (`cli_grant_run`), refusal
  (`cli_grant_refused`: unknown, revoked, expired, call limit) and revoke (`cli_grant_revoked`) is a line in Studio's
  event log, `data/events.jsonl`, workflow `cli-grant`.

## A pull request list grant (scope `prs`)

Settings → External CLI grants → **Reaches: The pull request list / PR 列表** issues a grant with `scope: "prs"` and no
project (`POST /api/cli-grants {scope: "prs", ttl}`; the same captain-only page checks). Its token reaches only the pull
request list's tools (`tools` in `src/pr-watch.ts`), never the four run tools; a project grant never reaches these.
The captain chose that the list's own edits go through directly, without a card: they change Studio's own record only,
are reversible on the page, and are each audited.

| Tool | What it does |
| --- | --- |
| `prs_list` | every watched row in the captain's order: CI, approvals (count, missing, per required team), reviews, test evidence, environments, dependencies, linked issues, the next step; the watch list and the settings |
| `prs_get` | `{pr}`: one row in full, with the head, labels, the dependency record, why it sits where it does, and the body |
| `prs_refresh` | read GitHub now, then `prs_list` (a refresh error is `refreshError`, not `error`) |
| `prs_watch`, `prs_unwatch`, `prs_restore` | the watch list, as the page's address field and remove buttons |
| `prs_settings` | `{settings}`: only what it names changes (`which` and `evidence` merge one level down) |
| `prs_order`, `prs_deps`, `prs_group`, `prs_accept` | the order, a dependency, a release group, accepting Studio's proposal |

They run the board's own code (`act` in `src/pr-watch.ts`), so the same checks hold, and the open page reloads (live event
`prs`). **Nothing writes to GitHub**: there is no tool for the dependency block (that stays the captain-only card the
board's Apply starts), merging, reviews, comments or labels. A tool error is `{error}`. Every successful edit is a
`cli_grant_prs_edit` line in the event log with the tool and what it sent (cut to 4 KB); reads are `cli_grant_used` as for any call.

- Arguments over 16 KB are refused (the route itself takes at most 64 KB). `prs_settings` refuses a field it does not know
  or one of the wrong type, so a mistaken call never clears a setting.
- A dependency a grant sets is recorded as `by: "external-cli"` with the grant's id (the row's `deps.source`), not as the
  captain's, until the captain sets it on the page.
- `prs_refresh` reads GitHub at most once a minute for a CLI (the captain's token is shared with the rest of Studio); a
  sooner call answers with the last refresh.
- **What it can read is what the captain's GitHub token can read.** `prs_watch` takes any pull request address and
  `prs_get` returns its body, so a list grant reads every pull request that token reaches, private repositories included.

## Scopes are a set; reading Studio (scope `observe`)

A grant's `scopes` is a set of `project` (the four run tools), `prs` (the pull request list's tools) and `observe` (Studio's
read tools, `src/observe/`). A record written before scopes were a set (`scope: "prs"`, or none: `project`) is read as that
one scope and written back as a set when Studio starts (`CliGrants.migrate`). `tools/list` holds the tools of the grant's
scopes and nothing else: a tool a scope does not give is not listed, and calling it is "no such tool".

Settings → External CLI grants → **Reaches: Read Studio / 讀取 Studio** (`POST /api/cli-grants {scopes: ["observe"],
project?, observe: {preset, kinds?, untrusted?}, ttl}`) picks what it reads (`src/observe/grant-scope.ts`):

| Preset | Kinds | Project |
| --- | --- | --- |
| This project / 這個專案 | every grantable kind | required: a project-bound kind shows that project's entities only (workflows, skills, the crew and Doctor are Studio-wide) |
| Review only / 只看 review | `room` | none: every review room |
| Custom… / 自訂… | the kinds ticked, by group (Work, Review, Outputs, Crew and skills, System: Doctor) | optional |

- **External text is left out** unless **Include external text / 包含外部文字** is ticked: every untrusted value (a pull
  request's text, a reviewer's comment, a tutor's or a model's answer, a tool's output) is removed from what the grant
  reads, and the envelope says `externalText: left out`. `studio_find` never matches untrusted text, ticked or not, so a
  search cannot tell what a pull request's body says. Reason: an external CLI has a shell and the network; private data,
  someone else's words and a way out must not meet there.
- **Never grantable**: settings, grants, peers, terminals and focus (`NEVER_GRANTABLE`). A custom grant naming one is
  refused; no preset includes one; no grant's `studio_now` carries the captain's focus.
- What a grant may not see reads exactly as a missing ref: `studio_get` of another project's Task says "not in Studio (or
  not in this grant)", the same words a ref that does not exist gets. Its events are those whose every ref it sees.
- **Resources**: the MCP helper offers the template `studio://{kind}/{id}` (`resources/templates/list`) where the session
  has `studio_get`; `resources/read` is `studio_get` of that ref (JSON), and an entity the grant does not see is
  `-32002 Resource not found`. `studio_find` and `studio_list` return `resource_link`s to them.
- **Rolling budget**: every grant, whatever its scopes, has at most `CREW_CLI_GRANT_HOURLY_CALLS` calls (600) and
  `CREW_CLI_GRANT_HOURLY_BYTES` bytes of answers (4 MB) in any hour; past either it gets HTTP 429 saying when it frees up.
  The board shows this hour's use on each grant. The total call bound (`CREW_CLI_GRANT_MAX_CALLS`) stays.

## Connecting a client (the plug-in kit)

- **Snippets.** Each active grant on the board has a tab per client, each with copy buttons (`src/mcp-snippets.ts`,
  `grantView(…).snippets`): Claude Code (`claude mcp add studio -- <helper>` or a project's `.mcp.json`), Codex
  (`codex mcp add studio -- <helper>` or `[mcp_servers.studio]` in `~/.codex/config.toml`), Cursor (`.cursor/mcp.json`)
  and VS Code (`.vscode/mcp.json`, `type: "stdio"`). Every one runs the same helper with the grant's file, never the token.
- **Plug-in.** `plugins/crew-studio/` is one folder with a Claude Code manifest (`.claude-plugin/plugin.json`, listed in
  the repository's marketplace `.claude-plugin/marketplace.json`) and a Codex manifest (`.codex-plugin/plugin.json`).
  Both bring `.mcp.json` (`crew-studio mcp`) and the `studio` skill. The helper takes the grant file from
  `CREW_STUDIO_GRANT_FILE` (and Studio's address from `CREW_STUDIO_URL`) when no `--grant-file` is given, and only for a
  plain CLI (never when Studio started the helper with its own token).
- **Generated pages.** The `studio` skill (`plugins/crew-studio/skills/studio/SKILL.md`) and the tools reference
  (`docs/reference/studio-tools.md`) are made from `src/observe/` by `bun scripts/observe-index.ts --write`;
  `tests/observe-index.ts` fails when one drifts.
- **Conformance.** `tests/mcp-sdk-conformance.ts` (CI, `test:ci:portable`) connects the official MCP SDK client
  (`@modelcontextprotocol/sdk`) through every snippet and the plug-in's `.mcp.json`. For each it checks: initialize;
  `tools/list` in a fixed order with valid schemas; `studio_find`, with `structuredContent` checked against its
  `outputSchema` by the SDK; a mistake returned as `isError`; and the resource template with `resources/read`. Real paid
  CLIs are not part of the test.

## What the boundary is not

- **It bounds the tool surface, not the process.** The CLI runs as the captain, unsandboxed, on the same Mac. A grant
  token reaches only the four tools; but a process of that user can read Studio's data folder (`data/session-token`
  included) and act as the captain's scripts can. The grant keeps a cooperating agent CLI on the four tools and every
  decision on the board; it is not a sandbox against a hostile process the captain started.
- **Revoking stops the CLI, not its proposals.** A proposal the grant already made keeps its dispatch card, labelled as
  coming from the external CLI; the captain approves or closes it as any other. Work an empty team seat held is
  proposed again under the grant only while the grant is active.
- Refusals of an unknown token are logged at most once a minute (with the count of the ones not logged), so a loopback
  process cannot fill the event log with them.

## Not in this unit

Workflows that take no project (documents, images, video) are not offered to a grant. The CLI's own coding work in its
repository is the CLI's business and never goes through Studio.
