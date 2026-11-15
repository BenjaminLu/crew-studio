// A fake Slack Web API for the Pull requests unit's Slack bot (docs/units/pr-watch.md "Sending"), in-process on loopback:
// users.info, conversations.open and chat.postMessage only, answered for the members a test puts in `users`. Every
// request is recorded in `calls` (with its Authorization header and the address asked); `posted` keeps each message;
// `errors` makes users.info answer an error for a member. Every name and id is invented. Nothing reaches a real Slack.
export type FakeUser = { id: string; team_id: string; name: string; real_name?: string; deleted?: boolean; is_bot?: boolean; is_stranger?: boolean; profile?: { real_name?: string; display_name?: string } };
export function fakeSlack(token: string) {
  const users = new Map<string, FakeUser>(), errors = new Map<string, string>();
  const calls: { method: string; path: string; url: string; auth: string | null; body: any }[] = [], posted: { channel: string; text: string }[] = [];
  const out = (v: unknown) => Response.json(v);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const u = new URL(req.url), auth = req.headers.get("authorization"); let body: any = null;
    if (req.method === "POST") { try { body = await req.json(); } catch {} }
    calls.push({ method: req.method, path: u.pathname, url: req.url, auth, body });
    if (auth !== `Bearer ${token}`) return out({ ok: false, error: "invalid_auth" });
    if (u.pathname === "/users.info" && req.method === "GET") { const id = u.searchParams.get("user") ?? "";
      if (errors.has(id)) return out({ ok: false, error: errors.get(id) });
      const m = users.get(id); return m ? out({ ok: true, user: structuredClone(m) }) : out({ ok: false, error: "user_not_found" }); }
    if (u.pathname === "/conversations.open" && req.method === "POST") { const id = String(body?.users ?? "");
      return users.has(id) ? out({ ok: true, channel: { id: `D${id.slice(1)}` } }) : out({ ok: false, error: "user_not_found" }); }
    if (u.pathname === "/chat.postMessage" && req.method === "POST") { posted.push({ channel: String(body?.channel), text: String(body?.text) }); return out({ ok: true, ts: "1.0" }); }
    return out({ ok: false, error: "unknown_method" });
  } });
  return { origin: `http://127.0.0.1:${server.port}`, users, errors, calls, posted, stop: () => server.stop(true) };
}
