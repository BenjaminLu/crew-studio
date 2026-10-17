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
