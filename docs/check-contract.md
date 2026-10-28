# Check contract (v1)

Every external script that judges a step's output — a gate, a lint, a test runner, a render probe, a model judge — is a **check**. One contract, any language. The runtime, not the check, owns retries, briefs, cards and evidence.

## Layout

```
packs/<pack>/checks/<id>/
  check.yaml     manifest
  run            executable (bash, python, node, binary)
```

Extracted checks have a local `package.json` declaring `"type": "commonjs"`, so extensionless Node executables do not inherit an enclosing application's ESM setting. Use an explicit `.mjs` executable for ESM checks. Extraction preserves the script bytes and repairs this module boundary for existing caches. This does not change sandbox policy, approval requirements or evidence validation.

## Manifest

```yaml
id: frozen-frames
version: 1.2.0
title: { en: "No frozen frames", zh-TW: "沒有凍結畫面" }
applies_to: [video]            # code-diff | image | video | web | document | spec | card | run
kind: deterministic            # deterministic | judged
blocking: true                 # a fail stops the edge
needs: [artifact, previous]    # what the runtime must put in the input
params:                        # JSON schema; the editor renders a form from it
  type: object
  properties:
    max_freeze_s: { type: number, default: 0.3 }
policy_bind:                   # params filled from org/project policy unless the workflow overrides
  max_freeze_s: video.max_freeze_s
timeout_s: 120
network: false
```

## Execution

- stdin: one JSON object:
  `{run, node, round, artifact:{type,path,version}, previous, spec:{done:[...]}, params, workdir, out}`
- stdout: one JSON object:

```json
{"verdict":"pass|fail|warn|error",
 "score":0.0,
 "findings":[{"locator":{...},"message":"...","expected":"...","class":"frozen-frame","severity":"blocking|minor"}],
 "evidence":["out/strip-12s.png"],
 "proves":[0,2]}
```

- `proves`: the indexes of the spec's done lines this check proves when it passes.
- Exit code 0 means the JSON was written. A crash, a timeout or bad JSON is `error`, never `pass`.
- Sandbox: inputs read-only, writes only to `out/`, no network unless the manifest says so (a check with `test_run: true`, one that runs the project's tests, gets loopback: architecture §10), killed at `timeout_s`.

## Locator: one schema for machine findings and human annotations

| type | fields |
|---|---|
| `file` | `path, line, end_line?` |
| `web` | `url, selector?, x?, y?, viewport` |
| `image` | `bbox:[x,y,w,h]` |
| `timeline` | `from, to, bbox?` |
| `text` | `section, start, end` |
| `card` | `field, index` |

A human pin or timeline box is stored in the same schema. A worker cannot tell machine feedback from human feedback, so it can act on both without a human in the loop.

## Judged checks

- `kind: judged` runs a model through the provider interface.
- It must return locators. A judged finding without a locator is dropped.
- It is never the only blocking check for a done line. To block, it needs `quorum: {n: 2, of: 3}` across independent rounds or vendors.
- Its prompt and model are pinned in the workflow version, like any param.
- `judge.role` names the workflow role the judge works as (for example `designer`). Without it, the judge works as the role of the node the check sits on; a node with no role falls back to `designer` for a check named for one, else `reviewer`. The judge's instructions go through the same composer as an agent turn: Studio's safety rules, then that role's skill. Each judge call is listed on its step with the role skill it got (ref, version, sha256).
- `judge.distinct_providers: true` explicitly requires distinct canonical, actually resolved provider identities. Each vote records `provider`, `model` and its independent owned `job`; aliases or different models of the same provider cannot count as two providers. Unknown/unavailable explicit judges refuse; worker fallback never supplies a judge vote. The flag defaults to false: a declared independent-context quorum can use three fresh rounds from one vendor. Historical votes without measured provider identity cannot satisfy an explicit diversity request. On a machine with one usable vendor (docs/architecture.md, "Adaptive staffing") the votes run on that vendor's distinct models instead (two votes on one model are then refused), or, with one usable model, on that model; the result carries `independence: {level: model | same, en, zh}` and the ledger keeps it. Without provider facts nothing is relaxed.

## Adapters for existing scripts

`kind: deterministic` with `adapter: exitcode` wraps a script that only has an exit code and a log:

```yaml
adapter:
  command: ["bash", "bin/ci.sh", "--stage", "bash"]
  pass_on: [0]
  findings_from: { regex: "^(?P<path>tests/[^:]+):(?P<line>\\d+): (?P<message>.*)$" }
```

`adapter.optional: true` allows a missing repository command only when expansion produces an empty argv. The result allows the gate with `data.status: not-run`, a reason, and empty evidence/proves; it does not claim execution or test success. The default remains an error for an empty argv. A configured command always executes normally, and its nonzero exit still blocks. The built-in repository lint adapter opts into this behavior.

## Hooks

The same contract with `kind: hook` runs at a lifecycle point (`after_merge`, `after_round`, `on_cancel`). Its verdict is reported and does not move the task backward.

## Runtime duties (not the check's)

- Refine loop: produce → run checks → compile a brief from the findings → produce again. Stop when every blocking check passes; raise a card when the score does not improve for 2 rounds, when the same `class` fails twice, or at the round cap.
- Brief compiler: a fixed template. Each item lists the locator, message, expected result and class, plus "fix the whole class". A coordinator agent can add a root cause, and the brief is then checked for a locator and an expected change.
- Evidence: every result is stored with the check version, the input hash and the head. The final acceptance card shows the ledger.
- Done-line map: each spec done line binds to at least one check through `proves`. Unbound lines go to the human acceptance list on the final card.
