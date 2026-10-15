# Codex repository tool execution

Why: A real Studio-owned Codex copy replied from cached context after its `exec` wrapper timed out negotiating with the code-mode host. A ready message is not proof that repository tools work. Fresh isolated reads reproduced the failure, so the problem is not exclusive to forks.

What: Child Codex app-servers receive the captain's login/configuration location, not ambient parent thread IDs, sandbox identity or CI flags. Codex owns native tool execution and its approval/sandbox policy. Studio fails closed for client-owned dynamic tools, with a protocol-shaped unsuccessful response, and never executes arbitrary Work JavaScript. No model, effort, approval, sandbox or feature is silently overridden. Tool execution must be observed independently of an assistant's claims.

Done: `tests/codex-toolchain.ts` fails on 71ff0dd and proves runtime environment isolation preserving CODEX_HOME/PATH, a schema-correct unsupported dynamic-tool failure, and native command approval refusal. Actual model smoke reads a marker in a new isolated temporary project with the captain model/effort unchanged; a separate test-only policy fixture denies a requested write. No original/current captain thread is driven, and no live firstmate state is written. Full affected tests and independent exact-head review are required.

Evidence limitations: Vendor Doctor reports installation/login health, not a successful code-mode negotiation. Disabling code_mode_host alone leaves the configured model calling an unavailable exec wrapper and is not a functional fallback. No such fallback is applied.

Review remediation: Tool failure state belongs to the active thread and turn, resets for sent and externally started turns, and cannot be contaminated by foreign dynamic requests or late output. Doctor distinguishes detected CLI availability from unverified login and repository tool health in English and Traditional Chinese. These assertions are covered by `tests/codex-toolchain.ts`.
