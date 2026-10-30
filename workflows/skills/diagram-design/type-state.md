# State machine (diagram-design's, with baton's database lifecycle)

Best for finite state logic: an order's status, an authorization, a job, a connection.

- States are rounded rectangles (`rx=8`) in sans, each with `data-node` = the state's id from the code.
- Start: a filled ink dot (`r=6`) or the first state in ink at a heavier stroke. End: a ringed dot, or the final state in
  `ok` (ended well) or `seal` (failed, cannot be undone).
- Transitions labelled `event [guard] / action` (leave out what you do not need), in mono, 6–10px off the connector.
- Self-loops curve above the state. Ways back (a retry, a re-auth) in `amber`, dashed, routed around the boxes.
- Orient along the lifecycle (left to right, or top down for more than four stages); rearrange before letting transitions
  cross.

## The database lifecycle (baton)

When the states are a column of database rows, the lifecycle is the state machine with each edge opened into the one
transaction that implements it. For every transition give its `tx`: each table written (INSERT, UPDATE, DELETE or UPSERT),
each field `was → now`, the guard that makes it safe (the CAS predicate, the unique key, the row condition), and what is
written outside the transaction (a cache, the outbound call, an event), which the page sets apart dashed. The in/out
boundary is the content: a reader who cannot see which writes commit together assumes they all do.

Cover every transition the code has, not the memorable ones: the claim, the release, the cancel are where the protection
lives. More than about twice as many transitions as states means two machines: one figure per entity (an order, its
authorization), never a subset of one. Every transition cites the code that makes it.

Anti-patterns: "from any state" drawn from every state (one annotation instead); unlabelled transitions; a schema timeline
instead of the transactions.
