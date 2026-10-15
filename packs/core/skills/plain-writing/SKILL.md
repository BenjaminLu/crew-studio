---
name: plain-writing
description: Write text people read (specs, cards, PR text, commit messages, comments, reports) in plain English and Traditional Chinese that a reader can act on without decoding it. Keeps every fact; removes AI-writing patterns.
---

# Plain writing (English and Traditional Chinese)

Use these rules for any text a person reads: specs, cards, pull-request titles and
bodies, commit messages, review comments, status reports. A person and an AI agent
should both be able to read it without decoding it. The rules apply to English and to
Traditional Chinese (zh-TW); the zh-TW section adds checks for Chinese prose.

## Who reads it

Write for a backend engineer with three to five years of experience. This reader knows
git and CI, and has never seen this project, its task numbers, its ids or its private
words. Each sentence lets this reader act without opening another file.

When a person approves what you wrote, an unclear sentence turns the approval into a guess.

## What comes first

Keep every fact, number, condition, scope and level of certainty. Improve the wording only
after that. A shorter sentence that drops a condition is wrong. A clear sentence that turns
"may" into "does" is wrong. When a clear rewrite cannot keep the meaning, leave the sentence
and say what the problem is.

Do not add a fact, name, number, date, path or claim the source does not contain. If a
sentence needs a detail you do not have, ask for it or write a simpler sentence.

## Structure rules

1. Explain a term of art in one plain sentence the first time it appears.
2. Never make an internal code the subject of a sentence. A task number, an id or a commit
   hash means nothing to the reader. Say what the thing is, then put the code in
   parentheses: "the change that added merge cards (T-242)", not "T-242 added merge cards".
3. Keep a number apart from the word next to it: "round 3", "10 MB", "PR #12", never
   "round3" or "10MB".
4. Give each acceptance line one requirement. Split a line that joins two things a reviewer
   checks separately.
5. Name a code path by what it does, not by an internal label.
6. Do not chain words with slashes ("kind/purpose/chosen"). Write the relation out.
7. Keep machine tokens exactly as their parsers need them, and put plain words next to each
   one so a reader who does not know the token learns what it means.
8. Put code, paths, commands and identifiers in backquotes. Text in backquotes is never
   rewritten.

## Patterns that make text hard to read

Each pattern hides a fact or makes the reader work. Fix the pattern, not the word: a listed
word that carries real meaning stays.

### Staging instead of stating

- Not X but Y. "This is not a lint, it is a gate." Say what it is: "This check blocks the
  merge." Keep a contrast only when the reader really holds the wrong belief.
- One-line closers that repeat the paragraph ("That is the real fix."). Cut them, or state
  the consequence.
- Sayings that sound deep ("At its core, the question is trust."). State the specific claim.
- Run-ups ("Here is what you need to know:", "Let's look at"). Start with the point.
- Arguing with no one ("To be clear, this does not change the gates."). Keep it only if a
  reader would really think so.

### Rhythm by rule

- Forced lists of three. List exactly the items there are.
- Dashes as the universal connector. Use a period, comma, colon or parentheses, and say how
  the parts relate.
- Stacked qualifiers ("could potentially possibly"). Keep the one the evidence supports.
- Passive voice that hides who acts. Say who does it.

### Inflation

- Words that sound important and say little: crucial, robust (outside its technical sense),
  seamless, comprehensive, key (as an adjective), leverage.
- Claims of significance ("This marks a major step."). Keep the fact, drop the significance.
- Vague links ("related to the merge path"). Name the relation: "called by", "read by".
- Borrowed authority ("Reviewers agree that"). Name the record or drop the claim.
- Avoiding is and has ("serves as", "features", "boasts"). Use is and has.

### Formatting by rule

- Bold on every label. Bold only where a skimming reader needs to stop.
- Title Case Headings and decorative emoji. Use sentence case and no emoji.

### Leftovers

- Chat wrappers: "Great question", "I hope this helps", "Let me know".
- Notes about the draft instead of the subject ("This section was rewritten to").
- Re-explaining what the reader already has. A reply leads with the decision and adds only
  what the reader lacks.

## Traditional Chinese (zh-TW)

zh-TW text is a real translation that a Taiwanese engineer reads naturally, not English
with Chinese words in front. Technical terms stay in English (PR, CI, merge, fast-forward,
worker); the sentence around them is Chinese.

- 長串的「的」。拆開修飾語，讓讀者看得出誰修飾誰。
- 「進行」加動詞。「進行測試」就寫「測試」。
- 疊在一起的「被」字句。知道誰做的就用主動；不知道才用被動。
- 重複同一個意思的四字詞串。只留帶新資訊的。
- 沒有資訊的開場，例如「隨著……的發展」。直接講重點。
- 收尾口號，例如「讓我們拭目以待」。停在最後一個事實。
- 翻譯腔：「一個」「這個」「其」濫用、「對……進行……」、「基於……」開頭。改成口語的台灣用法。
- 中國大陸用語換成台灣用語：「信息」→「資訊」、「默認」→「預設」、「質量」→「品質」、「項目」→「專案」、「代碼」→「程式碼」。
- 中英文之間留半形空格；全形標點用在中文句子裡。

The structure rules and patterns above apply to zh-TW too: keep every fact and condition,
one requirement per line, internal codes in parentheses, numbers apart from words.

## When not to act

Leave a phrase alone inside a quotation, a title, a proper name, or text that discusses the
phrase instead of using it. A pattern is a clue, not a ban: one dash or one passive sentence
is fine when it is the clearest choice.

Credit and licenses: NOTICE.md
