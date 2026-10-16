# Crew Studio

Build and run AI workflows, coordinate parallel agents, review changes, and approve results—all in one local-first workspace.

## Install

Install [Bun](https://bun.sh/docs/installation). Clone this repository using GitHub’s **Code** menu, then enter its directory:

```sh
curl -fsSL https://bun.com/install | bash
# Open a new terminal after installing Bun.
cd crew-studio
```

No `npm install`, database, firstmate v1 checkout or manual hook setup is needed for the first example below.

## Start

```sh
bun run launch
```

This starts Studio (or finds the verified running instance) and requests its authenticated Board in your browser. Keep this process running. No second terminal or copied session link is required. A browser accepting the request does not prove a visible window; retry with `bun run launch --browser Safari` if your default browser has no normal window.

On the Board, connect Codex using your ChatGPT account, or sign in to Claude, then continue with Studio’s own Firstmate in its private workspace on the host you pick (Codex and Claude sit side by side; a Claude Firstmate signs in with the crew token and never falls back to Codex). No existing terminal session, repository, AGENTS file or handoff is required. The coffee-shop guided workflow starts with your explicit brief; Firstmate can propose native work, but only your approval of its dispatch card starts the pinned workflow. Account readiness and native worker/tool readiness remain separate.

Source and binary default to `~/.crew-studio/data`. Existing checkout-local stores are not moved or read automatically; select one explicitly with `CREW_DATA`. `bun run start` remains a headless server command.

## Your first workflow

Create your first website—no model account needed:

1. Open **Workflows → First workflow tutorial**.
2. Choose **Discuss my first workflow** under **Hello Crew Studio**, then send the prepared message to Firstmate.
3. Discuss the website goal, heading and style. Firstmate previews its generated workflow; no Task starts while drafting.
4. Review the graph and node model/skill choices, then save your workflow. Use the step and connection buttons to edit without dragging the graph.
5. Click **Run…**, confirm inputs and agent staffing, then review the actual output.
6. Open **Compare and refine workflow versions** to compare saved versions with current edits, or compare a Task's execution rounds. Save changes as a new version; existing Tasks keep their original version.
7. Open **Reuse this workflow → Save as template**. The named template appears in Workflows. Open it and choose **Create workflow from this template** for an independent copy.

**Skip discussion: try a ready-made example** is an explicit shortcut. It starts a real responsive HTML example from a built-in template, without an AI model: **Create website → Preview website → Website complete**. Firstmate's custom-workflow interview remains available alongside it.

## Next steps

- **AI and coding:** configure a provider in **Settings → Doctor**. Coding also needs Git, Node.js, Python 3 and a supported OS sandbox; the current check sandbox uses macOS `sandbox-exec`.
- **Screenshots and video:** optionally install Playwright/Chromium and ffmpeg.
- **Standalone binary:** `bun run build`, then run `./dist/crew-studio`; open its session separately with `./dist/crew-studio launch`.

See [setup, dependencies, hooks and reference](docs/setup-and-reference.md) for installation commands and optional integrations, or [architecture](docs/architecture.md) for how Studio works.
