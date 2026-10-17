// The worker's own words that its tests were not run, not rerun after a change, or not green (E2E F20: R-058's worker said
// "the final suite is NOT verified green" and a reviewer approved anyway). Read one sentence at a time so fail-first wording
// ("the new test fails on the base and passes on the head") and other things not run ("the job is not run twice") stay quiet.

/** a failing test described as fail-first evidence: red on the base or before the fix, green after */
const FAIL_FIRST = /\b(?:on|against)\s+(?:the\s+)?(?:base|old\s+code|main)\b|\bbefore\s+(?:the\s+|my\s+|this\s+)?(?:fix|change|patch)\b|\bon\s+the\s+old\b|\b(?:then|and|but|now)\s+pass(?:es|ed)?\b|\bpass(?:es)?\s+(?:now|on\s+(?:the\s+)?head|after)\b|\bfail-?first\b/i;
/** what a "not run / not verified" must be about: the tests, the suite, a check, the change */
const SUBJECT = String.raw`(?:tests?|suites?|checks?|lint|verification|run_tests|change|fix|head|build)`;
const PATTERNS: { re: RegExp; skip?: RegExp }[] = [
  { re: new RegExp(String.raw`\b${SUBJECT}\b(?:\W+\w+){0,4}?\W+not\s+(?:been\s+|yet\s+)?(?:verified|executed|run|re-?run|green|passing)\b`, "i") },
  { re: /\bnot\s+(?:verified|executed|run)\s+(?:green\b|tests?\b|suites?\b|against\b)/i },
  { re: /\bunverified\b/i },
  { re: /\b(?:could\s*not|couldn't|cannot|can't|unable\s+to|did\s+not|didn't|never)\s+(?:be\s+)?(?:verif(?:y|ied)|re-?run|execute)\b/i },
  { re: new RegExp(String.raw`\b(?:could\s*not|couldn't|cannot|can't|unable\s+to|did\s+not|didn't|never)\s+run\s+(?:the\s+|any\s+|a\s+)?(?:\w+\s+){0,2}${SUBJECT}\b`, "i") },
  { re: /\b(?:re-?run|verification|test\s+run)s?\s+(?:is\s+|was\s+)?(?:unavailable|blocked|skipped)\b/i },
  { re: /(?<!\bno\s)(?<!\b0\s)\btests?\s+(?:still\s+)?(?:fail(?:s|ed|ing)?|red)\b/i, skip: FAIL_FIRST },
  { re: /\blimit\s+reached\b/i },
];

/** the sentence where the worker says its tests were not run or not green, or null */
export function unverifiedClaim(summary: unknown): string | null {
  const t = typeof summary === "string" ? summary : ""; if (!t.trim()) return null;
  for (const sentence of t.split(/(?<=[.!?;])\s+|\n+/)) {
    for (const p of PATTERNS) if (p.re.test(sentence) && !(p.skip && p.skip.test(sentence))) return sentence.trim().slice(0, 300);
  }
  return null;
}
