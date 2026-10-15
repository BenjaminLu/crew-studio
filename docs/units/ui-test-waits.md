# UI tests: no vacuous ok(true), and hash waits that hold under load

Done when (the UI suites; this round changes tests only):
1. Every `ok(true, …)` after a wait became a check of what it waited for (`ok(await <wait>.then(() => true, () => false), …)`): gates-ui (2), m3-ui, m6-ui, m7-ui (2), m8-ui (2), skins, runtime-ui, studio-agents-ui, intent-card-ui; `grep -n "ok(true" tests/` finds none.
2. A same-document hash change fires no load event, so `waitForURL` on a hash could wait for "load" and time out on a loaded machine (the m7-ui pack-draft flake in the full chain): the six such waits (m3-ui, m6-ui ×2, m7-ui ×2, m8-ui, skins) wait on `location.hash` instead.
