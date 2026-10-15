# Unit round-record: the exact prompt of every agent round, on disk

What: every agent node round leaves its record under `data/runs/<run>/nodes/<node>/<round>/`.

Why: the captain wants to see the exact prompt (brief included) of every agent invocation (2026-10-14). A viewer reads this layout.

Layout:
- `prompt.md`: a front-matter header (`run`, `node`, `round`, `head`, `brief` = the bound brief's id, `ledger` = the evidence ledger seqs the brief was compiled from, `hop`, `job`, `provider`, `model`, `sent`), then the exact bytes sent to the provider. Written and synced before the provider starts. A hand-off later in the same round writes `prompt.hop<n>.md`.
- `system.md`: the system prompt.
- `stream.jsonl`: the provider's events, `{ts, type: message|tool_call|tool_result|status, ...}`.
- `report.json`: the final output (status, error, what the agent said, tool count, cost).

A credential never goes into a prompt: before a prompt reaches the provider, anything that looks like a credential, and the value of any of Studio's own secret variables, is replaced with `[credential removed]`. Other redaction happens when the record is shown, not when it is written.

Done when (each line is proved by `tests/round-record.ts`, new and red on the base):
1. Every round of an agent node leaves `prompt.md` at that path. — "every round of an agent node leaves …".
2. `prompt.md`'s bytes after its header equal what the provider received. — "prompt.md's bytes after its header equal what the provider received".
3. The header names the run, node, round, head, the bound brief and its ledger entries. — "the header names …".
4. No credential is written into a prompt. — "a credential never reaches a prompt …".
5. `stream.jsonl` holds the normalized events; `report.json` the final output. — "stream.jsonl holds …", "report.json holds …".
