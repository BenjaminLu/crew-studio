# Preserve image refinement context and round evidence

Image generation currently starts a fresh ephemeral vendor thread with the original task text and only the latest version's open notes. It sends no reference image. A second refinement therefore loses earlier requirements and visual context.

Every refinement will send the exact verified current PNG, immutable original intent, and chronological ancestor-qualified annotation history. Resolved feedback remains an active requirement unless a captain annotation explicitly supersedes it through validated ancestor references. Earlier notes retain original text and locators; no automatic semantic deletion or visual-success claim.

New artifact versions and acceptance cards retain immutable per-round snapshots, including original annotation words, target version/region/time, cumulative active requirements, reference image hash, producer round and attempt. Existing records without a contemporaneous snapshot are labelled not recorded; mutable current notes cannot prove historical wording.

Scope: src/domain/deliver.ts; src/domain/image-refinement.ts; src/providers/codex-image.ts; src/runtime/index.ts; src/server.ts; src/artifacts.ts; public/scard.js; public/m3.js; public/runtime.js (exact historical round evidence); tests/image-refine-context.ts; tests/image-refine-context-ui.mjs; tests/codex-image.ts; tests/codex-image-fixture.mjs; package.json; this document.

The installed app-server UserInput schema supports image URL inputs. The adapter will accept only source-owned verified PNG bytes plus hash and embed a data URL; browser paths/URLs do not become input authority. Two successive refinements will be verified through real Engine/card/version transitions and strict subprocess payload fixtures. This proves transport and lineage, not that a real model rendered black fur or the correct head direction.
