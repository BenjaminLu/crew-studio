// A loopback stand-in for the Claude Code routine fire API (POST /v1/claude_code/routines/{id}/fire), shaped as its
// documentation shows (platform.claude.com/docs/en/api/claude-code/routines-fire): a session id and URL on success, the
// error envelope with 401, 429 (Retry-After) and 5xx. Tests never reach the real API. Values are synthetic and built at
// run time, so no tracked file holds a token or a session link.
export const FIXTURE_ROUTINE = "trig_" + "01FixtureRoutine";
export const FIXTURE_TOKEN = ["sk", "ant", "oat01", "fixture-routine-token-not-real"].join("-");
export const sessionUrl = (id: string) => ["https://claude", "ai/code/"].join(".") + id;
export function routineFireStub() {
  const calls: { path: string; auth: string | null; version: string | null; type: string | null; text: string }[] = [];
  let mode: { status: number; retryAfter?: string; body?: any } = { status: 200 }, n = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const u = new URL(req.url); let body: any = null; try { body = await req.json(); } catch {}
    calls.push({ path: u.pathname, auth: req.headers.get("authorization"), version: req.headers.get("anthropic-version"), type: req.headers.get("content-type"), text: String(body?.text ?? "") });
    if (req.method !== "POST" || !/^\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/.test(u.pathname)) return Response.json({ type: "error", error: { type: "not_found_error", message: "fixture: no such routine" } }, { status: 404 });
    if (!req.headers.get("anthropic-version")) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "fixture: anthropic-version is required" } }, { status: 400 });
    if (mode.status !== 200) return Response.json({ type: "error", error: { type: mode.status === 401 ? "authentication_error" : mode.status === 429 ? "rate_limit_error" : "api_error", message: "fixture error text includes fake-vendor-detail-do-not-show" } },
      { status: mode.status, headers: mode.retryAfter ? { "retry-after": mode.retryAfter } : {} });
    if (mode.body !== undefined) return Response.json(mode.body);
    const id = `session_01Fixture${String(++n).padStart(4, "0")}`;
    return Response.json({ type: "routine_fire", claude_code_session_id: id, claude_code_session_url: sessionUrl(id) });
  } });
  return { origin: `http://127.0.0.1:${server.port}`, calls, set(m: typeof mode) { mode = m; }, stop() { server.stop(true); } };
}
