# Fix round 1, legacy class A1: no credential reaches a round, a chat, a work run, a check or a child tool

Answers: m6#2 (agent jobs pass credentials into rounds) and the same class everywhere a child process starts: chat turns, M3 work runs, the renderer, git.

Done when (each line is proved by `tests/credentials.ts`, new and red on the base):

1. An agent round's environment is an allowlist (PATH, HOME, USER, locale, terminal, TMPDIR …) plus its tool URL and token: no credential. — "an agent round's environment carries no credential …".
2. A provider gets only the keys it declares for itself (`envKeys`: claude its Anthropic key and config, codex its OpenAI key and home). — "a provider gets only the key it declares for itself", "each CLI provider declares only its own key".
3. A chat turn and an M3 work run build their environment the same way. — "a chat turn's environment carries no credential", "a work run's environment carries no credential".
4. Child tools (git, the renderer) get the environment with every credential-named variable removed; a check's sandbox gets a scrubbed HOME and no credential. — "child tools (git, the renderer) …", "the renderer runs without credentials", "a check's environment has no credential and a scrubbed HOME".

src/chat.ts is on the takeover branch's side; its change is the one line that builds the environment.
