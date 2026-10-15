# Fix round 1, class ids: unique identifiers from a counter under a lock (runtime brief item 5)

Answers: check-runtime#5 (two runs of one check on one node shared an evidence folder). Swept: every count-based id in the codebase.

Done when (each line is proved by `tests/ids.ts`, new and red on the base):

1. Two runs of one check on one node keep separate evidence folders, each with its own output (the folder name is unique, not the ledger count). — "two runs of one check on one node keep separate evidence folders …".
2. Ids come from a counter read and written under a lock (`src/ids.ts`): three processes allocating at once get distinct ids. — "three processes allocating 40 ids each get 120 distinct ids", "the counter lives next to what it numbers".
3. The ledger's seq and chain link are read and written under the ledger's lock: two writers get distinct seqs and an unbroken signed chain. — "two processes appending to one ledger …".
4. Studio cards, intents, runs, changes, file-organization plans, retros, eval cases and review notes are numbered under a lock. — "two processes raising cards get distinct card ids", "two processes capturing intents get distinct intent ids" (runs, changes, plans, retros and evals use the same `allocate`; notes use max + 1 under the version's lock).

Not changed: a run's step `seq` is its position in the run's own step list, written by the one engine that owns the run.
