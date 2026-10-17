import "./isolated-env.mjs"; // first: tests never read the operator's .env
// A Studio with an approved code-firstmate staffing on the built-in sandbox project (the acceptance harness's
// staffing-code step, through the same HTTP routes the board uses): a code run starts through the staffing guard,
// never through an unstaffed copy of the graph. Imported by bun suites; a node suite runs it
//   bun tests/lib/staffed-code-studio.ts <name>      (prints {base, token, data} once ready; SIGTERM closes it)
import { bootStudio, type Studio } from "../acceptance/studio";
import { STEPS } from "../acceptance/steps";

export async function staffedCodeStudio(name: string): Promise<Studio & { token: string }> {
  const s = await bootStudio(name, { examples: false });
  try { await STEPS["staffing-code"]({ s, vars: { project: "sandbox" }, firstmate: async () => [] } as any); }
  catch (e) { await s.close(); throw e; }
  return { ...s, token: `acceptance-${name}-session` };
}

if (import.meta.main) {
  const s = await staffedCodeStudio(process.argv[2] ?? "staffed-code");
  console.log(JSON.stringify({ base: s.base, token: s.token, data: s.data }));
  const stop = async () => { await s.close(); process.exit(0); };
  process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
}
