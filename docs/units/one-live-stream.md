# Unit one-live-stream: a page holds one event stream

What: every page module listens on the page's one event stream, app.js's, through `window.liveListen(type, fn)`; no module opens an `EventSource` of its own (before: app.js, m25.js, takeover.js, runtime.js and, with a skin showing, skins.js each held one).

Why: a browser keeps at most 6 HTTP/1.1 connections per host. Each extra stream held one for good, so with two pages open a plain request (the Documents page's `/api/docs`) waited for a free connection: the class behind the UI suites that failed only under load (fix-runtime-ui-stream found the first case).

Done when (red on the base):
1. One page, several views and modules open (inbox, crew, runs, workflows, firstmate, settings, library): one request to `/api/stream`. — `tests/backbone-ui.mjs` "the page opens one event stream, with several views and modules open".
2. No module opens its own stream (`tests/runtime-ui.mjs` "the runtime pages listen on the page's one event stream …"); the views that follow live events still do: takeover-ui, smoke (the phone's main session), skins, runtime-ui pass.
3. skins: a snapshot that arrives after pro mode came back is dropped (the `contentWindow` of a removed frame was read after an `await`: the "Cannot read properties of null (reading 'contentWindow')" flake); its listeners, registered once, ignore events while no skin shows.
