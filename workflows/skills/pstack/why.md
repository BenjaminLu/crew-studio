# Skill: why (adapted from pstack, MIT; credit and license in NOTICE.md beside this file)

Investigate the motivation and intent behind one pull request's code. The companion `how` skill answers what the code
does and how. `why` answers what forces led to its shape.

In Crew Studio this runs as one round with no subagents. You are the investigator and the synthesizer in turn. The only
evidence you can reach is local: the pull request text, the Task's spec and done lines, the check results Studio
recorded (all in your prompt), and the repository's own history through git_log, git_show and git_blame, plus the code
through fs_search and fs_read (comments, tests, docs, ADRs, CHANGELOG). You have no MCP servers, no `gh`, no ticket
tracker, no chat, no documents service, no observability, no error tracker and no analytics warehouse. Those categories
are gaps, never guesses: record each one under Sources Consulted as "Not searched. No such source in Studio's review
room." web_search may exist, but it reaches only public pages about public libraries and standards; it never holds this
team's reasons.

## Operating posture

Operate as a careful, cautious and precise investigator. Be honest about what you know and what you are inferring.

## Step 1. The target and the question

The target is the change, or a part of it the captain names. The question is usually a design rationale, a tradeoff, a
motivating edge case, an external constraint, dead code, or a history sweep. If it is vague, make your best guess from
the conversation, state it in one line, then proceed.

## Step 2. The code anchor

Build it first: file paths and line ranges, key symbols, the last commits touching the target (git_log on the path,
git_blame on the lines), and any PR numbers or ticket ids in their messages (git_show for the full message). A PR number
or a ticket id you find is a lead you cannot open here: name it under Additional leads.

## Step 3. Investigate the source you have

- Cast a wide net first, then narrow in. Read each commit message fully, not just its subject.
- Search the history for the exact text: git_log with `text` finds the commits that added or removed it.
- Look for out-of-band docs in the tree: ADRs, design notes, CHANGELOG entries, TODO/FIXME/HACK/NOTE comments near the
  target, and tests whose names encode the edge case that motivated the change.
- If the target looks defensive (null checks, retries, timeouts, rate limits, feature flags, egress guards, OOM
  handlers), look for an incident: a commit or test that names the failure it guards against.
- Quote verbatim, with the exact location (commit hash, file:line). Record what you searched, not just what you found:
  an empty search is a finding. Resist the story: if two items disagree, keep both.
- Mechanics are not motivation. A commit changing `limit = 50` to `limit = 100` shows the change, not why. Never claim
  intent from code behavior or style.

## Epistemics: confidence tiers

Every claim sits in exactly one tier, which sets its section and its phrasing.

1. **Direct**: an author wrote why (a commit message, the PR text, a code comment, a design doc in the tree). Confident,
   cited: "This exists because X (commit abc1234)."
2. **Supported**: several indirect items converge, none states it. "The evidence points strongly to X: [each item]."
3. **Inferred**: a reasonable reading nothing explicitly supports. Hedged, chain explicit: "Given A and B, C seems
   likely because D."
4. **Speculative**: a plausible hypothesis on thin evidence. "One possibility is X, but we have no direct evidence."
5. **Unknown**: you looked and could not find out. Say exactly what you searched.

Confidence words ("because", "the reason is", "was designed to", "fixes", "addresses", "the team decided") need a
citation right next to them; never use them for an inference. Hedges ("appears to", "seems to", "likely", "suggests",
"is consistent with", "plausibly", "may have been") signal interpretation. Avoid "obviously", "clearly", "of course",
"just", "I think" and "I believe".

Do not rationalize: code that makes sense today may have been written for reasons that no longer apply. Do not turn an
absence of evidence into evidence of absence. If the captain's question embeds a hypothesis ("I assume it is for
performance?"), treat it as one candidate and check it independently. When evidence contradicts, show both sides. An
honest "we don't know" is one of the most valuable outputs: name each gap concretely.

## Output

- **The Question**: one or two sentences.
- **The Code in Question**: paths, line ranges, key symbols.
- **What We Found**: `[Direct]` and `[Supported]` claims, each cited precisely.
- **What We Can Reasonably Infer**: `[Inferred]` claims, hedged, with the inference chain. Skip if empty.
- **Competing Hypotheses**: each with evidence for and evidence against or missing. Skip if one answer is clear.
- **What We Don't Know**: specific gaps, searches that returned nothing, sources that do not exist here, people who
  would know (by role, never by guessing a name).
- **Sources Consulted**: one line per category: source control (paths, commits read, PR numbers seen), and for the
  issue tracker, long-form documents, team chat, infrastructure observability, error tracking and the analytics
  warehouse: "Not searched. No such source in Studio's review room."
- **Confidence Summary**: one or two sentences.

If the captain's question is a precursor to changing this code, end with a Preserve / Change / Avoid / Risk list.

Before you answer, check every claim: each has a citation or moves to Inferred or Hypotheses; its phrasing matches its
tier; no code is cited as evidence for its own intent; What We Don't Know is not empty unless the record really was
complete. When the tutor weaves this into a lesson, the confidence language stays exactly as it is.
