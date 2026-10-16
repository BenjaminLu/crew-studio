# Startup recursion

- Native workflow: `startup-recursion` v1; no Git repository, install, PR, image or video needed.
- Claude is the founder: complete proposal, then explicit responses to previous feedback.
- Codex is the judge: constructive critique, score 0–100, `ready` or `revise`.
- At most three proposal/critique rounds. `ready` can reach captain acceptance earlier. At round three, unresolved critique remains visible to the captain; it never becomes an automatic pass.
- Outputs: a pinned Markdown artifact retaining every proposal, critique and revision response, with actual job/provider/model provenance in the signed ledger.
- The captain must select execution, then separately accept or reject the exact artifact. Rejection closes without approval; modification after presentation blocks approval.

## Firstmate demo

- Read `studio_startup_workflow_contract`; it returns a complete inspectable candidate manifest with roles, nodes and edges.
- Ask Firstmate to draft a candidate for the competition and call `studio_propose_work` with workflow `startup-recursion`, version `1`, a specific business brief, exact `founderModel` and `judgeModel`, and optional JSON string `generatedWorkflow`.
- Candidate payloads may arrive pretty-printed (16,000 characters maximum); native proposal validation compacts them to at most 3,000 characters. Larger proposals use existing immutable transport so Engine parameters are not truncated.
- Approve the native dispatch card. The next captain card compares the candidate against the reviewed contract and links the actual candidate file.
- A matching candidate is explicitly described as **Firstmate-generated candidate contract, executed by the fixed template runner**. This is not a generic dynamically compiled workflow.
- An incompatible candidate is never executed. The captain must explicitly choose **switch to template**, or close. The manifest remains attached to the final artifact.
- Existing pack-genesis cannot honestly run this exact recursive two-provider workflow: its generated mode is `pack-produce` and it rejects loop nodes. This change does not relax that authority or claim that generic generation now works.

## Provider capability

- Exact Claude/Codex models are required. No vendor fallback or role substitution.
- Login is not execution proof. Native provider policy remains authoritative; unavailable Claude blocks the task.
- The selection card explicitly authorizes up to one bounded Claude verification probe per founder round, maximum three probes, each at most one turn and US$0.05. Proposal/review model inference is separate.
- Signed `startup-contract-approved` binds definition hash, candidate hash, captain card, exact roles/models/effort, and probe limits. A provider-layer verifier must enforce that authority and charge failed attempts; the workflow itself does not fabricate an execution receipt or claim quota availability.

## Verification

- `CREW_TEST_IN_PROCESS=1 bun tests/startup-recursion.ts` uses controlled providers through real Engine, native Firstmate proposal/dispatch, captain cards, tool authorization and signed ledger. It makes no vendor request.
- Covers three rounds, early readiness, explicit fallback, retained critique/revision context, wrong-provider refusal, artifact tamper refusal before answer, cancellation, rejection, duplicate captain answer, restart without new model jobs, complete generated candidate retention and long-proposal transport.
- Live acceptance still requires actual CLI provider-selection evidence, real transcript review and captain acceptance. Fixture pass is not live E2E proof.
