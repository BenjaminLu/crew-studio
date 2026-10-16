import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A known failure covers only the failure it names. tests/acceptance.ts runs on copies of the
// scenario list where file-organization:board is made a known failure of its own (it starts without
// the required folder, so the board refuses it at start). In one copy the run also names a setup step
// that does not exist: that other failure must be a FAIL and fail the suite, not hide under the known
// one. The copy with only the known failure stays KNOWN-FAIL with exit 0.
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
  const board = '    setup: [folder]\n    params: { folder: "{folder}" }\n    cards: [{ node: card, answer: apply }]\n';
  const known = (setup: string) => `    setup: [${setup}]\n    known_failure:\n      observed: "the board refuses a start without the folder"\n      match: "^the board start route refused: 400 Required workflow inputs / 必須提供流程輸入: folder"\n      root_cause: "fixture: the board run sends no folder"\n      covered_by: "tests/acceptance-known.ts"\n    cards: [{ node: card, answer: apply }]\n`;
  const text = readFileSync(join(same, "file-organization.yaml"), "utf8");
  ok(text.includes(board), "the board run of file-organization.yaml is where this test expects it");
  writeFileSync(join(same, "file-organization.yaml"), text.replace(board, known("folder")));
  writeFileSync(join(broken, "file-organization.yaml"), text.replace(board, known("folder, no-such-step")));

  const a = run(same);
  ok(a.code === 0 && /KNOWN-FAIL\s+file-organization:board/.test(a.out), "the matching failure stays a known failure (exit 0)", a.out);
  const b = run(broken);
  ok(b.code !== 0 && /(^|\n)FAIL\s+file-organization:board[^\n]*\n\s+no setup step no-such-step/.test(b.out) && !/KNOWN-FAIL\s+file-organization:board/.test(b.out),
    "a failure the known_failure does not match (a missing setup step) is a FAIL and the suite exits non-zero", `exit ${b.code}\n${b.out}`);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`\nacceptance-known: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
