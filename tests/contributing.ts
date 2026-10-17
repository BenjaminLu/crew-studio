import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The developer rules live in the repository (retro 2026-10-17, finding 3): CONTRIBUTING.md names the path a change
// takes (review, rebase, core suites, push, deploy only with no Task in flight, live check) and the guards; the
// `test:core` script runs exactly the core suites it names; the setup guide's merge text matches that path.
//   bun tests/contributing.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "CONTRIBUTING.md"), "utf8"), setup = readFileSync(join(root, "docs/setup-and-reference.md"), "utf8");
const core = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts["test:core"] ?? "";
const order = ["Independent review", "Rebase", "Core suites", "Push", "Merge", "Deploy", "Live end-to-end"].map((s) => doc.indexOf(`**${s}`));
ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), "CONTRIBUTING.md: review → rebase → core suites → push → merge → deploy → live check, in that order", JSON.stringify(order));
ok(/no Task is in flight/.test(doc) && /isolated-env\.mjs/.test(doc) && /checkedTempDir/.test(doc) && /opencc-js/.test(doc) && /No session links/.test(doc) && /git stash/.test(doc) && /git add -A/.test(doc),
  "CONTRIBUTING.md names deploy-only-when-idle, the test entry guard, the git-config guard, opencc-js only, no session links and the git prohibitions");
for (const s of ["tests/env-isolation.ts", "tests/git-config-guard.ts", "test:firstmate-staffing", "tests/smoke-code.ts", "test:acceptance", "tests/privacy.ts", "run build"])
  ok(core.includes(s), `test:core runs ${s}`, core);
ok(/bun run test:core/.test(doc) && /bun run test:core/.test(setup) && /no Task is in flight/.test(setup) && /live end-to-end check/.test(setup), "the setup guide's merge text follows the same path");
console.log(`\ncontributing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
