# Fix round 3, old-layout migration (migrate r2 REJECT)

Done when (red on 76f2523):
1. #9 `tests/worktrees.ts` "one record's failure never stops the others …" and "the failing record is logged and parked …": a failure injected into one record's migration (its save throws after the worktree moved) is logged, the record is parked with its lock and its folder (wherever the move left it), nothing of it stays in data/work/wt, and the records after it still migrate. Both go red when the per-record try/catch is removed (checked by hand: the error escapes `migrate()` and R-072 never migrates).
2. #10 every park takes the record's own sibling folder (data/work/<p>/<stem>, never a path the record names; a symlink moves as a link) and names it in the log line: "a record whose ids cannot name a folder is parked with its folder …", "every park takes the record's own sibling folder …". Same class as r1 #2: no park path leaves a folder outside every sweep.
3. #11 `tests/skins.mjs`: the late voyage snapshot is held at a gate opened only after terminal's listener is confirmed installed (no timer); the test fails if the snapshot is never requested.
