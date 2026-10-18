import {isAbsolute} from 'node:path';

// Operator-only local configuration. Never accepted from a model, task or API.
export function localUnrestricted(): boolean {
  if(process.env.CREW_LOCAL_UNRESTRICTED!=='1')return false;
  if(!process.env.CREW_LOCAL_DEPENDENCY_ROOT||!isAbsolute(process.env.CREW_LOCAL_DEPENDENCY_ROOT))throw Error('Local unrestricted mode requires an absolute CREW_LOCAL_DEPENDENCY_ROOT');
  return true;
}
/** What the Board and the Doctor show: "local-unrestricted" while CREW_LOCAL_UNRESTRICTED=1 is set (a misconfigured one too:
 *  the operator asked for it, and rounds refuse to start until it is fixed), else "sandboxed". */
export function executionMode(): "sandboxed" | "local-unrestricted" {
  try { return localUnrestricted() ? "local-unrestricted" : "sandboxed"; } catch { return "local-unrestricted"; }
}
export function localExecutionNotice(): string {
  return localUnrestricted()?`The operator explicitly enabled local unrestricted execution for this Studio instance: OS sandbox and outbound-network restrictions are disabled. This supersedes earlier sandbox/model-only-network instructions for this local test. Dependency installation is permitted only in ${process.env.CREW_LOCAL_DEPENDENCY_ROOT}, never globally. Keep task scope, captain approvals, repository identity, signed ledger and artifact validation intact.`:'';
}
