# Extraction

How a packet's ground truth is gathered. You gather it yourself — with `git`,
`gh`, `find`, and reading — and every fact in the packet must trace to what
you gathered. You never invent nodes or edges — see `diagrams.md` for what
you *are* allowed to do.

## Layers (graceful degradation)

Extract as deep as the repo allows. Always state the layer reached in the
packet; never let a diagram imply more certainty than the layer supports.

| Layer | Source | Yields | Availability |
|---|---|---|---|
| L0 | `git diff` / `git log` over the merge-base range | changed files, hunks, churn, ordering | always |
| L0 | the session itself — your context window, or the transcript JSONL under `~/.claude/projects/<slug>/` | files read/edited, commands run, **paths tried and abandoned** | always |
| L1 | reading the source: import/require/use lines | the import structure | any text repo |
| L1 | reading the migration files' SQL | schema delta, ordering, reversibility | convention-detected |

Anything not reached is **omitted, not guessed**. A packet that reached L1
says so, and its sequence diagram is labelled as inferred from imports, not
verified call order.

Explicitly out of scope: framework-specific extraction (Express routes, Rails
controller introspection, Django URL confs). It does not generalise, and
reading the code directly serves better.

## Scope: the session decides, not the repo

A monorepo carries many unrelated businesses, and ranking components by repo
size surfaces whichever subsystem is biggest — almost never the one the
session was about. The session already knows where the work happened: it
names the files it opened, edited, and ran tests against. For your own
session that knowledge is already in your context window; for one you did not
run, it is in the transcript JSONL. Use it:

1. **Focus** = the files the session touched, plus the files changed in the
   git range (weighted heavily; they survived). Paths mentioned in shell
   commands count too — `go test ./internal/checkout/...` says as much about
   location as an edit does.
2. **Subject** = the few components that cover most of that focus. A session
   that genuinely spanned three areas reports three; one that lived in a
   single package reports one. Resist padding: every component past the real
   ones dilutes the story.
3. **Context** = the immediate neighbours the subject actually talks to — the
   handful worth drawing, not every importer. A component drawn with no
   surroundings explains nothing, but every extra ring costs the reader more
   than it tells them.
4. Everything else is omitted.

Attribution must be exact — file path membership, or directory prefix for
paths from shell commands. Substring matching pulls in every component whose
name appears anywhere in a path, and the monorepo then looks like it was
worked on all at once — the failure this scoping exists to fix.

Verified on a Go monorepo of 26 packages: a session that lived in checkout
scoped to `checkout` and the API layer, against a repo-wide ranking that led
with two unrelated subsystems purely because they hold the most files.

When the whole repository really is the subject — an audit, a repo-wide
refactor — scope to the repo and say so.

### Plumbing

Shared helpers — error types, generated protobuf, hex encoding, constants —
are depended on from everywhere and depend on nothing. They are real, but
drawing them says only that the codebase has utilities. Recognise them by
reading: the package everything imports and that imports nothing back is
plumbing. This is a judgment call, not a fan-in/fan-out computation — do not
build the metric; read the tree and decide. Exclude plumbing from context
(never from the subject — if the session worked on one, that is the story).

## What commits already say

A commit is a structured record of a change, written by the person who made
it, and it is cheaper and more reliable than anything inferred from the tree.
Read it first:

- **Conventional-commit scopes** name the subject outright. `fix(checkout):`
  is a declaration, not a guess. Pull them from the range:

  ```
  git log --format='%s' <merge-base>..HEAD | grep -oE '^[a-z]+\(([^)]+)\)'
  ```

  On a real Go service, 137 of 400 commits carried one and the top scope
  matched what session scoping derived independently — worth having as a
  second, agreeing source, not enough to stand alone at that coverage
- **Subjects and bodies** carry intent that no diff contains
- **The range itself** decides which files are in scope at all

Scopes are free text. `deps`, `ci`, and scopes naming no known component are
left alone rather than mapped to the nearest match: a wrong attribution reads
exactly like a right one.

What commits do **not** contain is the dependency graph. No commit says that
one component imports another, and an architecture diagram is mostly edges.
That is what reading the source is for — commits choose the nodes, the
imports you read draw the lines between them.

## What the pull request adds

Four things live in the forge and nowhere else. Fetch them directly:

```
gh pr view --json number,title,body,baseRefName,reviews,comments,statusCheckRollup
gh pr diff <N>
gh pr list --search "<terms>"        # when the branch has no obvious PR
```

- **The real boundary.** `git merge-base HEAD origin/<base>`, instead of
  guessing how many commits back the work began — a guess that is wrong for
  any branch that ran longer than the guess
- **Whether the tests passed.** Not derivable from source at any effort
- **Why the work was done.** The description and its linked issues
- **What review changed.** A `CHANGES_REQUESTED` round is an abandoned
  approach with the reasoning recorded beside it

When there is no PR or `gh` cannot reach the forge, say so in the packet
rather than degrading quietly — the reader must know the review record is
absent, not empty.

The PR does not replace the session: a pull request shows what was pushed,
and approaches tried and reverted before the first push exist only in the
session.

## Grouping files into components

Diagram nodes are components, not files. Group by reading the tree, and keep
the grouping explainable — you should be able to say why any file belongs to
its component, in one sentence, by path.

Repos organise themselves one of two ways, and the right grouping differs.
Look at the top-level source directories:

- **Domain-oriented** (typical Go, Rust, Java, modular Node): directories
  already are components. Verified on a real Go service: of 26 packages,
  ~70% of directory names were business-legible as-is (`billing`,
  `portfolio`, `notifications`, `search`, `checkout`). The remainder were
  opaque three-letter package names that needed the naming evidence below.
- **Role-oriented** (Rails, Django, Laravel, classic MVC — directories like
  `controllers`, `models`, `services`, `jobs`): the directories carry no
  domain signal. Group instead by the domain noun in the file names — strip
  the role suffix (`_controller`, `_job`, `_service`, `_serializer`, …) and
  what remains is the component. Verified on a real Rails service: this
  surfaced `token_event`, `dapps`, `account_permission_update`, `risk_cases`,
  `notifications`, `devices`, `claim_activity` — all business-legible — while
  the framework boilerplate (`base`, `application`, `form`) was dropped.

## Naming evidence

Name a component from repo evidence only. Read, per group:

1. the directory or domain noun the group came from
2. the exported symbol names inside it — function, class and type names
3. the file names in the group

That is sufficient. Symbol lists alone resolve most cryptic package names —
illustrated here on an invented storefront service:

- `pxdb` → `BatchFetchProductInfo`, `SearchByCategory`, `BuildProductCard`
  → *Product Catalog*
- `harvester` → `AddOrder`, `OrdersBySince`, `AcquirePendingImportBatch`
  → *Order Ingestion*
- `checkoutd` → `EstimateShippingFee`, `GetPaymentReceipt`, `GetSubmittedOrderByRef`
  → *Checkout & Fees*
- `cartview` → `DecodeCart`, `BuildLineItems`, `DiscountTargetSKU`
  → *Cart Preview Before Purchase*

No human business knowledge was required for any of them. If a group's name
cannot be derived this way, label it by its directory and mark it unnamed —
do not invent a business meaning.

## Name stability

Write the names to `.baton/components.json` and commit it. Later packets
reuse them unless the grouping itself changed, so a reader watching a project
over weeks sees one diagram evolving rather than a new vocabulary each time.

Each entry stores all three languages, because a component whose name only
works in English is usually still stuck at the code level:

```json
{
  "id": "checkoutd",
  "files": ["internal/checkoutd/**"],
  "label": {
    "en": "Checkout & Fees",
    "hant": "結帳與費用",
    "hans": "结帐与费用"
  }
}
```
