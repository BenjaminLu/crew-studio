# Contributing

## Branches

Name every branch `feature/<short-name>`, for example `feature/split-rounding`. CI runs on pushes to `feature/**` and `main` and on every pull request; a branch with another prefix gets CI only once its pull request is open.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `test: …`, `docs: …`, `chore: …`, `refactor: …`. One change per commit; the subject says what changes, in the imperative, under 72 characters.

## Pull requests

- Fill in every section of the pull request template.
- Every change comes with a test that fails without it.
- `bun test` and `bun run lint` pass before you ask for review.
- Changes under `.github/` need the code owners' review.
