# Compare transcripts

What: a Task page link, "Compare transcripts / 並排比較紀錄" (`#/tasks/<id>/compare`), shows two agent Rounds side by side: each column has the prompt the agent received, its messages, tool calls and results, and its final report. Headers line up: role, provider and model, duration, outcome, and a link to the round's full log. At 390 px the columns stack behind a role toggle; at desktop width each column scrolls by itself, with an optional "sync scroll by step".

Why: in the startup competition a Claude founder and a Codex judge alternate for up to three rounds. The captain wants to read each founder round next to the judge round that answered it.

How the pairs are chosen: a workflow may declare role pairs in its yaml, `compare: [[founder, judge]]`. The k-th round of the first role sits next to the k-th round of the second (a node's `args.round` names k when it has one). A Task reads the hint from its own pinned copy of the workflow, else from the workflow's current version when the roles match. A workflow without a hint offers every agent Round, and the captain picks any two. Nothing in the page names a workflow.

Data: `GET /api/tasks/<id>/compare` (the pairs and every agent Round) and `GET /api/tasks/<id>/compare/<node>/<visit>` (one Round). The second reads `data/runs/<run>/nodes/<node>/<visit>/` `prompt.md`, `stream.jsonl` and `report.json` by name only: the node and visit must name an agent step of that Task, no path part may be a symlink, the folder's realpath stays under `data/runs`, and the file opens O_NOFOLLOW. Every text passes the Transcripts redaction; a paired phone gets a summary unless the Mac allows more. TODO: read through `src/logs.ts` (openLog, log links) once the error-log-links branch lands.

Done: `tests/compare.ts` (pairs for a seeded startup Task, any two rounds, redaction, traversal, symlinks, hard links and FIFOs, a final message shown once) and `tests/compare-ui.mjs` (two columns at 1280, stacked at 390, the round selector switches the content).
