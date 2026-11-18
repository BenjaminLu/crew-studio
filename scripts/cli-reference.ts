// Writes docs/reference/crew-studio-cli.md, the crew-studio CLI's reference, from the command table and the tools' specs
// (src/cli.ts). tests/cli-drift.ts fails while the file differs from what this writes.
//   bun scripts/cli-reference.ts            print it
//   bun scripts/cli-reference.ts --write    write it
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { verbs, LOCAL, EXIT_MEANING } from "../src/cli";
import { grantableKinds } from "../src/observe/grant-scope";

export const REFERENCE_PATH = join(import.meta.dir, "..", "docs", "reference", "crew-studio-cli.md");
export function cliReference(): string {
  return [
    "# crew-studio CLI reference",
    "",
    "Generated from the command table (`src/cli.ts`) and the tools' specs by `bun scripts/cli-reference.ts --write`; do not edit by hand. How it works: docs/units/cli.md.",
    "",
    "## Commands",
    "",
    ...verbs().flatMap((v) => [`### \`${v.usage}\``, "", `${v.summary}`, "", `Tool: \`${v.tool}\`.`, ...(v.flags.length ? ["", "| Flag | Type | |", "| --- | --- | --- |", ...v.flags.map((f) => `| \`--${f.name}\` | ${f.type} | ${f.doc} |`)] : []), ""]),
    ...LOCAL.flatMap((l) => [`### \`${l.usage}\``, "", l.summary, ""]),
    "## Kinds a grant may read",
    "",
    grantableKinds().map((k) => `\`${k}\``).join(", "),
    "",
    "## Exit codes",
    "",
    "| Exit | Meaning |",
    "| --- | --- |",
    ...Object.entries(EXIT_MEANING).map(([c, m]) => `| ${c} | ${m} |`),
    "",
  ].join("\n");
}
if (import.meta.main) {
  if (process.argv.includes("--write")) { mkdirSync(dirname(REFERENCE_PATH), { recursive: true }); writeFileSync(REFERENCE_PATH, cliReference()); console.log(`wrote ${REFERENCE_PATH}`); }
  else process.stdout.write(cliReference());
}
