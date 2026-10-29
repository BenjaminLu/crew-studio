# Third-party notices

- **opencc-js 1.4.2** (`public/vendor/opencc-js-1.4.2-t2cn.min.js`, copied from the pinned npm package by
  `scripts/vendor-opencc.ts`): the 繁體中文 → 简体中文 conversion. Code: MIT, copyright the nk2028 project.
  Dictionary data from OpenCC / opencc-data: Apache License 2.0. Both texts are in `public/vendor/opencc-js-LICENSE.txt`.
- **@anthropic-ai/sandbox-runtime 0.0.78** (Apache License 2.0, copyright Anthropic, PBC): two parts are adapted, not
  vendored. `src/runtime/checks.ts` `LOCAL_BINDING_RULES` and `LOCAL_BINDING_ENV` take the `allowLocalBinding` Seatbelt rules
  verbatim, and the IPv4-only Java option, from `dist/sandbox/macos-sandbox-utils.js`. `src/egress-guard.ts` is a port of
  `dist/sandbox/resolved-address-guard.js` and `dist/sandbox/address.js` (the denied address classes, the cloud metadata
  list, the IPv4-in-IPv6 decoding and the loopback-name rule). The Apache License 2.0 text is at
  https://www.apache.org/licenses/LICENSE-2.0.
- **pstack** (MIT License, copyright (c) 2026 Lauren Tan; https://github.com/backnotprop/pstack, commit
  37d989cabf310ea2d7631f1d006117ca4cc8a799): its `how`, `why` and `teach` skills (with their references) are adapted, not
  vendored as is, in `workflows/skills/pstack/` (how.md, why.md, teach.md) for the merge card's review room. The changes
  and the full MIT License text are in `workflows/skills/pstack/NOTICE.md`.
- **baton** (MIT License, copyright (c) Benjamin Lu; https://github.com/BenjaminLu/baton, commit
  0ccff28a2fba09eeed5ef33b129cdb6ce402dc11): its SKILL.md, references/diagrams.md and references/spec.md are adapted, not
  vendored as is, in `workflows/skills/baton/` (SKILL.md, diagrams.md, spec.md) for the review room's lesson, whose report
  layout follows its templates/packet.html. The changes and the full MIT License text are in `workflows/skills/baton/NOTICE.md`.
- **diagram-design** (MIT License, copyright (c) 2025 Cathryn Lavery; https://github.com/cathrynlavery/diagram-design, commit
  5d59b9b6bd4d7abc08bef2bb0fce8cfa525a203c): its SKILL.md and the references style-guide, semantic-patterns, output-spec,
  type-state, type-sequence, type-architecture, type-data-flow and type-flowchart are adapted, not vendored as is, in
  `workflows/skills/diagram-design/` for the review room's figures. The changes and the full MIT License text are in
  `workflows/skills/diagram-design/NOTICE.md`.
- **xterm.js 5.5.0** (`@xterm/xterm`, `public/vendor/xterm-5.5.0.min.js` and `xterm-5.5.0.css`) and **@xterm/addon-fit 0.10.0**
  (`public/vendor/xterm-addon-fit-0.10.0.min.js`), copied from the pinned npm packages by `scripts/vendor-xterm.ts`: the web
  terminal's renderer (docs/units/web-terminal.md). MIT License, copyright the xterm.js authors, SourceLair Private Company and
  Christopher Jeffrey; both texts are in `public/vendor/xterm-LICENSE.txt`.
- **LXGW WenKai TC** (Regular; SIL Open Font License 1.1, copyright 2024 The LXGW WenKai Project Authors,
  https://github.com/lxgw/LxgwWenkaiTC) and **Caveat** (SemiBold; SIL Open Font License 1.1, copyright 2014 The Caveat
  Project Authors, https://github.com/googlefonts/caveat): the review room's handwriting, for the board's titles and
  picture labels only. Copied as woff2 slices by unicode-range from the pinned npm packages `@fontsource/lxgw-wenkai-tc`
  5.3.1 and `@fontsource/caveat` 5.3.0 into `public/fonts/hand/` (the CJK slices and Latin; no Cyrillic, Greek, Vietnamese
  or Lisu), declared in `public/fonts/hand.css`; Studio serves them itself, nothing is fetched from Google Fonts. The
  license texts are `public/fonts/OFL-LXGW-WenKai-TC.txt` and `public/fonts/OFL-Caveat.txt`.
