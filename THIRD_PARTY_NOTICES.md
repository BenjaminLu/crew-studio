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
- **baton, vendored** (MIT License, copyright (c) Benjamin Lu; https://github.com/BenjaminLu/baton, commit
  c382464ab02a14ad3dda364143c74bff58ddbcfc): SKILL.md, requirements.txt, references/, scripts/ and templates/packet.html,
  copied byte for byte into `packs/core/skills/studio-baton/`, the review room's built-in default skill, with a subset of
  **diagram-design** (MIT License, copyright (c) 2025 Cathryn Lavery; commit 5d59b9b6bd4d7abc08bef2bb0fce8cfa525a203c: its
  LICENSE, skills/diagram-design/SKILL.md, assets/template.html and sixteen references) copied byte for byte into
  `packs/core/skills/studio-baton/diagram-design/`. The list of files and both licenses are in `packs/core/skills/studio-baton/NOTICE.md`.
  Its scripts install **OpenCC** (Apache License 2.0, https://github.com/BYVoid/OpenCC) from PyPI, pinned by version and
  sha256 in its requirements.txt; nothing of OpenCC is shipped with Studio.
- **@xterm/headless 6.0.0**, the headless build of xterm.js, with **@xterm/addon-unicode11 0.9.0**: how Studio reads a
  terminal's screen for `studio_logs` (src/terminal-screen.ts), bundled into the binary. MIT License, copyright the xterm.js
  authors, SourceLair Private Company and Christopher Jeffrey; the text is in `public/vendor/xterm-LICENSE.txt`.
- **xterm.js 6.0.0** (`@xterm/xterm`, `public/vendor/xterm-6.0.0.min.js` and `xterm-6.0.0.css`), **@xterm/addon-fit 0.11.0**
  (`public/vendor/xterm-addon-fit-0.11.0.min.js`) and **@xterm/addon-unicode11 0.9.0**
  (`public/vendor/xterm-addon-unicode11-0.9.0.min.js`), copied from the pinned npm packages by `scripts/vendor-xterm.ts`: the
  web terminal's renderer (docs/units/web-terminal.md). MIT License, copyright the xterm.js authors, SourceLair Private Company
  and Christopher Jeffrey; the texts are in `public/vendor/xterm-LICENSE.txt`.
