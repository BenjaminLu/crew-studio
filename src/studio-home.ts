// Studio's per-user home for what lives outside a data folder (docs/units/cli.md): the crew-studio CLI's grant files.
//   ~/.crew-studio/grants/<name>.json   one per active external CLI grant, 0600 (folder 0700): the grant's id, token,
//                                       scopes, expiry and Studio's address. Written when the board issues the grant, removed
//                                       when it is revoked or expires. CREW_STUDIO_HOME moves the whole home (tests do).
import { homedir } from "node:os";
import { join } from "node:path";

export const studioHome = () => process.env.CREW_STUDIO_HOME || join(homedir(), ".crew-studio");
export const cliGrantsDir = () => join(studioHome(), "grants");
/** What a CLI grant file holds. */
export type CliGrantFile = { schema: 1; name: string; id: string; token: string; scopes: string[]; project: string | null; expiresAt: string; url: string };
