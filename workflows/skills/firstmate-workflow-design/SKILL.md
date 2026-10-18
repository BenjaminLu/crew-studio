---
name: firstmate-workflow-design
description: Design and revise Studio workflow drafts after discussing the captain's goal, using Studio's current draft contract and readiness gate before saving or running work.
---

# Firstmate workflow design

Use this skill when the captain designs a workflow, asks for a graph preview, or revises an unsaved draft. Drafting defines work; it does not start a Task or grant execution approval.

## Ground the design

Discuss the desired output, audience, review responsibility and captain decision. Ask one short question at a time only for missing choices. Preserve answers already given and model choices. Language: your first message uses the Board's language; afterwards, the captain's language and script, for titles and drafts too. For Hello Crew Studio, discuss the website heading and visual direction before drawing its workflow.

Read `studio_workflow_draft_contract` before composing a graph. Its schema and example are the current executable contract; do not infer the draft format from a full installed workflow YAML. Use `studio_validate_workflow_draft` for a non-mutating format/static check, then `studio_draft_workflow` for the live preview. A valid format is not runtime or quality acceptance: read `studio_workflow_gate` after preview and repair its typed problems.

## Use the implemented vocabulary

- Root tool arguments: `goal`, optional `interview: [{question, answer}]`, `workflow`, and `draft` only when revising an existing unsaved draft.
- `workflow` has `name`, optional `description`, `roles`, `nodes`, `edges`, optional `intents`, `params`, `sample`. It has no `id`, `version`, `workflow` wrapper, `steps`, `connections`, `lanes`, `policies`, arbitrary scripts or installed-workflow metadata.
- Roles are `{id, label, skill, seat}`. `seat` is the team seat the role's nodes run as (`maker` makes the output, `reviewer` checks it, `alt-maker` is a second maker, `design-reviewer` checks a design; an agent node may name its own); a draft without one is refused. Obtain the allowed bundled skill refs from the contract. A role ID may describe a reviewer, but its executable capability still comes from the supported mode and tools; naming it reviewer does not create a code-review engine.
- Agents are `{id, kind:"agent", label, role, mode:"deliver", args:{format:"document"|"web"}}`, optionally `detail`, `serves`, a `variant` A–Z inside args, and explicitly discussed provider/model/effort/skill choices. Do not invent `mode:"review"`, shell actions, `args.prompt`, input/output mappings or test gates; draft authoring does not implement them.
- Give every agent node a `detail`: its own assignment, what this node produces. The interview shaped the graph; it is not a worker's brief.
- Pick each node's skill from the contract's `skills` catalogue by what the node makes: Writer for written documents, Designer for web pages, design direction and design review. A mismatch is refused.
- A normal captain card has `card:{title?,body?,options:[{id,label}]}`. An artifact acceptance card uses `accept:true` and no `card`: Studio generates its options.
- A hook is an end `{id,kind:"hook",label}`. Do not add `do`, `args`, role settings or fabricated deployment behavior.
- Edges are objects `{from,to,when?}`, not tuples. `when` is one exact option ID, not a list or `approve|changes` expression. Agent-to-next edges are unconditional. Normal card branches match the IDs declared in that card. For an acceptance card, button IDs and edge outcomes differ: `approve-<producer-node-id>` returns `approved`, `changes` returns `changes`, and `reject` returns `rejected`. Its edges must explicitly route all three outcomes `approved`, `changes`, `rejected`; never use the approve/reject button IDs as edge outcomes or a fallback that sends revision/rejection through the success end. Ordinary captain cards may use a valid fallback.
- IDs must be unique, lowercase, short and reference real roles/nodes. Let Studio lay out the graph; coordinates are unnecessary.

## Make the graph do what it says

Write the captain's goals as `intents:[{text,done,assumption?}]`; numbering is assigned by position. Each working/decision node lists the relevant 1-based numbers in `serves`. Every intent needs a concrete observable outcome. Keep assumptions distinct from the captain's answers.

Trace each branch before submission: one reachable entry; all nodes reachable; an explicit end reachable; the ordinary success route reaches an artifact-producing agent and then the captain's artifact acceptance card. `changes` returns to the intended producer; `reject` reaches a clearly labeled end. A return edge must not accidentally make the workflow lose its entry. Do not route an agent's mere completion directly to publication approval.

Match capability to the request. The draft vocabulary produces document/web artifacts and captain decisions. Deliver agents receive their node label/detail and can read fixed-version text sources from related earlier producers with input_list/input_read: doc.md, index.html or film.html. They can write a source-based review document, but have no browser, visual inspection or automatic independent quality gate. It does not support repository build/test/deploy actions or an automatic pass/fail review gate. Do not label an ordinary deliver node as if it performs those operations. For those requirements, explain the exact unsupported capability and offer an existing appropriate managed workflow; do not fake equivalent behavior with labels.

Use `params` for explicitly required Run inputs (`{label,default?}` string values), and `sample:{text?,params?}` for a small representative dry run. The acceptance node serves the intent lines that require artifact review/acceptance; earlier nodes still own their own confirmation or production obligations. The sample must satisfy the declared inputs without inventing business facts. Keep design and staffing approval separate.

## Validate, revise and hand back control

1. Read the current contract; compose the whole argument object.
2. Call the non-mutating validation tool. Correct its exact paths/reasons without saving a malformed draft. Retry at most three schema corrections in this turn; if the contract still cannot express the requested behavior, describe that capability gap and keep the existing draft intact.
3. Submit the valid object to `studio_draft_workflow`. For revisions, include the existing draft ID; preserve intent lines and the captain's node settings.
4. Read `studio_workflow_gate`. Repair format, reachability, briefs and dry-run problems within the stated goal. Do not weaken the gate or claim that static/stub passes prove real execution.
5. Show the preview link and explain the happy path, revision path, final decision and remaining runtime prerequisites in ordinary language. Save only on the captain's request. Run only through the explicit Run/staffing confirmation flow.

A successful draft response carries a real draft ID and preview link. Never describe a locally imagined graph as already previewed. Do not ask the captain to discover schema or tool instructions for you.

## Configure a saved workflow

Once saved, do not revise the old draft. Read `studio_read_workflow` for the latest version and actual node IDs. When the captain chooses provider/model/effort, use `studio_update_workflow_staffing` with that version as `base`. Include every agent node sharing the chosen role (for example the design and design-review nodes). Keep all graph structure, captain decisions, intents and skills unchanged unless the captain explicitly changes a skill. Report the saved version. This saves configuration only; it starts no task and does not verify paid execution. On a version conflict, read again and preserve concurrent changes. Never ask the captain to type their already stated choices into the editor manually.
