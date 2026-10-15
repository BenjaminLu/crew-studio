# Successful Codex login opens the primary conversation

An explicit Connect in a Studio-owned workspace must, after verified login, create the primary once, open its chat and show its real bootstrap greeting. Existing primaries are reused. The destination is the always-present Board; an uninstalled coffee workflow is never assumed. Passive account events/page loads, cancelled or failed login do not start work or fabricate a greeting.

Scope: public/takeover.js; src/host/main.ts (native greeting wording only); tests/codex-login-welcome-ui.mjs; tests/fixture/codex-account.mjs (offline greeting); package.json; this document.

Verification uses isolated actual Studio HTTP, an offline strict account callback fixture, and a separate headless browser profile. No real account/model calls or user browser profile.
