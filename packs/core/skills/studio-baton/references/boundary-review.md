# Boundary review: the last section of every packet

Every packet ends with a review of the places where one system calls or reads
another. That is where unhappy paths and version skew live: a client and a
server each correct on their own, wrong together. The section exists so the
reader — and, for a pull request, its reviewers — see those risks before they
ship.

**No finding is a valid result.** If a boundary checks out, say so in one line
and name what was checked. Never invent a risk to fill the section; a padded
review teaches the reader to skip it.

## 1. Find the boundaries

A boundary is any crossing between independently deployed or independently
versioned parts. Look for them in the diff, the pull request, the design
document, or the session:

| boundary | what to look for |
|---|---|
| client ↔ server API | request/response types, handlers, RPC methods, headers, auth, serializers |
| service ↔ service | RPC/HTTP clients, gRPC protos, retries, timeouts |
| producer ↔ consumer | queue/topic payloads, job arguments, event schemas |
| app ↔ OS / third-party SDK | identifiers, storage (keychain, prefs, local DB), push, background lifecycle |
| code ↔ shared data | schema migrations, columns read by old and new code, caches |
| us ↔ external party | webhooks, payment/chain providers, partner APIs |

List each crossing the work touches, with `file:line` on both sides when the
code is available. A change that crosses no boundary gets the one-line "no
boundary crossed" result and nothing more.

**Client ↔ server contracts deserve the closest read.** They are versioned
independently, old clients never disappear, and identity usually comes from
client storage the server cannot inspect.

## 2. Check each boundary through six lenses

| lens | the question |
|---|---|
| identity | Can two things share a key, or one thing get two? (copy, restore, migrate, reinstall, reuse) Who is the caller, and can the value that says so be copied or forged? |
| truth | Who owns this state? What happens when a cache, replica, client or offline copy disagrees? Can the server tell? |
| effect | Does the action happen exactly once despite retries, timeouts with unknown outcome, crashes mid-way and concurrent callers? Is "ok" returned only after the effect is durable? |
| dependency | What if the other side is slow, down, wrong, or changes behaviour on upgrade? Is that behaviour verified from its source or docs? |
| coexist | Old client + new server, new client + old server, mixed fleet mid-deploy, rollback, data written by old code, feature flags off/on. Is every new field optional and every old meaning preserved? |
| edges | Empty, huge, malformed, duplicate, out-of-order or hostile input; new enum values; null vs missing; limits and quotas; permissions; time zones and expiry. |

Rules for the check:

- **Verify platform and library behaviour from source or official docs.** A
  remembered fact about where an SDK stores a value is the commonest wrong
  premise. Mark anything you could not verify as unverified.
- **Trace every finding** to `file:line`, a PR line, or a sentence in the
  document. A finding with nothing to point at is a guess; leave it out.
- **For each real finding answer four things**: what the user sees; whether
  the fix makes it impossible or only detectable; which signal fires before a
  user complains; how affected data is repaired.
- A lens that does not apply is recorded in the context as "n/a because …"
  and is **not** printed on the page.

### The admission test — a candidate becomes a finding only if all four hold

1. **Introduced or left open by this work.** If the same failure exists today
   in the same way ("no worse than today"), it is not a finding of this
   change. Drop it.
2. **A concrete failure.** Name the input or state and the wrong outcome it
   produces. Generic hygiene ("validate the header", "add monitoring") with
   no scenario is not a finding.
3. **Checked, not suspected.** If the fact can be checked — read the config,
   the library, the other service — check it now. A candidate that cannot be
   checked goes to the open questions, never into the review.
4. **The premise is right.** Re-read where the value really comes from before
   reasoning about who can forge, copy or change it. One shipped review
   called a header forgeable; the proxy actually set it from a verified
   token.

Severity follows impact, not alarm: `risk` only when users lose data or
money, or the damage cannot be undone; everything else is `warn`.

Record every dropped candidate in the context with the test it failed, so a
reader can see it was considered. **If nothing passes, the page carries the
single "no issue" item** — three honest checks beat five padded findings.

## 3. Write it on the page

The last section of the packet is a `boundary` map (`components.md` §
boundary): the systems from §1 left to right, with what each does (`sub`) and
what flows on each link (`hops`).

- **Each real finding is a pin** — `n`, `at` (a system id, or `a>b` for a
  link), `lens`, `tone` (`risk` only for data/money loss or irreversible
  damage, otherwise `warn`), a one-line `title`, and `card`: the heading of
  the `chain` card that draws it. Every finding gets that chain card, placed
  before the map, so the reader sees the broken hop and the fix, not a
  sentence about them.
- **No findings:** no pins; `ok` names the boundaries checked — e.g.
  "Checked device.sync request/response and the `X-INSTALL-ID` header across
  old/new clients; no issue found." Links render green.
- **No boundary crossed:** the map still lists the component touched and
  `ok` says why nothing crosses (e.g. a pure UI or docs change).

On the `eli5` register the text says what the user would experience; the
mechanism stays in the context.

## 4. Pull requests: review comments as well

When the work is a pull request or a branch with a diff, also write the
findings as review comments in the context, under `## Boundary review`:

```
<path>:<line> — <lens> — <what breaks> — <suggested change>
```

Each comment must point at a changed line or at the unchanged line the change
now relies on. These are ready to paste. **Posting them to GitHub is
outward-facing: do it only when the user asks**, and then through the forge's
own review API, one comment per finding. If the session already ran a code
review, do not repeat its findings — reference them.

For a document (proposal route), the same lenses apply to the boundaries the
document describes; findings point at the document's sentences, and anything
that depends on code not yet written is marked as such.

## 5. In the context

Layer (b) carries `## Boundary review` with: the boundaries found, each lens's
result per boundary (finding, or "n/a because …"), the facts verified and
their sources, and the PR comments from §4. `verify.py` checks that both the
section and this heading exist.
