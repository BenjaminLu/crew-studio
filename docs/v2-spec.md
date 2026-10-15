# Crew Studio v2 spec (index)

Captain priorities, 2026-10-14:

1. **Check contract**: the standard interface for every script, gate, lint, judge and hook. [check-contract.md](check-contract.md)
2. **code-firstmate**: firstmate's coding pipeline as a v2 workflow on that contract, shown in a draggable graph editor with live task overlay. The same graph runs on local repos and on external repos' pull requests. [code-firstmate-pipeline.md](code-firstmate-pipeline.md)
3. **Session takeover (today)**: Studio becomes the captain's single entry point to the firstmate session:
   - Take over forks the live session (`--fork-session`), holds the driver lock and writes a handoff; Release hands it back;
   - dispatch from chat;
   - live status of every worker and reviewer;
   - human in the loop: permission prompts, questions, interrupt;
   - intent-alignment cards with the full intent sections and the one-way door confirmation, answered through the v1 board endpoint;
   - firstmate wakes delivered into the session's input queue (firstmate's own Stop hook in the fork first, Studio after a grace period; see docs/units/takeover.md).
4. **Native runtime**: workflows run inside Studio, not read-only:
   - a persisted task state machine, restart-safe;
   - pause, resume and cancel;
   - hot-swap handoff;
   - Studio-owned cards;
   - versioned workflow definitions, where running tasks keep their pinned version.
5. **Refine loops** for non-code work (video, image, web, documents): checks with shared locators. A human sees only the final acceptance card, split into "proved by checks" and "needs your eye".

6. **Pack genesis**: authoring a domain pack is a human-AI workflow on the same runtime: label samples, draft checks, score the checks against the labels, run in shadow, then promote to blocking. [pack-genesis.md](pack-genesis.md)

Standing rules:

- Studio never modifies the firstmate repo and never answers firstmate cards on its own.
- No GitHub writes without a repo the captain named.
- Out of the box, with no new external dependencies.
- No real company or repo names in shared content.
