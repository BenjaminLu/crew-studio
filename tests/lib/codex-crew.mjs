// An approved code-firstmate crew, offline, for page tests that start a real Task on a real Studio server.
// A Codex login the stub CLI (tests/fixture/codex-account.mjs) hands to the scripted agent (tests/acceptance/agent.mjs),
// so every round goes through the real native Codex path with no vendor call; the crew is approved through the
// captain's own staffing discussion and its captain-only confirmation card (src/domain/staffing.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Writes the fixture Codex login under <home>/.codex; returns the server env that points Studio at it. */
export function codexCrewEnv(home) {
  const codexHome = join(home, ".codex"); mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", last_refresh: "2020-02-29T12:34:56.123+08:00", tokens: { access_token: "abcdefgh.abcdefgh.abcdefgh", id_token: "fixture-id-token", account_id: "fixture-acceptance", refresh_token: "acceptance-refresh-must-not-copy" } }), { mode: 0o600 });
  return { HOME: home, CODEX_HOME: codexHome, CREW_CODEX_BIN: join(root, "tests/fixture/codex-account.mjs") };
}

/** The staffing discussion for <project> × <workflow>, every role on the fixture Codex account, then the confirmation card
 *  answered. api(path, body?) → { status, body } against the server with the session. */
export async function approveStaffing(api, project, workflow) {
  const version = (await api(`/api/wf/${workflow}`)).body.def.version, target = { project, workflow, version };
  let r = (await api(`/api/intake/staffing?project=${project}&workflow=${workflow}&version=${version}`)).body; if (r.error) throw new Error("staffing interview: " + r.error);
  const roles = [...new Set((r.frontier ?? []).map((q) => q.role))];
  for (const [field, value] of [["provider", "codex"], ["model", "fixture-model"], ["effort", "low"]]) { const a = await api("/api/intake/staffing", { ...target, answers: Object.fromEntries(roles.map((id) => [id, { [field]: value }])) }); if (a.status !== 200 || a.body.error) throw new Error(`staffing ${field}: ${a.status} ${a.body.error ?? ""}`); r = a.body; }
  const conf = await api("/api/intake/staffing", { ...target, roles: r.choices, confirm: true }); if (!conf.body.proposal) throw new Error("staffing confirmation: " + JSON.stringify(conf.body).slice(0, 300));
  for (let i = 0; i < 200; i++) { const card = (await api("/api/scards")).body.cards?.find((c) => c.run === conf.body.proposal); if (card) { await api(`/api/scards/${card.id}/answer`, { choice: "approve" }); break; } await new Promise((res) => setTimeout(res, 100)); }
  for (let i = 0; i < 200; i++) { if ((await api(`/api/wruns/${conf.body.proposal}`)).body.status === "succeeded") return conf.body.proposal; await new Promise((res) => setTimeout(res, 100)); }
  throw new Error("staffing approval did not finish");
}
