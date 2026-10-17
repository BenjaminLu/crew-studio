# code-firstmate on GitHub

## Briefing

- Same roles and briefs as a local repository. The Task's branch becomes a pull request; the merge card merges it on
  GitHub at the reviewed head, only on the captain's click.

## Environment

- Studio fetches the base and rebases the Task's branch onto it every round, then pushes only that branch with a
  lease. No agent pushes, force-pushes or touches another branch.
- Someone else's push to the PR branch stops the Task and asks the captain.

## Tools

- The same tools as the local workflow. No agent has a GitHub token, the `gh` CLI or network access to GitHub.

## Tests

- The repository's own CI runs on the pushed head; the merge card waits for it. Studio's own checks still run
  locally before the push.

## Dependencies

- A GitHub connection in Studio (token or an installed `gh`). Doctor shows its state.

## Deliverable

- The same per-role deliverables. Studio writes the PR title and body from the spec; never put a session link, a
  token or a local path in anything pushed.
