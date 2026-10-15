# Agent skills: a skill library, several skills per agent node

Today each workflow role has exactly one skill (its SKILL.md), and there is no way to bring
in a skill from outside. The captain wants reusable writing and working rules (for example
STE wording and a humanizer that keeps text plain) available to any agent. Skills attach
to agent nodes, and one agent node can enable several skills at once.

What:
- A skill library in Library → Skills. It lists the role skills already there plus imported
  skills, each with name, description, source, current version and hash.
- Import a skill from a local folder holding a SKILL.md, from a skills home directory
  (`~/.claude/skills`, `~/.codex/skills`, picked from a list), or from a public https git URL
  (read-only, no credentials). The import is the captain's act in the UI (session cookie plus
  Origin), and it copies the skill into Studio as an immutable version with its hash.
- An agent node keeps its role skill and adds an ordered list of enabled skills. In the
  workflow editor's node panel, the captain turns skills on or off and orders them. Each such
  edit is a new workflow version, and its diff names the skills.
- A run pins every enabled skill by version and hash. The agent's instructions are Studio's
  safety rules first, then the role skill, then each enabled skill under its own heading, in
  the listed order. The run step shows which skills it loaded (name@vN).
- Re-importing a changed source makes the next version. Workflows and runs stay on the
  version they pinned, and the editor says that a newer version exists. Moving to it is an
  editor change, so it is a new workflow version.

Why: the same rules (STE, plain writing, a repo's conventions) recur across workflows and
roles. Pasting them into each role skill drifts, and one role often needs several of them at
once (a spec writer needs the role skill, STE and the humanizer).

Not in scope: skills as checks (STE stays a check as well, see check-contract.md); writing
the STE or humanizer skill text itself; a public skill marketplace.

Security (binding):
- A skill is text given to the agent. It never changes the node's tools, sandbox, network or
  credentials. Frontmatter that asks for tools (`allowed-tools` and similar) is ignored, and
  the node panel shows that it was ignored.
- Import never runs anything from the skill folder. Supporting files are copied only when they
  are regular files inside the folder (no symlink that leaves it), within a size cap.
- A git import uses https only, with no credentials in the URL, and clones with no hooks.
- Imported skill text goes only to the run's provider inside the prompt, never into shared or
  committed content (architecture §1.9).

Done when (`tests/agent-skills.ts`, `tests/agent-skills-ui.mjs`; both red on the base, where
the library, the import route and the node `skills` field do not exist):
1. A skill imported from a local folder and one picked from a skills home directory are listed
   with name, description, source, v1 and sha256. — "import from a folder …", "import from a skills home …".
2. Import refuses, with a reason the captain sees: a folder without SKILL.md, a skill over the
   size cap, a symlink that leaves the folder, a git URL that is not https or carries
   credentials, and a request without a session or with a foreign Origin. — one assertion each.
3. In the editor, turning on two skills on an agent node and ordering them makes a new workflow
   version whose diff names both, in order. — "two skills on one node make a new version …".
4. A run on that version (stub provider capturing its system prompt) gets the safety rules,
   then the role skill, then both skills under their headings in the set order, and its step
   shows both as name@v1. — "the agent receives its skills in order …", "the step shows name@v1 …".
5. Re-importing a changed source makes v2. A run on the pinned workflow version still receives
   v1, and the editor shows that v2 exists. Moving to v2 makes a new workflow version.
   — "re-import makes v2; the pinned run keeps v1 …".
6. A skill whose frontmatter asks for tools or network leaves the node's tool list and sandbox
   unchanged, and the panel says the request was ignored. — "a skill cannot grant tools …".
7. Saving a node whose enabled skills exceed the per-node size cap is refused with the total and
   the cap. — "the per-node cap is enforced …".
8. The Skills page and the node panel at 1440 and 390, light and dark, with no sideways scroll;
   reviewed by a fresh-context designer reviewer page by page. Screenshots in `tests/out/agent-skills-*.png`.
9. architecture.md §4 (a `skill` contract row) and §5 (agent nodes carry an ordered skill list)
   describe this.
10. The built-in plain-writing skill is listed and enabled on code-firstmate's coordinator; a run's
   coordinator prompt contains it after the role skill. — "the built-in plain-writing skill is listed …",
   "a code-firstmate run's coordinator prompt contains plain-writing after the role skill".
