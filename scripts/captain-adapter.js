// The imported renderer only receives Crew Studio's read-only skin contract.
import { BoardSource } from './board-source.js';
const source = new BoardSource();
window.__voyageLive = source;
let snapshot = { tasks: [], crew: [], pending: [] };
const recent = [], outcomes = [], seen = new Set();
const stage = status => ({succeeded:'merged', done:'merged', cancelled:'closed', failed:'gate', 'needs-you':'captain', running:'working', idle:'queued'})[status] || status;
const bubbles = new Map();
const mateId = root => `firstmate:${root}`;
// Canvas pennants are compact identifiers; full task titles stay in crew details.
const crewLabel = value => {
  const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim());
  return chars.length > 20 ? chars.slice(0, 19).join('') + '…' : chars.join('');
};
const terminal = t => ['merged', 'closed', 'parked'].includes(stage(t.status));
function update() {
  document.documentElement.lang = snapshot.lang || 'en';
  const roots = new Map(snapshot.tasks.map(t => [t.id, t.rootTask || t.id]));
  const groups = new Map();
  for (const t of snapshot.tasks) {
    if (terminal(t) && !snapshot.pending.some(c => c.task === t.id)) continue;
    const root = roots.get(t.id);
    if (!groups.has(root)) groups.set(root, { task:t, title:snapshot.tasks.find(p => p.id === root)?.title || t.title, cards:[] });
  }
  for (const c of snapshot.pending) {
    const root = roots.get(c.task) || c.task || c.id;
    if (!groups.has(root)) groups.set(root, {task:{id:c.task, title:c.title}, title:c.title, cards:[]});
    groups.get(root).cards.push(c);
  }
  const mates = [...groups].map(([root, g]) => ({id:mateId(root), crew_name:crewLabel(root),
    role:'firstmate', task:g.task.id, state:g.cards.length ? 'waiting' : 'working'}));
  source.accept({ default_project: 'studio',
    tasks: snapshot.tasks.map(t => ({...t, stage:stage(t.status), actions:[]})),
    crew: [...mates, ...snapshot.crew.filter(c => c.role !== 'firstmate').map(c => ({...c, id:c.name, crew_name:crewLabel(c.name), state:c.alive ? 'working' : 'idle'}))],
    pending: snapshot.pending.map(c => ({...c, answerable:false})), recent, outcomes });
  const cards = document.getElementById('captain-cards');
  const zh = snapshot.lang?.startsWith('zh');
  for (const [root, el] of bubbles) if (!groups.get(root)?.cards.length) { el.remove(); bubbles.delete(root); }
  for (const [root, g] of groups) {
    if (!g.cards.length) continue;
    let el = bubbles.get(root);
    if (!el) {
      el = document.createElement('section'); el.className = 'mate-speech'; el.dataset.mate = mateId(root);
      cards.append(el); bubbles.set(root, el);
    }
    const signature = JSON.stringify([snapshot.lang, g.title, g.cards.map(c=>[c.id,c.title])]);
    if(el.dataset.content === signature) continue; // preserve keyboard focus across snapshots
    el.dataset.content = signature;
    const label = document.createElement('strong'); label.textContent = zh ? '船長，需要你的 input' : 'Captain, your input is needed';
    const task = document.createElement('small'); task.textContent = g.title || g.task.id; task.title = task.textContent;
    el.replaceChildren(label, task, ...g.cards.map(c => {
      const button = document.createElement('button'); button.textContent = c.title || c.id;
      button.dataset.card = c.id; button.onclick = () => CrewSkin.openCard(c.id); return button;
    }));
  }
}
// Called after the renderer updates its camera: bubbles follow their firstmate's head.
source.placeInputs = crewAt => {
  const placed = [];
  for (const el of bubbles.values()) {
    const at = crewAt(el.dataset.mate);
    if (!at) { el.hidden = true; continue; }
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = Math.max(12, Math.min(innerWidth - w - 12, at[0] - w/2));
    let y = Math.max(12, Math.min(innerHeight - h - 24, at[1] - h - 22));
    for (const p of placed) if (x < p.x+p.w+8 && x+w+8 > p.x && y < p.y+p.h+8 && y+h+8 > p.y) y = Math.max(12, p.y-h-12);
    el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    el.style.setProperty('--tail', `${Math.max(18, Math.min(w-24, at[0]-x))}px`);
    placed.push({x,y,w,h});
  }
};
// No decision answers or task mutations are exposed by this skin.
source.command = async c => {
  if(c.type === 'answer' && snapshot.pending.some(d => d.id === c.decision)) CrewSkin.openCard(c.decision);
  return {error:true,code:'actionFailed'};
};
CrewSkin.onSnapshot(s => {
  for(const t of s.tasks) {
    const prior = snapshot.tasks.find(p => p.id === t.id);
    if(prior && stage(prior.status) !== 'merged' && stage(t.status) === 'merged') {
      outcomes.push({type:'merged',task:t.id,ts:s.at,identity:`completed:${t.id}:${s.at}`});
      if(outcomes.length > 100) outcomes.shift();
    }
  }
  snapshot = s; update();
});
CrewSkin.onEvent(e => {
  const id = e.seq ?? JSON.stringify(e);
  if(seen.has(id)) return;
  seen.add(id); if(seen.size > 512) seen.delete(seen.values().next().value);
  // The host omits review-outcome payloads; do not infer review rejection.
  recent.unshift(e); if(recent.length > 100) recent.pop();
  if(e.type === 'merged') { outcomes.push(e); if(outcomes.length > 100) outcomes.shift(); }
  update();
});
const ready = setInterval(() => {
  if(window.__G?.ready) { clearInterval(ready); CrewSkin.ready(); }
}, 25);
addEventListener('pagehide', () => {clearInterval(ready);source.close();}, {once:true});
