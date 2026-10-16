// Prints the definition pin (sha256 of defHash) of bundled workflows, for a scenario's `pin:` and
// for CAPTAIN_ONLY_ALLOW in scenarios.ts. Review the workflow change before copying a new hash.
//   bun scripts/acceptance/pin.ts [<workflow id> ...]     (no id: every bundled workflow)
import { bundledList, bundledText, parseYaml } from "../../src/bundled";
import { normalize } from "../../src/runtime/defs";
import { defHash } from "./scenarios";
const defs = [...bundledList("workflows/v2/"), ...bundledList("packs/")].filter((f) => f.endsWith(".wf.yaml")).map((f) => normalize(parseYaml(bundledText(f) ?? "")));
const want = process.argv.slice(2);
for (const d of defs) if (!want.length || want.includes(d.id)) console.log(`${d.id} v${d.version} sha256 ${defHash(d)}`);
