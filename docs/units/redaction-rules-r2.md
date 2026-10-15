# Fix round 2, redaction-rules (redaction-rules r1 REJECT)

Answers redaction-rules r1 #1–#4 (`docs/units/redaction-rules.md` now states the rules and the 13 test lines as they are):
1. #1 Under a credential name an unquoted value goes only when it is data, not code (`isDataValue`): no call, member access, operator, keyword or small number. `token: getToken(),`, `apiKey: process.env.API_KEY,`, `session: req.session,`, `password: true` stay; `token: abc123def456`, `Authorization: Bearer …`, a passphrase on a YAML line go. — `tests/secret-registry.ts` lines 5 and 6.
2. #2 CREDENTIAL and CREDENTIALS are credential words again; an environment-style name ending in `_KEY` or containing `PRIVATE` is a credential name (STRIPE_KEY, OPENAI_KEY, SIGNING_KEY, DB_CREDENTIALS, SSH_PRIVATE_KEY); prefix-only names stay visible. — lines 2, 4 and 7.
3. #3 The fake `SECRET_KEY` RegExp is gone; `isCredentialName` is the one function (the transcripts test checks for it). — line 7.
4. #4 The unit doc matches the test file.
