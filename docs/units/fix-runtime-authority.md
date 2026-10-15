# Fix round 1, class authority: only the captain's signed grant answers cards (runtime brief item 6)

Answers: check-runtime#6 (authority from unauthenticated config; `granted_by` free text; `one_way` auto-confirm).

Done when (each line is proved by `tests/authority.ts`, red on the base: there `auth.window` resolves from any policy layer and `src/runtime/grants.ts` does not exist):

1. A workflow definition carrying `auth.window` answers no card. — "a workflow definition carrying auth.window does not answer cards".
2. A policy file (org, project, a pack's bundled policies) carrying `auth.window` answers no card; `auth.*` never resolves from policy. — "a policy file … does not answer cards".
3. Only the captain's own action opens a window; it is a grant line signed with Studio's key, and the answer's ledger entry names the grant and who granted it. — "only the captain's own action opens a window", "a captain's grant answers the listed kind with the workflow's auto option", "the ledger records the grant id and who granted it".
4. A window never confirms a one-way door (`one_way` is gone). — "a one-way merge card stays open inside a window" (also tests/runtime.ts "an auth window never confirms a one-way door").
5. An edited, revoked or expired grant answers nothing. — "an edited grant is ignored", "a revoked grant answers nothing", "an expired grant answers nothing".

The auto-answer option comes from the workflow's card (`card.auto_option`, else its primary option), not from hard-coded ids. The desktop route that opens a grant lands with the server wiring (runtime class "contract").
