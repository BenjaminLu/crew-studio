# Crew Studio

Build and run AI workflows, coordinate parallel agents, review changes, and approve results—all in one local-first workspace.

## Install

Install [Bun](https://bun.sh/docs/installation). Clone this repository using GitHub’s **Code** menu, then enter its directory:

```sh
curl -fsSL https://bun.com/install | bash
# Open a new terminal after installing Bun.
cd crew-studio
```

When `bun install` is needed:

- **To run Studio from source** (`bun run launch`): not needed. On the first start Bun fetches the one pinned package Studio imports (`opencc-js`) into its own cache, so that first start needs the network once.
- **To build the binary** (`bun run build`) **or run the test suite** (`bun run test`): run `bun install` once in the clone first. It installs the pinned packages in `package.json`: `opencc-js`, which the build bundles, and the film toolchain (`hyperframes`, `gsap`, `node`) the tests and the coffee film use. Without it the build stops with `Could not resolve: "opencc-js/t2cn"`.

No database, firstmate v1 checkout, `.env` file or manual hook setup is needed for the first example below.

## Start

```sh
bun run launch
```

This starts Studio (or finds the verified running instance) and requests its authenticated Board in your browser. Keep this process running. No second terminal or copied session link is required. A browser accepting the request does not prove a visible window; retry with `bun run launch --browser Safari` if your default browser has no normal window.

What you see first:

1. **The Board**, empty: no Tasks and no decisions waiting.
2. **Settings → Doctor** (the gear) lists what this Mac has. Basic pages, workflows, cards and the Library need nothing else. A Claude or Codex CLI that is installed but signed out shows **Not signed in**; GitHub shows off until a project is connected. Nothing is installed or signed in for you.
3. **Workflows** lists the shipped workflows, each with a line on what it makes (the coding workflow, id `code-firstmate`, is listed as **coding**). **Rename** on any workflow changes the name Studio shows; the definition, its approved crews and its exports keep their own name. The Doctor page names what each optional install adds (the film renderer for Video, Git, Node.js and Python 3 for coding).
4. **Firstmate**: connect Codex using your ChatGPT account, or sign in to Claude, then talk to Studio's own Firstmate in its private workspace on the host you pick (Codex and Claude sit side by side; a Claude Firstmate signs in with the crew token and never falls back to Codex). No existing terminal session, repository, AGENTS file or handoff is required. Firstmate can propose work, but only your approval of its dispatch card starts a Task. Account readiness and native worker/tool readiness remain separate.

Two workflows run with no model account: **Hello Crew Studio** (below) and **File organization**. Leave its folder blank and Studio makes a sample folder in its own data to tidy; it never touches your files unless you name a folder.

Source and binary default to `~/.crew-studio/data`. Existing checkout-local stores are not moved or read automatically; select one explicitly with `CREW_DATA`. `bun run start` remains a headless server command. The startup competition example is not in a fresh catalog; `CREW_EXAMPLE_WORKFLOWS=1` adds it.

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
- **Standalone binary:** `bun install` (once), `bun run build`, then run `./dist/crew-studio`; open its session separately with `./dist/crew-studio launch`. The binary takes its configuration from environment variables only; it never reads a `.env` or `bunfig.toml` from the folder it starts in.
- **Acceptance on a clean Mac:** `bun run acceptance:sandboxed` runs every workflow offline with the OS sandbox on, an empty `HOME` and no tool cache, and lists which workflow needs which install ([acceptance](docs/acceptance.md)).

See [setup, dependencies, hooks and reference](docs/setup-and-reference.md) for installation commands and optional integrations, or [architecture](docs/architecture.md) for how Studio works.
