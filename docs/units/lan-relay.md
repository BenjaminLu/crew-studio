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

Unpair removes a peer (it may be introduced again); revoke marks its key for good (never introduced again). Either one
withdraws its open items, stops every Task its work started, and drops what was waiting to be sent to it.

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
  Mac's clock. Requests are rate-limited per source address; introductions in flight are capped.
- The client side dials only an IPv4 literal on one of this Mac's own private subnets: never a name, loopback (outside
  the demo), this Mac's own address, link-local, multicast, a metadata endpoint, the tailnet range or the internet; no
  redirects. Not done: refusing the gateway's own address.

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
says both signatures are valid; it never calls one of them the forged one. Then: a daily limit per author, the claimed
time within a day of this Mac's clock, the body by kind, the blob it names (present, opening for this Studio, the named
hash and size), and the thread: a take or a result naming another briefing than the round's is refused ("briefing hash
mismatch"); a result whose workflow or definition hash differs from its take's is taken in and flagged
`workflow-mismatch`.

## Receiving and approving

Every received entry becomes an inbox item; nothing happens until a person approves it on this Mac. All `/api/lan` routes,
reads included, are desktop only: a paired phone is refused even when it may drive Firstmate.

- **dispatch / refine**: the page shows the full briefing (invisible characters marked ⟦U+…⟧), the acceptance criteria
  and the exact prompt the agent will get; a long one must be scrolled to its end before it can be approved. Approving
  means taking it with one of this Studio's own workflows (only those the profile allows can be picked), a spend cap
  (dollars and agent rounds) and a provider. The suggested workflow is only a suggestion; nothing is fetched.
- **take**: the dispatcher assigns it (an `assign` entry naming the taker's key).
- **assign**: the taker starts the run.
- **result**: the dispatcher reads the files (text only) and accepts it; then refines or marks it done.
- Content from a peer is drawn only as text nodes: never as HTML, never as SVG, never in a frame of Studio's origin.

## Running work from a peer

`startLan` starts the taker's workflow through the same staffing and start path as the board's Run (v1: a workflow that
needs no project crew approval; an own workflow's staffing is confirmed with the take). The Task carries Studio's marks
`_lan` (the item and its spend cap) and `_tainted: "lan"`. Enforced, whatever the briefing says:

- **Sandbox only** (`taintRefusal`): never in local unrestricted mode, never under a sandbox-off grant.
- **Allowlisted steps** (`src/lan/profile.ts`): hooks that only work locally (`note`, `set`, `intent.capture`,
  `repo.prepare`, `repo.cleanup`, `deliver.*`, `doc.export`, `library.publish`, `hello.web`); never `pr.open`,
  `git.merge`, `remote.*`, `github.*`, issue or file moves, registrations, crew or staffing changes. Agent modes that
  write only their own folder or worktree. The take dialog applies the same list, so a workflow that pushes cannot be
  picked; the code pack's tainted path keeps any code Task on its local branch.
- **Fresh folder**: a deliver step writes in its own new round folder; a code step in the Task's own worktree.
- **Egress to the provider only**: every round (agent turns, coordinator turns, judges) gets no host from `egress.allow`.
- **No test listeners**: no round gets `run_tests`, `run_command` or `skill_run`; a check that runs the project's tests
  or wants the network reports "not run" with its reason.
- **Spend cap**: before every paid round, the rounds and dollars this Task already spent on this Mac are compared with
  the item's cap; at the cap the round is refused and the Task stops ("spend cap: …").
- **The briefing is fenced**: `<untrusted-lan-briefing-<nonce>>` with a nonce of this Studio's own, angle brackets in
  the text turned into ‹ ›, as the review room fences page text. A fence lowers the odds; it is not a boundary. The
  profile is the boundary.

## Handing a result back

Nothing is published by itself. When the Task has succeeded, the taker previews exactly what goes back (the files the
Task wrote, as text, editable) and presses 交回. The send is refused when the output changes CI configuration
(`.github/`, GitLab, CircleCI, Buildkite, Travis, Azure, Bitbucket, Jenkins, Drone, Woodpecker), git hooks (`.husky/`,
`.githooks/`, `.git/`, lefthook, pre-commit), package scripts or hook keys in a `package.json`, or install settings
(`.npmrc`, `.yarnrc`, `bunfig.toml`); and blocked while any line holds a credential (Studio's one redactor:
`src/secure.ts`) or a name on the `privacy.denylist` policy, until the person removes it and previews again. The send
must carry the hash of the bytes the person saw. The result is sealed to the dispatcher only. Its checks summary is the
taker's own report; the dispatcher reruns checks before relying on it.

## Audit

`lan/audit.jsonl` records what was dispatched, which entry (full key, hash) started which run with which workflow, and
what was sent back (hash and size). Entries and blobs are stored sealed.

## Not done in v1

- Code workflows that need a project's approved crew (code-firstmate) cannot take work from a peer yet.
- The Secure Enclave (a non-exportable key) and pre-rotation (KERI style) are not used: the Keychain item is exportable
  by this user's processes.
- Network pinning (subnet, gateway, SSID) and refusing the gateway's address.
- Deniable MACs for conversational entries: every entry is signed.
- Relaying entries between peers (each author's entries reach only its recipients directly).
