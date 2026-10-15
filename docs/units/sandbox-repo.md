# Unit sandbox-repo: data/demo-repo becomes the sandbox repository

What: the local demo repository becomes money-kit, a small Bun + TypeScript library with GitHub conventions, ready for the captain to publish as a sandbox and for code-firstmate to run on. Studio registers it as project "sandbox" with its policies.

Why: the captain chose Studio's demo repo as the sandbox for the first real feature run through v2 and for the later external-PR run (2026-10-14).

Done when (each line is proved by `tests/sandbox-repo.ts`, new and red on the base):

1. The sandbox lands on top of the existing history in one Conventional Commit; it is standalone, with no remote. — "the sandbox lands on top of the existing history …", "it is a standalone repository with no remote …".
2. `bun test` and `bun run lint` pass; the repository declares its test command (`.crew/gates.json`), split into 2 shards that each run one file. — "bun test passes …", "bun run lint passes", "the repository declares its test command, split into 2 shards …".
3. CI (`.github/workflows/ci.yml`) runs on pull requests and on pushes to `main` and `feature/**` only. — "CI runs on pull requests and on pushes to main and feature/** only".
4. CONTRIBUTING states the `feature/` prefix and Conventional Commits; CODEOWNERS, the PR template with its sections, and bug and feature issue templates exist. — "CONTRIBUTING states …", "CODEOWNERS, the PR template …".
5. README_SANDBOX.md gives the publish commands (`gh repo create <name> --private --source . --push`, or the web flow), turning on Actions, branch protection with the `test` check, where the token goes in Studio, and how to register the repo. — "README_SANDBOX.md gives the publish commands …".
6. Preparing again changes nothing. — "preparing again changes nothing".
7. Studio registers it as project `sandbox` with project policies: `.github/**` sensitive, round cap 3, branch prefix `feature/`. — "Studio registers it as project sandbox", "its project policies …".

The files come from `templates/sandbox-repo/` (embedded in the binary); names are generic (the privacy scan covers them). The "Register external repo" action README_SANDBOX.md mentions lands with the external-repo unit.
