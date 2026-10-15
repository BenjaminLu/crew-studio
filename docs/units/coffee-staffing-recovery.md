# Recover explicit coffee staffing choices

The live coffee onboarding supplied explicit answers as dotted keys, such as {"worker.provider":"codex"}. The persisted interview previously accepted only nested {"worker":{"provider":"codex"}}. Its ordinary validation error became a generic unavailable message at the native tool boundary, so the four captain-selected providers were never saved.

The source-owned interview now accepts either explicit representation against its actual role list and current frontier. It never guesses values, fields, vendors or dependent answers. The tool schema describes the format and each returned question includes its exact answerKey. Mixed representations for one role, unknown roles/fields and wrong-frontier choices produce a safe bilingual staffing_answer_invalid failure with a read-current-interview recovery action. Existing choices are retained. No raw filesystem or account error is exposed.

An exact repeat of already saved answers returns the existing state without saving another round. A new model/effort choice in the same captain turn still waits for the next real captain reply. Configuration approval and dispatch remain separate captain cards. Reading or saving provider choices never starts a model job or grants permissions. Previously failed dotted calls did not persist choices; retry the exact explicit answers through the source tool instead of rewriting state files or asking for the full design again.

The offline regression recreates the exact four-role corner-coffee call, checks persistence, idempotent replay, next-round questions, rejection without choice loss and no automatic work/approval. Existing staffing and coffee authority suites remain required. No paid account or live state mutation is needed to verify the repair.
