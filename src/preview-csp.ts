// The Content-Security-Policy every artifact preview is served with (src/m3.ts), shared with the web
// interaction smoke (src/render.ts) so the smoke runs a prototype under the exact policy the captain's
// tab does: a sandbox or CSP change that kills a page's controls fails the readiness gate, not the captain.

// The preview sandbox: scripts run in an opaque origin. allow-forms is needed for a form's submit
// event to fire at all (Chromium refuses the submission, and never dispatches the event, without it),
// so a prototype's own submit handler (preventDefault + show a summary) works; form-action 'none'
// below still lets nothing be submitted anywhere. Left off on purpose: allow-same-origin (the page
// could read Studio's storage and call /api), allow-popups and allow-modals (a prototype needs neither).
export const PREVIEW_SANDBOX = "sandbox allow-scripts allow-forms";
// Restrict artifact subresources and API requests to the declared sources.
// Interactive documents have an opaque sandbox origin; CSP does not block self-navigation.
export const CSP = "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
// A page the browser opens as its own tab (or any document that is not one of Studio's own
// frames) runs in an opaque-origin sandbox: its scripts still run and its CSS, images, poster and
// MP4 still load, but it cannot read Studio's storage, script a Studio window, open one, or call
// /api as Studio. Studio's own previews are frames (Sec-Fetch-Dest: iframe) and keep CSP, whose
// frame-ancestors 'self' also refuses a frame inside such a sandboxed page.
export const TAB_CSP = `${PREVIEW_SANDBOX}; ${CSP}`;
export const INTERACTIVE_CSP = `${PREVIEW_SANDBOX}; default-src 'none'; img-src data: blob:; media-src blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;
