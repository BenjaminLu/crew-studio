# Unit redaction-rules: explicit rules instead of shape guessing

Why: redaction failed in opposite directions across three review rounds (record-smoke r1–r3: too little, then too much, then both), the same class twice; per the step-back rule the heuristics are replaced by an explicit rule set (coordinator's design, 2026-10-14). v1 (`~/Desktop/firstmate-workflow/bin/lib`) has no credential redactor to borrow (`fm_retro.py`'s `redact` withholds project names, not credentials).

The rules (`src/secure.ts`):
1. Known values, always, whatever their characters (8 or more): the values of environment variables with a credential name; every secret registered where it is read (the key store, Studio's GitHub token from the environment, its settings file or `gh auth token`, the ledger key, the session token); a round's own token as `extra`.
2. A credential name is one of `CREDENTIAL_WORDS` (PASSWORD, PASSWD, SECRET, TOKEN, API_KEY, APIKEY, ACCESS_KEY, PRIVATE_KEY, CLIENT_SECRET, AUTHORIZATION, COOKIE, SESSION, SESSION_ID, CREDENTIAL, CREDENTIALS) as the whole name or its last word, camelCase and dashes normalized (`apiKey`, `X-API-Key`); and, for an environment-style name (UPPER_SNAKE), any `*_KEY` and any name containing PRIVATE (since r2). One plain function, `isCredentialName`; there is no `SECRET_KEY` RegExp. A prefix alone is not one: `GH_HOST`, `AWS_REGION`, `GITHUB_REPOSITORY`, `DOCKER_HOST`, `FM_HOME`, `HERDR_*` stay visible. (The round environment's scrub list, `SECRET_NAME`, is a separate, wider rule: it decides what a round may see, not what is redacted.)
3. Under a credential name, security wins over readability (firstmate's policy decision, 2026-10-14, reversing redaction-rules r1's "keep code expressions"): in a `NAME=value` assignment, a `name = value` ini/properties/my.cnf line, a `Name: value` header or YAML line, or `name = "literal"` in source, the value is redacted unless it is exactly `true`, `false`, `null`, `undefined`, a bare number under 8 digits, or an empty string; a JSON string under a credential name always goes (only an empty one stays), and the keep list applies there only to the types boolean, null and short numbers (since r4). Code expressions (`token: getToken(),`, `apiKey: process.env.X`, `session: req.session`), dotted tokens and values with brackets or semicolons go too. Rationale: a false positive under a credential name costs readability; a false negative leaks a secret. There is no source-code exemption (since secrets-migrate-r5): a `name = value` line, ini or source (`const token = getToken();`), goes whatever its right side looks like (`P4ss.word`, `hunter2(prod)`, `getToken()`, `process.env.X`); readable source under a credential name gets masked too, and that is accepted.
4. Known formats anywhere: sk-ant-, sk-, gh*_, github_pat_, xox*, AKIA, JWT, PEM.

Done when (`tests/secret-registry.ts`, table-driven; 29 lines since secrets-migrate-r5; the first 18 named here in the order they print, each with where it is red; later ones are listed in `docs/units/secrets-redaction-r4.md` and `docs/units/secrets-migrate-r5.md`):
1. "the one marker is …" (guard).
2. "every credential name (32) … is redacted in JSON, NAME=value, header and source forms" (red on ce09947; the env `*_KEY`/`*_CREDENTIAL(S)`/PRIVATE names red on a0d5c24).
3. "redactJSON: a string under a credential name goes at any depth …" (red on ce09947, which kept letters-only and spaced strings under a credential key).
4. "a prefix-only name … is no credential name …" (red on ce09947).
5. "the kept values under a credential name (true/false/null/undefined, small numbers, empty strings), code assigned an expression in source, other names and hashes stay unchanged" (red on ce09947 for `max_tokens`/`tokenizer`).
6. "under a credential name everything goes but true/false/null/undefined, a number under 8 digits and an empty string: code, dotted tokens, brackets too" (red on e87166e, which kept code expressions).
7. "a YAML or header line under a credential name with a data value … is redacted" (guard since r2).
8. "the name rule is one plain function …" (red on a0d5c24).
9. "a known credential format is removed anywhere …" (guard).
10. "a credential-named variable's value is removed wherever it appears …" (guard).
11. "a round's own token, passed as extra, is removed" (guard).
12. "the key store's values are registered" (guard).
13. "Studio's GitHub token is registered where it is read …" (red on ce09947 for `gh auth token`).
14.–17. the logins Studio hands a round (codex copy without its refresh token at mode 600; handed values registered; a remaining refresh token refused; a held CLAUDE_CODE_OAUTH_TOKEN handed and redacted) (unit secrets-redaction-r3; red on 5a84ea6 only where untested before: these were not asserted).
18. "the server registers its file-held secrets …" (guard).
The vacuous `A && B || C` assertion is gone; the other suites were grepped for the pattern (none left that is not parenthesized).
