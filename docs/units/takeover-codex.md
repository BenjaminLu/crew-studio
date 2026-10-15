# Codex can be Studio's firstmate

Claude's quota runs out, and the captain moves the firstmate session to Codex. Studio's Firstmate page can take over only a Claude session today: src/takeover.ts hard-codes "claude". The Codex host (src/host/codex.ts) attaches by resuming the same thread, which would drive a live session twice (architecture §7).

What:
- The Firstmate page lists sessions from both hosts, Claude and Codex, for this project. Each one is labelled with its host, last activity and summary. The captain picks one and takes it over.
- A Codex takeover never drives the live thread. It forks it when `codex app-server` supports a thread fork. Check the installed codex's app-server protocol: `codex app-server generate-json-schema` or the equivalent, and never guess.
- When no fork exists, Studio starts a NEW Codex thread seeded with a handoff instead. The handoff is the thread's recent turns (read-only), plus the repo's state/HANDOFF-*.md when present. The page says plainly "Codex has no fork; Studio started a new thread from a handoff".
- Taking over Codex holds the same driver lock, input queue with wakes, permission bridge (any failure denies), handoff file and release. Release returns `codex resume <id>` for the Studio-owned thread.
- firstmate's wakes reach the Codex thread the same way they reach Claude: the Stop-hook equivalent if Codex has one, else Studio's wake delivery after the grace period.
- Studio can start a fresh Codex firstmate from the page ("Start firstmate on Codex") when no session exists. It runs in the firstmate repo, follows AGENTS.md, and gets the newest state/HANDOFF-*.md as its first message.
- The model and reasoning effort come from the captain's Codex config; Studio shows them and never overrides them silently.

Done when (tests/takeover-codex.ts plus tests/takeover-codex-ui.mjs; red on base). The stub must answer exactly like the real app-server: record real JSON-RPC shapes from the installed codex into a fixture, with no secrets.
1. Discovery lists both Claude and Codex sessions, each with its host label.
2. A Codex takeover never sends thread/resume, or any turn, for the live thread id. It forks, or starts a seeded new thread, and the page states which.
3. The driver lock, wake delivery, permission bridge (with deny on failure) and release (`codex resume <id>`) work for Codex as they do for Claude.
4. "Start firstmate on Codex" starts a thread in the firstmate repo whose first message holds the handoff file's contents.
5. The Firstmate page at 1440 and 390, light and dark, gets a fresh-context designer review.
