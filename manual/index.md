# Crew Studio operating manual

The procedure every shipped workflow and role follows: what a step is told, where it runs, which tools it has,
how it tests, what it needs installed, and what it hands back. Skills say how a role thinks; this manual says how
a step runs. Firstmate reads it with `studio_manual` before it briefs an agent or answers an agent's question.
Every agent brief carries the same six sections (BRIEFING, ENVIRONMENT, TOOLS, TESTS, DEPENDENCIES, DELIVERABLE),
each built from the workflow graph, the environment preflight and the page of this manual that the brief names.

A section id is the page path without `.md`, for example `code-firstmate/worker`. A page's `## Tests` heading is
the brief's TESTS section, and so on for the other five.

## Studio

- `studio/firstmate`: how Firstmate briefs agents, answers their questions and decides when to ask the captain.
- `studio/agents`: what every agent step gets, whatever its workflow.
- `studio/deliver`: a deliver producer in a drafted (custom) workflow.

## code-firstmate (local repository and GitHub)

- `code-firstmate/coordinator`: spec, plan acceptance, root cause, design capture gaps.
- `code-firstmate/worker`: plan and build rounds, `run_tests`, fail-first tests.
- `code-firstmate/reviewer`: diff and run review modes, read plan.
- `code-firstmate/designer`: the blocking design review over captures.
- `code-firstmate/github`: what changes when the project lives on GitHub (branch, lease push, PR, CI).

## Other shipped workflows

- `hello-crew-studio/overview`: the first website, no model account.
- `web-prototype/designer`: two web variants, readiness, refinement.
- `file-organization/overview`: dry-run plan, gates, captain's card, undo log.
- `video/editor`: an HTML film and the renderer contract.
- `images/overview`: a PNG generated with Codex.
- `documents/writer`: a Markdown document and its exports.
- `coffee-kit/overview`: the coffee-shop kit: design plan, image, film, bundle judges, whole-site acceptance.
- `coffee-kit/worker`: the coffee website page round.
