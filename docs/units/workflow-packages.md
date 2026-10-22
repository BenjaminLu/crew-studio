# Workflow package transfer (phase 1)

The editor exports either the existing definition JSON or a real `.crew.zip` containing the selected saved version's declaration and known dependency bytes. Export never uses the unsaved editor or mutable layout projection. Private workflow record metadata/origin/interviews are omitted; the record hash identifies the immutable source. Declaration/skill text may itself contain author-provided sensitive information: inspect before sharing. This is not a secret scanner.

Package layout:

```
manifest.json
workflow/definition.json
skills/<id>/v<N>/SKILL.md
skills/<id>/v<N>/files/<recorded supporting file>
roles/<content-sha256>.md
```

Exact library pins require recorded text hash and aggregate files hash. Every recorded supporting file, including scripts, check sources or assets, is included unchanged. Built-in role refs only resolve through the application's build inventory. Arbitrary `fm:` files, paths in args, URLs, custom code-owned checks/hooks and provider configuration are not guessed or installed. Unresolved semantics are explicit compatibility holds. No task history, credentials, local grants, script decisions or readiness records are transferred.

The ZIP profile is `crew-store-v1`: exports are deterministic uncompressed STORE entries (sorted paths, fixed time and mode); canonical bounded paths, no comments/extras/encryption/data descriptors/ZIP64/multidisk/links. At most 8 MiB archive/expanded bytes, 2 MiB per file, 200 files including manifest. `src/zip.ts` (Node built-ins only, shared with the DOCX writer) reads the archive: every entry must agree in its local and central headers, sit contiguously before the directory and match its CRC32 and size. Import also accepts deflate entries, inflated with `node:zlib` capped at each entry's declared size, so a bomb fails without allocating; any other method is refused. No shell command is invoked. Standard Python zipfile interoperability and hostile metadata tests cover the profile.

Catalog Import package opens a verified tree and escaped UTF-8 source viewer. Scripts, HTML and SVG are source text, never mounted as active documents. Binary/large files show an explanation. Malformed files/digests are rejected. Structurally valid packages remain HELD, even if producer metadata claims compatibility. Saving creates a separate inert `data/workflow-packages/pkg-<random>/` archive+receipt, not a runnable workflow. Saved packages can be reopened or deleted. Preview/cancel writes no package/workflow/approval files. Tokens are session-bound, single-use, expire after five minutes, and have per-owner/global count and aggregate-byte caps. Import does not call install, setup, provider, network or Skill P1 approval/prepare functions.

**Phase 2 remains required:** explicit local adoption to a new personal workflow identity, dependency ref rewrites, local Skill P1 admission and normal staffing/readiness gates, and actual workflow completion. Phase 1 is real package transfer/inspection, not executable import or fulfillment of that remaining work.

Safe stored-byte reads use held directory descriptors (macOS arm64 openat / Linux procfs). Package saving and stored dependency export currently require those platforms; other platforms can inspect uploaded packages but cannot save them. The configured data root ancestors are trusted Studio configuration, not package-controlled paths.

## Local adoption profile (phase 2)

A saved package remains inert. **Create local workflow** is a separate desktop POST bound to the saved archive SHA256. It accepts only `crew-personal-deliver-v1`: bundled writer/designer roles, document/web deliver nodes, declarative decision cards, the destination-owned `artifact-ready` check and `deliver-accept` card, and plain terminal hooks. Extra fields/actions/check parameters remain held with a reason. The source graph is never rebuilt or repaired during adoption.

The ZIP records the exact application capability manifest bytes, version, digest and adapter contract. The destination must already register the corresponding native check/card handler and carry the same manifest. Packaged YAML or scripts never become runtime registrations. Re-export older packages missing this inventory.

Adoption allocates new workflow and skill identities; every pin is rewritten to the new version 1 while preserving both hashes and original SKILL.md/support bytes. P1's existing static analysis, native-binary refusal and limits apply. If P1 would omit any file (including caches), adoption stops instead of silently changing the package. Existing script approvals, setup state, login, staffing grants and readiness results are not imported.

A local HMAC journal records exact owned paths and hashes before publication. Skills publish first, the workflow last. An interrupted operation is recovered before catalog startup: intact complete output is retained; partial unchanged transaction-owned output is removed; changed/unowned output or an invalid journal signature stops that transaction's recovery for manual inspection (`recovery-hold.json` beside the journal; nothing is deleted and Studio still starts). This is recoverable multi-object publication, not an assertion that several filesystem writes are globally atomic. A separate original ZIP survives deletion of the saved transfer package.

Imported workflow saves and read-only editor/gate views do not automatically run readiness (including stub/native dry-runs). An explicit local gate POST is required. Ordinary Run retains its existing staffing/script/Claude gates; it does not gain a new global `gatePassed` prerequisite. Adoption itself starts no Task, provider, installation, network access or script.
