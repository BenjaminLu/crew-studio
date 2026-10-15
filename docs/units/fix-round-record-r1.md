# Fix round 1, round-record (round-record r1 REJECT)

Answers round-record r1 #1–#4 (must-fix) and #5. The secret registry takes the shape the transcript viewer's unit defines (branch `transcripts`: `SECRET_KEY`, `SECRET_VALUE`, `secretValues()`, `redactText`, `redactJSON`, marker `[redacted]`), so the two land as one definition; this unit adds the file-held secrets (`registerSecretValues`: the key store registers itself; the server registers the GitHub token file, the ledger key and the session token) and an `extra` list (a round's own tool token).

Done when (`tests/round-record.ts`, 9 lines; each new line is red on the base):

1. #1 One definition of a credential in `src/secure.ts`; the round's prompt and record, the agent log (`Agents.log`), the stream (`redactJSON` on tool arguments) and the gates' secret check (`looksSecret`) all use it; agent.ts and gates.ts keep no list of their own. — "no credential reaches a prompt or the record: Anthropic, OpenAI project, GitHub and JWT formats, and the values of Studio's env and key-store secrets".
2. #2 The value of a Studio secret, from the environment and from a file (the key store), is removed from the prompt, `system.md` and `stream.jsonl`. — the same line, with a secret in the system prompt too.
3. #3 A hand-off in the same round writes `prompt.hop<n>.md` and `system.hop<n>.md` with the same n as its header (`hop`); a retry of the round adds `.attempt<k>`. — "a hand-off in the same round writes prompt.hop1.md (header hop 1) with the bytes the new provider received".
4. #4 The header's values are asserted: round 1 names run, node, round, attempt, hop, the head, no brief, job, provider, model, sent; round 2 names the exact brief id of round 1 at the head and the seqs of round 1's failing ledger entries. — "round 1's header …", "round 2's header names the exact brief …".
5. #5 A record that cannot be written fails the job before the provider starts, releases its token and leaves nothing running. — "a record that cannot be written fails the job …".
