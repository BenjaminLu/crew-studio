# Inline verified team settings

Status: proposed implementation; independent review and real-provider browser acceptance required.

## Decision

Treat first-use model assignments as captain-owned settings, not a workflow
approval Task. Detection reads authenticated capability metadata. An explicit
inline check exercises the existing native worker adapter, sandbox and MCP tool
path; an explicit inline save signs a source-owned complete team plan with
CrewStore compare-and-swap. No model-authored role values are accepted from the
browser. No paid request runs on page load.

Plans expire after two minutes and bind the exact requested provider/model/effort,
team hash and local executable/config-directory metadata fingerprint. The
fingerprint is not a cryptographic attestation of executable contents. Save
rechecks availability and ownership; cancellation, stale state and changed
provider context fail closed. Unknown Claude quota is retained as unknown and
requires the existing exact native execution admission. The worker request
checks actual tool execution; it cannot promise future quota or model quality.

Only absent basic seats receive defaults. Existing explicit members, workflow
and project overrides remain intact. Existing approved project staffing also
remains authoritative when the team was filled through this source-owned inline
path; ordinary Crew edits retain their existing adoption behavior.

## Tradeoff

One usable model across basic roles removes first-use configuration friction,
but does not create model diversity. The UI labels separate fresh review
contexts honestly. Specialist adapters and all project/grant/spec/dispatch/
merge/deploy gates remain independent. Preserving the same widget through live
updates is required so a running or completed paid check cannot disappear and
encourage a duplicate request.

## Verification

Unit contracts cover source plans, stale/cancelled/replayed saves and explicit
choices. Integration tests run the real server, Agents, OS sandbox and MCP with
an offline CLI fixture, including CSRF and mobile layout. Those tests are not
real-provider E2E evidence; captain acceptance must additionally exercise the
normal browser with the real connected provider.
