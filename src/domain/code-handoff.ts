import type {SCard} from '../runtime/cards';
import {localUnrestricted} from '../local-execution';
/** Read-only guidance for existing cards; never changes answers, authority or routes. */
export function codeHandoffView(card:SCard):SCard {
 if(card.workflow!=='code-firstmate'||card.node!=='scope-card'||card.kind!=='scope'||card.status!=='open')return card;
 const overlap=/scope-overlap|overlaps R-\d+/.test(card.body);
 const environment=/repo\.lint|gates\.json|ci-config|check-error|no test command|installing.*dependencies/i.test(card.body);
 const why=environment
  ? ['Execution configuration is blocking the worker. This is not a request to restate the product requirement.','執行設定阻擋了 worker；目前不是要你重述產品需求。']
  : overlap?['The proposed scope conflicts with another task or omits required callers. The implementation has not been approved to proceed.','規格範圍與另一任務衝突，或缺少必要引用檔案；實作尚未獲准繼續。']
  :['The worker needs a concrete scope decision before it can proceed.','worker 需要具體的範圍決策，才能繼續。'];
 const execution=environment && localUnrestricted()
  ? ['in local unrestricted mode (OS sandbox and outbound-network restrictions are disabled; dependency installation remains limited to the operator-configured directory)', '於本機 unrestricted 模式下（OS sandbox 與對外網路限制已停用；依賴安裝仍限於操作員設定的目錄）']
  : ['under the current sandbox policy','在現有 sandbox 限制下'];
 const how=environment
  ? [`Coordinator: repair the declared lint/test setup and verify it ${execution[0]}. Task scope, captain approvals, repository identity, signed ledger and artifact validation remain enforced. Captain: only approve a concrete scope revision if those repairs need additional files. Rescope rewrites the spec; it does not retry the build. Park closes this run without merging.`,`處理責任：coordinator 先修 lint/test 設定並${execution[1]}驗證。任務範圍、captain 核准、儲存庫身分、簽署帳本與產物驗證仍須遵守。若需要額外修改檔案，再由 captain 核准具體範圍。Rescope 會重寫 spec，不是重試 build；Park 會結束這次 run，且不合併。`]
  :['Coordinator: list the exact changed files and conflicting task, then narrow the change or sequence the tasks. Captain: enter that concrete decision in the note before Rescope. Repeating the requirement does not resolve a conflict. Park closes this run without merging.','處理責任：coordinator 列出實際要改的檔案與衝突任務，提出縮小範圍或先後順序。Captain 在備註填寫該具體決策後再 Rescope；重述需求不會解除衝突。Park 會結束這次 run，且不合併。'];
 return {...card,sections:{...card.sections,en:{...card.sections.en,why:why[0],how:how[0]},'zh-TW':{...card.sections['zh-TW'],why:why[1],how:how[1]}},options:card.options.map(o=>o.id==='rescope'?{...o,labelZh:'送交範圍修訂（填寫具體變更）'}:o.id==='park'?{...o,labelZh:'結束本次執行（擱置）'}:o)};
}
