// Presentation only: historical cards and run events remain unchanged.
import type { Engine, Run } from './engine';
import type { SCard } from './cards';

function activeHold(run: Run, node: string, getCard: (id: string) => SCard | undefined) {
  const rn = run.nodes[node], hold = rn?.data?.nativeQueueCapability;
  const card = rn?.card ? getCard(rn.card) : undefined;
  if (run.status !== 'waiting' || rn?.waiting !== 'card' || !hold ||
      card?.status !== 'open' || card.run !== run.id || card.node !== node || card.visit !== rn.visits) return null;
  return { hold, card };
}
function staffing(reason: string) { return /staffing|role configuration|角色配置|派工配置/i.test(reason); }
function guidance(run: Run, node: string) {
  const en = `Ask Firstmate to discuss and approve every role configuration, then use studio_change_staffing for task ${run.id}, node ${node}. Approve that configuration card first, then return here and approve fresh preparation. Retrying alone cannot repair missing approval.`;
  const zh = `請在 Firstmate 討論並確認完整角色配置，針對任務 ${run.id}、節點 ${node} 使用 studio_change_staffing 提出配置核准卡。先核准配置，再回到本卡「核准重新準備」。只重試不會補上缺少的核准。`;
  return { en, 'zh-TW': zh };
}
export function readinessNodes(run: Run, getCard: (id: string) => SCard | undefined): Run['nodes'] {
  return Object.fromEntries(Object.entries(run.nodes).map(([id, node]) => {
    const active = activeHold(run, id, getCard);
    if (!active) return [id, node];
    const reason = String(active.hold.reason ?? 'Round readiness requires confirmation');
    const note = run.workflow === 'code-firstmate' && staffing(reason)
      ? `等待角色配置核准 / Staffing approval required. ${guidance(run, id)['zh-TW']} (${reason})`
      : `回合尚未就緒 / Round not ready: ${reason}`;
    return [id, { ...node, note }];
  }));
}
export function installReadinessViews(engine: Engine) {
  const prior = engine.cards.view;
  engine.cards.view = card => {
    const view = prior(card), run = engine.get(card.run);
    const active = run && activeHold(run, card.node, id => engine.cards.get(id));
    if (!run || run.workflow !== 'code-firstmate' || !active || active.card.id !== card.id || !staffing(String(active.hold.reason))) return view;
    const how = guidance(run, card.node);
    const why = { en: `Role configuration approval is missing or no longer valid. ${active.hold.reason}`,
      'zh-TW': '此任務的角色配置尚未核准或已失效；需要針對既有任務核准配置升級，工作尚未開始。' };
    return { ...view, ...(view.detail ? { detail: { ...view.detail, why: [why], how: [how] } } : {}),
      sections: { en: { ...view.sections.en, why: why.en, how: how.en },
        'zh-TW': { ...view.sections['zh-TW'], why: why['zh-TW'], how: how['zh-TW'] } } };
  };
}
