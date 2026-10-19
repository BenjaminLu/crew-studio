# Skill packages: scripts, dependencies, approval, network

Status: P1 and the network part of P2 are implemented; integration verification is required before release. Date 2026-10-19.
Supersedes the scratch design of the same day. Captain's decisions are marked **(captain)**.

A skill can carry scripts (`pptx`'s `scripts/thumbnail.py`, `scripts/office/soffice.py`) that its SKILL.md tells the agent
to run. This unit makes that work in Studio without giving up what a round already guarantees: one approval by the
captain, a sandbox with no reads of Studio's data or the user's secrets, and no network the captain did not allow.

## 0. Findings that shape this design

1. **The CLIs cannot run scripts, by design.** Claude rounds run with `--tools ""`, `--disable-slash-commands`,
   `--setting-sources ''` (src/providers/claude.ts); Codex with `--disable shell_tool`, `-s read-only`
   (src/providers/codex.ts). Every action goes through Studio's MCP tools. So a skill's folder and scripts reach the agent
   only through Studio's own tools: `skill_files`, `skill_read`, `skill_run` (§5). One enforcement point, and the
   provenance of every script run for free. Native CLI skill loading is not used.
2. Pins hashed only SKILL.md. Once files execute, **the pin and every approval bind both hashes**: `sha256` (SKILL.md)
   and `filesSha256` (every other file of the version) (§1).
3. The round sandbox (`roundProfile`, src/runtime/checks.ts) is deny-default with a read allowlist, and egress goes
   through a per-round scoped listener; Studio retains the upstream credential (src/egress-client.ts, src/egress.ts). Most of the enforcement exists; this unit adds read-only folders,
   per-call credentials and a resolved-address guard.
4. The real `pptx` skill is 1.3 MiB / 65 files / depth 5 and ships `__pycache__/*.pyc`; its JavaScript dependency
   (pptxgenjs) is 7.5 MiB of `node_modules`. The text-skill caps refuse it.

## 1. Skill package

- Package = the whole folder: `SKILL.md`, `scripts/`, `references/`, any other regular file. Stored as before under
  `data/skills/_library/<id>/v<N>/{SKILL.md, files/…}`, never changed once written. Studio never modifies skill files.
- **Dependencies travel with the skill as lockfiles inside its folder (captain)**: `package.json` + `package-lock.json`;
  `uv.lock`; `requirements*.txt` with a `--hash` on every line; a PEP 723 script with its `<script>.py.lock` beside it
  (`uv lock --script`). No separate toolchain item, no vendored `node_modules`. The lockfiles are files of the version, so
  they are inside `filesSha256`: changing a dependency is a new version.
- Import (src/skills.ts): a folder with any script is a package: cap 8 MiB, 400 files, depth 8 (text skills keep 1 MiB, 100,
  4). `__pycache__/`, `*.pyc`, `.DS_Store` are skipped and named in `skipped`. Native binaries are refused (`.so`, `.dylib`,
  `.node`, `.dll`, `.exe`, or Mach-O / ELF by their magic). Links are refused as before.
- **Pin = `{id, v, sha256, filesSha256}` (captain)**. A pin made before filesSha256 existed takes the library's, which is
  written once per version; a pin whose filesSha256 differs from the library is refused (workflow save, prompt build, and
  the round's dispatch). The round copy is hashed again after it is made.
- What a version needs is read at import, never run (src/skillpkg/analyze.ts) and kept on its record as `pkg`:
  scripts (path, language, size, sha256, flags), the npm lock and the python lock, runtimes (node, python), programs
  (frontmatter `metadata.requires.bins`, or a known program a script or SKILL.md names), hosts (§6), warnings (a Python
  import no lock installs, a requirements file without hashes, PEP 723 without its lock).

## 2. Scan (informational, no card)

Flags per script: `network`, `delete-perm`, `env-secret`, `subprocess`, `install`, `native`, `obfuscation`. Hosts: every
`http(s)://` URL a script names, except XML namespace and schema identifiers (`schemas.openxmlformats.org`, `www.w3.org` …;
the `pptx` scripts name hundreds) and lines that declare a namespace; plus the frontmatter's `metadata.hosts`,
`metadata.network`, `metadata.requires.hosts` and URLs in `compatibility`. A host must be a DNS name: an IP literal, a local
name (`localhost`, `*.local`, `*.internal` …), a metadata name or a wildcard over a top-level domain is refused and listed
as refused, never proposed. The scan is a reading aid; the sandbox is the enforcement.

## 3. Approval

Studio's own record, never in skill files: `data/skills/_library/<id>/approvals.jsonl`, one HMAC-signed line per decision
(ledger key): `{v, sha256, filesSha256, scripts: "approved"|"text-only", hosts, installScripts, by, via, card?, run?, at, sig}`.
A later line for the same hashes supersedes; an edited or forged line is ignored. Markdown-only versions need none.

- **One card (captain)**: the existing team-change card (src/crew-tools.ts `crew.confirm`) lists every script skill version
  the changed team, or a workflow the change reaches, would load and the captain never decided: version, both short hashes,
  each script with its flags, the hosts approving it allows, its lockfiles and programs (en and zh-TW). Its approve option then
  carries a pick: 「核准（含 script）」 Approve with scripts / 「只當文字」 Text only. 「先不用」 is "don't add".
  `crew.apply` records the decision, bound to the hashes the card showed, before it writes the team.
- The Crew page's own change (POST /api/team/change) asks the same: a change that brings an undecided script skill is
  answered 409 `{code: "skillDecision", skills}`, the page shows the scripts and hosts in one panel, and the captain's
  answer is sent with the change (`skillDecisions`).
- Studio-wide per version hash: decided once, never asked again. A new version (any changed file) has no decision and
  inherits nothing, its hosts included. Until it is decided it blocks where it is pinned.
- **Dispatch (captain)**: an undecided script skill blocks the round before its agent starts, outcome `blocked`, with the
  reason ("… is not approved: the captain approves it on the team-change card (or chooses text only)"). Text only is only
  the captain's explicit choice: the agent gets the text and the note "this skill's scripts are not enabled here; do not
  try to run or recreate them", and no `skill_run`.

## 4. Prepare, runtimes, programs (captain)

After a version is approved with scripts, Studio prepares it by itself (src/skillpkg/index.ts `decide` → `prepareSoon`;
again at start for every approved version in use; a round waits for one in flight). No human in the loop, no card.

- **Env**: `data/envs/<key>/`, key = sha256(lockfile bytes + platform + arch + runtime versions + approved install-script names). Content-addressed:
  two skills with the same locks, runtimes and install-script approval share one env; `env.json` is written last (a folder without it is a
  prepare that did not finish and is redone) and names every `<id>@v<N>` using it. GC removes an env no approved, in-use
  version names (the team's pins and every workflow's latest version); a per-prepare cache `data/envs/.cache-<rand>` is
  removed after each prepare.
- **npm**: `npm ci --ignore-scripts --no-audit --no-fund` in `env/node` (package.json + package-lock.json copied there), with
  empty user and global npmrc (no token, no other registry). Lockfile v2/v3 only; linked entries and entries without a resolved URL are refused; every dependency must be a registry tarball
  with an integrity hash. A package with `hasInstallScript` is recorded on the env and shown as a warning: its script is
  unreviewed code from the registry, so it never runs, unless the captain's approval names that package
  (`installScripts`): then `npm rebuild <names>` runs in the same sandbox with no network.
- **Python**: `python3 -m venv env/py/venv`, then `pip install --no-deps --require-hashes --only-binary :all:` from the lock
  (uv.lock and a script's .lock are read as hash-pinned requirements; an sdist build is an install script too, so wheels only).
- **Sandbox**: the round profile (`roundExec`): writes only the env and its cache; reads nothing of Studio's data or the
  user's secret folders; the network only through the egress proxy with a strict credential of its own whose list is
  **derived per prepare from the lockfiles** (each lock entry's `resolved` host; the index host of a requirements/uv lock,
  plus files.pythonhosted.org for pypi.org) **or the recipe's own host** — never a broad default list.
- **Runtimes, without asking**: node = the host's node with its npm (a version manager's is fine); else Studio's own bun runs
  node scripts and a skill with a package-lock is not ready ("npm is not installed"). Python = the host's python3 (not
  macOS's `/usr/bin/python3` stub without Xcode's tools); else, with uv on the host, a standalone CPython that uv fetches into
  `data/runtimes/python` inside the prepare sandbox (uv checks each build's sha256; hosts github.com and its asset hosts);
  else not ready, with the reason. The versions are part of the env key.
- **Programs** (src/skillpkg/recipes.ts), data-driven: host first (PATH, or an app path the recipe names); then a recipe's
  pinned download into `data/tools/<recipe>/<version>-<sha12>/` — curl in the prepare sandbox to that one host, no
  redirects, size capped, the sha256 checked before anything is unpacked; a disk image is attached read-only outside the
  sandbox and its app copied into data/tools (never /Applications); then a Homebrew formula, only through a Homebrew already
  installed at a prefix the user owns (no cask, no sudo, no auto-update); else **"not ready: <program> missing" with the exact
  reason**, on the Crew page and in Firstmate's status — no card, no question. Shipped recipes: libreoffice (official image
  from downloadarchive.documentfoundation.org; its sha256 is **not pinned yet**, so Studio reports it missing instead of
  trusting an unpinned download), poppler (Homebrew formula; Poppler has no portable macOS build), gcc/cc/clang/make (Xcode's
  command line tools: detected, never installed). A test run never uses Homebrew or uv to fetch anything.
- A missing program does not block the round (other scripts work); the agent is told which programs are missing. No
  approval, a failed env or a missing runtime blocks it.

## 5. Delivery and skill_run

Per round (src/skillpkg/round.ts, called from the engine before the mode's begin): each approved script skill the node pins is
copied byte for byte into the round's folder (`data/work/skills/<run>/<node>-…-skills/<id>/`, files 0444, folders 0555) and
hashed again; the prompt gets a footer naming the folder and the three tools.

- `skill_files(skill)`, `skill_read(skill, path)`: the copy's files; relative paths only, no link, text only, 256 KiB a call.
- `skill_run(skill, script, args)`: `script` must be one of the version's detected scripts; Python runs in the prepared venv
  (else the resolved python), JavaScript on the resolved node with `NODE_PATH` = the env's node_modules for CommonJS
  and a trusted read-only Node loader resolving ESM bare imports from the same pinned env, shell with
  /bin/bash. Args: up to 64 strings. Timeout ≤ 300 s, output cut to its last 64 KiB, 30 calls a round. It runs under the
  round profile with the round's own cwd and writes (nothing more); the copy, the env, the runtimes' installs and Studio's
  tools are read and executed but **write-denied** (`roundProfile` `readOnly`). PATH starts with shims for npm, npx, pnpm,
  yarn, pip, pip3, uv, brew, gem … that fail with Studio's reason ("dependencies come from the lockfiles … nothing is
  installed at run time"), and `PIP_NO_INDEX`, `npm_config_offline` are set: a skill that says "npm install if missing"
  fails with a clear error. The env carries no vendor token (built fresh: PATH, HOME/TMPDIR in the call's tmp).

## 6. Network per skill version (P2, pulled into this branch by the captain)

**Only the package hosts a skill's dependencies need, and the hosts the skill itself needs (captain).**

- Prepare: the hosts derived from the lockfiles and recipes (§4).
- Run time: default none. A version's hosts are its scan and frontmatter proposals (§2), stored only in the signed decision,
  bound to both hashes; approving the version approves exactly those hosts, shown on the same card.
- Enforcement: each `skill_run` call gets its own egress credential (src/egress.ts `open(token, hosts, meta)`), list = that
  version's approved hosts, closed when the call ends. The agent's CLI keeps its provider-hosts credential; its other tools
  (`run_command`, `run_tests`) get no skill host.
- Strict credentials (skill and prepare): an IP literal is refused even when listed; every resolved address is judged by the
  resolved-address guard (src/egress-guard.ts, ported from sandbox-runtime, the same file fix/sandbox-loopback-tests adds):
  loopback, unspecified, link-local, multicast, broadcast, cloud metadata and this host's own addresses, and in addition
  private ranges (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7). The address that passed is the address dialed.
  A plain-HTTP request is forwarded with `connection: close`, so a reused proxy connection comes back through the checks.
- **A refused host is not allowed and nobody is asked mid-run (captain)**: the script gets 403; `skill_run` answers with
  "skill pptx@v3 tried api.x.com, not in its approved hosts …"; the refusal is recorded on the call, in the Task's context
  (`ctx.skillRefusals`) and in Firstmate's work status (`skillRefusals`), so Firstmate can propose a new skill version or a
  team change, which goes through the normal card.
- Egress log per Task: `data/runs/<run>/egress.jsonl`, one line per connection of a credential that names its run: host,
  `skill@version`, script, allowed or refused, why. `data/egress.log` keeps refusals Studio-wide.
- **If an "allow this time" is ever added (captain)**: its scope is the whole Task, reruns included — not one run.

## 7. Reads (P3, not in this branch)

Narrow SYSTEM_READ (`/opt/homebrew/etc`, `/Library/Keychains` patterns), write-deny the main repo's `.git/hooks` and
`.git/config`, read-only shared caches opt-in, vendor-token strip for every child, profile snapshot tests. The skill copy,
env, runtimes and tools being read-only is done (§5).

## 8. Provenance

- Step: `skillPackages: [{id, v, sha256, filesSha256, scripts: "approved"|"text-only", approval, card, env}]` beside the
  existing `skills: ["id@vN"]`; the same list in the round record's header.
- Each `skill_run`: `rn.data.skillRuns` (skill, v, both hashes, script, scriptSha256, argv, cwd, exit, ms, output tails,
  egress allowed/refused) and an evidence-ledger record `skill-run` (`evidence: skill-run:<id>@v<N>/<script>`).

## 9. UI

- Team-change card: the script section and the pick (§3). Crew page: a readiness mark after each script skill chip
  (✓ ready · T text only · … preparing · ? not approved · ! not ready), its full line in the title, en and zh-TW
  (「含 2 個 script · 會連 api.x.com · 還不能用：缺 soffice」); the one decision panel for a change that brings an undecided one.
- `GET /api/team` carries `skillStatus` ("<id>@v<N>" → badge) and the library's `filesSha256` (so new pins carry it).
- Firstmate's `studio_work_status`: `skills` (each script skill in use: state, line, reasons) and per Task `skillRefusals`.
- The skill viewer (opened from any skill chip) shows the same line for the version it shows (`scripts` on `GET /api/skills/<id>`).

## 10. Phases

- **P1 + P2 network (this branch)**: pin with filesSha256; import tiers, skips, binary refusal; scan; signed decisions;
  the card and the Crew page ask; blocked dispatch; prepare (npm, pip), runtimes, recipes, GC; read-only round copy;
  skill_files/read/run; per-call strict credentials; resolved-address guard incl. private ranges; per-Task egress log;
  readiness on the Crew page and in Firstmate's status; provenance.
- Remaining: pin the LibreOffice image's sha256 (needs a reviewed download); a recipe for a portable Node when the host has
  none; P3 reads (§7); an upgrade card with a script/host diff and "seat keeps the last approved
  version" (today a new version blocks until decided); native CLI skill loading behind a flag.

## 11. Risks

- Per-invocation network still lets one script of a version use another script's hosts. Accepted; the card says hosts are
  per version.
- The scan is heuristic: a host built at run time is not proposed, and is refused when tried (the run says so).
- A skill whose scripts need a program Studio cannot fetch safely stays "not ready" until the captain installs it.
- Seatbelt is macOS only; rounds off macOS are refused today, so skills inherit that.
