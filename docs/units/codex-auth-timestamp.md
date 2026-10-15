# Codex copied-login timestamp compatibility

Base: 95f297015e3e1253cbfc3d3a17fc9b12c0636c3d. Worker owns only src/providers/login.ts, tests/secret-registry.ts, tests/codex-capability.ts, and this document. Parent approved this exact scope. D1a remediation remains preserved in its independent checkout.

Installed CLI requires original last_refresh metadata when resolving ChatGPT token data; removing it caused the real account/read metadata probe to refuse a still-valid copied access token. Parent retained a same-token control changing only that nonsecret original timestamp, which verified auth/model inventory/quota. This is credential-shape compatibility, not a token refresh or quality/tool canary.

Copy only a valid original RFC3339 timestamp, unchanged, alongside existing allowlisted login fields. Validate calendar/time/offset bounds and finite parsing; reject unsupported malformed values before creating/writing the disposable credential home. Never manufacture or freshen a timestamp, copy a refresh credential or unknown config, modify original credentials, change provider/model/effort, or claim auth readiness from timestamp shape alone. Missing timestamps stay missing; expired timestamps stay unchanged and real CLI verification retains authority. Existing API-key behavior stays unchanged.

Fail-first: strict dummy CLI reads the actual disposable auth file and refuses account/read without the exact original timestamp. This must fail on unchanged base. Timestamp cases cover valid original UTC/offset/fractional forms, old timestamps, malformed dates/time/offset/injected objects, dropped unknown fields, immutable source and mode0600. Regressions: secret-registry, credentials, codex-capability. A bounded actual installed metadata probe is allowed after focused checks; no actual model turn before independent code review. No public/UI files change. No real config/credential writes outside disposable copied home.

## Collected evidence

- Old unchanged production login with new strict CLI fixture: /tmp/v2-codex-auth-timestamp-failfirst.log, EXIT1, 6 passed/2 failed (exact original timestamp absent; actual metadata adapter refuses account/read).
- Fixed strict fixture: /tmp/v2-codex-auth-timestamp-capability.log, EXIT0, 8/0.
- Secret registry/calendar/type/offset/immutable-source: /tmp/v2-codex-auth-timestamp-secrets-final.log, EXIT0, 66/0. Initial test-only missing existsSync import failure retained at /tmp/v2-codex-auth-timestamp-secrets.log; corrected before final run.
- Unchanged credentials regression: /tmp/v2-codex-auth-timestamp-credentials.log, EXIT0, 8/0.
- Actual installed metadata-only probe using this implementation: /tmp/v2-codex-auth-timestamp-probe.log/.exit, EXIT0: auth verified, quota available, 9 models, configured gpt-6.1-sol/low present. Output contains only readiness categories/counts, no account identity or token values. No model turn occurred. This establishes auth/metadata compatibility, not sandbox tool capability or vision quality. Root owns independent review and later actual OS-bound canary.

No public bytes changed; UI captures are not applicable. No full suite run by worker. D1a separate dirty remediation remains preserved and paused.
