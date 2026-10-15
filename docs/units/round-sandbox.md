# Unit round-sandbox: agent rounds run in the OS sandbox, network only through Studio's proxy

What: every agent round a workflow mode marks as sandboxed (worker, coordinator, reviewer of the coding workflow) runs its provider CLI under `sandbox-exec` with a round profile, and reaches the network only through an egress proxy Studio starts with itself.

Why: the captain's round-sandbox requirement (2026-10-14): a round writes only its worktree and tmp, reads neither Studio's data nor secret folders, and calls only its provider's API.

Done when (each line is proved by `tests/round-sandbox.ts`, new and red on the base):

1. A round writes in its worktree and cannot write outside it. — "a round writes in its worktree", "a round cannot write outside its worktree".
2. A round reads nothing of Studio's data: not the ledger key, not any other file; only its worktree (data/work) and its tmp are reopened, and a protected root (firstmate's checkout) is closed entirely. A round whose folder is inside a protected root, or in Studio's data outside data/work, is refused before it starts (architecture §10; check-runtime r2 #17 applied to rounds). — "a round cannot read Studio's ledger key", "… anything else in Studio's data …", "a round whose folder is inside a protected root …".
3. A round cannot open a connection of its own; the egress proxy refuses a host off its allowlist and logs it in `data/egress.log`; the allowlist is the provider's API hosts plus what policy `egress.allow` grants (no registry otherwise). — "a round cannot open a connection of its own …", "the egress proxy refuses a host …", "the allowlist holds the provider's API hosts, and no registry …", "a host policy egress.allow grants …".
4. A round's env has no token but its provider's own key (roundEnv), and its traffic goes to the proxy. — "its env has no token but its provider's own key …".
5. A round stopped at its time limit leaves no live process: the CLI runs in its own process group and the group is killed. — "a round killed at its time limit leaves no live process (… by pid)".
6. The Doctor shows the round sandbox and the proxy, from Studio itself; without an OS sandbox a sandboxed round is refused, never run bare, and the Doctor says so. — "Studio starts the egress proxy with itself …", "the Doctor shows the round sandbox and the proxy", "without an OS sandbox …", "and the Doctor says the round sandbox is missing".

How: `src/egress.ts` (the proxy), `roundProfile` in `src/runtime/checks.ts`, `Agents.run({ sandbox })` in `src/agent.ts`, `sandboxNeeds` on the claude and codex providers (`src/providers/needs.ts`: the CLI's install and config folders, its API hosts), `processSession` spawning in a process group (`src/providers/proc.ts`), `AgentMode.sandbox` so a workflow mode asks for it. Agent tool calls may be async (a tool can run a sandboxed command). The check sandbox now also lets bun list the folders above its working folder (bun reads them to load its environment) and read its own process info.
