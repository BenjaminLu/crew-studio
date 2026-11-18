# The crew-studio CLI: an external agent's way into Studio

An agent that can run a shell (Claude Code, Codex, any other) reads the captain's Studio with `crew-studio <command>`. It uses the grant the captain issued on the board (docs/units/cli-mcp-grant.md). Every command is one of Studio's tools: the read tools of `src/observe/` and the run tools of `src/cli-grants.ts`. Studio's server enforces everything the grant decides: its kinds, its project, whether external text is in, and its hourly budget. The CLI is only another way to call those tools, so it is exactly as safe as they are.

No command does what only the captain decides: paying, a one-way door, a merge, an approval. Those stay on the board.

Code:
- `src/cli.ts`: the commands, output and exit codes.
- `src/studio-client.ts`: the tool API client and grant lookup, shared with the MCP helper `src/mcp.ts`.
- `src/studio-home.ts`: `~/.crew-studio`.

Tests:
- `tests/cli.ts`: end to end, against a real Studio.
- `tests/cli-drift.ts`: in process, in CI's portable job.

## Commands

| Command | Tool |
| --- | --- |
| `crew-studio now` | `studio_now` |
| `crew-studio list <kind> [--<filter> value …] [--cursor C] [--depth full]` | `studio_list` |
| `crew-studio get <ref> [--depth full]` | `studio_get` (`task:R-012`, `pr:owner/repo#12`, `studio://kind/id`) |
| `crew-studio find <text> [--kind a,b]` | `studio_find` |
| `crew-studio logs <ref> [--since CURSOR] [--tail N]` | `studio_logs` |
| `crew-studio events [--since CURSOR] [--kind a,b] [--ref R]` | `studio_events` |
| `crew-studio read studio://<kind>/<id>` | `studio_get`, as the MCP resource reads it |
| `crew-studio run workflows` / `run start <workflow> --text …` / `run status <run>` / `cards read <run>` | the run tools; only a grant with the project scope lists them |
| `crew-studio call <tool> '{json}'` | any tool the grant lists (the pull request list's, for instance) |
| `crew-studio help [--json]` | the commands, their flags, the kinds, the exit codes, and what this grant can use |
| `crew-studio whoami` | the grant: scopes, kinds, project, expiry, and what is left of the hourly budget |
| `crew-studio mcp` | the same tools as a stdio MCP server, for a client with no shell |

The command table is made from the tools' specs (`verbs()` in `src/cli.ts`); a command's flags are its tool's inputs. `tests/cli-drift.ts` fails when any of these disagree:
- the command table and the tools' specs;
- `help --json`;
- the tools a grant lists over MCP.

Any word that is no command is a usage error. Only `crew-studio` with no argument starts Studio, so a mistyped command never binds Studio's port.

## Output and exit codes

On a terminal, `crew-studio` prints a summary for a person:
- a list is a table;
- one entity is its fields, with someone else's words marked `«untrusted: <source>»`;
- below that come the cursor to read on with and this hour's budget.

Piped, or with `--json`, it prints one JSON object: `{ok, ref, kind, data, items, trust, untrusted, nextCursor, truncated, quota}`. External text comes wrapped as `{untrusted: true, source, text}`. A Task's withheld words, and every field the grant does not include, are not there at all. `quota` is the grant's budget after the call (the `x-crew-grant-quota` header).

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | the tool failed (its error) |
| 2 | usage: wrong command or arguments (the right usage is printed) |
| 3 | not in this grant: a kind, project or tool it does not reach, or one no grant reaches (code `not_granted`, or a tool it does not list) |
| 4 | the hourly budget is used up: `freesAt` says when; every call holds 24 KB up front until its answer is counted |
| 5 | not found |
| 6 | Studio is not answering at the grant's address: `crew-studio launch` |
| 7 | no grant, or it was revoked or expired: issue one on the board |

With `--json`, an error is `{ok: false, exit, error, meaning, …}` on stdout; otherwise it is one line on stderr.

## Grants

When the board issues a grant, Studio writes `~/.crew-studio/grants/<name>.json`. It is 0600, in a 0700 folder, and holds the grant's id, its token, scopes, project, expiry and Studio's address. Studio removes the file when the grant is revoked or expires. `CREW_STUDIO_HOME` moves `~/.crew-studio`; every test gets its own (`tests/lib/isolated-env.mjs`).

The CLI and `crew-studio mcp` find a grant in this order:
1. `--grant <name|path>`
2. `CREW_STUDIO_GRANT` (a name or a path)
3. the only file in the grants folder
4. none: exit 7, saying where grants come from (with several files, it names them)

The token is read from that file only. It is never printed, never on a command line, never in an environment value.

`GET /api/tools?whoami=1` (`crew-studio whoami`) answers which grant a token is. It counts no call.

## Transport

The CLI uses the address in the grant file (`http://127.0.0.1:<port>`; local only), through the client the MCP helper also uses (`src/studio-client.ts`). The client takes a private unix socket too. Studio does not yet listen on one for grants, so a grant file names the http address.
