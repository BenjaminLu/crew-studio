# Fix: the runtime pages open no event stream of their own

Found by the clean-tree run of 1caf84b: `tests/backbone-ui.mjs` "?labs=1 …" failed about two runs in five, alone too. The Documents page stayed on its skeleton: its `/api/docs` request never left the browser. A browser keeps at most 6 HTTP/1.1 connections per host; every page already holds Studio's event streams (app.js, takeover.js), and `public/runtime.js` (unit code-firstmate-smoke) opened one more per page, so with two pages open a plain request waited for a free connection.

Now `public/runtime.js` listens on the page's one stream: app.js forwards `wrun` and `scard` events to `window.onLive`. — `tests/backbone-ui.mjs` "?labs=1 …" (5 of 5 green after, about 3 of 5 before; it now also waits on what it asserts, not a fixed 500 ms), `tests/runtime-ui.mjs` "the runtime pages listen on the page's one event stream …" and its live-overlay and run-view lines.

Still open (the flaky-suite class, after the first real run): `public/takeover.js`, `public/m25.js` and `public/skins.js` each open their own stream too.
