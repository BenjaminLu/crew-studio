# A Studio does not outlive whoever started it

53 `bun src/server.ts` were found running under launchd (parent pid 1), the oldest for 27 days, each holding its ports:
Studios started by test suites or by agents in worktrees and temporary folders, whose starter had died without stopping
them.

Done when (`tests/server-lifetime.ts`, in `test:core` and the Linux portable checks; red on origin/main 7725eff4, where 4
of its cases fail):
1. A Studio reads its starter's pid at start (`src/parent-watch.ts`, imported first by `src/server.ts`) and checks it
   every 2 s (`CREW_PARENT_POLL_MS`) with signal 0: Bun caches `process.ppid`, so it never shows the re-parenting.
   Once the starter is gone it logs one line and runs the SIGTERM shutdown (terminals, local runs, Codex and Claude
   sign-ins, the fresh primary's detach), then exits, at most 8 s later. — "a server whose starter was killed with
   SIGKILL exits within 10 s", "and its port is free again", "it says in its log why it stopped".
2. Exempt: parent pid 1 at start, and `CREW_DETACHED` equal to the starter's pid. `scripts/live-release.ts` sets it on
   every Studio it starts (deploy, rollback, the restart of a stopped dev instance), so the live board outlives the
   script. — "a server started detached on purpose keeps serving after its starter is gone", and in
   `tests/live-release.ts` "release A was started with CREW_DETACHED naming its starter".
3. The marker names a pid, so it is never inherited: a Studio started by a process of the live board (Bun children get
   the env Bun started with) has another parent. — "a server whose CREW_DETACHED names another process still stops with
   its starter". The Studio also removes the marker from `process.env`.
4. Belt and braces: when a test entry ends, `tests/lib/isolated-env.mjs` sends SIGTERM to a Studio (`src/server.ts`,
   `src/main.ts`) it left running as its direct child. — "a Studio a test entry left running is stopped when that entry
   ends".

Other start paths keep a parent: `bun run dev`, `bun run start`, `crew-studio`, `crew-studio launch` and
`Open Crew Studio.command` run under their terminal, and closing it stops Studio as before. Nothing in the repository
installs a launchd job. A hand-started Studio meant to outlive its shell: `CREW_DETACHED=$$ bun src/main.ts &`.

Deploy this change with a `live-release.ts` that has it: an older script starts the release without the marker, and that
release then stops as soon as the script exits.
