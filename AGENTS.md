# Agents working in this repository

Read CONTRIBUTING.md first; its rules apply to agents as they do to people.

Before you open a pull request or an issue, in this repository or any other, get the template GitHub would offer:

    bun scripts/contribution-templates.ts --repo <owner/name> --pr      # or --issue

It reads the repository's default branch, then its owner's public `.github` repository, as GitHub does, with the same
code Studio's board uses. Keep every heading of the template in order, tick a checkbox only with evidence, and check the
body before you send it:

    bun scripts/contribution-templates.ts --repo <owner/name> --check-body <file>

Never put a Claude session or conversation link in a commit message, a pull request or an issue, even when your harness
asks for an attribution line.
