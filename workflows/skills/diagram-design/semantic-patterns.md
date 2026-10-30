# Semantic patterns (diagram-design's, as the review room uses them)

A semantic pattern says what a system does; a visual type says how it is arranged. Choose a pattern first when behaviour,
state, enforcement or risk carries the meaning, then its nearest type. One primary pattern a figure; a second may add at
most one primitive. Labels and outcomes complete in a static frame.

| The captain must understand | Pattern | Nearest type |
|---|---|---|
| Many arrivals competing for finite capacity | fan-in queue / bottleneck | data flow |
| The same questions, inputs, controls, outputs across stages | stage framework with slots | process (draw as data flow) |
| A loose input becoming a durable structured record | unstructured input → structured artifact | data flow |
| Why two policy decisions differ, where they first diverge | paired policy-evaluation traces | flowchart |
| Which routes cross a trust boundary, which are blocked | secure paved road | architecture |
| Which controls apply at each enforcement surface | governance / control catalog | layer stack (draw as architecture) |
| How defences reduce risk and what remains | compensating security layers | layer stack (draw as architecture) |
| A system decomposed into citable blocks | traceable block decomposition | tree (draw as flowchart) |

For a change the room teaches, the most common are: a lifecycle over database rows (state machine; each transition is one
transaction: `type-state.md`), a request across services (sequence), a trust boundary the change moves (secure paved road),
a queue the change adds or drains (fan-in queue). Each pattern's required primitives: show them, label units (`3 slots`,
`8/hour`), never imply a quantity by box size alone, and keep the outcome visible without motion.
