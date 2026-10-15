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

On the Board, connect Codex using your ChatGPT account, then continue with Studio’s own Firstmate in its private workspace. No existing terminal session, repository, AGENTS file or handoff is required. The coffee-shop guided workflow starts with your explicit brief; Firstmate can propose native work, but only your approval of its dispatch card starts the pinned workflow. Account readiness and native worker/tool readiness remain separate.

Source and binary default to `~/.crew-studio/data`. Existing checkout-local stores are not moved or read automatically; select one explicitly with `CREW_DATA`. `bun run start` remains a headless server command.

## Your first workflow

Create a simple confirmation workflow—no model account needed:

1. Open **Workflows → New workflow**.
2. Enter **My first workflow**, keep the generated id `my-first-workflow`, and click **Create workflow**.
3. The editor shows **Start → Done**. Click **Start a task**.
4. Enter a short task description, keep your new workflow selected, and click **Start**.
5. Open its confirmation card in **Board** or **Inbox**, then click **Continue**. The Task completes.

You now have a reusable workflow. Edit its graph and save to create a new version; existing Tasks keep their original version.

## Next steps

- **AI and coding:** configure a provider in **Settings → Doctor**. Coding also needs Git, Node.js, Python 3 and a supported OS sandbox; the current check sandbox uses macOS `sandbox-exec`.
- **Screenshots and video:** optionally install Playwright/Chromium and ffmpeg.
- **Standalone binary:** `bun run build`, then run `./dist/crew-studio`; open its session separately with `./dist/crew-studio launch`.

See [setup, dependencies, hooks and reference](docs/setup-and-reference.md) for installation commands and optional integrations, or [architecture](docs/architecture.md) for how Studio works.
