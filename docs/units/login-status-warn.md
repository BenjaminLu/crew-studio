# The Doctor's round login: warn until a round has signed in

Done when (red on 1dbf12a):
1. The round-login item is `degraded` (the Doctor's warn) while the login is a keychain item seen by existence that no round has signed in with yet, `ok` once a round has, and `missing` (fail) when the last outcome failed and no later source works. — `tests/round-sandbox.ts` "the Doctor's round login: warn (degraded) while …", "… an untried crew keychain item is a warn"; `tests/secret-registry.ts` "a crew keychain item is unverified until a round signs in with it, verified after".
(The Doctor's vocabulary is ok / degraded / missing / info; degraded renders as warn, missing as bad.)
