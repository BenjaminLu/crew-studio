# Startup recursion

- An example, not a default: a fresh data folder does not seed it (it is not in a new captain's catalog and cannot catch a website request); `CREW_EXAMPLE_WORKFLOWS=1` seeds it. An install that already has it keeps it unchanged and startable, and its Tasks keep running (src/runtime/defs.ts `EXAMPLE_DEFAULTS`).
- Native workflow: `startup-recursion` v1; no Git repository, install, PR, image or video needed.
- Claude is the founder by default: complete proposal, then explicit responses to previous feedback.
- Codex is the judge by default: constructive critique, score 0–100, `ready` or `revise`.
- Either role can run on another provider: `founderProvider` / `judgeProvider` (`claude`, `codex` or `cursor`; empty keeps the default) are choices on the board's start form and optional Firstmate params. The selection card names a moved role with its role ("Cursor founder: …"); the default card is unchanged. When a role's default vendor is not signed in on this Studio and Cursor is, the start form (`providerAdvice` from `/api/wruns/start-options`, with a "Use Cursor" button) and Firstmate's startup contract say which of those params to set to `cursor`; the defaults themselves stay Claude founder, Codex judge.
- At most three proposal/critique rounds. `ready` can reach captain acceptance earlier. At round three, unresolved critique remains visible to the captain; it never becomes an automatic pass.
- Outputs: a pinned document artifact (doc.md + doc.html) retaining every proposal, critique and revision response, with actual job/provider/model provenance in the signed ledger. It is review-only outside the accept card: its review page has no Approve / Request changes, the artifact and docs approve routes refuse it (403 / 409, en/zh-TW reason), export stays open. Early versions hold only competition.md; their page is rendered on the fly, never rewritten.
- The captain must select execution, then separately accept or reject the exact artifact. Rejection closes without approval; modification after presentation blocks approval.

## Firstmate demo

- Read `studio_startup_workflow_contract`; it returns a complete inspectable candidate manifest with roles, nodes and edges.
- Ask Firstmate to draft a candidate for the competition and call `studio_propose_work` with workflow `startup-recursion`, version `1`, a specific business brief, optional exact `founderModel` and `judgeModel`, and optional JSON string `generatedWorkflow`.
- Candidate payloads may arrive pretty-printed (16,000 characters maximum); native proposal validation compacts them to at most 3,000 characters. Larger proposals use existing immutable transport so Engine parameters are not truncated.
- Approve the native dispatch card. The next captain card compares the candidate against the reviewed contract and links the actual candidate file.
- A matching candidate is explicitly described as **Firstmate-generated candidate contract, executed by the fixed template runner**. This is not a generic dynamically compiled workflow.
- An incompatible candidate is never executed. The captain must explicitly choose **switch to template**, or close. The manifest remains attached to the final artifact.
- Existing pack-genesis cannot honestly run this exact recursive two-provider workflow: its generated mode is `pack-produce` and it rejects loop nodes. This change does not relax that authority or claim that generic generation now works.

## Provider capability

- Exact models for the chosen providers are required. No vendor fallback or role substitution.
- An explicit `founderModel` / `judgeModel` param wins. When one is omitted (the board's Tasks start offers neither), Studio binds its configured model for that exact provider: Settings → Chat model for that provider, else `CREW_CLAUDE_MODEL` / `CREW_CODEX_MODEL`, else Studio's Claude default or the `model` in Codex `config.toml`. The binding is a signed `startup-models-resolved` record written before the selection card; the card shows those exact models and the captain approves them.
- A later param change cannot replace the bound model or provider: approval, every round and the Claude verification probe refuse it. An unknown provider refuses the start (`startup_provider_invalid`).
- No configured model for a provider refuses the start with a typed bilingual reason (`startup_model_unconfigured`, or `startup_model_invalid` for a malformed explicit id) naming the provider and where to set it. Nothing falls back to the other vendor.
- Login is not execution proof. Native provider policy remains authoritative; unavailable Claude blocks the task.
- With the founder on Claude, the selection card explicitly authorizes up to one bounded Claude verification probe per founder round, maximum three probes, each at most one turn and US$0.05. Proposal/review model inference is separate.
- Signed `startup-contract-approved` binds definition hash, candidate hash, captain card, exact roles/providers/models/effort, and (founder on Claude) probe limits. The probe accepts the bundled template at any installed version (Studio stores a changed built-in as a new version). A provider-layer verifier must enforce that authority and charge failed attempts; the workflow itself does not fabricate an execution receipt or claim quota availability.

## Verification

- `CREW_TEST_IN_PROCESS=1 bun tests/startup-recursion.ts` uses controlled providers through real Engine, native Firstmate proposal/dispatch, captain cards, tool authorization and signed ledger. It makes no vendor request.
- Covers board start without model params (configured models bound, shown, approved and run end to end), explicit override, unconfigured-model refusal, model change after approval, three rounds, early readiness, explicit fallback, retained critique/revision context, wrong-provider refusal, artifact tamper refusal before answer, cancellation, rejection, duplicate captain answer, restart without new model jobs, complete generated candidate retention and long-proposal transport.
- Also covers an incomplete transcript at acceptance (typed `startup_incomplete_transcript`, no card) and a card whose ledger no longer verifies (`competition: {untrusted:true}`; the card says the rounds cannot be shown, the run page lists no output).
- `node tests/startup-accept-card-ui.mjs` and `bun tests/startup-run-output-ui.mjs` mount the card and the run page: rounds, proposals and critiques fold (last round and its proposal open), model markdown renders as text-node DOM with no model-authored link and no inner scroll box, one button to the artifact, and the run output reads "Competition write-up".
- Live acceptance still requires actual CLI provider-selection evidence, real transcript review and captain acceptance. Fixture pass is not live E2E proof.
