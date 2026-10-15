# pack-genesis: authoring a domain pack is itself a workflow

A new pack is built by a workflow on the same runtime, with the captain and agents collaborating. It is not hand-written code.

## Graph

```
describe ─▶ interview ─▶ samples ─▶ label ─▶ draft pack ─▶ check-the-checks ─┬─▶ shadow tasks ─▶ promote ─▶ publish
                                     ▲                                       │
                                     └──────── refine (labels ↔ checks) ◀────┘
```

| node | who | what |
|---|---|---|
| describe | captain in chat | "I want an architect workflow for floor plans", with any files |
| interview | coordinator agent | asks every question at once: inputs, outputs, the tools at hand, what "good" means, deal-breakers, and who signs off |
| samples | agent + captain | collect or generate good and bad examples, and past work |
| label | captain + agent | the captain annotates samples in the M3 review UI, with the same locators as the checks. The agent pre-labels and the captain corrects |
| draft pack | agent | manifest, producer nodes, checks (scripts or judged prompts), locator type, policies, workflow template |
| check-the-checks | runtime | every check runs on the labelled samples and gets scored for precision and recall against the labels. A judged check also gets agreement across vendors |
| refine | agent ⇄ captain | the agent proposes a change per miss ("you marked 3 frozen frames; a 0.3 s threshold catches 3/3 with 0 false hits"), and the captain accepts or edits. A captain annotation that no check catches becomes a proposal for a new check |
| shadow tasks | runtime | the pack runs on real work with its checks advisory only, and the results are compared with the captain's final acceptance |
| promote | card (H) | a check becomes blocking once it matches the captain's acceptance in at least N of M tasks (per-check policy). Below that it stays advisory and goes to the "needs your eye" list |
| publish | runtime | a versioned, hash-pinned pack with its eval set and metrics |

## Continuous improvement (M6)

- Every final acceptance where the captain overrides a check (passes something it failed, or rejects something it passed) is stored as a new labelled sample.
- Retro turns these into proposals: change a threshold, add a check, demote a check. Each proposal carries the expected metric change, measured on the eval set. A rejected proposal is never re-proposed.

## What a human does

The human labels examples, answers one batch of interview questions, accepts or edits the proposed checks, and promotes checks. The human never writes check code, though an engineer may edit any check by hand in the pack editor.
