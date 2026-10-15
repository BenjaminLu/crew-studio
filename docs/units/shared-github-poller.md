# Shared GitHub polling owner

## Problem and authority boundary

`GitHub` currently owns its dashboard timer and optional token discovery. `RemoteWatchers` separately owns native grant-bound repository timers. Two active paths can poll the same repository independently. Dashboard status is advisory; native CI success still requires fresh exact-head, exact-required-policy verification.

The shared owner must be keyed by exact API origin, repository, canonical complete authority and credential identity. A dashboard ambient-token authority is not a native project grant, even when the repository or token happens to match. Conflicting active authorities for one origin/repository fail closed with an explicit unsupported-configuration result. No broad-token response can enter a grant-bound cache. Cache entries belong to one in-flight polling generation only; no previous successful generation can satisfy fresh CI.

## Proposed scoped paths

- `src/github-poller.ts`: dependency-free shared repository owner, subscriptions, owned timer/request cancellation, per-generation in-flight read coalescence and authority conflict detection. It contains no native workflow/domain knowledge.
- `src/github.ts`: dashboard subscription and generation-safe state publication; preserve optional/disabled/fixture behavior and token lifecycle.
- `src/adapters/github.ts`: optional injected shared read transport, retaining typed endpoint allowlists, exact grants, bounded bodies, authentication and no generic mutation surface.
- `src/domain/remote-ci.ts`: native subscriptions through the shared owner, independent absolute subscriber deadlines, concurrent subscribers, existing exact-head/policy inspection and invalidation guards.
- `src/domain/code.ts`: install the injected shared owner; no generic runtime changes.
- `src/server.ts`: create one process owner and inject it into both installed paths; preserve `CREW_GH=0` and no native credential discovery for local/default tasks.
- `tests/shared-github-poller.ts`, `tests/shared-github-poller-server.ts`: actual strict REST simulator and bare-local native fixtures, owning cleanup; relevant existing GitHub/dashboard/native suites.
- `tests/lib/github-simulator.ts`: only exact documented dashboard open/closed GET-list query shapes, retaining strict refusal of duplicates, unknown queries and other methods.
- `tests/ootb.ts`: explicitly restart a stopped dashboard before its actual rate-limit test; stop never resurrects polling.
- `package.json` and this unit document.

## Testable done lines

1. An enabled dashboard and two native waits explicitly using the identical complete grant authority share one repository owner and coalesced same-head transport reads. Ambient dashboard authority cannot silently acquire that binding.
2. Two native subscriber deadlines run concurrently: an earlier timeout cancels only that subscriber, never a longer-lived shared read. Dashboard stop leaves native work alive and vice versa; the last subscriber aborts requests and clears timers.
3. Each polling generation has one owned request batch, no overlapping timer polls, stale callbacks or previous-generation green cache. New subscriptions during a batch receive fresh reconciliation. Restart restores persisted native waits using their original deadlines and exact grant identity.
4. Rate limits/backoff remain owned and bounded; no busy retry, orphan process, credential/error-body disclosure or fallback to broader authority.
5. Malformed/stale descriptors and conflicting authorities stop explicitly; unrelated dashboard check status cannot wake CI as passed. Cancellation/delete cannot append late ledger/state events.
6. Disabled GitHub and local/default ad-hoc tasks neither discover credentials nor start read timers. No real remote, service, token, grant or user configuration is changed by tests.

## Explicit production dashboard binding

`CREW_GH_PROJECT=<registered-project-id>` explicitly selects an existing trusted project from the existing `Projects` storage. Its GitHub grant must pass the same `projectPrAdapter` path match and complete grant validation used by native code. The selected project's grant supplies the exact API origin/repository and full authority; contradictory dashboard repository/origin configuration fails closed. No grant is inferred from matching credentials or repository names, and this unit writes no configuration. The shared owner is created once by `server.ts` and injected into dashboard and code installation. The production server fixture starts an enabled, explicitly bound dashboard and two persisted native external waits with the same approved grant, then proves one owner/coalesced transport and real task outcomes.

Without explicit binding, the optional ambient dashboard retains its distinct authority and can run alone. If a native grant attempts to subscribe to that same origin/repository (or the reverse), the shared registry refuses conflicting authority before creating another owner or issuing reads. Disabled GitHub/local tasks never read credentials to construct unused authority. Existing optional GitHub use remains available; simultaneous dashboard/native polling requires the explicit trusted binding. A supplied project selector while GitHub is disabled does not activate it. Projects currently have no enabled field; explicit false is refused if present. Broader project enablement is the separate D1 unit.

## Validation and follow-up

Fail-first runs against approved `29d1ce9`, followed by focused actual simulator/native lifecycle tests and existing GitHub regressions. Root owns final full tests and independent reviews. Pack-genesis `1aef6ea` remains immutable; its designer follow-up concerning English backend refusal text is recorded for a separate cleanup unit, outside this scope.

## Implemented lifecycle and evidence

All transport cache values live only within the currently executing repository polling generation. Final authoritative PR/ref reconciliation explicitly bypasses that cache, retaining force-push detection after check reads. Subscriber promises observe their own cancellation/deadline while underlying shared transport belongs to the repository owner; an earlier subscriber deadline cannot abort another subscriber's response. The final unsubscribe aborts all remaining owned requests. Backoff is repository-owned and neither a joining subscriber nor refresh can bypass it. Error responses are sanitized and shared dashboard JSON is bounded to the same one-megabyte ceiling as native transport.

The existing authenticated `GET /api/github` adds aggregate polling counts only (`repositories`, `subscribers`, `timers`, `requests`). No authority, credential, Task identity or cache contents are exposed. No UI layout changes are included.

Meaningful fail-first uses actual old production `GitHub` plus `RemoteWatchers` on `29d1ce9`, with only the approved strict simulator query adaptation: it observes two timer owners and duplicate same-head check reads (2 passed / 2 failed). The earlier absent-new-module contract failure is retained only as historical development output and is not behavioral acceptance evidence. The actual production-server fixture proves explicit binding with two persisted native Tasks, cancellation/deletion isolation, original deadline restoration and freshly rechecked success after restart.

## R2 native response-body lifecycle

Additional scoped owning test: `tests/github-response-lifecycle.ts`. Rejected native API responses, grant-bound reads and log-download validation failures all retain their actual response until cleanup. The per-request controller is aborted before bounded awaited body cancellation and before the request timeout is cleared or the shared read settles. This closes a nonterminating rejected body without aborting other repository subscribers. Cancellation waits have an owned one-second ceiling; underlying request abort happens first, so that ceiling cannot keep a bad network stream live. Bounded readers release their lock after cancellation. Existing log redirect allowlists, credential stripping, byte-range validation and sanitized status messages are preserved.

The reviewed `ce6` fail-first uses real loopback HTTP streams that never close themselves: repository subscription remains active while its rejected 429/500 read reports settled, revealing the uncancelled body. Isolated probes additionally cover PR API rejection, overflow, redirect, timeout, caller abort, invalid log Content-Range and successful bounded JSON. Leaked baseline fixture streams are closed only after their assertions, never to manufacture a passing result.
