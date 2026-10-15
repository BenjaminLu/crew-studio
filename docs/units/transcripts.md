# Unit transcripts: what every agent was asked, and what it did

What: for every agent invocation the captain sees the exact prompt (with the brief it
was bound to), the transcript of what the agent did, and its report. Crew (firstmate's
worker and reviewer rounds), Firstmate (the main session's history) and Runs (Studio's
own agent nodes) each show it. No new sidebar entry.

Why: the captain asked to see, from the v2 pages, the transcript and "the brief each node
was called with": the prompt, not a summary of it.

## How it works

- **Crew round detail** (`#/crew/<actor>`): three tabs in this order.
  - Prompt: the round's newest attempt's `prompt.md` (`state/runs/<actor>/<attempt>/prompt.md`),
    raw, plus the same text split at its level-1 headings into labelled sections (dispatch
    line, role skill, spec pin, task, round notes, the approved brief, the context pack with
    CI or review inputs, review history). The brief section names the evidence record it
    matches (`state/evidence/<project>/<task>/<record>.json`, kind `brief`), with that
    record's round and head, the brief file in `state/briefs/` with the same text when
    there is one, and a carried-to note when firstmate carried it to a new head.
  - Transcript: the attempt's `cli.log` (else `run.log`): assistant text, tool calls with
    their arguments, tool results collapsed by default and cut at 2,000 characters with an
    expand control (the server sends at most 50,000), errors, the final result, and
    timestamps (an assistant line carries the last timestamp seen before it). While the
    round runs, the page asks for the bytes after the last offset every 1.5 s and appends.
    The offset belongs to one attempt: the page sends the attempt it read, and when a
    newer attempt exists the server reads that file from 0 and says `reset`, so the page
    replaces its entries. The server says whether the round is `live`: a crew round while
    its process lives and it wrote no result since it started; a node round while its run
    (`run.json`) is queued, running, waiting or paused and the round has neither a terminal
    status in its stream nor `report.json`. The page polls only while `live` is true.
  - Report: `final.txt`.
- **Firstmate** (`#/firstmate`): the history of the session Studio drives (its copy holds
  the turns from before the takeover) or, when none is attached, of the firstmate session,
  read backwards from its transcript JSONL in pages of 40 turns, with "Load older".
- **Runs**: Studio's runtime keeps each agent node round in the round-record layout
  (docs/units/round-record.md): `data/runs/<run>/nodes/<node>/<round>/prompt.md` (a
  front-matter header with run, node, round, head, the bound brief's id and its ledger
  seqs, then the exact bytes sent), `prompt.hop<n>.md` for a hand-off, `system.md`,
  `stream.jsonl` (`{ts, type: message|tool_call|tool_result|status}`) and `report.json`.
  `GET /api/node-runs` lists them; `#/runs/node/<run>/<node>/<round>` shows the same three
  tabs: the Prompt tab shows the header as the round's binding (brief id, ledger, round,
  head), the body's sections, every hand-off prompt and the system prompt; Report reads
  `report.json`. When the folder or a file is missing the tab says so.
- **Safety.**
  - Every response that carries a round's text passes the one secret registry in
    `src/secure.ts` at the server boundary: crew prompt, transcript and report (both report
    routes), Firstmate history, node-run prompt, header, system prompt, stream and report,
    and the phone summaries. The rules are `src/secure.ts`'s (unit redaction-rules): known
    values (credential-named environment variables, every secret registered where Studio
    reads it, a round's own token), the credential names (`isCredentialName`: a credential
    word as the whole name or its last word, an UPPER_SNAKE `*_KEY` or PRIVATE name; prefix
    families like `GH_HOST` stay visible), and under a credential name every value goes
    but true, false, null, undefined, a number under 8 digits and an empty string; known
    formats (`sk-ant-`, `sk-`, `gh*_`, `github_pat_`, `xox?-`, `AKIA`, JWT, PEM) anywhere.
    `redactJSON` applies the same name rule to keys at any depth: tool arguments, headers,
    round-record headers, `report.json`. The marker is `[credential removed]`.
  - A paired phone gets a summary (sizes, section labels, counts), never the raw prompt,
    transcript or history, unless the Mac turns on "phones may read prompts and
    transcripts" (`data/transcripts.json`; changing it is desktop-only).
  - Only GETs read firstmate state; nothing writes it. Paths are checked by pattern (no
    `.` or `/` in an actor, run, node or round name).

Routes: `GET /api/crew/<actor>/invocation`, `GET /api/crew/<actor>/transcript?after=<byte>`,
`GET /api/crew/report/<actor>` (existing), `GET /api/firstmate/history?before=<byte>`,
`GET /api/node-runs`, `GET /api/node-runs/<run>/<node>/<round>[/transcript?after=]`,
`GET|POST /api/transcripts/settings`.

## Done lines

Each names its test. All of them are new in `tests/transcripts.ts` and
`tests/transcripts-ui.mjs`, which do not exist on the base, so they are red there by
construction; the fail-first section records the run.

1. The prompt tab shows the exact bytes of a fixture prompt.md: UI "the Prompt tab shows the
   exact bytes of prompt.md"; API "the invocation returns prompt.md byte for byte".
2. The prompt is split into labelled sections, and the brief section shows its source, round
   and head: API "the prompt splits into labelled sections", "the brief section names its
   evidence record, round and head", "the brief section names its brief file"; UI "the brief
   section shows its round and head".
3. Planted secrets are redacted in the prompt and the transcript: API "a planted token is
   redacted in the prompt", "a planted token is redacted in the transcript", "an
   Authorization header is redacted", "the redactor keeps ordinary hashes"; UI "the planted
   token never reaches the page".
4. The transcript shows text, tool calls with arguments, collapsed results with an expand
   control, and timestamps: API "the transcript has text, tool calls with arguments, results
   and timestamps", "a large tool result is cut with its full size"; UI "a tool result is
   collapsed by default and expands".
5. A live round appends without a reload: API "reading after an offset returns only the new
   entries"; UI "a live fixture round appends to the transcript without a reload".
6. Report tab: UI "the Report tab shows final.txt".
7. Phones: API "a phone gets a summary, never the raw prompt", "a phone gets no transcript
   entries", "a phone gets no firstmate history", "the phone setting is desktop-only", "with
   the setting on, a phone may read the prompt".
8. Firstmate history: API "the firstmate history pages backwards", "older pages join without
   gaps or repeats"; UI "the Firstmate page shows the session history and loads older turns".
9. Runs: API "node runs are listed from data/runs/<run>/nodes/<node>/<round>", "a node run
   returns its prompt, stream and report", "a node run's prompt header names its round,
   head, brief and ledger; the body is the exact bytes sent", "a hand-off's
   prompt.hop<n>.md is listed and readable, nothing else", "a missing node run folder is an
   empty list"; UI "Runs lists the agent node runs", "a node run shows the same three tabs,
   its record header and its system prompt", "a node run's transcript reads the normalized
   stream", "a node run's Report tab reads report.json".
10. Read-only and path-safe: API "a path outside the runs is refused", "nothing under the
    firstmate state is written".
11. Every new view at 1440 and 390 px, light and dark, with no sideways scroll: UI "<view>
    renders at <width> <scheme>", "<view> has no sideways scroll at <width> <scheme>" for
    prompt, transcript, report, history, node (Prompt), runs (the "Agent node runs" card),
    node-transcript, node-report and phone-summary (a real phone paired over LAN mode).
12. One redactor at every boundary (review round 1): API "no secret leaves the server: <route>"
    for crew invocation, transcript, report, report (takeover route), firstmate history,
    node run, node run transcript, and both phone summaries; "a secret named by its key in
    tool arguments is redacted"; "redaction lives in the one secret registry
    (src/secure.ts)"; "Studio's own secret values are redacted wherever they appear".
13. The live cursor belongs to one attempt: API "a new attempt restarts the transcript from
    its start".
14. Polling stops on an explicit signal: API "a round that ended says so: a dead crew
    round, a node round in a terminal state without report.json"; UI "a finished round
    stops polling" (a round older than Crew's two-day list), "a node round in a terminal
    state without report.json stops polling".

## Fail-first

Base: first `095a8b8` ([unit:round-sandbox]); the branch was then rebased onto `7a86cd7`
([unit:round-record]), its merge-base now. With only the new test files copied onto `095a8b8`:

- `bun tests/transcripts.ts` → 0 passed, 1 failed: `src/transcripts` does not exist, so
  every API line above is red by construction, not assertion by assertion.
- `node tests/transcripts-ui.mjs` → "a crew round opens on its Prompt tab with sections",
  "the tabs are Prompt, Transcript, Report in that order" and "the brief section shows its
  round and head" FAIL, then the Raw switch never appears (exit 1).

After the rebase onto `7a86cd7` the fixture's node run moved to the round-record layout;
on the first commit those three node-run API lines were red (23 passed, 3 failed: no header,
no normalized stream, no hop list) before the second commit read that layout.

One existing assertion changed meaning: `tests/smoke.mjs` "crew focus view shows the log"
looked for the old focus terminal (`.screen.big .tl`); the round's log now lives in its
Transcript tab, so the assertion opens that tab and requires a stream entry. The guard (a
round's detail shows its log) is kept.

Review round 1 (REJECT on `8487a26`; tests written first, run on its rebased equal
`7a5a596`): `tests/transcripts.ts` 29 passed, 11 failed (every route in done line 12 that
had a planted secret, the registry, the attempt reset, the liveness signal);
`tests/transcripts-ui.mjs` 92 passed, 2 failed ("a finished round stops polling", 3
requests in 4 s; "a node round in a terminal state without report.json stops polling", 3
requests). The new matrix views and the LAN phone pairing were green there too: they add
coverage of views that already worked.
