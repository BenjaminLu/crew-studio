# Fix round 1, class generic: the runtime knows no domain (runtime brief item 7)

Answers: check-runtime#7 (hooks keyed on mode === "build" and do === "git.merge"; card checks and choice ids hard-coded). Swept: every generic runtime file for domain literals.

Done when (each line is proved by `tests/generic.ts`, new and red on the base):

1. A node declares the lifecycle points it marks (`lifecycle: [after_merge]`, `[after_round]` …); the workflow's hooks at those points run when it finishes, and only those. — "a node that declares lifecycle after_merge fires the workflow's after_merge hook …", "a node named merge fires nothing unless it declares the lifecycle point".
2. The loop routes the finding classes the workflow names (`route_classes`) and treats as report-only the checks it names (`report_checks`). — "the loop routes a finding class the workflow names …" (and tests/refine.ts "a failure of only the report …", now with `report_checks`).
3. A card's checks (`card_checks`, default the runtime's own `core/ste-wording`) and its auto option (`card.auto_option`) come from the workflow (landed in fix-runtime-contract and fix-runtime-authority).
4. No domain literal is left in the generic runtime files (engine, refine, checks, defs, cards, grants, locator, index): no firstmate check ids, git merge, build mode, report schema, door change, migration, worktree or fail-first. The intake classifier's one-way words come from policy (`intake.one_way_words`). — "the generic runtime files carry no domain literal …".
