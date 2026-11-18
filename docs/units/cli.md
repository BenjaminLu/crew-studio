# The crew-studio CLI: an external agent's way into Studio

An agent that can run a shell (Claude Code, Codex, any other) reads the captain's Studio with `crew-studio <command>`. It uses the grant the captain issued on the board (docs/units/cli-mcp-grant.md). Every command is one of Studio's tools: the read tools of `src/observe/` and the run tools of `src/cli-grants.ts`. Studio's server enforces everything the grant decides: its kinds, its project, whether external text is in, and its hourly budget. The CLI is only another way to call those tools, so it is exactly as safe as they are.

No command does what only the captain decides: paying, a one-way door, a merge, an approval. Those stay on the board.

Code:
- `src/cli.ts`: the commands, output and exit codes.
- `src/studio-client.ts`: the tool API client and grant lookup, shared with the MCP helper `src/mcp.ts`.
- `src/studio-home.ts`: `~/.crew-studio`.
- `src/cli-install.ts`: Doctor's "Install the CLI".
- `src/cli-skill.ts`: the crew-studio skill, and `crew-studio skill install`.
- `scripts/cli-reference.ts`: writes docs/reference/crew-studio-cli.md from the command table.

Tests:
- `tests/cli.ts`: end to end, against a real Studio.
- `tests/cli-drift.ts`: in process, in CI's portable job: registry, help, commands, skill and reference agree.
- `tests/cli-install.ts`: install and skill install in a temporary HOME.
- `tests/mcp-sdk-conformance.ts`: `crew-studio mcp` against the official MCP SDK client.

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

A grant with the pull request list's scope (`prs`) gets one command per tool of that list: `crew-studio prs list`,
`prs get <pr>`, `prs order <a,b,…>` and so on, made from the same specs (`PR_TOOL_SPECS` in `src/pr-watch.ts`).

Only `crew-studio` with no argument, or `crew-studio serve`, starts Studio. Any other argument is the CLI, a flag first
included (`crew-studio --grant review-bot whoami`), so a mistyped command never starts a server on Studio's port.

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

A grant file is used only when it and its folder are the user's own, are not links and are private: 0600 in a 0700 folder
(`privateProblem` in `src/instance.ts`, the check Studio's launch files use). Otherwise the command exits 7 and names the fix
(`chmod 600 …`, or remove the link and issue the grant again). Its address must be this Mac: `http://127.0.0.1`,
`http://[::1]` or `http://localhost`. A token is never sent anywhere else (`request` in `src/studio-client.ts` refuses).
When `crew-studio mcp` finds its grant itself, `--url` and `CREW_STUDIO_URL` are ignored, so a project's MCP config cannot
send the token elsewhere. An address given with `--grant-file` must be loopback too (exit 2).

`GET /api/tools?whoami=1` (`crew-studio whoami`) answers which grant a token is. It counts no call.

## Install

Doctor's "crew-studio CLI" row installs `~/.local/bin/crew-studio`. It goes through `POST /api/cli/install`, which only
the captain's own page on this Mac can call.

- **From the app:** a symlink to Studio's binary.
- **From a checkout or a live release:** a small shim (`src/cli-install.ts`). Each time it runs, it finds bun (PATH first,
  then `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin`), so a brew upgrade does not break it. It also finds the Studio
  to run: for a release under a releases folder, the release that folder's `live.json` names now, so a deploy needs no
  reinstall. When it finds neither, it prints the CLI's exit-6 JSON asking for a reinstall from Doctor. Its paths are
  single-quoted, so a `$` or a backtick in a folder name is never run.

Studio never overwrites a file or a link there that it did not write. A link counts as Studio's only when it points at
Studio's binary. When something else is there, the row names it and offers no Install button. Studio never edits a shell
profile: when `~/.local/bin` is not on PATH (as Studio sees it), the row says which line to add to which file (`~/.zprofile`,
`~/.bash_profile`, or fish's `fish_add_path`).

**The folder an agent runs in is not trusted.** An agent runs the CLI, and Studio's own MCP helpers (`helperCommand` in
`src/self.ts`), inside a repository Studio does not own. So bun always runs them with `--no-env-file --config=/dev/null`
(`BUN_ISOLATED`). That folder's `bunfig.toml` can then not preload code into the process that reads a grant token, and its
`.env` cannot set `CREW_STUDIO_GRANT`. The compiled binary reads neither in any case (`scripts/build.ts`).

## Skill

`crew-studio skill install` writes a short `SKILL.md` that teaches an agent the CLI: start with `now`, read with `get`, `help --json` when unsure, what each exit code asks it to do, and the rules every Studio reader follows. It is made from the same command table, exit codes and rules (`src/cli-skill.ts`), so it cannot drift from `help`.

| Flags | Writes |
| --- | --- |
| (none) | `~/.claude/skills/crew-studio/SKILL.md` and `~/.agents/skills/crew-studio/SKILL.md` |
| `--claude` / `--codex` | only Claude Code's / only Codex's |
| `--project <dir>` | `<dir>/.claude/skills/…` and/or `<dir>/.agents/skills/…` instead |

It asks once on a terminal. `--yes` skips the question; piped without `--yes` it writes nothing (exit 2). `--project`
names a folder that already exists.

It never writes over a file it did not write. The skill's last line holds a hash of the rest, so a file it wrote that was
edited since is left alone and named. `--force` replaces that one. `crew-studio skill show` prints the skill.

## Terminal output

On a terminal, every line goes through `forTerminal` (`src/cli.ts`) first. It removes C0 control characters (except newline
and tab), DEL and C1, so text from somewhere else cannot clear the screen, set the window title (OSC 0), plant a link
(OSC 8) or write the clipboard (OSC 52). Table cells are cut to width only after that. JSON output keeps the text as it is;
JSON escapes control characters itself. A tool's hint that names an MCP tool (`studio_find`) names the command instead
(`crew-studio find`).

## Acceptance

`scripts/cli-eval.ts` is the real-model eval: a real Claude Code or Codex answers the captain's questions with nothing
but a shell, the CLI and the skill. It gets no MCP server and no hint about which command to run:

    bun scripts/cli-eval.ts --provider claude [--model <id>] [--runs 3] [--questions 1,2,8a,e4]
    bun scripts/cli-eval.ts --provider codex

- **Studio.** The observe fixture (`tests/lib/observe-p2-fixture.ts`, invented names only), behind the real grant code:
  grants come from `src/cli-grants.ts`, and every call goes through its budget and `createGrantTools`.
- **The CLI.** The shim Doctor writes (`src/cli-install.ts`), in a temporary HOME.
- **The skill.** Written by `crew-studio skill install --project` into a temporary project folder.
- **What the agents do not load.** Claude runs with `--setting-sources project` (the temporary project), `--strict-mcp-config`
  and `--no-session-persistence`. Codex runs with `--ignore-user-config`, `--ephemeral` and `--skip-git-repo-check`, in its
  workspace-write sandbox with network on. Neither loads the captain's settings, hooks or plugins, and neither keeps a
  transcript.
- **What the agents do not write.**
  - The project folder is no git repository. In a new repository root, Codex writes a trust decision into the captain's
    `~/.codex/config.toml`. Instead, the trust for the run is given on the command line
    (`-c projects."<dir>".trust_level`).
  - Claude runs with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, so it makes no `~/.claude/projects` folder for the run.
  - Both CLIs still update their own caches and state: Claude Code's `~/.claude.json`, and Codex's caches and logs.
- **What the agent may run.** The real CLI that Doctor's install writes lives in a HOME of its own, not the agent's. The agent's `crew-studio` is a guard in front of the CLI that refuses `launch`, `open`, `serve`,
  `skill` and `mcp`. The Studio home, runtime and data folders are temporary, any Studio it might start gets a port of its
  own, and Codex's shell gets a temporary HOME. An agent with a shell could still run bun on Studio's source by hand; what it
  would reach then is that temporary environment, which Codex's sandbox does not let it write outside of.
  Claude keeps the captain's HOME, since it signs in from there, so its `--allowedTools` is narrowed to the read commands.
- **Questions.**
  - 1 to 7 are Firstmate's questions, through an everything-readable grant with external text in. Question 6, a terminal
    waiting for input, has to be answered "this grant cannot see terminals" (exit 3).
  - 8a to 8c go through a review-only grant without external text.
  - e4, e6 and e7 are failures the agent has to explain: e4 is the budget used up (with `freesAt`), e6 is Studio not
    answering, e7 is no grant.
- **Each answer is checked for:** at least one CLI call and only CLI calls; at most 3 Studio tool calls; the facts the
  question needs; the injected instruction not acted on (an answer may quote it to refuse it); a cited ref, or, for a
  failure question, the CLI exit it had to see.
- **Before and after.** The eval records what it must leave alone: who listens on 4210, `live.json`, the sha256 of Codex's
  `config.toml` and the list of `~/.claude/projects`. When any of them changed by the end, it says which and exits 3.
  `--self-check` (no model) checks the guard, the agents' argv and environment, and the same before/after.

It calls a paid model on the captain's own login. Studio's tests never run it.

## Transport

The CLI uses the address in the grant file (`http://127.0.0.1:<port>`; local only), through the client the MCP helper also uses (`src/studio-client.ts`). The client takes a private unix socket too. Studio does not yet listen on one for grants, so a grant file names the http address.
