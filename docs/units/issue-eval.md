# Unit issue-eval: measuring issue triage and categories

A change to the triager or categorizer skill, to the investigators' models or to the agreement rules
(`src/domain/issue-triage.ts`) is measured against a gold set instead of guessed. Everything here is offline,
deterministic and free: no model runs, nothing is read from or written to GitHub, and no UI is involved.

`src/domain/issue-eval.ts` (the gold format, derived labels, the template, the import, the scorer),
`src/issue-eval-store.ts` (files and the stored runs, read only), `scripts/issue-eval.ts` (the commands).

## Where the gold set lives

Only in Studio's data directory, next to the project's triage and categories, never in the repository:

    data/issue-eval/<project>/gold.json          the gold set (schema 1)
    data/issue-eval/<project>/labels-<time>.json templates written for labeling
    data/issue-eval/<project>/scores/<key>.json  one file per score

The script refuses to write a template or a score into the checkout (outside the data directory). Tests use neutral
synthetic fixtures in a temporary data directory.

A gold label is one issue's answer; every field is optional and scored only where it is given:

    { n, state: present | fixed? | not-code | not-found, files: [paths], security: yes | no,
      category: C-n | PLANNED, notPlanned: true, package: <group key>, source: captain | derived, at, from }

`gold.json` keeps the captain's labels and the derived ones apart (`captain`, `derived`); the captain's fields win over
derived ones, field by field. `package` is a group key: issues with one key belong in one work package.

The states are the triager's own words (`Finding['state']` in `src/domain/issue-triage.ts`). A new state the skill
gains later (such as `needs-info`) is added to `STATES` in `src/domain/issue-eval.ts`; existing gold stays valid, and the
schema number changes only if a field changes meaning.

## Derived labels (free)

`bun scripts/issue-eval.ts mine <project>` refreshes the derived labels from what Studio records already (the score
does this too):

- **Categories record.** An issue the captain moved (`category`, `PLANNED` included) and an issue the captain took off
  planned work (`notPlanned`). A merge is not a judgement of the issue (the model's category is followed into the one it
  was merged into), and a rename names a category, not an issue, so neither gives a label.
- **Triage record.** Every package the captain approved (`approvedBy`, or status approved) or joined a cross-batch match
  to (`joins`): its members get that package's id as `package`.
- **Merged work.** A package issue whose Task merged (its proposal's child Task succeeded through its done step, read
  as `src/issue-triage-workflow.ts` reads it) gets `state: present`.

Not derivable: a declined package (the triage record drops it and keeps no trace beyond its id never being reused), a
declined category's former members (the record releases them), a match the captain kept apart (the new package does
not record it), and the items under "For you to judge" (the captain does not answer them in the record). The pull
request a package's Task opened is not linked from the triage record; only the Task's merged state is. A captain's move
into a category that is later merged is overwritten by the merge (`merged by …`), so that move is no longer read.

## Labeling

    bun scripts/issue-eval.ts label <project> [--sample 50] [--seed s] [--out file]

writes a template (JSON) of a stratified sample: strata are category × whether the two investigators agreed (or nobody
investigated), taken in turn so each one is represented; within one, a fixed order from the seed (the project id by
default). Issues the captain labeled before are left out. Each row shows the current answers (both investigators'
agreement, the state, files, security, category and package) and a `gold` prefilled with them. The captain corrects
`gold`, drops a field they cannot judge, sets `"reviewed": true`, and imports:

    bun scripts/issue-eval.ts import <project> <file>

Rows not reviewed are skipped. Any bad row refuses the whole file, every problem listed: a state or security answer
outside the skill's words, an issue neither the triage nor the categories know, a category that is not open, a path
outside the checkout, a file for another project or of another schema.

## Scoring

    bun scripts/issue-eval.ts score <project> [--repo path] [--out file] [--no-write]

replays every stored triage batch of the project (`data/runs/<task>/issue-snapshot.json`, `issue-report-a.json`,
`issue-report-b.json`; the report a step kept in `run.json` if the file is missing) through the current
`parseReport`, `verifyReport`, `compareReports` and `proposePackages`, imported from `src/domain/issue-triage.ts`, never
copied: a changed rule changes the score. The pinned checkout is removed after each triage, so the code is read from
the project's repository at each report's commit (`git cat-file`, nothing written): `--repo`, else the project's
GitHub folder. Without it, or for a commit the repository lacks, every quoted line fails the check and the score says
so. An issue investigated twice is answered by its latest batch; packages are each batch's own (the cross-batch match
is not replayed). Categories are the current categories record; where the captain changed an issue's category, the
categorizer's own answer comes from its stored report in the run's `run.json`.

Per predictor (investigator A, investigator B, and `studio`: what Studio does with the two, answering only for issues in
a package both agree on; for security, Studio's flag from either report or a label):

- **state** and **security**: gold, answered, coverage, accuracy (right among answered), recall (right among labeled),
  and precision and recall per class;
- **files**: the share of answers sharing a file with the gold, and file precision and recall;
- **category**: accuracy and recall, and precision and recall on `PLANNED` (`notPlanned` counts against it);
- **package**: pairs of labeled issues put together, precision and recall, and the share whose package is exactly the
  gold set;
- **human**: the share of investigated issues routed to a person (in no package).

The result (`schema 1`, `kind: issue-eval-score`) is keyed by `<skills>-<commit>`: a hash of the role-skill sha256s the
replayed reports' steps recorded (and the categorizer's), and the Studio commit; uncommitted changes to the domain
files add a hash of them. It also records the current bundled skills' hashes. Comparing two score files compares two
skill sets or two rule sets on the same reports.

Tests: `tests/issue-eval.ts` (the reader, mining, the template, import refusals, the scoring math on a hand-computed
case, that the scorer runs the live rules, the script end to end).
