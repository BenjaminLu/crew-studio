# Fix round 1, class durability: every two-write change is one durable step, or recovers (runtime brief item 4)

Answers: check-runtime#11 (a run killed while an edge check is in flight cannot recover). Swept: every other place in the runtime where one change takes two writes.

Done when (each line is proved by `tests/durability.ts`, new and red on the base; each case replays a run's events cut at the crash point into a fresh engine):

1. A node's result and the routing still to do are one durable event (`routing` marker); after a crash between the result and the routing, the routing replays (its edge checks run again) and the run reaches its end. — "a node's result and its routing marker are one durable event", "after a crash between the result and the routing, the routing replays …".
2. A card answered just before a crash is carried on: the node moves with that answer, and the card's effects apply once. — "after a crash between a card's answer and the run's move, the answer is carried on".
3. A card raised by a step that did not record that it waits on it is cancelled on recovery; the step runs again and exactly one card is open. — "a card raised by a step cut short is cancelled …".
4. A run whose creation was recorded but not its first step starts after a restart. — "a run whose creation was recorded but not its first step starts after a restart".

Also in this commit (the class the coordinator named after the red refine test): a run override set by a card adds to the policy that resolved and never replaces it, at every resolution site (the engine's policy(), check params bound to policy, the loop's cap). 7a0747b already made master green for tests/refine.ts.
