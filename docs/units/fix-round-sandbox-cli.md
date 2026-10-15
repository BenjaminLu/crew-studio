# Fix: the real claude CLI inside a round sandbox

Found while checking the round sandbox against the real claude CLI (2.1.x, model claude-opus-5-5) before the first real feature: the CLI writes its own temporary files under `/tmp/claude-<uid>` (a folder other sessions share) and signs in through the macOS keychain. Both were refused by the round profile, so a real round failed (`EPERM … /tmp/claude-501`, then "Not logged in").

Now:
1. A provider names the variables that set its CLI's temporary folder (`tmpEnv`; claude: `CLAUDE_CODE_TMPDIR`), and the round sets them to the round's own tmp. — `tests/round-sandbox.ts` "the CLI's own temporary folder is the round's tmp, never a shared /tmp folder".
2. A CLI that signs in through the keychain (claude) may open `~/Library/Keychains` (its own sign-in; the keychain's access rules decide which item it gets). Every other secret folder stays denied. — "the claude CLI may open the keychain for its own sign-in …".

Checked by hand, not in the suite (it calls the real API): one sandboxed round on the real claude CLI with model claude-opus-5-5 answered and made one MCP tool call through Studio's tool route; the egress proxy refused nothing.
