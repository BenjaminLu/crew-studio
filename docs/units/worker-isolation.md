# W29 dedicated-worker boundary proposal

Status: protocol prototype only. **Not enabled, not an implemented isolation boundary, not a W29 security fix.** Current macOS execution remains same-uid and the proxy-environment and escaped-process findings remain open. `src/worker-boundary.ts` validates a proposed broker request and models serialization; it does not execute anything or attest OS isolation. Its tests are protocol tests, not security E2E coverage.

## Why a different OS identity

On the measured macOS host, a sandboxed same-uid process can read another process's startup argv/environment using KERN_PROCARGS2. Seatbelt sysctl rules do not prevent it. Moving Claude and Studio credentials to inherited FDs/private files reduces exposure but does not hide existing operator startup environments. Proxy credentials still appear in child exec environments. A shell wrapper exporting a secret before exec does not fix this.

Process groups and an environment marker do not contain an untrusted process that calls setsid and re-execs without the marker. Polling ancestry cannot close the fork/reparent race; macOS NOTE_TRACK is unsupported. A reliable cleanup boundary must survive lost ancestry.

## Captain decision

1. **Recommended: dedicated non-admin macOS worker account.** Native macOS behavior is retained. All untrusted commands, including project tests, skill scripts, and dependency installs, run on that uid, serialized. This needs explicit captain consent and one-time administrator setup. The trusted Studio/provider/git processes remain on the operator uid. Proxy capability credentials may remain visible to the one active worker, but cannot expose a concurrent operator process's credentials through same-uid procargs. Scoped proxy grants are revoked before worker reuse.
2. **Per-run ephemeral VM.** Destroying the VM gives a stronger cleanup boundary and supports concurrency. Native macOS guests require a supported virtualization runtime and OS licensing/setup; a Linux guest changes test-platform coverage. No VM backend is implemented here.
3. **No administrator setup: fail closed.** Refuse untrusted macOS test/skill/dependency execution, showing a concrete worker-not-configured readiness reason. Planning and trusted provider operations can remain available after auditing that they cannot execute project hooks/scripts. This changes product behavior and is deliberately not enabled by this patch. Continuing same-uid execution is an explicit acceptance of the unresolved exposure, not a secure alternative.

## Dedicated-account implementation plan

No account/helper/sudoers/launchd change has been performed. Do not copy these requirements into an unrestricted sudo rule.

The administrator creates one non-admin worker uid/gid with a private home and no login credentials, interactive login or unrelated jobs. A narrow root-owned helper and its configuration are installed outside writable project paths. A launchd service authenticates the controller's OS audit identity; alternatively a tightly scoped executable launch mechanism must provide equivalent authentication. The helper accepts only the versioned structured request, never a caller-selected uid, environment, mount, root path, or shell command string to execute while privileged. It never executes project-provided code before dropping privileges.

The administrator-owned policy fixes the controller uid, worker uid/gid, home, runtime PATH, and staging root. Runtime installations must be readable by the worker; operator-home nvm paths are not assumed accessible. `workerManifest` is a broker-side shape check only; helper validation and OS peer authentication remain mandatory. A run id is an identifier, not authentication.

The broker copies approved inputs into a per-run staging tree. It does not recursively chown an operator checkout, permit arbitrary host paths, or mount the operator home. Git inputs contain no `.git` credential config/hooks. Staging uses no-follow directory handles with ownership checks and rejects symlink escapes at use time; lexical path validation alone cannot establish confinement. Artifact collection uses the same no-follow discipline, quotas, and type checks. Secrets, signed policy records, live data and the controller worktree never become worker-readable or writable.

Before exec the helper sets supplementary groups, gid and uid irreversibly, verifies all real/effective/saved identities, closes unintended FDs, creates a clean environment and applies the seatbelt profile. The worker receives only scoped per-run network access; Studio API/session/credential paths remain denied. Secret values are forbidden in argv. The broker does not pass a controller process environment. User input must not control privileged environment/configuration loading.

The lease is exclusive per worker uid. On startup every worker begins quarantined until the helper verifies it has no prior processes and no active grants. The prototype `WorkerLease` starts idle only to model an already-verified lease; constructing it is not verification. On completion, cancellation, deadline, controller disconnect or service restart, the helper revokes grants, kills **all** processes owned by the dedicated uid, verifies no process remains, and collects artifacts only after cleanup. It must not depend on a parent tree, process group, env marker, or a single PID snapshot. PID reuse must be handled using kernel identity/ownership checks. Any inability to establish cleanup quarantines the worker and refuses reuse. Never apply uid-wide cleanup to the operator uid or a shared worker running concurrent tasks.

A production completion receipt must bind the authenticated helper instance/boot generation, lease id, run id, execution result, grant revocation and verified cleanup. Broker code accepts only that authenticated receipt; the prototype's `cleaned(run, verified)` boolean is not an IPC trust mechanism.

## Required acceptance evidence before enablement

- A dummy operator secret is visible through same-uid KERN_PROCARGS2 in the control experiment and unreadable from the actual worker uid; no real credentials are used.
- Worker cannot read controller home, Studio data, another run's files, or inherited controller FDs; cannot reach Studio APIs or unapproved egress.
- setsid + double-fork + clean-environment re-exec cannot survive a completed/cancelled/timed-out run; writable output baseline confirms filesystem denial is not faking cleanup.
- Helper/controller crash, restart, stale receipt, malformed manifest, symlink replacement, PID reuse, long output, hung descendants, artifact oversize and concurrent request tests refuse safely.
- Exact uid/gid/supplementary groups and sandbox profile are measured in the worker. Its attempt to regain controller/root privileges fails.
- Native macOS application suites, dependency preparation and skill execution pass with isolated fixture data and stub providers. Independent security reviewer approves helper, broker and cleanup implementation.

## Rollback

Before enablement, remove the prototype code/tests without affecting current execution. After installation, stop dispatch, revoke all worker grants, wait for verified uid cleanup, disable the helper/service and remove its administrator-owned configuration through an explicit administrator operation. Preserve audit logs and staged outputs for inspection. Rollback must select fail-closed execution; it must never silently fall back to same-uid execution. The worker account is deleted only after process, ownership and artifact checks. No live deploy is authorized by this design.
