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

The initial ZIP profile is `crew-store-v1`: standard uncompressed STORE entries, canonical bounded paths, no comments/extras/encryption/ZIP64/multidisk/links. At most 8 MiB archive/expanded bytes, 2 MiB per file, 200 files including manifest. Deflated third-party ZIPs are clearly refused; use the original Crew export. AdmZip 0.6.1 encodes/reads entries after strict local+central metadata preflight; no decompression or shell command is invoked. Standard Python zipfile interoperability and hostile metadata tests cover the profile.

Catalog Import package opens a verified tree and escaped UTF-8 source viewer. Scripts, HTML and SVG are source text, never mounted as active documents. Binary/large files show an explanation. Malformed files/digests are rejected. Structurally valid packages remain HELD, even if producer metadata claims compatibility. Saving creates a separate inert `data/workflow-packages/pkg-<random>/` archive+receipt, not a runnable workflow. Saved packages can be reopened or deleted. Preview/cancel writes no package/workflow/approval files. Tokens are session-bound, single-use, expire after five minutes, and have per-owner/global count and aggregate-byte caps. Import does not call install, setup, provider, network or Skill P1 approval/prepare functions.

**Phase 2 remains required:** explicit local adoption to a new personal workflow identity, dependency ref rewrites, local Skill P1 admission and normal staffing/readiness gates, and actual workflow completion. Phase 1 is real package transfer/inspection, not executable import or fulfillment of that remaining work.

Safe stored-byte reads use held directory descriptors (macOS arm64 openat / Linux procfs). Package saving and stored dependency export currently require those platforms; other platforms can inspect uploaded packages but cannot save them. The configured data root ancestors are trusted Studio configuration, not package-controlled paths.
