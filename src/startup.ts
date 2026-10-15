import { dirname, join, resolve } from "node:path";
/** Legacy state is opt-in. A native workspace never inherits an ancestor's protection. */
export function startupPaths(dataDir: string, env: Record<string,string|undefined> = process.env) {
  const data=resolve(dataDir), legacy=!!env.CREW_FM_STATE?.trim();
  const state=legacy ? resolve(env.CREW_FM_STATE!) : join(data,"legacy-empty");
  const project=env.CREW_MAIN_PROJECT?.trim() ? resolve(env.CREW_MAIN_PROJECT) : legacy ? dirname(state) : join(data,"workspace");
  return { data, state, project, legacy, protectedRoots: legacy ? [dirname(state)] : [] };
}
