// Phone access (M2.5). Loaded before everything else. A paired phone keeps its
// bearer token in localStorage and every same-origin request carries it: fetch
// gets an Authorization header; EventSource and media sources (which cannot
// set headers) get ?token=. Opening Studio with ?pair=123456 pairs this phone.
(function () {
  const KEY = "crew.remoteToken";
  const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const set = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} };
  const same = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } };
  const withToken = (u) => { const t = get(); if (!t || !same(u)) return u; const x = new URL(u, location.href); x.searchParams.set("token", t); return x.pathname + x.search + x.hash; };
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const t = get(), url = typeof input === "string" ? input : input?.url;
    if (t && url && same(url)) { const hd = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined)); hd.set("authorization", `Bearer ${t}`); init = { ...init, headers: hd }; }
    return _fetch(input, init).then((r) => {
      if (r.status === 401 && url && same(url) && !String(url).includes("/api/remote/pair")) {
        r.clone().json().then((b) => { if (b?.code === "pair") { set(null); window.dispatchEvent(new CustomEvent("crew-pair-needed", { detail: b.error })); } }).catch(() => {});
      }
      return r;
    });
  };
  const _ES = window.EventSource;
  window.EventSource = function (u, o) { return new _ES(withToken(u), o); };
  window.EventSource.prototype = _ES.prototype;
  const _set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) { if (k === "src" && typeof v === "string" && /^\/(files|af)\/|^\/api\/(artifacts|lane)\//.test(v)) v = withToken(v); return _set.call(this, k, v); };
  window.crewRemote = { token: get, set, withToken,
    async pair(code, name) {
      const r = await _fetch("/api/remote/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.token) { set(b.token); return { ok: true, device: b.device }; }
      return { ok: false, error: b.error || `HTTP ${r.status}` };
    } };
  const q = new URLSearchParams(location.search);
  const code = q.get("pair");
  if (code) {
    q.delete("pair");
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
    window.crewRemote.pairing = window.crewRemote.pair(code, (navigator.userAgentData?.platform || navigator.platform || "phone").slice(0, 30))
      .then((r) => { if (r.ok) location.reload(); else window.dispatchEvent(new CustomEvent("crew-pair-needed", { detail: r.error })); return r; });
  }
})();
