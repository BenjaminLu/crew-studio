import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A known failure covers only the failure it names. tests/acceptance.ts runs on a copy of the
// scenario list where file-organization:board (a known failure: "give the folder's absolute path")
// names a setup step that does not exist: that other failure must be a FAIL and fail the suite,
// not hide under the known one. The unchanged copy stays KNOWN-FAIL with exit 0.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCENARIO_DIR } from "../scripts/acceptance/scenarios";

let passed = 0, failed = 0;
const ok = (c: boolean, name: string, detail = "") => { if (c) { passed++; console.log(`  ok    ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? ` ${detail.slice(0, 1500)}` : ""}`); } };
const run = (dir: string) => {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "acceptance.ts")], { env: { ...process.env, ACCEPTANCE_SCENARIO_DIR: dir, ACCEPTANCE_ONLY: "file-organization:board" }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
const root = mkdtempSync(join(tmpdir(), "acceptance-known-"));
try {
  const same = join(root, "same"), broken = join(root, "broken");
  cpSync(SCENARIO_DIR, same, { recursive: true }); cpSync(SCENARIO_DIR, broken, { recursive: true });
  const f = join(broken, "file-organization.yaml"), text = readFileSync(f, "utf8");
  const changed = text.replace("    setup: [folder]\n    expect: { status: succeeded, result: done, visited: [intake, plan, gates, card, apply, done] }", "    setup: [folder, no-such-step]\n    expect: { status: succeeded, result: done, visited: [intake, plan, gates, card, apply, done] }");
  ok(changed !== text, "the board run of file-organization.yaml is where this test expects it");
  writeFileSync(f, changed);

  const a = run(same);
  ok(a.code === 0 && /KNOWN-FAIL\s+file-organization:board/.test(a.out), "the matching failure stays a known failure (exit 0)", a.out);
  const b = run(broken);
  ok(b.code !== 0 && /(^|\n)FAIL\s+file-organization:board[^\n]*\n\s+no setup step no-such-step/.test(b.out) && !/KNOWN-FAIL\s+file-organization:board/.test(b.out),
    "a failure the known_failure does not match (a missing setup step) is a FAIL and the suite exits non-zero", `exit ${b.code}\n${b.out}`);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`\nacceptance-known: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
