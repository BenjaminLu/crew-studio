// Routing by deliverable: what the captain asks to receive decides the workflow, never a business word
// in the request. A bean-curd shop's website is a website, not a startup pitch (R-045).
export type Deliverable = "web" | "document" | "video" | "image";
const WORDS: [Deliverable, RegExp][] = [
  ["web", /\b(?:web ?sites?|web ?pages?|landing pages?|home ?pages?|web ?apps?)\b|網站|网站|網頁|网页|官網|官网|首頁|首页|落地頁|落地页/i],
  ["video", /\b(?:videos?|films?|trailers?)\b|影片|視頻|视频|短片/i],
  ["document", /\b(?:documents?|reports?|articles?|essays?|memos?|handbooks?|newsletters?)\b|文件|文檔|文档|報告|报告|文章|手冊|手册/i],
  ["image", /\b(?:images?|pictures?|illustrations?|posters?)\b|圖片|图片|插圖|插图|海報|海报/i],
];
/** The one deliverable a request names, or null when it names none or several (then nothing is routed by deliverable). */
export function deliverableOf(text: string): Deliverable | null {
  const found = WORDS.filter(([, re]) => re.test(String(text ?? ""))).map(([d]) => d);
  return found.length === 1 ? found[0] : null;
}
/** The shipped workflow that makes each deliverable. */
export const DELIVERABLE_WORKFLOW: Record<Deliverable, string> = { web: "web-prototype", document: "documents", video: "video", image: "images" };
/** What a workflow of each kind hands the captain, as Firstmate's chooser reads it. */
const BY_KIND: Record<string, string> = {
  web: "a website, landing page or web app (index.html)",
  doc: "a written document (Markdown with HTML, DOCX and PDF exports)",
  video: "a short film (MP4)",
  image: "one image (PNG)",
  code: "code changes in a registered repository",
  "startup-recursion": "a startup competition pitch, text only (never a website, page or code)",
  files: "a folder tidied in place",
  "coffee-kit": "a coffee shop kit: page, image and video",
  lane: "an approved image merged into a local README",
};
export const deliverableOfKind = (kind: string | undefined): string | null => (kind && Object.hasOwn(BY_KIND, kind) ? BY_KIND[kind] : null);

// Routing a captain's request (live E2E S3): "幫我寫一份文件…" made Firstmate write the document itself in its
// workspace, with no writer, checks, acceptance, Library or exports. A request for a deliverable becomes a proposal
// on the workflow that makes it; Firstmate works hands-on only when the captain explicitly asks it to.
/** What the captain can ask to receive, in their words, and the workflow kind that makes it (Firstmate's routing table). */
export const DELIVERABLE_ROUTES: { asks: string; kind: string }[] = [
  { asks: "a document, report or article", kind: "doc" },
  { asks: "a website, landing page or web app", kind: "web" },
  { asks: "an image, picture or poster", kind: "image" },
  { asks: "a video or short film", kind: "video" },
  { asks: "a code change in a registered repository", kind: "code" },
  { asks: "a folder of files organised", kind: "files" },
];
const KIND_OF: Record<Deliverable, string> = { web: "web", document: "doc", video: "video", image: "image" };
const FILES = /\b(?:organi[sz]e|tidy|sort|clean up)\b[^.\n]{0,40}\b(?:folders?|files|director(?:y|ies)|downloads)\b|(?:整理|分類|歸檔|整頓)[^。\n]{0,20}(?:資料夾|文件夾|檔案|文件)/i;
/** The captain explicitly asks Firstmate to do the work itself, or to skip the workflow. */
export const HANDS_ON = /\b(?:do it yourself|yourself|by hand|hands-on|without (?:a |the )?workflow|no workflow)\b|你自己|親自|自己(?:寫|做|改|動手)|你直接(?:寫|做|改)|不用(?:走)?(?:workflow|流程|工作流程)|不要(?:走)?(?:workflow|流程|工作流程)|別走(?:workflow|流程)/i;
/** Every deliverable kind a request names (workflow kinds, in the order of DELIVERABLE_ROUTES); tidying a folder is not a document. */
export function deliverableKinds(text: string): string[] {
  const t = String(text ?? ""), files = FILES.test(t);
  const found = new Set<string>(WORDS.filter(([d, re]) => re.test(d === "document" && files ? t.replace(new RegExp(FILES.source, "gi"), "") : t)).map(([d]) => KIND_OF[d]));
  if (files) found.add("files");
  return DELIVERABLE_ROUTES.map((r) => r.kind).filter((k) => found.has(k));
}
// Naming a deliverable is not asking for one: "explain this document", 「這份報告寫了什麼？」, 「那個影片任務進度如何」 read,
// explain or ask about one. A turn routes only when it asks to make, write, produce, draft or dispatch something new.
const MAKE = /\b(?:make|create|write|draft|produce|build|design|generate|render|draw|shoot|compose|prepare|dispatch|organi[sz]e|tidy|sort|clean up|put together)\b|寫|做|製作|產出|生成|畫|拍|剪輯|設計|建立|派|起草|撰寫|產生|整理|弄一?[個份張支]/i;
/** Phrases about what exists (what it says, what a task made): their verb is not a request to make. */
const ABOUT = /\bdid\b[^?.!\n]*\b(?:make|create|write|produce|build|generate)\b|\b(?:made|written|created|produced|built|generated)\b|(?:寫|做|講|說)了(?:什麼|甚麼|啥|哪些)|在(?:講|說|寫)什麼/gi;
/** Reading, explaining, summarising, or asking about progress: no request to make, unless the turn also says to make one. */
const ASK = /\b(?:explain|summari[sz]e|summary|read|translate|review|look at|check|what(?:'s| is) in|progress|status)\b|看一下|看看|解釋|摘要|總結|翻譯|進度|狀態|有哪些/i;
/** Asking to be given something new: 「給我一張海報」, 「我想要一支短片」, "I need a landing page", "can I get a poster". */
const WANT = /(?:給我|我想要|我要|需要)(?:一|兩|幾|\d+)?\s*[個份張支部篇段套組]|\b(?:I (?:want|need|'d like)|give me|can I (?:get|have))\s+(?:a|an|some|\d+|new|another)\b(?!\s+(?:summary|explanation|update|status|look)\b)/i;
const IMPERATIVE = /\b(?:make|create|write|draft|produce|build|design|generate)\b\s+(?:me\s+|us\s+)?(?:a|an|the|new|some|another|\d)\b|(?:幫我|幫忙|請|再|來|要)(?:寫|做|製作|產出|生成|畫|拍|設計|建立|派|起草|撰寫|整理)|^\s*(?:寫|做|製作|產出|生成|畫|設計|建立|派)|派[一二三四五六七八九十兩\d]+個/i;
/** The captain asks to make something new (not to read, explain or check on something that exists). */
export function asksToMake(text: string): boolean {
  const t = String(text ?? "");
  if (!MAKE.test(t.replace(ABOUT, " ")) && !WANT.test(t)) return false;
  return !ASK.test(t) || IMPERATIVE.test(t);
}
/** The deliverables a captain turn asks for, each with the installed workflow that makes it; none when the captain asked for hands-on work. */
export function routeRequest(text: string, workflowOf: (kind: string) => string | null): { asks: string; kind: string; workflow: string }[] {
  if (HANDS_ON.test(String(text ?? "")) || !asksToMake(text)) return [];
  return deliverableKinds(text).flatMap((kind) => { const workflow = workflowOf(kind), asks = DELIVERABLE_ROUTES.find((r) => r.kind === kind)!.asks; return workflow ? [{ asks, kind, workflow }] : []; });
}
/** A file a deliverable workflow makes (a document, a page, an image, a film): Firstmate writing one itself for a routed request is the S3 slip. */
export const DELIVERABLE_FILE = /\.(?:md|markdown|docx?|pdf|html?|png|jpe?g|webp|gif|svg|mp4|mov|webm)\b/i;
