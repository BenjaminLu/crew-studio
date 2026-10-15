#!/usr/bin/env bash
# Adversarial review of one unit of Studio work, following firstmate's reviewer
# protocol (docs/architecture.md section 11). The reviewer gets a fresh session,
# the spec docs, the diff, the test output and a fail-first report - never the
# builder's reasoning. Its verdict is stored under data/reviews/<id>/.
#
#   scripts/adversarial-review.sh --base <rev> --head <rev> --label <name> \
#       --spec docs/x.md [--spec docs/y.md] [--round N] [--model M]
#
# Exit: 0 APPROVE, 1 REJECT, 2 no verdict, 64 usage.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FM_REVIEWER_SKILL="${FM_REVIEWER_SKILL:-$HOME/Desktop/firstmate-workflow/skills/reviewer/SKILL.md}"
base='' head='' label='' round=1 model="${REVIEW_MODEL:-claude-opus-5-5}"
specs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --base|--head|--label|--spec|--round|--model)
      [ $# -ge 2 ] || { echo "review: $1 needs a value" >&2; exit 64; } ;;
  esac
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --head) head="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --spec) specs+=("$2"); shift 2 ;;
    --round) round="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
    *) echo "review: unknown option $1" >&2; exit 64 ;;
  esac
done
[ -n "$base" ] && [ -n "$head" ] && [ -n "$label" ] && [ "${#specs[@]}" -gt 0 ] ||
  { echo "usage: scripts/adversarial-review.sh --base R --head R --label NAME --spec FILE..." >&2; exit 64; }
[ -r "$FM_REVIEWER_SKILL" ] || { echo "review: reviewer skill not readable: $FM_REVIEWER_SKILL" >&2; exit 64; }
command -v claude >/dev/null || { echo "review: claude CLI not found" >&2; exit 64; }

base="$(git -C "$ROOT" rev-parse "$base")" && head="$(git -C "$ROOT" rev-parse "$head")" || exit 64
id="$(date -u +%Y%m%dT%H%M%SZ)-${label}-r${round}"
out="$ROOT/data/reviews/$id"; mkdir -p "$out"
tmp="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$tmp/head" >/dev/null 2>&1 || true
  git -C "$ROOT" worktree remove --force "$tmp/base" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

git -C "$ROOT" worktree add --detach "$tmp/head" "$head" >/dev/null 2>&1 || { echo "review: cannot check out head" >&2; exit 2; }
git -C "$ROOT" worktree add --detach "$tmp/base" "$base" >/dev/null 2>&1 || { echo "review: cannot check out base" >&2; exit 2; }
git -C "$ROOT" diff "$base" "$head" > "$out/diff.patch"
git -C "$ROOT" diff --stat "$base" "$head" > "$out/diffstat.txt"
git -C "$ROOT" log --format='%h %s' "$base..$head" > "$out/commits.txt"

# Tests on the head, in a clean checkout.
( cd "$tmp/head" && bun install --frozen-lockfile >/dev/null 2>&1; bun run test ) > "$out/tests-head.txt" 2>&1
echo "exit $?" >> "$out/tests-head.txt"

# Fail-first: each test file the diff adds or changes, run on the base with the
# head's version of that file. A test that passes there proves nothing new.
: > "$out/fail-first.txt"
( cd "$tmp/base" && bun install --frozen-lockfile >/dev/null 2>&1 )
git -C "$ROOT" diff --name-only --diff-filter=AM "$base" "$head" -- 'tests/*' | while IFS= read -r t; do
  case "$t" in *.ts|*.mjs) ;; *) continue ;; esac
  mkdir -p "$tmp/base/$(dirname "$t")"
  cp "$tmp/head/$t" "$tmp/base/$t"
  case "$t" in *.mjs) runner=node ;; *) runner=bun ;; esac
  if ( cd "$tmp/base" && "$runner" "$t" ) > "$out/ff-$(basename "$t").txt" 2>&1; then
    echo "GREEN-ON-BASE $t" >> "$out/fail-first.txt"
  else
    echo "RED-ON-BASE $t" >> "$out/fail-first.txt"
  fi
done

{
  echo "You are an adversarial reviewer of Crew Studio work. Follow the reviewer protocol below exactly,"
  echo "adapted to this repo: there is no GitHub pull request and no CI; the test output and the fail-first"
  echo "report below are the machine's results. You have a checkout of the head as your working directory;"
  echo "you may read any file and run small commands to verify a claim. Do not edit files."
  echo
  echo "Judge the change against the spec docs. Every done line must be proved by a test that is red on the base."
  echo "Look for: spec lines not met, regressions, untested paths, security and privacy breaks (docs/architecture.md"
  echo "sections 1 and 10), and contracts broken (one contract per seam). List every finding at once and name"
  echo "its class. End with exactly one line: APPROVE:$label or REJECT:$label."
  echo
  echo "===== REVIEWER PROTOCOL ====="; cat "$FM_REVIEWER_SKILL"
  for s in "${specs[@]}"; do echo; echo "===== SPEC $s ====="; cat "$ROOT/$s"; done
  echo; echo "===== COMMITS ====="; cat "$out/commits.txt"
  echo; echo "===== DIFFSTAT ====="; cat "$out/diffstat.txt"
  echo; echo "===== TEST OUTPUT (head), last 200 lines ====="; tail -200 "$out/tests-head.txt"
  echo; echo "===== FAIL-FIRST ====="; cat "$out/fail-first.txt"
  echo; echo "===== DIFF (first 6000 lines; read files in the checkout for the rest) ====="; head -6000 "$out/diff.patch"
} > "$out/prompt.md"

( cd "$tmp/head" && claude -p --model "$model" \
    --allowedTools "Read,Grep,Glob,Bash(git log:*),Bash(git diff:*),Bash(git show:*),Bash(bun test:*),Bash(bun tests/*),Bash(node tests/*),Bash(ls:*),Bash(cat:*)" \
    < "$out/prompt.md" ) > "$out/verdict.md" 2> "$out/reviewer.stderr"

printf '%s\n' "{\"id\":\"$id\",\"label\":\"$label\",\"round\":$round,\"base\":\"$base\",\"head\":\"$head\",\"model\":\"$model\"}" > "$out/meta.json"
if grep -q "^APPROVE:$label\$" "$out/verdict.md"; then echo "APPROVE $id"; exit 0; fi
if grep -q "^REJECT:$label\$" "$out/verdict.md"; then echo "REJECT $id"; exit 1; fi
echo "NO-VERDICT $id"; exit 2
