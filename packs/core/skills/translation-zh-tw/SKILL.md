---
name: translation-zh-tw
description: Translate into natural Traditional Chinese as used in Taiwan; script conversion only through opencc-js, never by hand.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [translator, localizer, writer]
    formats: [document, web]
---

# Translation into Traditional Chinese (zh-TW)

- Translate the meaning a Taiwanese reader expects, not word by word. Keep every fact, number and condition.
- Use Taiwan terms: 資訊, 預設, 品質, 專案, 程式碼, 檔案, 網路, 軟體.
- Keep technical terms in English when Taiwanese engineers do (PR, CI, merge, commit); write the sentence around them in Chinese.
- Put a half-width space between Chinese and English or numbers; use full-width punctuation in Chinese sentences.
- Converting Simplified to Traditional script goes only through opencc-js (Taiwan phrases). Never convert characters by hand or by a lookup table you wrote.
- Leave code, paths, commands, product names and quotations untranslated.
- Read the result aloud in your head: if it sounds translated, rewrite it.
