import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// One registry, several faces (docs/units/cli.md): the crew-studio CLI's command table, its `help --json`, the tools a
// grant lists over MCP (tools/list) and the tools' specs must agree. A tool added to the registry without a command, a
// command whose flags are not its tool's inputs, or help that lists something else fails here. In process, no Studio: it
// runs in CI's portable job.      bun tests/cli-drift.ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { observeSpecs } from "../src/observe/tools";
import { grantableKinds, readObserve } from "../src/observe/grant-scope";
import { GRANT_TOOLS, createGrantTools } from "../src/cli-grants";
import { verbs, LOCAL, EXIT_MEANING, skillText } from "../src/cli";
import { cliReference, REFERENCE_PATH } from "../scripts/cli-reference";
import { readFileSync } from "node:fs";

const REPO = join(import.meta.dir, "..");
let failed = false;
const step = (name: string, f: () => void) => { try { f(); console.log(`  ok    ${name}`); } catch (e: any) { failed = true; console.log(`  FAIL  ${name}\n${e?.stack ?? e}`); } };
const grant = { id: "g-00000000", kinds: grantableKinds(), project: null, untrusted: false };
const reads = observeSpecs(grant), specs = new Map<string, any>([...reads, ...GRANT_TOOLS].map((t) => [t.name, t]));
step("every read tool a grant can list is a CLI command, and every command is a tool", () => {
  const vs = verbs(); assert.deepEqual(reads.filter((t) => !vs.some((v) => v.tool === t.name)).map((t) => t.name), []);
  assert.deepEqual(vs.filter((v) => !specs.has(v.tool)).map((v) => v.verb), []);
  assert.ok(GRANT_TOOLS.every((t) => vs.some((v) => v.tool === t.name)), "a run tool without a command");
});
step("every command's flags are its tool's own inputs (made from its schema, never typed twice)", () => {
  for (const v of verbs()) { if (v.verb === "run start") continue; const props = Object.keys(specs.get(v.tool).inputSchema.properties ?? {});
    for (const f of v.flags) assert.ok(props.includes(f.key), `${v.verb} --${f.name} is not an input of ${v.tool}`); }
});
step("help --json lists the same commands, the grantable kinds and every exit code; no captain-only action is a command", () => {
  const r = Bun.spawnSync(["bun", join(REPO, "src", "main.ts"), "help", "--json"], { cwd: REPO, env: process.env as any });
  const h = JSON.parse(r.stdout.toString());
  assert.deepEqual(h.commands.map((c: any) => c.command), verbs().map((v) => v.verb)); assert.deepEqual(h.local.map((l: any) => l.verb), LOCAL.map((l) => l.verb));
  assert.deepEqual(h.kinds, grantableKinds()); assert.deepEqual(h.exitCodes.map((e: any) => e.code), Object.keys(EXIT_MEANING).map(Number));
  assert.ok(!h.commands.some((c: any) => /approve|answer|merge|pay|prepare|door/.test(c.command + c.tool)), JSON.stringify(h.commands.map((c: any) => c.command)));
});
step("the tools a grant lists over MCP (tools/list) are the CLI's commands' tools, for each scope", () => {
  const gt = createGrantTools({ engine: { defs: { catalog: () => [] } } as any, grants: {} as any, firstmate: () => ({ call: async () => ({}) }), observe: (v) => ({ specs: observeSpecs(v), call: async () => ({}) }) as any });
  const tools = (scopes: string[]) => gt.list({ id: "g-00000000", scopes, project: "p", observe: readObserve({ preset: "project" }) } as any).map((t) => t.name);
  const vs = new Set(verbs().map((v) => v.tool));
  for (const sc of [["observe"], ["project"], ["project", "observe"]]) assert.deepEqual(tools(sc).filter((t) => !vs.has(t)), [], `${sc.join("+")}: a listed tool with no command`);
});
step("the skill names every command and every exit code, from the same table; the reference page is what the script writes", () => {
  const sk = skillText(); for (const v of verbs()) assert.ok(sk.includes(v.usage), `the skill misses ${v.usage}`);
  for (const c of Object.keys(EXIT_MEANING)) if (c !== "0") assert.ok(new RegExp(`^\\| ${c} \\|`, "m").test(sk), `the skill misses exit ${c}`);
  assert.ok(/^---\nname: crew-studio\ndescription: .+\n---\n/.test(sk), "a skill: name and description front matter");
  assert.equal(readFileSync(REFERENCE_PATH, "utf8"), cliReference(), "docs/reference/crew-studio-cli.md drifted: run bun scripts/cli-reference.ts --write");
});
console.log(failed ? "\ncli-drift: FAILED" : "\ncli-drift: all passed");
process.exit(failed ? 1 : 0);
