# Workflow semantic comparison

The saved-version diff and editor comparison include workflow `kind`, team
`seats`, discovery `intent`, approval `card_checks` and transcript `compare`
pairs alongside the existing editable declaration fields. A compare-only or
kind-only edit now creates a new saved version instead of being discarded as
"nothing changed". Earlier versions remain unchanged.

The editor shows before/after declaration values. Version-record metadata and
node coordinates are excluded from that semantic view; layout persistence stays
separate. No scheduler, runtime authorization, staffing or approval gate changes.

This closes the audited supported-field comparison omissions. It does not add
rollback, Git collaboration, import, arbitrary future-field compatibility or
proof that a changed workflow will run successfully. Compare the declaration,
then use the existing validation, execution and human approval flow.

`bun run test:workflow-semantic-diff` exercises actual saved-version writes and
the authenticated editor comparison on desktop/mobile. It is also included in
the main full-CI test chain.
