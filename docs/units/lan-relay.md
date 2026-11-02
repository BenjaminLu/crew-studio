# Board-to-board work on the local network (LAN relay)

Two Studios on the same network hand work to each other: one dispatches a briefing, the other takes it with a workflow of
its own, runs it, and hands the result back; the dispatcher refines or closes it. Security comes first. The design follows
the CSO review of the LAN boards prototype (its blockers are requirements) and the captain's decisions:

1. An introduced colleague is still a potential threat: their machine can be compromised.
2. Nothing travels in plain text on the LAN: every entry and every blob is encrypted to its named recipients.
3. "Permissionless" covers discovery only: anyone can see that a Studio is nearby; exchanging anything needs an
   in-person introduction first.
4. Work that came from the LAN runs under a restricted profile Studio enforces (below), and never runs tests that open
   listeners.

v1 has no auto-start and no auto-accept: every received item waits for a person on the desktop. A time-boxed auto relay
(a capability token, CSO change 17) comes later.

Code: `src/lan/` (`crypto.ts`, `noise.ts`, `wire.ts`, `identity.ts`, `protocol.ts`, `relay.ts`, `profile.ts`,
`runner.ts`, `mdns.ts`, `routes.ts`), `startLan` in `src/runtime/index.ts`, `public/lan.js`, `public/lan.css`.
Tests: `tests/lan-crypto.ts`, `tests/lan-profile.ts`, `tests/lan-relay.ts`, `tests/lan-ui.mjs` (`bun run test:lan`).
Demo: `bun scripts/lan-pair-demo.ts`.

## Identity

- One P-256 key pair per Studio (the curve the Keychain and the Secure Enclave hold). By default the private scalar is in
  a 0600 file `lan/identity.key` under Studio's data folder, which every round's sandbox denies. The macOS Keychain is
  opt-in (`CREW_KEYSTORE=keychain`; service `crew-studio-lan-identity`, one account per data folder), never used for a
  test run or a data folder under the temporary directory, and written through `security -i` on stdin so the key is
  never on an argv a same-uid process could read. No test, demo or script touches the login Keychain.
- The identity is the full public key. Every decision (allowlist, freeze, revocation, who may take a round) is keyed by it.
- The fingerprint people compare is 30 decimal digits in six groups of five (about 99.7 bits) from SHA-256 of the key.
- Display names are the captain's own petnames. What a peer calls itself is shown only as "自稱 …", cleaned (NFKC, no
  control, bidi or zero-width characters), with a warning when it looks like a name already in use.
- 我的地址 shows the device name, the fingerprint, the address and a copy button; each peer's card shows its fingerprint.

## Discovery

- Bonjour `_crewstudio._tcp` through macOS's `dns-sd`: an opaque instance name (`cs-` + 12 hex) that changes every 15
  minutes, the port, and `v=1`. No device name, key or fingerprint. (Bonjour's own SRV record still names this Mac's
  `.local` host name: a known limit.)
- What is found is listed as "nearby, not introduced". Discovery never connects, never introduces, never trusts.
- An introduction takes a typed `host:port` (the other screen shows it under 我的地址). Tests and the demo use loopback
  addresses, allowed only with `CREW_LAN_ALLOW_LOOPBACK=1`.
- `CREW_LAN_MDNS=0` turns discovery off.

## Introduction

1. The responder opens its introduction window on the desktop (5 minutes by default, at most 15).
2. The introducer enters the responder's address. They run Noise XX (both keys learned and authenticated), then a
   commit-then-reveal exchange: the introducer sends a commitment to a random nonce, the responder answers with its own
   nonce, the introducer reveals. Both compute a 6-digit code from the handshake hash and both nonces. A man in the
   middle must fix his nonce before he sees the other one, so he matches the codes with probability 10⁻⁶ per attempt.
3. Each person types the code the **other** screen shows and gives the peer a name. A match puts the peer's full key on
   this Studio's allowlist; a mismatch ends the introduction (start again). Only after both sides confirm can they
   exchange anything.

An attacker could still grind: learn the responder's nonce, see the code it gives, abort, try again. So the responder
takes one introduction at a time; every introduction that got its nonce and did not reveal a matching one (a wrong
reveal, an abort, a timeout after 20 s, messages out of order, and one that stalls before its commitment while it holds
the only slot) is shown on its screen as a failed introduction; the third
failure closes the window, and a successful introduction closes it too (one introduction per window). An attacker gets
at most three tries, all visible, each with odds 10⁻⁶.

Unpair takes a peer off the allowlist and keeps its record (a freeze survives; it may be introduced again); revoke marks
its key for good (never introduced again). Either one withdraws its open items, stops every Task its work started, and
drops what was waiting to be sent to it.

## Transport

- A listener of its own (`CREW_LAN_PEER_PORT`, default 7417, bound to this Mac's LAN address or `CREW_LAN_BIND`), its own
  server, off until the captain turns it on. It never reaches Studio's `handle(req, …)` routes, session or cookies.
- Four fixed routes, all `POST` with an `application/octet-stream` body of at most 1 MiB: `/lan/v1/kk` (one request
  over a Noise KK handshake, the reply in its second message), `/lan/v1/xx/1`, `/xx/3`, `/xx/4` (an introduction).
- Before any cryptography: the Host must be the listener's own address literal (DNS rebinding sends another name); a
  request with `Origin`, `Referer`, `Cookie`, `Authorization` or any `Sec-Fetch-*` header is refused; chunked bodies are
  refused; no CORS header is ever sent. A page cannot read an answer, and cannot produce the handshake anyway.
- KK needs both keys before it starts, so the first message already proves the initiator holds an allowlisted key; a
  responder that cannot decrypt it with any of them answers 403 and nothing else (an unintroduced key does not even learn
  this Studio's key). XX runs only while the introduction window is open.
- A KK message is accepted once (its ephemeral key is remembered for ten minutes) and only within five minutes of this
  Mac's clock (a time that is not a date is refused); the replay cache is kept across restarts. Requests are
  rate-limited per source address (the rate table is bounded), at most 32 are in flight, one introduction at a time, and an address that keeps sending KK messages no
  allowlisted key made is cut off for a minute from its eighth failure before Studio tries its keys again (an IPv6
  address counts with the rest of its /64; a full table drops its oldest entries, never a cut-off it holds).
- The client side dials only an IPv4 literal on one of this Mac's own private subnets: never a name, loopback (outside
  the demo), this Mac's own address, the network's default gateway, link-local, multicast, a metadata endpoint, the
  tailnet range or the internet; no redirects.

## Entries

Each Studio keeps one append-only log. An entry is an envelope: author key, `seq`, `prev` (the hash of the author's
previous entry), the author's claimed time, the recipients' full keys, a sealed body and an ECDSA signature over all of
it (with a purpose string, so a signature made for one purpose never verifies for another). The body is sealed to the
recipients and the author (ECDH with a fresh key, HKDF, AES-256-GCM). A briefing or a result travels as a sealed blob
next to the entry that names its SHA-256; there is no blob endpoint, so nothing can be asked for by hash.

| kind | from | names |
|---|---|---|
| dispatch | the dispatcher | thread, title, briefing hash and size, acceptance criteria, suggested workflow and its definition hash |
| take | the taker | the briefing hash it read, the taker's own workflow and its definition hash, the spend cap |
| assign | the dispatcher | the take it picks and the taker's full key (the dispatcher decides; timestamps decide nothing) |
| result | the taker | the take, the briefing hash, the output hash and files, the workflow and its definition hash, the run id, a checks summary |
| refine | the dispatcher | a new briefing for the next round |
| done | the dispatcher | the result that closes the thread |
| revoke | the author | one of its own entries (withdraws a dispatch: the briefing blob is deleted on receipt) |

Receiving, in order: shape and size checks; the entry must come over its own author's channel and name this Studio; the
signature; a decision already made stands (a refused entry sent again is refused again); then the fork check. Two
different validly signed entries at one `seq`, or an entry whose `prev` does not match the entry this Studio holds before
it (or the one after it), freeze the author: both entries are kept as evidence, its items are frozen, its Tasks stop, and
everything it sends is refused until a person decides (revoke the key, or unfreeze after checking in person). The page
says both signatures are valid; it never calls one of them the forged one. A frozen author, an author past its daily
limit and an entry whose claimed time is not within a day of this Mac's clock are refused before anything is stored.
Then: the body by kind, the blob it names (present, opening for this Studio, the named
hash and size), and the thread: a take or a result naming another briefing than the round's is refused ("briefing hash
mismatch"); a result whose workflow or definition hash differs from its take's is taken in and flagged
`workflow-mismatch`. A refusal that can pass later (a frozen author, a daily limit, a clock, content not there yet, an
entry before its thread) is not kept as the entry's verdict; any other is, and the same entry sent again gets the same
answer. Decided entries and each author's sequence numbers are bounded, and the state file is written at most every
150 ms. Revoking an entry deletes the content it named (a dispatch's or a refinement's briefing, a result's output).

## Receiving and approving

Every received entry becomes an inbox item; nothing happens until a person approves it on this Mac. Every `/api/lan`
route, reads included, answers only Studio's own page, as the web terminals do: its session cookie, `Sec-Fetch-Site:
same-origin`, and on a write an `Origin` equal to Studio's own. A script's `x-crew-session` is refused, and so is a paired
phone, even one allowed to drive Firstmate. (Not a boundary against a local process of this user: it can read
`data/session-token`. It keeps scripts and other sites off.)

- **dispatch / refine**: the page shows the full briefing (invisible characters marked ⟦U+…⟧), the acceptance criteria
  and the exact prompt the agent will get; a long one must be scrolled to its end before it can be approved, and the
  approval must name the SHA-256 of that exact prompt (the page computes it only once the person has read to the end;
  the server refuses any other). Approving means taking it with one of this Studio's own workflows (only those the
  profile allows can be picked), a spend cap (dollars and agent rounds, or rounds only when the provider reports no
  cost), a provider and, for a code workflow, one of this Studio's registered projects. The suggested workflow is only a
  suggestion; nothing is fetched.
- **take**: the dispatcher assigns it (an `assign` entry naming the taker's key).
- **assign**: the taker starts the run.
- **result**: the dispatcher reads the files (text only) and accepts it; then refines or marks it done; a code result's
  patch can be applied (below).
- Content from a peer is drawn only as text nodes: never as HTML, never as SVG, never in a frame of Studio's origin.

## Running work from a peer

`startLan` starts the taker's workflow through the same staffing and start path as the board's Run: a code workflow
(code-firstmate) runs on one of the taker's registered projects with its approved crew; an own workflow's staffing is
confirmed with the take. The Task carries Studio's marks `_lan` (the item and its spend cap) and `_tainted: "lan"`; a
Task with the taint and no readable `_lan` is held to a zero cap. Enforced, whatever the briefing says:

- **Sandbox only** (`taintRefusal`): never in local unrestricted mode, never under a sandbox-off grant; a round without a
  sandbox is refused.
- **Allowlisted steps** (`src/lan/profile.ts`): hooks that only work locally (`note`, `set`, `intent.capture`,
  `repo.prepare`, `repo.cleanup`, `deliver.*`, `doc.export`, `library.publish`, `hello.web`, and the code pack's
  `pr.open` and `remote.ready`, which for a tainted Task are local: a local review request, "ready on the local branch").
  Never `git.merge`, `github.*`, issue or file moves, registrations, crew or staffing changes, the designer's rounds. A
  workflow may contain a merge or a designer step a tainted Task never reaches; if it is reached anyway it is refused.
- **Fresh folder**: a deliver step writes in its own new round folder; a code step in the Task's own worktree, on a
  branch named `lan-untrusted/…`. Such a branch is never sent for review as trusted work: Send for review and the
  code pack's From existing branch refuse it (`lan_untrusted`), by its name and by its commit under any other name.
- **Writes**: no round writes a protected path, nor any path with a character outside printable ASCII (a file system
  folds some onto protected names: APFS folds `ſ` to `s`) (`src/lan/paths.ts`, case-insensitive: CI, `.git/`, hooks,
  `.gitattributes`, `.gitmodules`, install settings, `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `.cursor/`,
  `.vscode/`, `.devcontainer/`, `.envrc`, `Makefile`, `conftest.py`, `build.rs`, `setup.py`, Dockerfiles and similar).
- **Egress to the provider only**: every round (agent turns, coordinator turns, judges) gets no host from `egress.allow`.
- **Nothing listens**: every step of the Task runs in a no-binding scope (`sandboxScope` in `src/runtime/checks.ts`):
  its agent rounds, its installs and its test runs (`run_tests`, `run_command`, the checks that run the project's tests)
  get no inbound and no bind, so nothing in them can serve this Mac's LAN address; a check that wants the network does
  not run; no skill script runs; no dependency install runs and no install script (policies `install` and
  `install_scripts` are off for it).
- **Spend cap**: every paid round (agent turns, coordinators, judges) is recorded on the Task itself
  (`ctx.lanRounds`, saved with it) when it is admitted, and its dollars when it ends; before the next one, the rounds
  and dollars are compared with the item's cap, so neither concurrency nor a restart reopens it. A provider that reports
  no cost makes the dollars unknown, which stops the next paid round under a dollar cap. The taker may instead choose a
  rounds-only cap, for any provider: then there is no dollar bound, and every paid round of the Task (any provider,
  judges and staffed nodes included) counts toward the rounds cap. A round admitted before a restart and never settled
  counts as unknown dollars.
- **One Task per assignment**: approving an assignment claims the round before the Task starts, so a second approval
  starts nothing; if the peer is revoked or frozen, or the work withdrawn, while the Task starts, it is stopped at once.
  The claim is never written to disk; after a crash mid-start it is cleared and the take may be approved again.
- **Every workflow is classified**: the taker's Studio lists every installed workflow; one it does not offer (internal,
  retired, held, or a step off the profile) names its reason, and a take with it is refused with that reason
  (`tests/lan-workflows.ts` relays every offered one end to end across two Studios and refuses every other one).
- **Other Tasks never see its title**: another Task's overlap note names it by its id only.
- **Firstmate never sees it**: an agent's question or an escalation from a tainted Task is the captain's card, never
  Firstmate's; Firstmate's status lines show a peer's Task without its title or card titles; Studio's event log keeps no
  text of it. A failure card never repeats it as a New task (its marks would be left behind): it is taken again from the
  inbox.
- **The briefing is fenced**: `<untrusted-lan-briefing-<nonce>>` with a nonce of this Studio's own (never sent), and a
  fence-shaped tag in the text defused. A fence lowers the odds; it is not a boundary. The profile is the boundary.

## Handing a result back

Nothing is published by itself. When the Task has succeeded, the taker previews exactly what goes back and presses
交回: a deliver workflow's files, or a code workflow's one patch (`changes.patch`, everything its worktree changed
against its base, new files included; every changed path is checked, and more than 240 refuse the hand-back). Every file is read without following a link: a symbolic link, a hard link or
anything but a regular file is refused, and its real path must stay inside the Task's folder. The send is refused when
the output touches a protected path (above) or adds package scripts or hook keys, and blocked while the scan finds a
credential, a key, an encoded or split secret, Studio's own key format, a long random string or a name on the
`privacy.denylist` policy (`src/lan/scan.ts`), until the person removes it and previews again. The scan is a net for
honest mistakes, not a wall: an agent told to leak something can encode it past any scanner, and the page says so; the
person reading the bytes is the gate. The send must carry the hash of the bytes the person saw. The result is sealed to
the dispatcher only. Its checks summary is the taker's own report.

## Applying a code result

The dispatcher applies a code result's patch to one of its own registered projects (`src/lan/apply.ts`). Git names the
paths (`git apply --numstat -z` and `--summary`), never a regex, and every one is checked: nothing outside the
project, no protected path, nothing but printable ASCII. A binary hunk, a copy or a rename (it carries its source's
mode), a new file with any mode but 100644 (an executable, a link, a submodule), a mode change, or an edit to a path
that is not a plain 100644 file in the base (`ls-tree`: a symbolic link keeps its mode when its target changes) refuses
the whole patch. It is applied without a checkout: into a
temporary index (`apply --cached`), committed with `commit-tree`, branched as `lan-untrusted/<thread>-r<n>` with
`update-ref`, so no clean or smudge filter of the repository and no hook runs. Nothing is merged, built, tested or
pushed: the branch is read and diffed like any untrusted change, and Studio never sends it for review (above).

## Audit

`lan/audit.jsonl` records what was dispatched, which entry (full key, hash) started which run with which workflow, and
what was sent back (hash and size). Entries and blobs are stored sealed.

## Not done in v1

- The Secure Enclave (a non-exportable key) and pre-rotation (KERI style) are not used; the Keychain is opt-in
  (`CREW_KEYSTORE=keychain`) and its item is readable by this user's processes.
- Network pinning (subnet, gateway MAC, SSID).
- Deniable MACs for conversational entries: every entry is signed.
- Relaying entries between peers (each author's entries reach only its recipients directly).
- On Linux a test run uses bwrap's private network namespace; the restricted profile's no-local-binding scope is
  enforced by the macOS profile.

