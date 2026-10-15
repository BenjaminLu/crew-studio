# Card zh-TW: real translations

R-002's SC-001: the zh-TW title stayed English ("派工：format() supports JPY, …") and the zh-TW why was the placeholder "船長要求的變更。".

Done when (`tests/card-zh.ts`; red on 36ff4c3):
1. core/ste-wording refuses a zh-TW text that is English (code names, paths, quoted strings and numbers aside) or a stock placeholder; R-002's card is the fixture (tests/fixture/cards/r002-dispatch.json). — "R-002's zh-TW title … is refused …", "R-002's zh-TW why … is refused …", "its real Chinese sections pass …", "the same card with a translated title and why passes …", "every stock placeholder and a plain English sentence are refused …".
2. The coordinator writes both: spec_write takes `zh: {title, why}`; spec-schema requires them; the spec's STE texts include them, so an English or placeholder translation goes back through the refine loop before any card. — "a spec without its zh-TW title and why fails spec-schema …", "the coordinator's first draft with an English zh-TW title and a placeholder why fails …; the refined draft passes".
3. Every card body takes its zh-TW title from spec.zh (else the zh explain) and the dispatch card its zh-TW why too; the merge card's zh-TW why is intent-merge-card's translated detail (an untranslated line is marked （未翻譯）); the placeholder is gone from the code. — "the dispatch card's zh-TW title and why are the coordinator's translation …".
The firstmate pack's coordinator skill says so. Stub: STUB_ZH_ENGLISH makes the first draft's zh-TW English.

Review r1 (`tests/card-zh.ts`; red on 4a9e349 where marked):
4. Valid zh-TW that keeps technical terms in English passes: a hyphenated term (fast-forward) is one word, and a text is English only when it has no Chinese, or at least 3 English words and fewer Chinese characters than English words. Every Chinese literal of the code card bodies is swept from the source and checked. — "Studio's own zh-TW card texts … pass the zh rule …" (red: "合併會在本地 fast-forward base branch。" was refused), "R-002's English title behind 派工： is still refused".
5. The code-stripping pass removes only code: its path, call and dotted patterns are ASCII-only, placeholders are checked per token split on '/', and a title "<Chinese prefix>：<rest>" is judged on <rest>. — "派工：Fix login … is refused" (red), "TODO/TBD … refused" (red), "修改src/app.ts並補上測試 passes", "code, paths and calls inside Chinese still do not count as English".
6. A spec stored before zh existed (an in-flight run) takes the zh explain for the zh-TW title and the dispatch card's why; with neither, the title is the English one marked （未翻譯）, never shown as a translation. — "a spec without zh … 派工： + the zh explain …", "with neither zh nor a zh explain the English title is marked untranslated …" (red).
