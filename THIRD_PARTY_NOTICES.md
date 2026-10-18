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
