# Unit locators: M3's human annotations on the shared locator schema

What: every M3 note (a web pin, a timeline range with an optional box, a document block) is stored with a locator in the schema of docs/check-contract.md, and a version's notes can be read as findings of the same type a check produces.

Why: architecture §1.4 — check findings and human annotations share one locator schema, so an agent acts on both alike.

Done when (each line is proved by `tests/locators.ts`, red on the base: notes there carry no locator and the store has no `findings`):

1. A web pin is stored with `{type: web, url, selector, x, y, w, h, viewport}`. — "a web pin is stored with a web locator …".
2. A timeline range with a box is stored with `{type: timeline, from, to, bbox}`. — "a timeline range with a box is stored with a timeline locator …".
3. A document block note is stored with `{type: text, section}`. — "a document block note is stored with a text locator".
4. A note saved before locators existed gets one when it is read. — "a note saved before locators existed gets one on read".
5. `ArtifactStore.findings()` and `GET /api/artifacts/<id>/v/<n>/findings` return open notes as findings with exactly the fields of a check finding (locator, message, expected, class, severity, source, check); they pass the same locator validation and print the same way. — "a version's notes come out as findings …", "a human finding passes the same locator validation …", "both print the same way in a brief", "resolved notes leave the open findings", "GET /api/artifacts/<id>/v/<n>/findings …".
6. A review room's questions on its lesson board are stored with `{type: text, section}`, the section the place's stable key (chapter / scene / board item # part), and `GET /api/review-room/<room>/findings` returns the open ones as findings of the same fields (class `captain-question`, source human). — review-room-board "each anchor is stored as a text locator …", "the room's open questions read as findings …".
