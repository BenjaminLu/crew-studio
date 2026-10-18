# Local sandbox execution contract (W29)

This contract is for a single operator running trusted local repositories. It is
not a multi-tenant boundary against arbitrary unsandboxed software using the same
macOS account. VM/container/dedicated-user execution is not required here.

## Credential transport

| Credential | Trusted storage / transport | Child exec metadata |
| --- | --- | --- |
| Claude OAuth / API key | Unlinked private file, inherited descriptor | Descriptor number only |
| Legacy `ANTHROPIC_AUTH_TOKEN` | Unsupported CLI transport; execution refuses | Never exported to a CLI |
| Codex API key | Private `auth.json`; direct provider contexts are converted too | `CODEX_HOME` directory only |
| Codex subscription | Isolated `auth.json` copy without refresh credential | `CODEX_HOME` directory only |
| Studio tools | Per-job private token file | File path only; missing-file fallback refuses |
| GitHub git auth | Private git config inside Studio operation data | Config path only |
| Egress authority | Trusted Studio memory; scoped relay injects central proxy authentication | Credential-free loopback proxy URL |
| Browser session dispatch | Mode-0600 redirect HTML inside the protected runtime directory | Redirect file path only |

Mode 0600 does not isolate processes sharing a uid. The relevant boundary is the
actual Seatbelt path denial tested for other rounds/tests. Descriptor files are
unlinked before exec. Child helpers receive explicit scrubbed environments,
including keychain helpers, browser dispatch and release startup.

## Proxy admission

The central proxy still requires a per-job credential. Untrusted CLI clients
instead receive a job-specific loopback relay URL. A relay keeps its upstream
credential in Studio memory and removes client-supplied proxy authentication
before injecting that credential. It closes its sockets and revokes authority
when its owning job ends. Central revocation also closes already-open tunnels.
Headers, connection counts and connect/idle lifetimes are bounded; DNS/connect
waiting uses stream backpressure rather than an unbounded pending buffer.

Relay listeners bind only `127.0.0.1` in reserved TCP ports **43000–43063**.
Exhaustion refuses execution; there is no arbitrary-port fallback. A round may
connect only to its own relay and tool listener. Test profiles permanently deny
the entire reservation, including listeners started after profile compilation,
and deny binding/accepting on it. Tests also deny the configured/default Studio
port and listeners present at startup. These rules are checked with actual
Seatbelt connections, including IPv4, IPv6, mapped addresses and host addresses.
They do not rely on port secrecy. A legitimate test choosing a reserved port
will fail and must choose an unreserved or ephemeral port.

Generic egress grants cannot authorize loopback/private addresses by spelling an
IP literal or localhost. The resolved address is checked and that address is
used for the connection. Existing local-model support is narrower: only an
in-process provider's trusted configured exact scheme/host/port can authorize a
local endpoint, only after resolving to loopback or this host's own address.
Studio, tool, central proxy and broker ports remain forbidden even when a local
provider is misconfigured to target them. Workflow `egress.allow` cannot create
this exception.

## Starting Studio

The supported release launcher uses an explicit scrubbed initial exec
environment. Release configuration and credentials are loaded from its private
`.env` after exec, or read from the key store/keychain. The launcher does not
forward exported GitHub/provider/proxy credentials to the Studio process.

For a direct development launch, start with a clean environment and keep secrets
in the existing protected configuration/key store, for example:

```sh
env -i PATH="$PATH" HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" bun src/main.ts
```

`bun run start` can propagate Bun-loaded `.env` values into its script child and
is not certified by this launch gate. Use the direct command above or the release
launcher for the W29 contract.

Launching Studio with exported secrets in its original OS environment is outside
this verified launch contract. Deleting `process.env` entries later does not
rewrite macOS `KERN_PROCARGS2`. These changes do not scrub operator shells,
editors or other applications. Do not claim that all same-uid process environments
are confidential.

`CREW_LOCAL_UNRESTRICTED=1` disables the OS sandbox and outbound restrictions.
The W29/R-088 sandbox evidence does not apply to an instance in that mode. The
operator must review the execution mode before approving deployment/resumption.

## Local test gate and accepted limits

Test execution runs the unchanged repository command with the production
Seatbelt profile. A preflight proves a known own-loopback operation succeeds,
protected listeners cannot be reached, protected files cannot be read and
external connections are denied. Failure to inspect listeners or launch the
probe refuses the test instead of treating a failed probe as a successful deny.

Actual `KERN_PROCARGS2` tests target only owned dummy victim PIDs: a secret-bearing
positive victim must be readable, while an FD-only victim must have readable
nonempty procargs without the credential. Reading a scan's own argv is not a
valid positive control. Negative file tests must prove the sandbox actually
started, not merely report a nonzero exit.

Process-group and marker cleanup remain best effort: deliberate `setsid` plus a
clean-environment re-exec can escape that cleanup. Unsandboxed same-uid malware
can also connect to local relays or read same-uid private files. These are
explicit accepted residual limits for this local trusted-repository scope, not
claims of total OS isolation. Future nonbroker local services created after a
test starts are not all covered by the listener snapshot. Studio and its broker
reservation have stable exclusions independent of that snapshot.

R-088 acceptance requires the original base/head full test commands, unchanged
shop test hashes, zero skipped/cancelled/todo tests, an enforced production
sandbox, and a fresh independent security review of the final integrated commit.
Passing unit tests, starting a VM, or running with unrestricted mode does not
satisfy it. Deployment and live task resumption require the operator's approval.
