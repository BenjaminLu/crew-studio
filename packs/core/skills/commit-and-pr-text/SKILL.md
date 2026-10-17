---
name: commit-and-pr-text
description: Write commit messages and pull-request text that follow the repository's own templates and say what changed and why.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [coordinator, publisher, release]
---

# Commit and pull-request text

- Follow the repository first: its CONTRIBUTING file, pull-request template, commit conventions and recent history. Their rules win over these.
- The subject says what the change does, in the imperative, under about 70 characters.
- The body says why, what a reviewer should look at, and how it was tested, with the exact commands and results.
- Name breaking changes, migrations and follow-ups plainly.
- Link issues the way the repository does.
- Never put session links, chat transcripts, internal tool names, credentials or local paths in a commit or pull request.
- One logical change per commit; do not mix a refactor with a behaviour change.
