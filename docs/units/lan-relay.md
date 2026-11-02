# Board-to-board work on the local network (LAN relay)

Two Studios on the same network hand work to each other: one dispatches a briefing, the other takes it with a workflow of
its own, runs it, and hands the result back; the dispatcher refines or closes it. Security comes first. The design follows
the CSO review of the LAN boards prototype (its blockers are requirements) and the captain's decisions:

1. An introduced colleague is still a potential threat: their machine can be compromised.
2. Nothing travels in plain text on the LAN: every entry and every blob is encrypted to its named recipients.
3. Exchanging anything needs an in-person introduction first (Studio does not advertise itself; an introduction takes a
   typed address).
4. Work that came from the LAN runs under a restricted profile Studio enforces (below), and never runs tests that open
   listeners.

v1 has no auto-accept: every received item waits for a person on the desktop (the one exception is the taker's own opt-in auto-start of an assignment, below). Protocol 2 is the only protocol; nothing
of protocol 1 (its single-key identity, its routes, its envelopes) is read or answered.

Code: `src/lan/` (`crypto.ts`, `keystore.ts`, `se-helper.swift`, `noise.ts`, `wire.ts`, `protocol.ts`, `store.ts`,
`relay.ts`, `profile.ts`, `runner.ts`, `apply.ts`, `paths.ts`, `scan.ts`, `routes.ts`), `startLan` in
`src/runtime/index.ts`, the engine's profile seam in `src/runtime/engine.ts`, `public/lan.js`, `public/lan.css`.
Tests: `tests/lan-crypto.ts`, `tests/lan-keys.ts`, `tests/lan-identity.ts`, `tests/lan-store.ts`, `tests/lan-profile.ts`,
`tests/lan-relay.ts`, `tests/lan-workflows.ts`, `tests/lan-ui.mjs` (`bun run test:lan`); mutations:
`bun scripts/lan-mutation-check.ts`. Demo: `bun scripts/lan-pair-demo.ts`.

## Identity

- A Studio's identity is its **admin key**, a P-256 signing key: its public key is what peers allowlist, and its
  fingerprint (30 decimal digits in six groups of five, about 99.7 bits, from SHA-256 of the key) is what people compare.
  Every decision (allowlist, freeze, revocation, who may take a round) is keyed by it.
- The admin key signs only what a person decides on this Mac: the certificate of the daily keys, each introduction (its
  signature is what puts a peer on the allowlist: a peer written into the state without it is not on it), a
  revocation, a successor, a replacement.
- Two **daily keys** do the rest: a signing key signs every entry of the own log, and a key agreement key is the Noise
  static key and the key every box sealed to this Studio is opened with. One certificate, signed by the admin key, binds
  both to the identity from a sequence number on; an entry names the hash of the certificate whose key signed it, and
  peers keep each identity's certificates (a later certificate ends the one before it at its own first sequence number;
  v1 makes no new daily keys: replacing them is a new identity, below).
- Three keystores, one contract (`src/lan/keystore.ts`, `tests/lan-keys.ts`):
  - **Secure Enclave** (a Mac with one, the default for a new identity): every key is made inside the enclave by a small
    Swift helper Studio builds from `src/lan/se-helper.swift` on this Mac (`swiftc`, ad-hoc signed, no entitlements, no
    Keychain) and talks to over stdin/stdout (one JSON request per line). Studio keeps only the blobs the enclave wrapped
    for this device (`lan/enclave.json`, 0600): copied to another machine they are useless. The admin key needs Touch ID
    or the login password for every signature (`.userPresence`), and the helper builds the prompt itself from what it
    signs (a peer's fingerprint, a key's fingerprint, a sequence number), never from text Studio passes. The helper
    signs a daily purpose only with a daily key and an admin purpose only with the admin key, and checks every field.
  - **Files** (Linux, a Mac without an enclave, a helper that does not build): `lan/identity.json` and `lan/admin.key`,
    0600. The page and Doctor say plainly: 這台的身分可被本機程式讀取 (no Touch ID protection).
  - **Soft enclave** (tests only): the enclave's code over a stand-in with the same protocol and software keys
    (`tests/lan/soft-enclave.ts`); refused unless the test environment is isolated and the data folder is temporary.
    No test touches the login Keychain; an opt-in local test (`CREW_LAN_REAL_SE=1 bun tests/lan-keys.ts`) runs the real
    enclave, with its prompts.
- **What the enclave protects, and what it does not.** It protects against the keys being copied off this Mac (a backup,
  a stolen disk image, a process that reads files) and against pairing, revoking or replacing an identity unattended (a
  person answers Touch ID or the password). It does not protect against a process running as this user while Studio
  runs: such a process can ask the helper to sign entries and open boxes as the daily keys, and drive Studio's own
  routes. That is the residual "malicious colleague with this Mac" risk v1 accepts.
- Doctor shows which keystore holds the identity; a file identity on a Mac offers **升級到 Secure Enclave**, which is a
  new identity (作廢並換新身分, below) whose old files are overwritten and removed once every peer has its revocation.
- Display names are the captain's own petnames. What a peer calls itself is shown only as "自稱 …", cleaned (NFKC, no
  control, bidi or zero-width characters), with a warning when it looks like a name already in use (a different admin
  key is a different identity). Where a peer says it keeps its identity is shown as its claim.
- 我的地址 shows the device name, the fingerprint, the address, where the identity is kept and a copy button.
- Future work: a TPM 2.0 or PIV token on Linux; a Keychain access group tied to the helper's signature (Developer ID,
  notarization); a pre-rotation or recovery key for a lost Mac.

### Losing, retiring and replacing an identity

- **Lost** (the keys are gone while the store still holds an own log or peers): the relay does not start (no listener,
  nothing signed or sent) and the page offers 作廢並換新身分, which makes a new identity and sets the old store aside.
  The old keys are gone, so peers cannot be told: each replaces this Studio in person (below). A missing identity is never
  silently replaced. The own log is keyed by identity.
- **作廢並換新身分** (retire): a new identity is made; the old admin key signs a revocation naming the last entry it vouches
  for and the successor, and the new admin key signs the successor. The revocation is queued for every introduced peer
  and sent with the old identity's own keys (kept until it reached them all, then overwritten and removed); this Studio
  speaks as the new identity at once, its open threads close (threads are never moved) and every peer is introduced
  again with the short code.
- **A peer that retired**: its revocation is accepted only when the identity's own admin key signed it. Nothing after its
  last vouched entry is accepted; items and Tasks from entries after that are frozen and stopped; commits applied from it
  are marked; its threads close; the page says "X 換了身分，需要重新引介". The successor is never trusted from this: its
  introduction (with the code) is only labelled "certified successor" when both admin keys signed, else "not certified by
  the old identity: confirm in person". A result it handed back before the cut-off can still be accepted.
- **Replace** (a lost or stolen Mac whose owner cannot sign anything): only at the short code of a new introduction, on
  the desktop, the captain may say "this identity replaces X". X is revoked for good (never introduced again), its open
  items and Tasks stop, its threads close, what it applied stays marked as from a replaced identity, its petname carries
  over only if chosen, and the replacement is signed by this Studio's admin key and audited.
- **移除這個同事** revokes a peer for good without a replacement (its Mac is gone).

## Introduction

1. The responder opens its introduction window on the desktop (5 minutes by default, at most 15).
2. The introducer enters the responder's address. They run Noise XX over their daily key agreement keys; the responder's
   certificate rides in XX message 2 and the introducer's in message 3, both encrypted and mixed into the handshake hash,
   and each side checks that the certificate is signed by its admin key and binds the Noise key it came with. Then a
   commit-then-reveal exchange: the introducer sends a commitment to a random nonce, the responder answers with its own
   nonce, the introducer reveals. Both compute a 6-digit code from the handshake hash and both nonces, so the code covers
   both identities and both certificates. A man in the middle must fix his nonce before he sees the other one, so he
   matches the codes with probability 10⁻⁶ per attempt.
3. Each person types the code the **other** screen shows and gives the peer a name. A match: this Studio's admin key
   signs the introduction (Touch ID in the enclave) and the identity joins the allowlist; a mismatch ends the
   introduction (start again). Only after both sides confirm can they exchange anything.

An attacker could still grind: learn the responder's nonce, see the code it gives, abort, try again. So the responder
takes one introduction at a time; every introduction that got its nonce and did not reveal a matching one (a wrong
reveal, an abort, a timeout after 20 s, messages out of order, and one that stalls before its commitment while it holds
the only slot) is shown on its screen as a failed introduction; the third
failure closes the window, and a successful introduction closes it too (one introduction per window). An attacker gets
at most three tries, all visible, each with odds 10⁻⁶.

Unpair takes a peer off the allowlist and keeps its record (a freeze survives; it may be introduced again); revoke
(移除這個同事) marks its identity for good (never introduced again). Either one withdraws its open items, stops every
Task its work started, and drops what was waiting to be sent to it.

There is no discovery: Studio does not advertise itself on the network. A peer's address is the one it was introduced
at; when an introduced peer reaches this Studio from another address (an authenticated KK request, through the peer
address guard), the address is updated and the peer's card says so.

## Transport

- A listener of its own (`CREW_LAN_PEER_PORT`, default 7417, bound to this Mac's LAN address or `CREW_LAN_BIND`), its own
  server, off until the captain turns it on. It never reaches Studio's `handle(req, …)` routes, session or cookies.
- Four fixed routes, all `POST` with an `application/octet-stream` body of at most 1 MiB: `/lan/v2/kk` (one request
  over a Noise KK handshake, the reply in its second message), `/lan/v2/xx/1`, `/xx/3`, `/xx/4` (an introduction).
- Before any cryptography: the Host must be the listener's own address literal (DNS rebinding sends another name); a
  request with `Origin`, `Referer`, `Cookie`, `Authorization` or any `Sec-Fetch-*` header is refused; chunked bodies are
  refused; no CORS header is ever sent. A page cannot read an answer, and cannot produce the handshake anyway.
- KK needs both static keys before it starts, so the first message already proves the initiator holds an allowlisted
  identity's key; a responder that cannot decrypt it with any of them answers a bare 403 and nothing else (an
  unintroduced key does not even learn this Studio's key). After a message authenticated, a refusal is encrypted to the
  peer with its reason (`skew`, `version`, `replay`), and a version error never falls back to another protocol. The
  responder remembers each peer's static-static DH (memory only, keyed by both keys), so trying every introduced key
  costs the enclave one DH per message. XX runs only while the introduction window is open.
- A KK message is accepted once (its ephemeral key is remembered for ten minutes) and only within five minutes of this
  Mac's clock (a time that is not a date is refused). The replay cache is memory only: every operation is idempotent (a
  pushed entry keeps its verdict, and one at or below its author's low-water mark is never applied again), so a replay
  after a restart changes nothing. Requests are
  rate-limited per source address (the rate table is bounded), at most 32 are in flight, one introduction at a time, and an address that keeps sending KK messages no
  allowlisted key made is cut off for a minute from its eighth failure before Studio tries its keys again (an IPv6
  address counts with the rest of its /64; a full table drops its oldest entries, never a cut-off it holds).
- The client side dials only an IPv4 literal on one of this Mac's own private subnets: never a name, loopback (outside
  the demo), this Mac's own address, the network's default gateway, link-local, multicast, a metadata endpoint, the
  tailnet range or the internet; no redirects.

## Entries

Each Studio keeps one append-only log per identity. An entry is an envelope: the author's identity, the hash of the
certificate whose daily key signed it, `seq`, `prev` (the hash of the author's previous entry), the author's claimed
time, the recipients' identities, a sealed body and an ECDSA signature over all of it (with a purpose string, so a
signature made for one purpose never verifies for another). The body is sealed to the recipients' and the author's daily
key agreement keys (ECDH with a fresh key, HKDF bound to both points and the recipient's identity, AES-256-GCM). A
briefing or a result travels as a sealed blob next to the entry that names its SHA-256; there is no blob endpoint, so
nothing can be asked for by hash. A body is decrypted once, on receipt (or when Studio starts), into a bounded memory
cache; on disk everything stays sealed, the relay's own state included (titles and criteria are a peer's words: the state
row is sealed under a key derived from the daily key agreement key).

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
answer, and the sender keeps a retryable one in its outbox (in signing order, with backoff; the page says what it waits
for) while a permanent refusal stays on the thread with the reason. Decided entries and each author's sequence numbers
are bounded: entries trimmed below an author's low-water mark are never applied again, and fork evidence is never
trimmed. Revoking an entry deletes the content it named (a dispatch's or a refinement's briefing, a result's output)
unless that content started a run or was applied: that is kept, sealed.

Everything is kept in one SQLite store (`lan/relay.db`, WAL, synchronous FULL, `src/lan/store.ts`): the own log's
sequence number and head, the entry, its blobs, the outbox rows, the audit row and the thread it changes are written in
one synced transaction before anything is sent, so a crash never makes this Studio sign a second entry at a sequence
number a peer already holds. Approving an assignment writes the round's claim the same way before the Task starts; after
a restart the round finds its Task by the item that started it ("found after restart"), or shows it gone; the claim is
never released, so a new start needs a fresh take and assignment. A step whose writes fail leaves nothing behind.

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
  profile allows can be picked), a spend cap (dollars and agent rounds, or rounds only: no dollar limit, every paid
  round counted, for any provider), a provider and, for a code workflow, one of this Studio's registered projects. The suggested workflow is only a
  suggestion; nothing is fetched.
- **take**: the dispatcher assigns it (an `assign` entry naming the taker's key).
- **assign**: the taker starts the run.
- **result**: the dispatcher reads the files (text only) and accepts it; then refines or marks it done; a code result's
  patch can be applied (below).
- Content from a peer is drawn only as text nodes: never as HTML, never as SVG, never in a frame of Studio's origin.

## Running work from a peer

`startLan` starts the taker's workflow through the same staffing and start path as the board's Run: a code workflow
(code-firstmate) runs on one of the taker's registered projects with its approved crew; an own workflow's staffing is
confirmed with the take. The Task runs under the runtime's profile `lan` (`run.profile`, set only by the runtime as a
start option, never from params; its mark is the item and its spend cap; docs/architecture.md, Profiles). The engine
calls the profile for every step, round, tool, check and policy of the Task, whatever its kind; a seam it does not fill
refuses, and a LAN Task whose mark is unreadable is held to a zero cap. Enforced, whatever the briefing says:

- **Sandbox only** (`taintRefusal`): never in local unrestricted mode, never under a sandbox-off grant; a round without a
  sandbox is refused.
- **Allowlisted steps** (`src/lan/profile.ts`): hooks that only work locally (`note`, `set`, `intent.capture`,
  `repo.prepare`, `repo.cleanup`, `deliver.intake`, `deliver.round`, `doc.export`, `library.publish`, `hello.web`, and the code pack's
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
  counts as unknown dollars. Whatever its cap, every paid round of a peer's Task is at most 15 minutes and 60 tool calls,
  and a round that reports more than 2,000,000 tokens ends the Task's paid rounds. Dollars are shown on the thread as
  they are reported.
- **Daily ceilings**: over every peer's Task on this Mac (rounds-only ones included), Studio-wide and on by default
  ($20 and 60 rounds a day; editable on the Peers page): a round of unknown cost counts at an estimate ($1 by default)
  against the dollar ceiling, and every round against the round ceiling. A round past either is refused before it starts.
  A rounds-only take says so: no dollar limit, its worst case at the estimate, and the daily ceiling that still applies.
- **Auto-start, opt-in**: at the take the taker may tick "start as soon as they assign it, with this exact cap"
  (unticked by default). It lasts 30 minutes after the take. When the assignment arrives every check is made again (the
  peer still introduced, not frozen or revoked; the round current; the prompt the one the taker read; the item's cap
  and the daily ceilings holding), and only then the Task starts; the thread says it started by itself and offers a stop
  button; the start and every skip are audited. Without it, the start click shows the prompt's hash, the cap and the
  project, and starts nothing else. Every running Task has a one-click stop.
- **One Task per assignment**: approving an assignment claims the round before the Task starts, so a second approval
  starts nothing; if the peer is revoked or frozen, or the work withdrawn, while the Task starts, it is stopped at once.
  The claim is never written to disk; after a crash mid-start it is cleared and the take may be approved again.
- **Every workflow is classified**: a workflow is eligible only when every step is on the profile, it declares in its
  definition what it hands back (`lan: { output: "text" | "patch" }`; `lan: { refuse: "<why>" }` says why it takes
  none), and this machine enforces the profile (macOS; elsewhere this Studio takes no work from a peer at all). Images
  and video are refused in v1 (binary output; the renderer runs a browser over the agent's page and is not on the
  profile). The taker's Studio lists every installed workflow; one it does not offer (internal, retired, held, not
  declared, refused, a step off the profile) names its reason, and a take with it is refused with that reason; steps a
  LAN Task never reaches on its own are shown at the take as "may stop at …". A file the hand-back cannot carry (binary)
  refuses the send, shown in the preview. `tests/lan-workflows.ts` relays every eligible bundled workflow end to end
  across two Studios, refuses every other one, and fails when a workflow a person can start is not classified.
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

## Code work: its base

Code work names a project at dispatch: the dispatch carries that project's history (its root commit) and the commit its
base branch is at. The taker takes it only on a project that holds both (two clones of one project do); the Task's
worktree starts at that commit, on a branch `lan-base/<sha>` pinned there, so a build round's rebase changes nothing;
the result names that commit as its base, and the dispatcher applies it there (never onto whatever its base branch is
later, and never onto another base: a result naming another commit is refused).

## Applying a code result

The dispatcher applies a code result's patch to one of its own registered projects (`src/lan/apply.ts`) only when the
peer is still introduced and not frozen (a revoked identity's result only from before its cut-off), the result was
accepted, and the apply names the SHA-256 of the exact patch the page showed (read to its end). Git names the
paths (`git apply --numstat -z` and `--summary`), never a regex, and every one is checked: nothing outside the
project, no protected path, nothing but printable ASCII. A binary hunk, a copy or a rename (it carries its source's
mode), a new file with any mode but 100644 (an executable, a link, a submodule), a mode change, or an edit to a path
that is not a plain 100644 file in the base (`ls-tree`: a symbolic link keeps its mode when its target changes) refuses
the whole patch. It is applied without a checkout: into a
temporary index (`apply --cached`), committed with `commit-tree` onto the base the result names, branched as
`lan-untrusted/<thread>-r<n>` with `update-ref`, so no clean or smudge filter of the repository and no hook runs.
Nothing is merged, built, tested or pushed: the branch is read and diffed like any untrusted change.

The commit joins Studio's **taint list** (`src/lan/taint.ts`, kept in the store with its peer and thread, audited). A
commit is tainted when any recorded commit is its ancestor (`git merge-base --is-ancestor`), whatever its branch is
called, so one commit on top of it under another name is still the peer's work. Studio starts no trusted Task from a
tainted commit (repo.prepare checks the Task's base, a base Firstmate set included), sends none for review (Send for
review, From existing branch), merges none and publishes none (every Studio push and pull request). The Peers page lists
them, says not to check a `lan-untrusted/` branch out in a terminal or ask Firstmate to review it, and clears one only
when a person says "I reviewed commit X" (audited). A commit from a peer that was later removed or replaced stays on
the list, marked so.

## Audit

The audit is a table of the store, hash-chained (each row names the hash of the one before; a rotation keeps the chain
from the last moved row) and written in the same transaction as the step it records: a step whose audit row cannot be
written does not happen. It records introductions (fingerprint), unpair, revoke, unfreeze and freezes, dispatches, takes
(the prompt hash read, the workflow, the cap, the provider, the project), assignments, what started which run, result
accepts, hand-backs and applies. The page reads it at `/api/lan/audit` with whether its chain holds.

## Not done in v1

- Pre-rotation (KERI style) or a recovery key for a lost Mac; new daily keys under the same identity.
- A TPM 2.0 or PIV token for the identity on Linux.
- Network pinning (subnet, gateway MAC, SSID).
- Deniable MACs for conversational entries: every entry is signed.
- Relaying entries between peers (each author's entries reach only its recipients directly).
- Taking work from a peer anywhere but macOS: the restricted profile's no-local-binding scope is enforced by the macOS
  profile, so elsewhere the take is refused (dispatching still works).

