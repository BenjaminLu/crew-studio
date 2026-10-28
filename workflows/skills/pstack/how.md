# Skill: how (adapted from pstack, MIT; credit and license in NOTICE.md beside this file)

Answer "how does this change work?" for one pull request. Produce an architectural explanation at the level of a senior
engineer onboarding onto a subsystem: enough to build a working mental model, not so much that it reads like annotated
source code.

In Crew Studio this runs as one round. There are no subagents and no model settings file: you explore and explain in
one pass. You read the code only with Studio's tools (fs_list, fs_search, fs_read at the pull request's head; git_diff
against its base; git_log, git_show and git_blame on the local history). You have no shell and you write nothing.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The captain can redirect.

- **Simple** (one module, a small utility, a narrow question): read the changed lines and their callers, then explain.
- **Complex** (a change spanning several files or layers): decompose it into 2 to 4 angles, each a distinct slice
  (for example: the entry point, the data it carries, the state it changes, the tests that pin it). Trace each angle in
  turn, keeping for each one: the components found (name, path, one sentence), the flow step by step, the files read,
  the boundaries (inputs and outputs), the non-obvious things and the open questions. Then reconcile the angles into one
  picture: merge overlaps, resolve contradictions by reading the code again, and keep the gaps you could not trace.

When in doubt, take the simple path.

## Output

Use these sections, dropping any that do not apply:

- **Overview**: 1-2 paragraphs. What this change is, what it does, why it exists. Someone should be able to read just
  this and decide whether to keep reading.
- **Key Concepts**: the important types, functions or abstractions needed to follow the rest. Brief definitions.
- **How It Works**: the core, and the longest section. Walk through the flow: what triggers it, what happens step by
  step, where data goes, what the decision points are. Prose, not pseudocode. Reference specific files and functions
  (path and line) so the reader knows where to look. When several components talk to each other, or data transforms
  through stages, put a diagram on the board (board_draw) rather than in the text. A diagram should clarify, not
  decorate.
- **Where Things Live**: a brief file map, just the files someone needs to start working here.
- **Gotchas**: non-obvious things, surprising behavior, pitfalls. Skip it when there is nothing worth calling out.

## Communication style

- Concrete language, not abstractions about abstractions. Say "`priceOf` calls `round()`", not "the service delegates".
- When something is complex, explain why it is complex. When something is simple, do not pad it out.
- If there is a helpful analogy, use it. If there is not, do not force one.
- If you could not trace something, say so rather than hiding it.
