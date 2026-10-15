# Crew Studio skin compatibility kit

A skin is a folder with `manifest.json` and an HTML entry. Studio installs it
by copying it and pinning every file by sha256; a file that changes later is
refused (the skin will not load until it is installed again).

## manifest.json

```json
{ "id": "my-skin", "name": "My skin", "version": "1.0.0", "entry": "index.html",
  "description": "…", "permissions": ["snapshot.tasks", "snapshot.crew", "snapshot.pending", "snapshot.flow", "events", "openCard"],
  "network": [] }
```

- `permissions` choose what the snapshot carries and whether events and
  `openCard` are allowed. Nothing else exists: a skin cannot answer a card,
  dispatch, merge or write anything.
- `network` is empty by default: the skin has no network at all (CSP
  `connect-src 'none'`, `img-src 'self' data:`). Origins listed here are allowed
  only when the captain grants them at install.

## The API

Load `/skin/_kit/skin-kit.js` and use `CrewSkin.onSnapshot`, `CrewSkin.onEvent`,
`CrewSkin.openCard(id)` and `CrewSkin.ready()` (call it once you have drawn).
A skin that never calls `ready()` within 5 seconds is closed and Studio returns
to pro mode.

## Rules the checker enforces (Skins → Check)

1. The manifest parses and names an existing entry.
2. Every file still matches its pinned sha256.
3. No file references the network (`http://`, `https://`, `//host`), unless listed and granted.
4. The entry loads the kit and calls `CrewSkin.ready()`.
5. Only known permissions.

## Pro mode always works

The skin runs below Studio's own bar, in an iframe it cannot leave. The
"Pro mode" button, the Escape key, and opening `/#/pro` always switch back.
