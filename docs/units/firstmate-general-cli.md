# General CLI work in the primary Firstmate conversation

Status: implementation; base 401cf59. Scope: this file, `src/host/main.ts` (native bootstrap prompt only), `tests/firstmate-native.ts`, `tests/host.ts`, `tests/takeover-codex.ts`, and `tests/fixture/codex-account.mjs`.

The primary conversation is a normal configured vendor CLI session with Studio's additional typed tools. An explicit general file, command, Git or skill request uses available vendor capabilities under its unchanged sandbox and approval policy. These are not limited to the listed Studio dynamic tools. Report actual tool availability and permission refusals honestly. Never invent capabilities or request a blanket permission grant.

Managed workflow/project/ledger state changes remain separate: native proposal tools, project confirmation, staffing and captain dispatch approval apply. No startup action, automatic task or paid workflow is authorized merely by opening the conversation. No external firstmate engine, terminal session or legacy script dependency is introduced.

Tests exercise the real Studio server/host/permission bridge and an offline app-server fixture with fixed local commands in its owned workspace. Approved commands perform actual local read/write and host verifies their bytes; declined/interrupted commands write nothing. This proves transport/approval coexistence, not a real vendor model's tool choice, sandbox enforcement or quality. Prompt checks fail on the former blanket workflow routing. No real account/model/auth/config/project changes or UI changes.

Validation: valid old-base fixture 43 passed/1 failed (bootstrap routing); final native suite 44/0 including actual seeded-prompt receipt and real fixed-command bytes, host64/0, takeover-codex60/0, build exit0. Two earlier fixture-only errors (wrong approvals field; missing interrupt-completed event) are retained separately and are not product fail-first evidence. No public assets or layout changed. Ordinary CLI capability and actual OS sandbox guarantees remain vendor-owned; offline fixture does not certify a real model turn.
