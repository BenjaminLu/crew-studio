// Crew Studio skin kit: the whole skin API. A skin runs in a sandboxed iframe
// (no same-origin, no network by default). It gets a read-only snapshot and
// event hooks from the host, and may only ask the host to OPEN a card: it can
// never answer one, and anything else it posts is ignored and counted.
//   CrewSkin.onSnapshot(fn)   fn(snapshot): {tasks, crew, pending, flow, permissions, lang, theme, at}
//   CrewSkin.onEvent(fn)      fn(event): {seq, ts, type, task, actor, summary}   (needs the "events" permission)
//   CrewSkin.openCard(id)     ask the host to show card <id> in pro mode         (needs the "openCard" permission)
//   CrewSkin.ready()          tell the host the skin is up (it falls back to pro mode if you never do)
(() => {
  const snap = [], ev = [];
  let last = null;
  addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (m.type === "crew:snapshot") { last = m.snapshot; for (const f of snap) try { f(m.snapshot); } catch (err) { console.error(err); } }
    if (m.type === "crew:event") for (const f of ev) try { f(m.event); } catch (err) { console.error(err); }
  });
  window.CrewSkin = {
    onSnapshot(fn) { snap.push(fn); if (last) fn(last); },
    onEvent(fn) { ev.push(fn); },
    openCard(id) { parent.postMessage({ type: "crew:openCard", id: String(id) }, "*"); },
    ready() { parent.postMessage({ type: "crew:ready", version: 1 }, "*"); },
    get snapshot() { return last; },
  };
})();
