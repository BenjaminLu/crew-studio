# Unit pr-watch: every pull request I am on, its state, what it waits for and who

What: a top-level **Pull requests** page (`#/prs`), in the sidebar right after Inbox, with a count of the rows whose next
step is approve or merge. One list, across projects and repositories; a repository need not be a registered Studio
project (a row shows the project's mark when it is one, a grey "·" mark when not). One row per open pull request.

Why: the captain asked the same thing again and again in agent sessions. Over 30 days of the captain's own messages,
"list the pull requests' status" came 26 times on 9 days, and "is it deployed yet" 52 times on 12 days. The captain's
rule: 「如果我一直機械式的問一樣的問題或一直重複同一個指令意思，那表示這個應該做成一個crew studio 的功能」.
The page is generic: no organisation, repository, team, bot, account or environment name is built in; all of them are
settings or what the captain pastes.

Code: `src/pr-watch-rules.ts` (the deterministic part: addresses, verdicts, approvals, the next step, the dependency block,
the proposal), `src/pr-watch.ts` (state, GitHub reads, refresh, routes, the apply card), `public/prs.js`,
`public/prs.css`, `workflows/v2/pr-watch-apply-depends.wf.yaml`.

## Adding and removing

- A URL box at the top. `https://github.com/<owner>/<repo>` watches that repository: its open pull requests opened by the
  captain or assigned to the captain (a setting adds "review requested from me").
  `https://github.com/<owner>/<repo>/pull/<n>` (also `…/files`, `…/commits`, `…/checks`) watches that one pull request even
  when it is not the captain's; its row carries a "single" badge.
- Only https github.com repository and pull request addresses are accepted, parsed strictly (no other host, port, user,
  issue or tree address; owner and repository match `^[A-Za-z0-9_.-]+$`); anything else is refused with a message.
- Watched repositories and single pull requests fold into one summary chip ("13 repos · 3 with open PRs · 1 PR"). It opens
  a menu that lists each repository with its count (those with open pull requests first, most first; those at 0 dimmed
  after them), then each single pull request, each linked and with an × to stop watching; the menu stays open after an ×.
  Removing one row that came in through its repository records it as excluded; an "excluded N · restore" chip, beside the
  summary, brings them back.

## Columns, in this order

| column | content |
|---|---|
| (handle) | drag to reorder (or Alt+↑/↓ on a focused row) |
| # | the order: Studio's record, or the proposed position (shown as proposed) |
| pull request | the project mark, `repo#n` linked to GitHub, the title, and "changed N min ago: …" when it changed |
| next step · waits on | the next step (below) and who it waits on |
| missing | the approvals the branch rules still miss: a button that opens the actions below |
| depends on | the pull requests this one waits for and whether they merged; proposed ones dashed and tagged |
| test evidence | the latest verdict from the evidence sources, and whether it covers the current head |
| environments | each environment, lit when it runs the head |
| reviews | each reviewer's latest verdict; stale when it was given on another head |
| issues | one chip: the issue itself when there is one (dashed outside the watched repositories), else the issue icon and the count, which opens the dialog; titles in the tooltip |
| group | an optional release group |

Filters (pressed buttons) by next-step kind with counts: all, approve, test, fix, dependency, mergeable, on hold. Clicking a row opens a
dialog with every linked issue (title, state, external), reviews, evidence, environments, the order's reasons, the missing approvals and the next-step rule
list with the matched rule highlighted. Every text from GitHub is set as text, never as HTML.

## Settings (the gear on the page)

- **Which pull requests** of a watched repository: opened by me, assigned to me (both on by default); review requested
  from me.
- **Evidence sources**: GitHub accounts whose comments count, check-run names, labels. A comment's verdict is read by
  rules: a heading, a bold line, a `Verdict:/Result:/結論:` line, or a short line on its own that names pass, conditional,
  fail or code review only (lines over 500 characters are never read). The report's own conclusion outranks every other
  line: a heading or label naming it (`結論`, `测试结论`, `驗收結論`, `Verdict`, `Conclusion`) read from its own text or,
  when it has none, from the next line, and a table row whose first cell is one. An HTML comment is read as text: block
  tags end a line, table cells become `|` cells. A negated pass ("didn't pass", "does not pass",
  「沒通過」) is a fail; "not yet" is unclassified. None, or two that disagree, is "unclassified"; no model guesses a verdict. The latest decided
  comment of a listed account counts (else its latest comment, unclassified); a listed check run on the head counts as pass
  or fail; a listed label counts as pass, not tied to a commit. The commit a comment covers: the latest pull request commit
  it names. A comment that names none covers the head only when Studio saw that head (in an earlier refresh) before the
  comment was written; a commit's date says when it was made, not pushed, so otherwise the coverage is unknown ("commit not
  named") and the next step is test.
- **Required reviewers**: accounts (a review bot, say) whose review every pull request needs before anything else.
- **Environments**: an ordered list; each is production or not and may be limited to some repositories. Each says how to
  tell whether a head runs there, by one of: a GitHub Deployment to that environment (the latest one, at the head, status
  success); a check run by name on the head; the latest deployment of a branch, when its latest status is success or active, whose commit contains the head (compare);
  an image tag in a file in a repository (path, a one-line template with exactly one `{tag}`, e.g.
  `image: registry/app:{tag}`, with text before `{tag}`; optional ref), compared by commit. No regular expression is taken
  from the settings: Studio finds the text before `{tag}`, then the text after it, and the tag between must be
  `[0-9A-Za-z._-]{1,128}` (with nothing after `{tag}`, the tag ends at the end of the line or the first other character;
  a longer run is no tag). The commit is the tag's trailing 7 to 40 hex characters, never all digits (a date or build
  number is no commit). One line at a time, lines over 500 characters skipped. Saved settings pass the same checks when
  Studio starts: an environment that fails is dropped and the page says which.
  One named environment covers many repositories: besides (or instead of) its own detect, it holds a detect per
  repository (`each`: `{repo, detect}`, which wins over the environment's detect for that repository). At most 20
  named environments, 60 repositories with their own detect in one, 400 in all. Settings from before `each` (the same
  name once per repository, each limited by `repos`) are folded on load into one environment with a detect per
  repository, only where no repository sees a difference: same name and production flag, no catch-all entry, no
  repository named twice, and no environment between the two applies to those repositories (each repository keeps its
  environments, their order and detects); anything else stays as it was. The file is rewritten only on the next save.
- **Find environments automatically** (自動找環境): the settings' first action for environments (disabled, with the
  reason, while nothing is watched), above a card per environment listing each repository and where it is read; the
  hand editor is under **Advanced** (folded when every environment came from it, open when one was set by hand or one
  is begun). The dialog keeps the keyboard (Escape closes it from anywhere, Tab cycles inside) and has three steps:
  ① **sources** (`POST /api/prs/envs/sources`, one read): each repository's GitHub deployments, and a GitOps/config
  repository with its branch, filled in with the one used last or else the first repository that looks like one;
  ② **scan**, its progress read from `GET /api/prs/envs/progress` (what it reads, reads used of the budget); ③ **the
  table**: a row per watched repository and a column per environment, each cell green (sure, ticked), amber (pick one)
  or grey (not found), the evidence under it; repositories with nothing found listed greyed last; repositories where
  everything is already set folded behind "Show N already set"; a summary (found N repositories' M environments · K
  need a pick · J not found), the reads used and any note (budget, walk, unreadable) above the table; a legend; a sticky
  footer whose Accept names the repositories it saves, or links "K need a pick" to the first. A failed search returns
  to the sources with the message and no table. Closing it mid-scan cancels the search (`POST /api/prs/envs/cancel`),
  so the next one starts at once. After Accept the dialog closes with a toast. A manifest found on a branch the captain
  named keeps that branch as its detect's `ref` (a refresh and the release brief read the same branch); on the default
  branch the detect has no `ref` and follows it.
  It proposes, for every watched repository at once (the repositories and the single pull requests' repositories):
  - its GitHub environments that have a deployment (`GET …/environments`, then `…/deployments?environment=…&per_page=1`
    for at most 8, `github-pages` left out), as a "GitHub Deployment" detect;
  - with a GitOps/config repository the captain names (or picks: when none is named, the repositories the token can
    read whose name looks like one — deploy, config, gitops, manifests, k8s, helm, argo, flux, cluster, ops, … — are
    offered, the last one used first) and, optionally, one **folder** of it to narrow the scan (e.g. `deploy/`): its
    default branch (or the branch given), resolved to its commit first (`commits?sha=<branch>&per_page=1`, so a branch
    named `release/v1` works), the folder's tree at that commit (`git/trees/<sha>?recursive=1`; when GitHub truncates it
    or it is over the 1 MB Studio reads, every folder is walked, 30 a GraphQL read, at most 600 folders, those naming an
    environment or a deploy layout first, and said so with how many were left; a config repository that cannot be read
    at all fails the search with why). Only files under an environment are read: at most 400 YAML/JSON files of 200 KB
    or less, production first, then the files that usually hold an image (patches, deployments, kustomizations, values),
    shallow first, 40 files (or 600 KB) a GraphQL read. In each file every image line: `registry/path/name:tag` on one
    line, or the name on one line (repository, name, newName, image; a kustomize newName wins) and `tag:`/`newTag:` on one
    of the next four.
  - **Who builds an image**, by evidence read together, not by its name: (1) what each watched repository's build
    config publishes — its Drone config (a docker plugin step's `repo:`), its GitHub Actions workflows
    (docker/build-push-action `tags:`, docker/metadata-action `images:`, `docker build -t`, `docker push`, `docker tag`),
    templated parts (`${DRONE_TAG}`, `${{ env.REGISTRY }}`) taken out, compared by path with the registry ignored, else by
    its last segment; a Dockerfile's `org.opencontainers.image.title` label is supporting evidence only (the root and
    `.github/workflows` of every repository, two or three GraphQL reads for all); (2) the commit in the image's tag
    (version-sha `1.0.28-9a59f6b`, branch-sha `master-6b7d4068`, a bare sha `da8137f1`) found in the repository
    (`commits?sha=<short>&per_page=1`, the repositories its CI or its name point at first, then the others, at most 8);
    (3) a version-only tag (`6.0.84`, `v5.1.16`) among the repository's git tags, with or without `v` — proof only when
    neither of the others proves anything and one repository alone has it. One repository proven: strong. Proofs that
    point at two repositories: each a weak candidate (a pick). Only names alike (shared words, one name holding the
    other): weak. An image nothing ties to a watched repository (a database, a sidecar) is not proposed. The table shows
    which proofs matched under each cell (builds X (path:line) · commit abc in the repository · tag v6.0.84).
  - A repository whose image runs as several services in one environment (one image, many service folders): every one
    of those manifests is its detect for that environment (`files`), and the environment has a merge when **every**
    manifest runs it (one lagging service keeps it not live). A line of the same image Studio cannot read a commit from
    (a version no git tag has, a second line read first) is shown but does not make the cell a pick.
  - Live with a version-only tag: a refresh resolves the tag through the repository's git tags (three pages, once a
    refresh) to its commit before checking that it contains the merge commit.
    template is the line from its key to the tag, `{tag}` for the tag, the closing quote kept (a comment is not). The
    environment is the deepest directory or file-name part that names one: prod, production, prd, live → production;
    staging, stage, stg → staging; dev, develop, development → dev; qa; test; uat; sandbox; preprod, pre-prod,
    preproduction → preprod (pre-prod is not prod; nonprod names none). A GitHub environment's name maps the same way
    (any other name stays as it is, production when a part of it is: eu-prod, production-eu; not eu-preprod, nonprod-eu).
    A watched repository's name is taken out of a path segment before it is read for an environment
    (values-shop-api-prod is production; a service named live-feed is no environment). An environment already set
    under another name of the same kind (prod for production) keeps that name: the table, what is set and Accept agree,
    and no second production is added. A template holding a tab or another control character cannot be picked. A file naming an image
    under no environment (a kustomize base) is listed as skipped.
  - One review table, a row per repository × environment, each candidate with where it was found (the manifest path
    and line, linked to that line on GitHub, and the line itself; or the GitHub environment and its latest deployment).
    One strong candidate and nothing set for it yet: ticked. More than one, a weak match, or a different detect already
    set (never replaced unasked): a pick, Accept held until each is picked or left out. A tag that ends in no commit
    (Studio cannot tell which commit runs), or a template Studio's own reader would match on an earlier line, is shown
    with its reason and cannot be picked. Already detected that way: "already set". Production is inferred per
    environment name and editable (one tick for the name, as the setting is per environment).
  - One **Accept** saves (as the settings do: a change made meanwhile refuses it): each pick becomes that repository's
    detect in the environment of that name (a name not set yet is added in the usual order dev … staging … preprod …
    production), and the config repository is remembered. Nothing is saved before it, and nothing is ever written to a
    repository: discovery reads with GET only.
  - Budget: at most 600 reads a search (manifests and folders come many to a GraphQL read) and 180 s; past it the search stops reading, proposes what it read and
    says so. A rate limit fails the search with a message. Only the board's captain runs it (no agent CLI tool).
- **Release groups**: names; each row may be put in one.
- The short same-repository form `Depends-on: #<n>` in the block (off by default), and the language of the drafted message.

## Reading

- The list has its own switch: `CREW_PR_WATCH=0` turns it off. `CREW_GH=0` does not; that switch is for the firstmate
  dashboard's poller, and this list reads only what the captain pasted in.
- Studio reads with the token `findToken` finds (src/github.ts); it never reaches the browser, which talks only to
  `/api/prs…`. Every call goes to `api.github.com` (`CREW_GITHUB_API` may name a loopback test server, nothing else), at
  an address Studio builds from validated owner, repository and number; no address a page or GitHub supplies is fetched.
  Reads are GET and one GraphQL query per pull request; bodies are bounded (`boundedGitHubJSON`), lists capped (3 pages of
  100 for pull requests, reviews, commits, comments and files; 2 for the timeline). A refresh reads at most 60 rows (the
  single ones first, then the most recently updated, saying how many it left out), two at a time, at most 1500 requests
  (past it the refresh fails and the last list stays), at most 60 issues and 30 outside dependencies. A GET is repeated with
  `If-None-Match`; GitHub's 304 reuses the kept answer (at most 32 MB kept, none over 256 KB, least recently used out;
  dropped when the token changes). Redirects are never
  followed.
- Per watched repository: the captain's login (`GET /user`), then the open pull requests (`GET …/pulls?state=open`),
  filtered by author, assignee or requested reviewer. Per row: reviews, commits, comments, timeline, files, check runs on
  the head, and `closingIssuesReferences` (GraphQL).
- **Issues**: links from the body (any GitHub issue URL in any repository), `closingIssuesReferences`, and
  cross-referenced events in the timeline. An issue outside the watched repositories is read (title, state), marked
  external, and never written.
- **No settings yet**: with no environment set, each repository's own GitHub environments that have a successful
  deployment are shown (at most 6, production last; `github-pages` left out): one is on when the newest successful of its
  last five deployments contains the head (`GET …/environments`, the deployments and their statuses, then a compare, at
  most 120 compares a refresh, past which an environment reads "not read"). They are shown only: they never make the
  next step "deploy for testing", which needs environments set by the captain. With no evidence source set, no evidence is guessed: the column offers Set up,
  and the settings offer, as one-click additions, the accounts that commented on a row's pull request without authoring
  or reviewing it (bot accounts and the captain excluded).
- A refresh that lands while a row is dragged or its actions menu is open waits until they close.
- **CI**: GitHub's combined state of the head's check runs and commit statuses (GraphQL `statusCheckRollup`, read in
  the same query as the merge box), only when GitHub's last commit is the row's head: passing, failing, error, running,
  waiting, or "—" for none.
- **Approval groups**: each group the rules ask an approval from (a required team, a set of code owners) shows in the
  Reviews column as ✓ (with who approved) or ✕, ahead of each reviewer's own latest verdict.
- **Missing approvals**: from the base branch's rulesets (`GET …/rules/branches/<base>`) and its classic branch protection
  (`GET …/branches/<base>/protection`), the stricter of each: the required count, code owners (CODEOWNERS at
  `.github/`, the root or `docs/` on the base; every changed file's owners need an approval from one of them; patterns are
  matched without building a regular expression from the file, in time bounded by the pattern and path, with length caps;
  a file, line, pattern or path past those caps (200,000 characters, 2,000 lines, 256-character or 32-segment patterns,
  1,024-character or 32-segment paths), or a row whose check runs past 1,000,000 matching steps, makes the code owners
  unreadable, never a silent non-match; owners found for a path are shared by the rows of one repository and base;
  a CODEOWNERS that cannot be read, or changed files that could not all be read, make the approvals unreadable, never
  "no owner"), approval after
  the last push (GitHub: "the most recent reviewable push must be approved by someone other than the person who pushed
  it"; it dismisses nothing, so older approvals keep counting toward the number unless stale approvals are dismissed, and
  the latest push needs, in addition, one approval on the current head by someone other than the pusher, even when the
  approval count is 0; GitHub does not say who pushed, so the pusher is inferred as the pull request's author and the head
  commit's author and committer, and the row's detail says it is inferred; only when the head commit cannot be read are
  the approvals unreadable), stale
  approvals dismissed, required reviewer teams (members from the teams API). The author's own approval
  never counts; an approval given on an older head shows stale and counts unless the rules dismiss stale approvals (the
  pusher's own approval counts toward the number too, but never as the approval of the latest push). Classic protection needs admin access to read; rulesets, CODEOWNERS and team
  members need only read access. When GitHub refuses the protection (403, or 404 without "not protected") the rulesets
  decide, a required team named only by id is looked up by name (`GET /teams/<id>`), and the row's detail shows that the
  protection was not read beside GitHub's own merge box (GraphQL `reviewDecision`, `mergeStateStatus`, review requests).
  If those rules miss nothing yet GitHub's review decision is `REVIEW_REQUIRED`, the protection asks for more: the missing
  review is "a review GitHub still requires", from the pending review requests. If they miss nothing and GitHub still
  blocks the merge, the row is on hold (rule 9), not ready; without the merge box at all, the rules are unreadable. Only when the rulesets themselves cannot
  be read, or the protection read fails any other way, are the rules unreadable (the next step names "rules unreadable").
- **Refresh**: when the page opens, every 5 minutes, and on the Refresh button. The timer runs on the shared
  `GitHubPoller` (src/github-poller.ts) under its own key, never a repository's, so it cannot collide with a project grant
  or the dashboard; a failed refresh backs off (10, then 15 minutes), and a rate limit (403 with no remaining, or 429)
  fails the whole refresh and keeps the last list. A refresh asked while one runs waits for it and reads again.
- **No read/unread state.** A row that changed in the latest refresh carries a left accent bar and "changed N min ago:
  what" (new commits, a review, the evidence, an environment, the next step); the mark stays until the next change. A
  settings change starts the marks afresh.
- A refresh's result is filtered by the watch list as it is when the refresh ends: what the captain removed meanwhile
  stays removed.
- **State**: `<data>/pr-watch/state.json` (watch list, settings, Studio's order and dependencies, what Studio wrote) and
  `<data>/pr-watch/snapshot.json` (the last refresh), 0600, never in a repository.

## Merged, until production

A merged pull request stays on the page until it runs in production. Two more tabs, after a separator and marked new:
"Merged, not live" and "Live", each with its count.

- **Which**: a watched repository's merged pull requests opened by or assigned to the captain (the recently closed pull
  requests, `GET …/pulls?state=closed&sort=updated&direction=desc&per_page=20`, up to 5 pages, stopping at one updated
  before the 30 days; a page larger than the 1 MB Studio reads from GitHub is read again as four pages of 5, and a
  page still too large is reported as such, never as "could not be reached"), and a single watched pull request once
  merged; merged in the last 30 days, or already followed. One followed that those pages no longer show is read on its
  own (at most 30 a refresh). At most 40 merged rows a refresh, the ones merged last.
- **Release base only**: a pull request is followed only when it was merged into a release base: the repository's
  default branch, read from GitHub (the pull request's `base.repo.default_branch`, else `GET /repos/<repo>` once a
  refresh; never assumed to be `main` or `master`), or a branch a production environment of the settings deploys
  (detected by "branch"). One merged into any other branch, such as a sub-pull-request merged into its umbrella pull
  request's integration branch, is on neither tab: it reaches production with the pull request that merges that branch,
  which is the one followed. Such a pull request already in `state.json` (`shipped`, or marked by hand in `manual`)
  from before this rule is dropped on the next refresh that reads it, nothing else changed (the snapshot's `offBase`:
  id → base). When the default branch cannot be read, the row is followed as before rather than dropped on a guess.
  A repository whose production runs another branch than the default (a hotfix merged straight into `main` while the
  default is `develop`) sets a production environment detected by "branch" on that branch, or those rows are left out.
- **Environments**: the same settings as the open rows (or the repository's own GitHub environments), read against the
  **merge commit** (squash or merge), never the old head: an environment has the pull request when the commit it runs
  contains the merge commit (`compare`). A GitHub Deployment environment: its newest successful deployment of the last
  five; a check run: on the merge commit; a branch deployment and an image tag in a file: as for the open rows.
- **State**: merged → each pre-production environment → in production. A row waits on the environment after the
  furthest one that has it (the first when none does). In every production environment it moves to "Live", from the
  refresh Studio first saw it there, and is dropped 14 days later, recorded so it never comes back
  (`state.json`: `shipped`, `retired`). No production environment set: it says so and never goes live.
- **Reverted**: a followed row that a merged pull request in the same watched repository reverts never reaches
  production as itself, so it is dropped on the refresh that sees the revert, and recorded so it never comes back
  (`retired`, and `reverted`: the row → the reverting pull request, the last 500). A revert is GitHub's own Revert
  button output: a body line `Reverts <owner>/<repo>#<n>` naming the row's repository (any case), or else the title
  `Revert "<the row's exact title>"` in the same repository. It may be by anyone (the mine/assigned filter does not
  apply) and is read from the closed pull requests already read above, so it costs no extra GitHub read. A revert that is
  open or closed unmerged does nothing; a revert that a merged revert itself cancels (`Revert "Revert "…""`, or
  `Reverts …#<the revert>`) does not drop the row: the newest merged revert of a chain decides.
- **Dropped by hand**: × on a merged row (either tab) drops it like an open row's: one that came in through its
  repository is recorded as excluded (`watch.excluded`, not followed again) and the "excluded · restore" chip brings it
  back; a single watched pull request stops being watched.
- **Marked in production by hand**: for a captain who cannot read production's version (no access to the deploy
  repository or environment), each row on "Merged, not live" has "Mark in production" (標記已上線), and the ticked rows
  can be marked at once ("Mark in production (n)" beside the release brief; `POST /api/prs/ship/mark {prs}`, at most 50,
  each one on "Merged, not live" or the whole request is refused). A marked row moves to "Live" with a "Marked by hand ·
  <day>" badge and is dropped 14 days after the mark, like a row production shows (`state.json`: `manual`, the row → the
  mark time, the last 500; also written into `shipped` as the live time). It stays live on every refresh although the
  environments still do not show it: the release brief no longer offers it, nor warns that a tag carries it, and
  `pr.track-deploy` reads it as in production. On "Live" only a marked row has "Undo" (撤銷, `POST /api/prs/ship/undo
  {pr}`): it goes back to "Merged, not live". When the environments later show it in every production environment, the
  mark is dropped and it is an ordinary live row with no Undo, **keeping the mark time** as its live time (the earlier
  of the two, so the 14 days are not restarted). A `state.json` written before marks existed loads with none.
- **Columns**: #, the pull request, going live · waits on (how long since the merge), the merge commit and when, the deploy
  unit (the repository) with its dependencies (Studio's record, else the body's `Depends-on:` lines or block), the
  environments.

## Release brief

On "Merged, not live", tick rows and press "Release brief (n)" (`POST /api/prs/brief {prs}`; reads GitHub at most 300
times, writes nothing). The dialog shows one card per batch, each with its own Copy, and a language picker.

- **Batches** (`src/pr-watch-release.ts` batchesOf): pull requests that depend on each other (Studio's record, else the
  body's `Depends-on:` lines or block) go in different batches; independent ones, of any repository, share one. A batch
  is one deploy pull request and one brief; its first line says which batch it is and that it waits for the one before
  to run in production, naming the dependency that forces it. A dependency the captain did not select (merged, not live)
  is added to the batch before, with the reason; one not merged yet is a warning.
- **The line to change**, per deploy unit (the repository) and per production environment that reads an image tag from
  a file: `repository · path`, the line with the old tag and with the new one, built from that environment's template.
  The old tag is the file's (or the batch before's new tag). The new tag is the newest of the repository's tags (as
  GitHub lists them, first 20) whose commit contains every selected merge commit of the unit up to this batch, none of a
  later batch's, and whose CI is green (no failing or running check run or status; no CI at all is allowed). The image
  tag is taken to be the git tag's name. When that tag also carries a merged pull request that was not selected, the
  brief says so. No such tag: the line says what is missing instead. No production environment reading the unit's tag
  from a file: the text says only `<repo> · image tag: not tracked (no production environment reads it from a file)`
  (no instruction to whoever reads it), and the dialog shows one action beside it, **Set up production** (the reason on
  its icon). It opens the settings with a new environment begun: named production, production ticked, an image tag in a
  file, only this repository, its file repository, path and template empty with the focus on the first. Repositories
  other file environments read are offered as suggestions and fill the field only when picked. Saving opens the brief
  again, in the language it was in, with the line old → new; closing without saving goes back to the brief too. With
  20 environments already (the most kept) the save is refused with a message, never dropped silently. Beside it,
  **Find automatically** opens Find environments automatically; closing it goes back to the brief.
- **Before going live** (上線前要處理), each item with the address of its file and line at the merge commit (the body's:
  the pull request) — no address, no item: files matching the captain's path rules (settings: migrations, configuration,
  secrets; CODEOWNERS-style patterns, by default `migrations/`, `migrate/`, `*.sql`); configuration and secrets the added
  lines newly read (environment variables in Node, Go, Python, Java, Ruby, Rust; Spring `@Value`; a name that only moved
  is not new; a name like `*_SECRET`, `*_TOKEN`, `*_KEY` is a secret); Kubernetes ConfigMaps and Secrets added; metrics
  the added lines create (Prometheus clients for Go, Node and Python, Micrometer): name, labels, type and whether the
  series start at 0, with a **suggested** rule (`increase(…[5m]) > 0` for a counter, `for`, noData = Alerting, and
  `up == 0`), said to be a suggestion since Studio cannot read the team's alert configuration; and the body's rollout
  section quoted as written ("PR text"). The rows show these as badges. None: "Before going live: none". The brief
  ends by saying these come from the diffs and the pull requests: the release agent may arrange them, never add any.

## Follow-through (PR 跟進)

Off by default (settings: "Follow-through"); on, after every refresh each watched open pull request is read again by
`src/pr-watch-follow.ts` `shepherd` and its branch decides one Inbox card, a Task of the internal workflow `pr-follow`:

- **Branches**, by rules: `code-change` (a reviewer's change request read as a code change, failing evidence, failing
  CI: back to the author, no card), `needs-evidence` → **Ask QA to test**, `evidence-covers-head` → **Ask reviewers to
  look again** (as soon as evidence covers the head while a reviewer's verdict is on an older head, or predates the
  evidence they asked for; no "stalled N hours" setting), `missing-approvals` → **Ask for approval**, `mergeable` →
  **Ready to merge**, `ask` → a card asking the captain. Draft, unread, required reviewer, dependency, environment,
  CI running: wait, no card.
- **A reviewer's comment** (the latest review's body and its inline comments) is classified by rules into code change,
  needs evidence, question or not blocking, always with the sentence quoted. No quote, two kinds, or a question → the
  captain is asked, and the answer is kept for that comment. *Deviation from the design*: Studio has no one-shot model
  step behind a card today, so the classifier is rules with quotes, not a model; a model classifier can replace
  `classifyNote` without changing anything else.
- **Mergeable is not built in**: the next step "ready" (the base branch's rulesets and branch protection all met —
  count, required teams, code owners, approval after the last push, stale dismissal — the required reviewers, the
  evidence when a source is set) and CI passing (or none configured). Rules that cannot be read ask; never satisfied.
- **The cards** (public/pr-follow.js, the Inbox's own layout): title, lead quoting the reviewer, done / missing, who to
  send to (a GitHub team's members read from GitHub, pick one, remembered per team), the editable message (QA requests
  cite only routes the diff adds, `<placeholders>` for the rest), Copy, Copy and DM, Send to a channel, the history
  (what was sent to whom and when, what happened on GitHub), Nudge again (the short version for the same person),
  Snooze until (the card leaves the Inbox until then), and the options. An option that waits (A: "I sent it") is
  recorded and keeps the card; the others answer it. A card closes by itself when GitHub shows what it waits for
  (Studio answers it as `studio (GitHub)`); an approve card that is partly met keeps only the groups still missing.
  The row on the page links to its open card. Firstmate cannot answer one.
- **Push before voiding approvals**: `POST /api/prs/push-check {pr, quote?, by?, tests?}` (for a worker round about to
  push): when the rules dismiss stale approvals and approvals exist, a card "this push voids N approvals"; when the
  rules ask for an approval of the latest push (none voided), a card "this push needs a new approval of its head"
  (with both rules on, the voids card adds that the new head needs an approval by someone other than the pusher);
  either with push / don't push (with a reason) / follow-up pull request. `quote` and `by` are the
  comment the change answers and who wrote it; without them Studio takes the latest reviewer comment it read as a code
  change, and its author. `tests: true` is the round's own result (its tests passed), shown under done; Studio does not
  guess it. One push card per pull request and head: asking again returns the one waiting.
- **Why PR follow-through is a hook node**: a check node can route by a check's outcome (`args.route_from`), but its
  outcome comes from checks that judge a round's work; the follow-through reads the Pull requests page's row (no check
  produces it) and picks one of five branches, which is what a hook action's outcome is. A deliberate deviation from the
  design's "check · pr.shepherd".
- **On the Workflows page**: `pr-follow` is the one internal workflow shown there, read-only (docs/units/default-workflow-catalog.md
  "Internal workflows shown read-only"): its card says whether follow-through is on, and its page shows the graph, every
  branch with the card it makes (`FOLLOW_BRANCHES` in `src/pr-watch-follow.ts`, a record over the shepherd's branches)
  and a link to the Pull requests page, where the switch is (settings → Follow-through). Nobody starts, edits, renames,
  trashes or holds it there; Studio starts it.
- **Studio never** @-mentions on GitHub, re-requests a review, merges a pull request it did not open, or sends anything
  without the captain's click. It writes nothing to GitHub here.
- **The github-review workflow** shows the same nodes (PR follow-through `pr.shepherd`, the three cards, Follow to
  production `pr.track-deploy`, Release brief). That workflow is held (draft-only, docs/retro/2026-10-17-github-review-held.md):
  its runtime activation (rebuilt from code-firstmate) is what runs these nodes inside Studio's own coding Tasks; until
  then the follow-through runs for watched pull requests through `pr-follow`.

## Sending

Settings: **send targets** (name, tool — Slack, Lark, DingTalk, Microsoft Teams, Discord, generic JSON —, incoming
webhook, what it is used for by default, Send test). **Send test** (or Enter in the webhook field) posts a fixed test
text once to the webhook as it stands in the field — a saved one (the masked form) or one just typed and not saved; a
typed one is used for that post only and kept only when the captain saves. The row says the result: sent, with the name
the captain gave it to check, since an incoming webhook does not tell Studio its channel (and "not saved" when it was
not), or why not (the host rule, the address, the status the webhook answered). The webhook is a secret: it lives in `state.json` (0600) under
`hooks`, never in a repository, and the page sees it masked; typing a new one replaces it. https on the tool's own host
only (`CREW_WEBHOOK_LOOPBACK=1` lets tests use a loopback stub). Sending posts the text once, the GitHub logins of
contacts turned into Slack mentions. **Contacts**: GitHub account → Slack member id, Microsoft Teams or email address.
**DM** (copy and open): the message is copied (Clipboard API, `execCommand` fallback) and the server builds the link from
the contact only — `slack://user?team=<workspace>&id=<member>` (paste needed), a Teams chat with the message filled in,
or `mailto:` with subject and body; no contact, copy only. The page opens only those three kinds of address, never one
from a pull request, comment or message.

**Slack bot (optional)**: a bot token (scopes `users:read`, `im:write`, `chat:write`) is kept like a webhook — in
`state.json` (0600) under `botToken`, never in a repository, never in `settings`, the page sees only that it is set and
a masked form; a new value replaces it, the masked form keeps it, an empty field clears it; an agent CLI's settings never
touch it. Studio talks to Slack only on a click, with three Web API methods (`users.info`, `conversations.open`,
`chat.postMessage`), the token in the `Authorization` header, never in an address, on Slack's own host (`CREW_SLACK_API`
may name a loopback test server only while Studio runs under its tests, `CREW_TEST_ENV_ISOLATED`; otherwise it is
refused). **Check contacts** (校驗聯絡人) asks `users.info` for each Slack contact and keeps, per contact, the member id
and workspace checked, the name Slack reports (real name, then the display name when it differs), the time and the
verdict. A contact fails when its `team_id` is not the workspace id set, it is deactivated (`deleted`), a bot
(`is_bot`), external (`is_stranger`, Slack Connect), or Slack answers an error. Nothing is corrected: the captain edits
the table; a contact whose member id or the workspace id changed since its check needs checking again. On a card, for a
recipient whose check stands, **DM <name> via Slack** opens a confirm step showing the GitHub login → the Slack name as
last verified → the member id, and the full message; only its Send button sends (`follow/slack-dm`). The recipient is
resolved from the contact settings by the GitHub login alone, which must be someone the card is for — never from the
message, the pull request, a comment, or any other field of the request. Before sending Studio asks `users.info` again
and sends nothing when any fail rule holds or the name differs from the one the confirm showed; then it opens the DM and
posts the message once. The card's history records who it went to (login, name, member id) or why it was not sent.
**Send test DM** on a Slack contact row (or Enter in its id field) takes two steps, like every bot DM: the member id in
the field, with the bot token and workspace id as they stand in the dialog (typed or saved; nothing is kept). The first
click or Enter only asks `users.info` (the Check contacts fail rules) and shows on the row "Send test DM to <real name>
(@handle)?", the button now reading Send; nothing is sent. The second click or Enter asks `users.info` again, refuses
when the name differs from the one shown, then `conversations.open` and one `chat.postMessage` of the fixed test text.
Editing the id (or its tool) starts over. The row shows the DM channel Slack opened and the name, or the reason.

**Message guard**: Copy and DM, a Slack DM and a channel send refuse a message with a link that is not https (any
`scheme://`, the bare `javascript:`, `data:`, `mailto:`, `slack:` … forms, and Slack's `<scheme:…>` links) or a URL with a
user name or password before its host (`https://user:pass@…`). The wording is never judged.

## Next step and who it waits on

The first matching rule, top to bottom; deterministic, no model:

1. draft: on hold (the author)
2. Studio could not read every review or comment (a read failed, or more than the 300 it reads): on hold, see GitHub. A
   change request or a later failing verdict may be among the unread ones, so such a row is never ready.
3. a reviewer asked for changes: fix (the author)
4. a required reviewer has not reviewed: wait for that reviewer
5. a dependency is not merged: wait for that pull request
6. the head runs in no pre-production environment (when any is set): deploy for testing (the author)
7. the evidence verdict is fail: fix (the author). Failed evidence never falls through to "ready".
8. (when an evidence source is set) no evidence, unclassified, code review only, or evidence for an older head: test
   (the evidence sources), "test only the change since <sha>" when an older head was tested. With no source set the
   rule does not apply, as with environments; the evidence column offers Set up.
9. approvals missing, or the rules unreadable: approve (the missing people, owners or teams)
10. branch protection unread and GitHub blocks the merge for a reason the readable rules do not show (a required check,
   a rule Studio cannot see): on hold, waiting on the merge box on GitHub; never a missing approval
11. otherwise: ready to merge (the captain)

## Order and dependencies

- **Proposal**: from the pull requests themselves, each with its reason. A dependency is proposed only where the merge
  order is forced: a `Depends-on:` line in a body, or a pull request based on another's head branch (stacked). Everything
  else only orders: a body naming another watched pull request (that one first), files both change and an issue both
  link (the older first). These hints never hold a row back. The order puts every dependency first, then those hints,
  then age. It shows as
  proposed (dashed, tagged, the position in italics) until the captain accepts it ("Accept", or "Accept and apply…").
- **AI proposal: a follow-up.** Studio has no one-shot model step behind a captain card today; this unit ships the
  signals-based proposal. Asking a model to propose (through a captain card) is the next step of this unit.
- **Captain edits**: drag to reorder; add or remove a dependency on a row (from the list or by `owner/repo#n`). An edit
  replaces the proposal for that row and is Studio's record.
- **A block already on GitHub**: a row with no record of Studio's (its state was lost, or another Studio wrote the block)
  takes its dependencies from the valid `crew-studio:depends` block in its body, shown as from GitHub.
- **Applied on the pull request**: only through a captain-only card (workflow `pr-watch-apply-depends`, in the Inbox)
  that shows each target repository, pull request and the exact block. Studio reads each body when the card is made and
  again right before writing; a body that changed in between is left alone and the Task says so (apply again). The card
  also shows the block GitHub has now. Only the marked block is replaced (or added at the end, after the body as it is
  and one blank line, so removing it gives that body back exactly); everything else in the body is kept byte for byte,
  line endings, trailing spaces and blank lines included. The card's answer updates Studio's record only while the row
  still has the dependencies the card was made from: a change made since (on the page, by a CLI) is kept, and the row
  does not say applied until its record and the block agree. After the write Studio compares the body GitHub kept with what it
  sent (line endings and trailing spaces normalised, the block itself exactly) and reports a difference instead of
  recording the block as applied. A Task that ends while GitHub answers writes
  nothing more.

  ```
  <!-- crew-studio:depends -->
  Depends-on: https://github.com/<owner>/<repo>/pull/<n>
  <!-- /crew-studio:depends -->
  ```

  When a row has no dependency left but GitHub still has the block, the same card removes the block: the block, its own
  line ending and at most the one blank line that set it apart; every other byte of the body stays, paragraph breaks
  included.
  Studio never writes a block over 4000 characters (too many dependencies are refused before the card, with the reason).
  A body with an unpaired marker, two blocks, a block over 4000 characters, or a block holding anything but
  `Depends-on:` lines naming pull requests is refused (a marker pair
  around other text would otherwise delete it unseen). Firstmate cannot answer the card; closing it writes nothing.
- **Drift**: every refresh compares the body's block with what Studio wrote. A block edited or removed on GitHub turns
  the row's dependency cell amber, "the hint on GitHub changed", with two actions: apply Studio's record again (the card),
  or take GitHub's version as Studio's record.

## Actions on a row that misses approvals

- **Ask for review**: a drafted message (the pull request, what it does, its evidence, environments, dependencies, who is
  missing), in the language the captain picks; Copy. "Send via connector" is disabled with the reason while Studio has no
  messaging connector. Studio never sends by itself.
- **Open in the review room**: the existing review room for that pull request (`POST /api/review-room/open-pr`,
  docs/units/review-room.md); its refusal (a repository that is not a connected project) shows as is.
- **Handoff report**: today a one-page Markdown report of the row for a reader the captain names, copied. **Follow-up**: a
  Task that writes it, started only from its dispatch card (no existing dispatch path fits a report of pull requests yet).
- **Copy as Markdown**: that row (the list's toolbar copies the rows the current filter shows).
- Copied text (the report, Markdown) leaves out the titles of issues outside the watched repositories: their links stay.

## From an agent CLI

A pull request list grant (docs/units/cli-mcp-grant.md, scope `prs`) lets the captain's own claude or codex read the list
and make the same edits over MCP (`tools` in `src/pr-watch.ts`, the board's `act`); never a GitHub write.

## Routes

`GET /api/prs` (the list from the last snapshot; never calls GitHub), `GET /api/prs/count`; and, desktop only, through the
CSRF/session guard: `POST /api/prs/refresh`, `/watch {url}`, `/unwatch {repo|pr}`, `/restore {pr?}`, `/settings`,
`/order {order}`, `/deps {pr,on}`, `/group {pr,group}`, `/accept`, `/drift/take {pr}`, `/apply {prs,shortForm}`,
`/ship/mark {prs}`, `/ship/undo {pr}`, `/sending/check` (Check contacts), `/sending/test {target,tool,url,name}` (Send
test: the fixed text to the typed or saved webhook), `/sending/test-dm {id,token?,team?,name?}` (Send test DM: without `name` who the id is, nothing sent; with the name shown,
the test DM), `/follow/dm-preview {card,login,text}` (the confirm step:
sends nothing) and `/follow/slack-dm {card,login,text,name}` (the confirmed Slack DM).

## Done when (`bun tests/pr-watch.ts`, `bun tests/pr-watch-ui.mjs` (run with bun: it imports the TypeScript fixture), `bun run test:pr-watch` for both; a fictional GitHub, tests/lib/pr-watch-github.ts: three watched repositories, an issues-only one outside the set, an infrastructure repository and a single pull request elsewhere)

1. The set is exactly the open pull requests opened by or assigned to the captain in the watched repositories, plus the
   single one — pr-watch.ts "the set: …".
2. An issue linked from the body in an unwatched repository shows its title and state, marked external, and nothing is
   written to it — pr-watch.ts "an issue linked from the body …", "nothing is written to the external issue".
3. Missing approvals follow the rules fixture: the ruleset's count, a code owner, a required team, the author's own
   approval ignored, a stale approval, classic protection dismissing stale approvals, unreadable protection —
   pr-watch.ts "missing approvals from the ruleset …", "classic protection …", "branch protection that needs admin …".
4. An environment shows the head as running from each of the four detectors — pr-watch.ts "a GitHub Deployment …",
   "a check run by name …", "the latest deployment of a branch …", "an image tag in a file …".
5. Evidence from a listed account is classified; evidence naming an older head reads "test only the change since";
   an unclassifiable comment reads "unclassified" — pr-watch.ts "evidence from the listed account …", "evidence naming an
   older head …", "a comment the rules cannot classify …".
6. Each next-step rule fires on its fixture and the first match wins; failed evidence is a fix, never ready —
   pr-watch.ts "<id>: next step …", "the first matching rule wins …", "failed evidence: fix, never ready".
7. Refresh on open, on the button and on the interval; a changed row is marked with what changed; no read/unread state —
   pr-watch-ui.mjs "opening the page refreshes", "the refresh button reads GitHub …", "the 5-minute timer (shortened here)
   …", "the changed row is marked with what changed", "no read/unread state anywhere"; pr-watch.ts "the mark stays …".
8. The proposal shows as proposed with reasons; a drag and a dependency edit replace it for that row — pr-watch-ui.mjs
   "the proposal shows each dependency with its reason", "a drag (…) reorders …", "a dependency edit becomes Studio's
   record …".
9. Applying writes only the marked block, only after the captain's card; a body changed after the card is not written; a
   block edited on GitHub turns amber and both drift actions work — pr-watch.ts "nothing is written before the captain
   answers", "Firstmate cannot answer it", "only the marked block was added …", "a body that changed after the card …",
   "take GitHub's version …", "re-applying Studio's record …"; pr-watch-ui.mjs "the captain's approval writes …",
   "a block edited on GitHub turns the cell amber".
10. The actions on a row missing approvals: the draft names the missing people, the connector button is disabled with its
    reason, the review room is asked for that pull request, the report and Markdown are copied — pr-watch-ui.mjs.
11. Addresses are parsed strictly; settings are validated; the API origin is api.github.com — pr-watch.ts "refused: …",
    "settings: …", "the API origin …"; the token is in no file and no answer — "the state lives in Studio's data directory …".
12. No name of an organisation, repository, team or account is in the feature's source — pr-watch.ts "no organisation,
    repository, team, bot or account name is hard-coded …".
13. Review round 2 (tests/pr-watch.ts "round 2" and the UI suite): CODEOWNERS globs and verdict lines in bounded time,
    the environment pattern per line and nested quantifiers refused, negated passes, CRLF kept and marker pairs around
    other text refused, unreadable CODEOWNERS, ETag reuse, evidence naming no commit, a write GitHub kept differently, a
    cancelled Task writing nothing; in the page: one toast at a time, one-line missing-approval button, all columns at 1440,
    the × on touch screens, Try again after a failed load, focus kept across a live update, the row menu copying one row.
14. Review round 3 (tests/pr-watch.ts "round 3"): CODEOWNERS past the caps reads unreadable; removing the block keeps
    paragraph breaks (LF and CRLF) and round-trips an appended block byte for byte; after the last push, an older-commit
    approval counts toward the number unless stale approvals are dismissed, the head committer's (the inferred pusher)
    counts toward the number but never meets the latest-push requirement, the author's never counts, and someone else's on
    the head meets it (corrected in review round 8).
15. Review round 4 (tests/pr-watch.ts "round 4", the UI suite): after the last push with a count of 0 still needs one
    approval; CODEOWNERS work bounded per row; the ETag cache bounded by bytes; the environment template matched as
    literal text; the block on GitHub refused unless Depends-on lines naming pull requests; a normalised body still a
    good write; in the page: "+n" and the names in the Missing cell (two lines at most), the proposed tag inside its
    column, aria-expanded on the missing-approval button.
16. Review round 5 (tests/pr-watch.ts "round 5", the UI suite): a template with nothing before {tag} is refused and never
    loops; a suffix after {tag} matches; an over-long or all-digit tag is no commit; too many dependencies are refused
    before the card; a bad saved template is dropped on load with a message; in the page: the template hint, "+1
    approval", and a second click closing the menu.
17. Screenshots at 1440 and 390, light and dark, in tests/out/pr-watch/; no sideways page scroll at 390 (the table scrolls
    inside its card); a title with HTML is shown as text — pr-watch-ui.mjs.
18. Merged pull requests are followed until production (`bun tests/pr-watch-merged.ts`): the captain's merged ones only,
    each environment read at the merge commit, a closed page over 1 MB read again in pages of 5, the merged and live tabs, live from the first refresh that saw it, dropped
    14 days later and never back, unwatching drops them; a row a merged revert cancels (`Reverts …#n` by someone else,
    or only the title `Revert "…"`) dropped and recorded, an open or unmerged revert or a reverted revert leaving it;
    × on a merged row excludes it and restore brings it back; only a release base is followed: a sub-pull-request merged
    into its umbrella's branch is not, the umbrella merged into the default branch is, a default branch other than main
    (read from the repository when the pull request lacks it) and a production environment's branch work, and an older
    state.json's sub-pull-requests are dropped on the next refresh with nothing else lost; in the page the two tabs, their columns and Markdown —
    pr-watch-ui.mjs "the merged and live tabs …", "a merged row: on staging …", "the live tab …".
19. The release brief (`bun tests/pr-watch-release.ts`, pr-watch-merged.ts "selecting 22 alone …", the UI suite): the
    items from path rules and added lines, each with its address; the suggested alert rule; the rollout section quoted;
    dependent pull requests in different batches, an unselected dependency added before with its reason; old → new tag
    skipping a later batch's tag and a red CI; a tag carrying an unselected pull request said; in the page the badges,
    the button, one card and one Copy per batch, Simplified Chinese; with no production file environment the neutral
    note in the text and the copy, Set up production opening the settings with the environment begun and a suggested
    repository not filled in, and after saving the brief again with the image line (pr-watch-ui.mjs "the text has a
    neutral note …", "saved: the brief opens again …").
20. Marked in production by hand (pr-watch-merged.ts "marked in production by hand", the UI suite): a row marked moves
    to Live with the mark time and stays there after a refresh and a restart; the brief no longer offers it or warns it is
    carried; Undo returns it; the ticked rows are marked in one action; a live, unlisted or empty mark and an Undo of a
    row not marked by hand are refused; production confirming a marked row drops the mark and keeps the mark time; a
    marked row is dropped 14 days after the mark; a `state.json` without marks loads; in the page the row button, the
    badge, Undo only on a marked row, and the button for the ticked rows.
21. The Slack bot (`bun tests/pr-watch-slack-dm.ts`, against a fake Slack Web API in the test; pr-follow-ui.mjs "a
    Slack DM …"): the token is kept, masked, kept on the masked form, cleared on an empty field, never in the list's or
    the sending view and never set by an agent CLI's settings; Check contacts passes a member of the workspace and fails
    another workspace, a deactivated account, a bot, an external account and an API error, each with its reason; a DM
    is offered only for a contact that passed; the confirm step (dm-preview) sends nothing; a DM without the confirmed
    name, or after the name changed or the account was deactivated since the check, is refused with the reason in the
    history and nothing posted; the member id comes from the contacts only (ids, channels or users in the request are
    ignored); a confirmed DM opens the DM and posts once, the token only in the Authorization header; a message with an
    http, `javascript:` or `user:pass@` link is refused for the Slack DM, Copy and DM and a channel send. Send test and
    Send test DM (pr-watch-slack-dm.ts "Send test …", pr-follow-ui.mjs "Enter on an unsaved webhook …"): Enter on an
    unsaved webhook posts the fixed text there and says so on the row; a 500 or a host that is not the tool's own shows
    the reason inline and posts nothing; the typed webhook, token and contact are not kept unless saved; a test DM's first
    step shows whose id it is and calls neither `conversations.open` nor `chat.postMessage`, editing the id resets it, a
    second step with another name is refused, and the second step goes to the DM Slack opened with the name it reports;
    a deactivated, other-workspace, bot or unknown member is refused.
22. Find environments automatically (`bun tests/pr-watch-envs.ts`, `bun tests/pr-watch-envs-ui.mjs`, against the
    fictional GitHub with an invented config repository): environment names from GitHub and from paths, image names
    strong and weak, manifest templates (inline, kustomize, Helm values) kept only when Studio's reader finds that line,
    one environment with a detect per repository, old settings folded with every repository seeing the same
    environments (and an interleaved one left apart), the review table (ticked, pick, set, skipped), Accept saving one
    production for two repositories, a refresh then reading production from the accepted manifest, nothing written to
    GitHub, the budget and its message, a truncated tree, a rate limit; in the page Cancel saving nothing, the picks
    holding Accept, Advanced's per-repository rows, and screenshots at 1440 and 390, light and dark.

Touches outside the unit's own files: public/backbone.js (the sidebar item and its count), public/index.html (the script
and stylesheet), src/server.ts (the routes, the install, the timer), src/runtime/defs.ts and tests/lan-workflows.ts (the
internal apply workflow), tests/acceptance/pr-watch-apply-depends.yaml, tests/backbone-ui.mjs and tests/board-ui.mjs (the
sidebar order), docs/architecture.md (UI line), docs/units/backbone-nav.md.
