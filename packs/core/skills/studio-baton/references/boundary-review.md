# Boundary review: the last section of every packet

Every packet ends with a review of the places where one system calls or reads
another. That is where unhappy paths and version skew live: a client and a
server each correct on their own, wrong together. The section exists so the
reader — and, for a pull request, its reviewers — see those risks before they
ship.

**No finding is a valid result.** If a boundary checks out, say so in one line
and name what was checked. Never invent a risk to fill the section; a padded
review teaches the reader to skip it.

Two lists live on the map, with different rules. **Findings** (§2) are few
and admission-tested: what this work broke or left open. **Failure modes**
(§3) are exhaustive: every way each boundary can fail, what fires, what the
user sees and what on-call does — the runbook. "No finding" never means "no
failure modes".

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

## 3. List every failure mode, boundary by boundary — the runbook

Findings answer "what did this change break?". The failure-mode pass answers
a different question — "when this boundary fails, what fires, what does the
user see, and what does on-call do?" — and it is **exhaustive, not
admission-tested**. A mode that is no worse than today still belongs here: it
is the runbook the next on-call reads, and an honest "unhandled" row is worth
more than a missing one.

**Enumerate per boundary.** For every system and every link the map draws
(`a>b`, where `b` follows `a` in `systems`),
walk the modes below and keep each one that can happen there:

| family | examples |
|---|---|
| the other side is down, slow, or times out | connection refused, 30 s timeout with unknown outcome, a dependency's 503 |
| partial failure | three of five writes committed, a batch where some items fail |
| error codes returned | FCM `UNREGISTERED`, HTTP 429 / 5xx, a gRPC `UNAVAILABLE`, a provider's own codes |
| messages dropped, duplicated, reordered | at-least-once redelivery, a consumer that crashed after the side effect but before the ack |
| stale or missing data | a cache past its TTL, a replica behind, a row the old code never wrote |
| auth and expiry | an expired token or certificate, a revoked key, a clock skew past the window |
| version skew | old client + new server, a field the other side does not know yet |

**One row per mode, six columns:**

| field | what it says |
|---|---|
| `mode` | what fails, at this boundary — "FCM returns `UNREGISTERED` for a token" |
| `detect` | the signal that fires **before a user complains**: a metric, a log line, an alert, a query. Name it as it exists (`push_send_errors_total{code="UNREGISTERED"}`). When nothing detects it, leave `detect` out — the page prints **"no signal today"**, and that gap is itself worth a finding if this work opened it |
| `impact` | what the user sees — "the phone never gets the notification" |
| `action` | the runbook step: retry with backoff, mark the token invalid, page on-call, repair the data (and how) |
| `ref` | the evidence: a SHA-pinned permalink `https://github.com/<owner>/<repo>/blob/<sha>/<path>#La-Lb`, or a doc URL. No code line to point at → leave it out; the page prints "no code reference" |
| `state` | `handled` — code handles it (and `ref` points at that code); `detected` — something notices (and `detect` names it) but nothing handles it; `unhandled` — neither |

**Verify every `ref` line from source.** Re-locate the line at the pinned SHA
(`git grep -n '<pattern>' <sha> -- <path>`) before linking; a permalink to the
wrong lines is worse than none. A branch link (`/blob/main/…`) drifts the day
it is written, so it fails `verify.py`, and so does a ref whose host is not
the one the browser opens (a port, a trailing dot, userinfo, a
percent-escape, a backslash, an empty `//` or a `..` segment, or a `%` escape
in a GitHub path). The page shows a GitHub ref
as `owner/repo · file:La–Lb`: check the repository is the real one, not a
fork. GitHub also serves a fork's commit under the parent repository's URL,
so confirm the SHA exists in a clone of the real repository
(`git cat-file -e <sha>`) — the `git grep` step above does that when you run it.

**How it composes with findings.** Pins stay the admission-tested items of §2;
the failure table is the complete list under them. A mode that is
`unhandled` **and introduced by this work** (`"introduced": true`) is also a
finding: give it a pin on the same boundary and point the row at it with
`"finding": <n>`.
`verify.py` fails an introduced, unhandled row without one. A mode that
already existed stays a row and is never promoted to a pin — that would be the
"no worse than today" candidate §2 drops.

**Proposal route.** For a document, the modes are the ones it describes or
implies. Mark each with the sentence it comes from (`source`) and, when the
code does not exist yet, `"planned": true` — the page prints "not built yet",
so a designed retry is never read as a shipped one. `ref` may then be the
document's URL.

**Feeding the runbook.** The rows *are* the runbook: copy them into the
context's `## Boundary review` as a table (§6), so a receiving agent — or the
person on call at 3 a.m. — can answer "what do I do when X fails" without
opening the page. On the `eli5` register write `impact` and `action` in plain
words ("the notification is not delivered; the app stops trying that phone");
signal names in `detect` stay marked as terms. Write `hans` for `action` by hand
rather than letting `render.py` derive it: OpenCC turns 呼叫 on-call ("page")
into 调用 ("invoke"), which says something else in a runbook.

## 4. Write it on the page

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
- **Failure modes** go in `failures` on the same section (§3); the page draws
  them under the map as one compact table per boundary, and clicking a system
  or link on the map highlights its rows. Required on the `engineer` register
  whenever the map crosses a boundary; `"failures": []` says "none apply" out
  loud and still warns per uncovered link unless `ok` explains why.

On the `eli5` register the text says what the user would experience; the
mechanism stays in the context.

## 5. Pull requests: review comments as well

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

## 6. In the context

Layer (b) carries `## Boundary review` with: the boundaries found, each lens's
result per boundary (finding, or "n/a because …"), the facts verified and
their sources, and the PR comments from §5, and the failure-mode table of §3 (boundary, mode, detect,
impact, action, ref, state). `verify.py` checks that both the section and this
heading exist.
