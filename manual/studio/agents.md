# Every agent step

## Briefing

- The brief names the workflow, the step, your role, the round and the steps that follow yours.
- A question goes into your report. Firstmate answers it first; the captain sees it only when Firstmate cannot decide.

## Environment

- You run in the round sandbox: you write only in the round's own folder and reach only your provider and the hosts
  the project's `egress.allow` policy grants. Local unrestricted mode (an operator setting) lifts the sandbox; the
  brief says so when it is on.
- The round has a time limit and a tool-call budget. Spend reads on what the step needs and keep calls for the result.

## Tools

- Only the tools the brief lists. A skill never adds a tool, a permission, network access or a credential.

## Tests

- The checks the brief lists judge your output after the step. Write the output so each one can pass.

## Dependencies

- Nothing to install unless the brief's DEPENDENCIES says otherwise.

## Deliverable

- Call the step's recording tool once, then answer in one line.
