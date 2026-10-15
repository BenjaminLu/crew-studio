# Fix round 1, class lifetime: nothing outlives its run (runtime brief item 3)

Answers: check-runtime#8 (work keeps running after its run ended), check-runtime#3 (the process group; its group kill and pipe race landed in fix-runtime-sandbox, run-end kill here).

Done when (each line is proved by `tests/lifetime.ts`, new and red on the base):

1. When a terminal is reached on one branch, every sibling still running stops: its agent job is cancelled and its node is skipped with cause "the run ended". — "a terminal reached on one branch cancels the agent still running on another".
2. A check still running is stopped and its whole process group killed. — "… and kills the process group of a check still running".
3. A result that arrives after the run ended is refused: no node moves after the terminal event. — "a result that arrives after the run ended is refused …".
4. A run that fails for want of an edge stops its siblings the same way. — "a run that fails for want of an edge stops its siblings too".

Also: a card's run override (`effects: {extend: {policy: round_cap, add: 2}}`) adds to the cap in effect (the loop's own, a project's or the org's) instead of replacing it with a number computed from an absent policy; this made `tests/refine.ts` red on a clean checkout of fix-runtime-contract ("extending is a run override set by the card …").
