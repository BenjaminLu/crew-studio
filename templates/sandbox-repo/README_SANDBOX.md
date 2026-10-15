# Publishing the sandbox repository

This repository is the sandbox Crew Studio's coding workflow (code-firstmate) runs on. It lives in Studio's data folder (`data/demo-repo`) and has no remote. To run the workflow against a real GitHub pull request, publish it once:

## 1. Create the repository and push

With the GitHub CLI, from this folder:

```sh
gh repo create <name> --private --source . --push
```

Or on the web: create an empty private repository named `<name>` (no README, no licence), then:

```sh
git remote add origin git@github.com:<owner>/<name>.git
git push -u origin main
```

## 2. Replace the code owner

Edit `.github/CODEOWNERS` and put your GitHub handle in place of `@your-github-handle`, then commit with `chore: set the code owner` and push.

## 3. Turn on Actions

Settings → Actions → General → "Allow all actions and reusable workflows". The `ci` workflow runs `bun test` and `bun run lint` on every pull request and on pushes to `main` and `feature/**`.

## 4. Protect main

Settings → Branches → Add branch protection rule for `main`:

- Require a pull request before merging (1 approval; require review from Code Owners).
- Require status checks to pass before merging: `test` (the `ci` workflow's job). Require branches to be up to date before merging.
- Do not allow bypassing the above settings.

## 5. Give Studio a token

Create a fine-grained personal access token for this one repository with: Contents (read and write), Pull requests (read and write), Actions (read), Commit statuses (read), Metadata (read). In Studio, open the gear at the foot of the sidebar → Doctor → GitHub → "Connect", paste the token there (Studio keeps it in `data/github-token`, readable only by you). Studio never asks for it anywhere else.

## 6. Register it in Studio

In Studio: Workflows → "Register external repo", paste the repository's URL. Studio clones it into its own data folder, detects its conventions (the `feature/` prefix, Conventional Commits, the templates, the required `test` check) and is then ready to run code-firstmate on it.
