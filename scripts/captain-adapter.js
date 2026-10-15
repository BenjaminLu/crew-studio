// The imported renderer only receives Crew Studio's read-only skin contract.
import { BoardSource } from './board-source.js';
const source = new BoardSource();
window.__voyageLive = source;
let snapshot = { tasks: [], crew: [], pending: [] };
const recent = [], outcomes = [], seen = new Set();
const stage = status => ({succeeded:'merged', done:'merged', cancelled:'closed', failed:'gate', 'needs-you':'captain', running:'working', idle:'queued'})[status] || status;
function update() {
  document.documentElement.lang = snapshot.lang || 'en';
  source.accept({ default_project: 'studio',
    tasks: snapshot.tasks.map(t => ({...t, stage:stage(t.status), actions:[]})),
    crew: snapshot.crew.map(c => ({...c, id:c.name, crew_name:c.name, state:c.alive ? 'working' : 'idle'})),
    pending: snapshot.pending.map(c => ({...c, answerable:false})), recent, outcomes });
  const cards = document.getElementById('captain-cards');
  cards.replaceChildren(...snapshot.pending.map(c => {
    const button = document.createElement('button'); button.textContent = c.title || c.id;
    button.onclick = () => CrewSkin.openCard(c.id); return button;
  }));
}
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
