# Fix round 8, login tests (login-status r7 REJECT)

Test-only round: the code under test landed in r6/r7, so these lines are guards, made non-vacuous by mutation (each goes red when the branch it covers is changed: checked by hand).
1. #15 must-fix: the Doctor's probe of the captain's own keychain login, with the CREW_KEYCHAIN_TOOL stub: "Doctor, own keychain login: a present item no round has used is unverified (warn) …", "… verified once a round signed in with it", "… failed when the last round was refused (here a wrong-shape token) and nothing later works".
2. #16: codex refuses a login file holding neither an access token nor an OPENAI_API_KEY, and copies nothing: "codex: a login file with neither an access token nor an OPENAI_API_KEY is refused, nothing copied".
