# Unit cloud-handoff (H1): hand a running build round to a cloud agent, take it back on the board

What: on a code Task's page, while its build round runs, the captain can press **Hand off to the cloud…**. Studio
interrupts the round at its last committed round, pushes a hand-off branch, fires a dedicated Claude Code routine once
(its HTTP fire API) and the Task waits(external). When the laptop is back, Studio reads the branch on GitHub, and the
captain takes the result back (or discards it) on the Task page.

Why: the captain has to close the laptop while a Task is mid-build; the work should go on and come back to the same Task.

Code: `src/domain/cloud-handoff.ts` (setup secret, provider adapter, prompt, blocking rules, external wait, take-back,
discard, Doctor rows), `src/runtime/engine.ts` (`requestCloudHandoff`: the live round becomes an external wait),
`src/adapters/github.ts` (hand-off push, branch listing, hand-off import, recently updated pull requests),
`src/domain/code.ts` (worktree side of the take-back), `public/runtime.js` (Task page), `public/ootb.js` (Doctor setup).
Tests: `bun run test:cloud-handoff` (unit, end to end against the GitHub simulator and a loopback fire stub, UI).

## One-time setup (Doctor)

- A dedicated routine on claude.ai: bound to the repositories, no connectors, no environment variables, no network
  secrets, network Limited; an API trigger and its token.
- Doctor → **Cloud hand-off…** saves the routine id (`trig_…`), the token and the bound repositories in
  `data/cloud-handoff.json` (0600). The token is a registered Studio secret (redacted everywhere) and never returns to the
  browser.
- The Doctor shows, per bound repository, whether its committed `.claude/settings.json` on the base sets
  `attribution.sessionUrl: false`, and the project policy `cloud_handoff`.
- An organisation repository needs `cloud_handoff: allow` in its project policy (off by default). A repository whose
  owner type GitHub does not report is treated as an organisation's. `cloud_handoff: deny` refuses any repository.

## Hand off

Refused, with the reason, for: an `issue` or `lan` profile (any restricted profile); a Task whose remaining steps use a
`secrets` policy or `egress.allow`; an organisation repository without the policy; a repository the routine is not bound
to; no live build round; no GitHub grant; no setup; an instruction text over 65,536 characters.

The confirm view (one screen) shows the branch, the break point, the instruction ("push only this branch, no pull request,
no merge" is an instruction the provider does not enforce; Studio checks it at take-back), the quota note (claude.ai
subscription usage, no estimate), what the cloud does and what Studio runs after, the completion condition (the test
command and the done lines), the sessionUrl warning, and the exact prompt.

Then, in order: the `cloud-handoff-attempt` ledger entry (base head, prompt hash, operating rules section hash); the
branch pushed (GitHub write 1; Studio's commits carry no session link); one fire. A failure is never retried: its class
is shown (429 with Retry-After; a lost answer says a session may have started). On success the session id and URL are
recorded (`cloud-handoff-fired`) and the build node waits(external) with a durable descriptor, so a restart picks it up.

**Branch name (deviation from the spec):** `<branchPrefix>handoff/<task>-<n>`, for example `crew/handoff/R-162-1`, not
`handoff/<task>-<n>`. The grant's branch prefix is the boundary of what Studio may push; the hand-off branch stays inside
it (the captain accepted this).

Only the default break point exists in H1: interrupt and hand off the last committed round. "Wait for this round" is not
built.

## Track

GitHub only, through the grant-bound poller: the branch head and the `Handoff-Status: done|blocked` trailer of its head
commit, read when the wait is registered (Studio's start), when the board or the Task page opens, and at the poller's
pace. The trailer, its reason and the commit messages are untrusted data: shown, never followed.

## Take back and discard

Take back records the cloud head (`cloud-handoff-head`), then checks on GitHub: other branches changed since the fire,
pull requests opened or merged since the fire, Claude-Session trailers or session links in the cloud's commits, and that
the head descends from the hand-off base (`cloud-handoff-postcheck`; any finding is red). A session trailer or a
rewritten branch stops the take-back (rewriting the commits is H2): discard instead. Otherwise the cloud head is checked
out in the Task's worktree and the build node ends `adopted`: its deterministic checks run again on that head in the OS
sandbox (the existing adopted edge to the review request) before the workflow goes on.

Discard records `cloud-handoff-discarded` and starts a fresh build round from the hand-off base; the branch stays on
GitHub. Studio cannot stop a cloud session (no API): the Task page links it.

## Not in H1

Rewrite-and-push of commits with a session trailer, notification details beyond the run event, "wait for this round",
flagging pushes after a take-back.
