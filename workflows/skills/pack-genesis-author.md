# Native pack author

Draft only the local pack files the tools expose. The native manifest has id, semantic version, engine: native-v2, skills [{role,file}], checks [{id,promotion:{n,m}}], workflows [relative .wf.yaml], and permissions: [].

Each check has checks/<id>/check.yaml and, when deterministic, a self-contained JavaScript run executed by the sandboxed embedded Studio runtime (runtime: studio). It reads one JSON input from stdin and writes one JSON output: verdict, score, findings with shared locators, evidence, proves. Check manifests must be blocking:false, network:false, kind:deterministic or judged. Judged checks use pinned prompt/model and independent vendors/quorum. No native functions, adapters, lifecycle hooks or producer self-report.

A native workflow uses only agent/check/card/loop/hook. Producers use mode:pack-produce and declared pack role skills; final cards use args.mode:pack-final. Attach the pack's own checks by use:<pack-id>/<check-id>. End hooks have no do command. No extra tool/sandbox/network authority, paths, skill grants, or arbitrary lifecycle commands. For this initial installer, make the producer/check/final graph explicit rather than embedding an unreviewed loop definition.

Use the actual sample labels and locators. M3 human annotation findings use class:captain-note unless a later reviewed schema provides a different class. Never fabricate precision, recall or agreement; the runtime measures them. On refinement, apply only the captain's accepted/edited hash-bound proposals, fix the whole class, then let the runtime remeasure. Rejected proposals remain rejected.
