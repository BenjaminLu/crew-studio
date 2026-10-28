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

The script refuses a data directory (`--data`, `$CREW_DATA`) or an `--out` file inside the checkout unless git ignores
that path (the checkout's own `data/` is ignored); symbolic links are resolved first. Files are written with mode 0600
in folders made 0700. Tests use neutral synthetic fixtures in a temporary data directory.

A gold label is one issue's answer; every field is optional and scored only where it is given:

    { n, state: present | fixed? | not-code | not-found | needs-info, files: [paths], security: yes | no,
      category: C-n | PLANNED, notPlanned: true, package: <group key>, source: captain | derived, at, from }

`gold.json` keeps the captain's labels and the derived ones apart (`captain`, `derived`); the captain's fields win over
derived ones, field by field. `package` is a group key: issues with one key belong in one work package.

The states are the triager's own words (`Finding['state']` in `src/domain/issue-triage.ts`), `STATES` in
`src/domain/issue-eval.ts`. `needs-info` (the issue lacks what is needed to locate it: steps, expected and actual
result, logs, environment or version) is a state of its own in the gold and in the score: label it where the issue
as written cannot be located, `not-found` where it can be read but the code is not there. Studio's agreement puts a
needs-info answer against a not-found one in the needs-info bucket (`studio` answers `needs-info` for both), so a
gold `not-found` there counts as a miss for `studio`, while each investigator is scored on its own answer. Existing
gold stays valid, and the schema number changes only if a field changes meaning. A new state the skill gains later
is added the same way.

## Derived labels (free)

`bun scripts/issue-eval.ts mine <project>` refreshes the derived labels from what Studio records already (the score
does this too):

- **Categories record.** An issue the captain moved (`category`, `PLANNED` included) and an issue the captain took off
  planned work (`notPlanned`). A merge is not a judgement of the issue (the model's category is followed into the one it
  was merged into), and a rename names a category, not an issue, so neither gives a label.
- **Triage record.** Every package the captain approved (`approvedBy`, or status approved) or joined a cross-batch match
  to (`joins`): its members get that package's id as `package`.
- **Merged work.** A package issue whose Task merged (its proposal's child Task succeeded through its done step, read
  as `src/issue-triage-workflow.ts` reads it) gets `state: present`; a recheck package's issue gets only its `package`
  (a recheck asks whether earlier work fixed it, so its Task merging says nothing about the state).

**The captain's rulings.** A ruling of the triage's disagreement court (docs/units/board.md, "The disagreement court") is
written as the captain's own label (`source: captain`, `from` naming the ruling) through `IssueEvalStore.addCaptain`:
the state, files and package it decides, `needs-info` included. Its answer (state, files, package) replaces that issue's
earlier captain answer whole (a needs-info ruling leaves no files or package behind); the category, planned and security
answers given before stay; derived labels are left as they are. A ruling on an issue that changed on GitHub meanwhile writes nothing.

Not derivable: a declined package (the triage record drops it and keeps no trace beyond its id never being reused), a
declined category's former members (the record releases them), a match the captain kept apart (the new package does
not record it), and the items under "For you to judge" left there (the court's rulings are the captain's labels above). The pull
request a package's Task opened is not linked from the triage record; only the Task's merged state is. A captain's move
into a category that is later merged is overwritten by the merge (`merged by …`), so that move is no longer read.

## Labeling

    bun scripts/issue-eval.ts label <project> [--sample 50] [--seed s] [--out file]

writes a template (JSON) of a stratified sample: strata are category × whether the two investigators agreed (or nobody
investigated), taken in turn so each one is represented; within one, a fixed order from the seed (the project id by
default). Issues the captain labeled before are left out. Each row's `model` shows investigator A's and B's own answers
(from the stored reports), where they disagree (`diff`), what Studio kept, the category and the package. `gold` is
prefilled with the current answer, except for a field the two investigators disagree on (the state, and then its files
too; the files; security when their answers differ, though Studio flags either; or everything when one did not report
the issue): that one is left empty for the captain to decide. The captain corrects
`gold`, drops a field they cannot judge, sets `"reviewed": true` (exactly `true`), and imports:

    bun scripts/issue-eval.ts import <project> <file>

Rows not reviewed are skipped. Any bad row refuses the whole file, every problem listed: a state or security answer
outside the skill's words, an issue neither the triage nor the categories know, a category that is not open, a path
outside the checkout, an issue twice, an unknown field, planned and `notPlanned` together, a file for another project
or of another schema. Only an active or proposed category is accepted (not a declined or merged one).

## Scoring

    bun scripts/issue-eval.ts score <project> [--repo path] [--out file] [--no-write]

replays every stored triage batch of the project (`data/runs/<task>/issue-snapshot.json`, `issue-report-a.json`,
`issue-report-b.json`; the report a step kept in `run.json` if the file is missing) through the current `parseReport`,
`verifyReport`, `compareReports` and `proposePackages`, imported from `src/domain/issue-triage.ts`, never copied: a
changed rule changes the score. The pinned checkout is removed after each triage, so the code is read from the project's
repository at each report's commit (`git cat-file`, nothing written): `--repo`, else the project's GitHub folder.
Without it, or for a commit the repository lacks, every quoted line fails the check and the score says so. Where the run
recorded what `fs_read` returned to each investigator (`triageReads` on the step, since Studio records them), the replay
checks quotes against it as the workflow does. A report from before that has no reads: it is replayed with every other
check (line ranges, symbols, distinctive quotes), only the "quoted from what fs_read showed you" check left out, and
`runs.withoutReads` counts such batches. Recorded reads not shaped as `{file: [[start, end], ...]}` are treated as none.
`withReads` repeats the metrics over only the issues answered by batches with recorded reads, so old and new data can be
read apart. A batch the current rules throw on is skipped and named in `runs.skipped`. The ledger digest the workflow
demands of a live round is not checked here: the scorer measures rules on stored reports, it does not admit them. An
issue investigated twice is answered by its latest batch. Packages are each batch's own: the cross-batch match (and a
captain's join of one) is not replayed, so a gold pair whose issues were answered by different batches is not scored as
a miss but counted apart (`package.pairs.crossBatch`), and an issue whose gold package spans batches is left out of
`exact` (`exactOf` says how many count). Categories are the current categories record; where the captain changed an
issue's category, the categorizer's own answer comes from its stored report in the run's `run.json`. A merged category,
in an answer or in the gold, is followed to the one it was merged into.

Per predictor (investigator A, investigator B, and `studio`: what Studio does with the two, answering for issues in a
package both agree on, and for issues both agree have nothing to change in the code (`noCode`: not-found, not-code or
needs-info, that state, no files); for
security, Studio's flag from either report or a label):

- **state** and **security**: gold, answered, coverage, accuracy (right among answered), recall (right among labeled),
  and precision and recall per class;
- **files**: the share of answers sharing a file with the gold, and file precision and recall;
- **category**: accuracy and recall, and precision and recall on `PLANNED` (`notPlanned` counts against it);
- **package**: pairs of labeled issues put together, precision and recall, and the share whose package is exactly the
  gold set;
- **human**: the share of investigated issues routed to a person (in no package and not agreed `noCode`), with the
  `noCode` count beside it; both counted on each issue's latest answer.

The headline numbers use the effective gold (the captain's fields over derived ones). `bySource.captain` and
`bySource.derived` score each source alone: derived package gold comes from packages Studio itself proposed (and the
captain approved), so on its own it is circular and only shows what the captain accepted; read the captain's numbers
for how good the rules are.

The result (`schema 1`, `kind: issue-eval-score`) is keyed by `<skills>-<commit>-g<gold>`: a hash of the role-skill
sha256s the replayed reports' steps recorded (and the categorizer's, each step's latest turn), the Studio commit, and a
hash of the gold labels (so a grown gold set never replaces an earlier score). Uncommitted changes to the scoring code
(`src/domain/issue-triage.ts`, `src/domain/issue-categories.ts`, `src/domain/issue-eval.ts`,
`src/issue-eval-store.ts`, `scripts/issue-eval.ts`) add a hash of them. It also records the current bundled skills'
hashes. Comparing two score files compares two skill sets or two rule sets on the same reports.

Tests: `tests/issue-eval.ts` (the reader, mining, the template, import refusals, the scoring math on a hand-computed
case, that the scorer runs the live rules, the script end to end).
