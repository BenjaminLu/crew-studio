# Workflow definition export

Open a workflow and select a saved version, then choose **Export definition…**.
Review the dependency report and complete JSON before downloading. Save edits
first, or reload to discard them. Export never starts a Task or copies approvals.

This is a specification artifact for inspection and Git sharing. There is no
importer in this feature and execution compatibility is not verified.

## Exact source and hashes

`GET /api/wf/:id/export?v=N` is authenticated desktop-only and read-only. Exactly
one positive safe-integer version is required; the server never substitutes the
latest version. Source comes from the saved record, excluding later layout-only
overlays and unsaved browser edits.

- `source.sha256`: SHA256 of UTF-8 `JSON.stringify(savedRecord)`.
- `definitionSha256`: SHA256 of UTF-8 `JSON.stringify(exportedDefinition)`.

These preserve stored object-key order; they are not RFC canonical JSON. Neither
hash signs or authorizes execution.

The definition excludes `parent`, `createdAt`, `by`, `note`, `diff`, `seed`,
`origin` and `templateSource`. This avoids copying interviews and version-history
metadata. Origin also affects admission/readiness; any future import must create
fresh local provenance and approvals. Graph declarations remain intact, including
unknown top-level fields, which are reported as unsupported.

Dependency hashes are copied only from existing pins. Skill, script, asset,
project, credential, environment and task-history files are not read. Native
hooks/checks/modes and bundled/fm refs still depend on the installed Studio.
A pinned reference is not verification that its target exists or matches.

Authored declaration text may contain private or sensitive information. Inspect
it before sharing. No complete secret-detection guarantee is made and declaration
text is never silently redacted.

## Validation

`bun run test:workflow-definition-export` covers exact-version/source integrity,
privacy projection, dependency inventory, API refusals, and actual browser
preview/download/cancel/dirty and navigation ownership behavior.
