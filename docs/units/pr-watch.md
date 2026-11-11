# Unit pr-watch: every pull request I am on, its state, what it waits for and who

What: a **Pull requests** section on the Projects page (`#/projects`), and the same list filtered to one project on that
project's page. No new sidebar item. It watches the GitHub repositories the captain names, keeps every open pull request
the captain opened or is assigned to, and shows one row per pull request:

| column | content |
|---|---|
| order | the release order (AI-proposed, captain-editable; see Order and dependencies) |
| pull request | `owner/repo#N` linked to GitHub, and one line on what it does |
| issue | every linked issue, in any repository, with its state |
| group | an optional release group: pull requests shipped together |
| reviews | each reviewer's latest verdict; stale when the head moved after it |
| missing | who still has to approve, from the branch rules (below) |
| environments | which environments run the head (below) |
| test evidence | the latest verdict from the evidence sources, and whether it covers the current head |
| depends on | the pull requests this one waits for, and whether they are done |
| next | the next step and who it waits on |

Why: the captain asked the same thing again and again in agent sessions. Over 30 days of the captain's own messages,
"list the pull requests' status" came 26 times on 9 days, and "is it deployed yet" 52 times on 12 days. The captain's
rule: 「如果我一直機械式的問一樣的問題或一直重複同一個指令意思，那表示這個應該做成一個crew studio 的功能」.
The section must be generic: no organisation, repository, team, bot or environment name is built in; all of them are
settings.

## Settings (per board, edited on the Projects page)

- **Watched repositories**: any `owner/repo` the GitHub connection can read.
- **Which pull requests**: opened by me, assigned to me (both on by default); optionally review requested from me.
- **Evidence sources**: GitHub accounts whose comments count as test evidence, plus check-run names and labels that count.
  A comment's verdict is read by rules (a heading or line naming pass, conditional, fail, code review only) and the
  commit SHAs it names. A comment the rules cannot classify shows as "unclassified"; no model guesses a verdict.
- **Environments**: an ordered list (for example dev, staging, production). Each one says how to tell whether a head
  runs there, by one of: a GitHub Deployment to that environment; a check run by name on the head; a branch whose
  latest deployment contains the head; an image tag in a file in a repository (path and pattern), compared by commit.
- **Release groups**: optional names; a group's pull requests ship together.

## Reading

- One GitHub search per poll finds the set (`is:pr is:open` with the watched repositories and the author/assignee
  filter); one GraphQL read per repository fills the rows. It runs on the shared `GitHubPoller`
  (src/github-poller.ts): read authority per repository, backoff on failure. Every read is GET or GraphQL query; this
  unit writes to GitHub only through the dependency hint below.
- **Refresh**: every 5 minutes, when the page opens, and on a **Refresh** button. No read/unread state. A row that changed
  in the latest refresh is marked, with "changed N min ago" and what changed; the mark stays until the next change.
- **Issues**: links from the pull request body (any GitHub issue URL, in any repository), from
  `closingIssuesReferences`, and from cross-reference events in the timeline. An issue outside the watched
  repositories is read (title, state) and never written.
- **Missing approvals**: from the base branch's rules (`GET /repos/{o}/{r}/rules/branches/{base}`): required count,
  code owners, approval after the last push, required reviewer teams; team members from the teams API. The author's own
  approval does not count. When the rules cannot be read, the row says so instead of guessing.
- **Snapshot**: each refresh is saved in Studio's data directory (never in a repository); a row's change is the
  difference from the previous snapshot.

## Order and dependencies

- **AI proposal**: on first sight of a set, and when a pull request joins it, a model proposes an order and the
  dependencies, each with its reason: a `Depends-on:` line in a body, a body naming another pull request, a pull request
  based on another's branch, files both change (a conflict risk), an issue that says which comes first. The proposal shows
  marked "proposed" until the captain accepts it.
- **Captain edits**: drag to reorder; add or remove a dependency on a row. An edit replaces the proposal for that row.
- **Applied on the pull request**: the captain applies the dependencies through a card (Studio writes to GitHub only
  after the captain approves a card). Studio writes one marked block at the end of the pull request body:

  ```
  <!-- crew-studio:depends -->
  Depends-on: https://github.com/<owner>/<repo>/pull/<n>
  <!-- /crew-studio:depends -->
  ```

  A setting adds the short same-repository form (`Depends-on: #<n>`) for tools that read only that form.
- **Drift**: every refresh compares the body's block with Studio's record. A block removed or edited on GitHub turns the
  row's dependency cell amber, "the hint on GitHub changed", with two actions: apply Studio's record again (a card), or
  take the body's version as the new record.

## Next step and who it waits on

The first matching rule, top to bottom; deterministic, no model:

1. draft: on hold
2. a reviewer asked for changes: fix (who: the author)
3. a required reviewer has not reviewed: wait for that reviewer
4. a dependency is not done: wait for that pull request
5. the head runs in no pre-production environment: deploy for testing
6. no evidence, or evidence for another head: test (who: the evidence sources), "test only the change since <sha>" when an
   older head was tested
7. approvals missing: approve (who: the missing people or teams)
8. otherwise: ready to merge (who: the captain)

## Actions on a row that misses approvals

- **Ask for review**: drafts a short message to the missing people (the pull request, what it does, its evidence, what is
  asked), in the language the captain set; Copy, or Send through a messaging connector when one is connected. Studio
  never sends without the captain's click.
- **Open in the review room**: the existing review room for that pull request (docs/units/review-room.md).
- **Handoff report**: a Task that writes a one-page report of the selected rows for a reader the captain names (the
  pull requests, evidence, risks, what is asked); it starts only from its dispatch card.
- **Copy as Markdown**: the visible rows, for pasting into a chat or a document.

## Done when (tests/pr-watch.ts, tests/pr-watch-ui.mjs; a fixture GitHub with three repositories, one outside the set)

1. The set is exactly the open pull requests opened by or assigned to the captain in the watched repositories.
2. An issue linked from the body in an unwatched repository shows with its title and state, and nothing is written to it.
3. Missing approvals follow the rules fixture: required count, code owners, a required team, the author's own approval
   ignored, an approval made stale by a later push.
4. An environment shows the head as running from each of the four detectors.
5. Evidence from a listed account is classified; evidence naming an older head reads "test only the change since";
   an unclassifiable comment reads "unclassified".
6. Each next-step rule fires on its fixture and the first match wins.
7. Refresh: on open, on the button, on the interval; a changed row is marked with what changed; no read/unread state.
8. The proposal shows as proposed with reasons; a drag and a dependency edit replace it for that row.
9. Applying dependencies writes only the marked block, only after the card; a block edited on GitHub turns amber and
   both drift actions work.
10. The three actions on a row missing approvals: the draft names the missing people; the review room opens; the report
    Task waits for its card.
11. No name of an organisation, repository, team or account is in the source outside tests and fixtures.
12. Screenshots at 1440 and 390, light and dark, in tests/out/pr-watch/; no sideways scroll at 390.

Touches outside the unit's own files: public/projects.js (the section on both pages), src/github-poller.ts (a
subscriber), the card kinds (apply dependencies), docs/architecture.md (UI line).
