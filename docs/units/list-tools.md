# Unit: list-tools — one search, filter and paging toolbar for every list page

Every list page in the sidebar has the same toolbar above its rows: Tasks, Workflows, Skills, Projects, Crew, Terminals,
Library, Review room and Activity. One component draws it (`public/list-tools.js`, styles in `public/list-tools.css`);
a page hands it its rows and how to read them and gets back one element: the toolbar, the page of rows (drawn by the
page's own row function) and the paging footer.

## What the captain gets

- **Search** (`type=search`, a magnifier, a `/` hint) filters as they type over the page's text. Chinese matches in either
  script: the query and the text both go through `crewI18n.toCN` (opencc-js). OpenCC converts phrases as well as characters
  (Taiwan 軟體 becomes Mainland 软件), so a word typed in the other region's vocabulary (软体) does not find it. The first free word is marked
  (`mark.lt-mark`) in each row's title.
- **`key:value` words** in the box filter a facet; the value matches from its start, as stored or as the page shows it
  (`status:waiting`, `status:等你`). A value with spaces goes in double quotes. Typing `key:` lists that facet's values
  with their counts; a key's first letters list the keys. Picking a value writes its stored form (`status:waiting`), so a
  shared link reads the same in every language. A word whose key is not a facet is a free word.
- **Facet buttons** open a popover of checkboxes. Each count is the rows left if that box is ticked as well, with every
  other filter applied. More than six values: the popover has its own search. Clear / Done; Escape or a click outside
  closes it. A button with a selection is primary and says how many (`Status · 2`). An open popover is moved left as far
  as it must to stay inside the page (the last facet's would run off the right edge). A facet no row has a value for is
  not offered.
- **Sort**, per page.
- **The active line**: `N of M match` (`M 條中 N 條符合`), or `N in the last 30 days`, or `N in all`; a removable chip per
  ticked value; Clear all.
- **Paging**: `a–b of N`, `‹ 1 … n ›`, 25 / 50 / 100 a page (the size is remembered per page). Any filter change goes back
  to page 1.
- **Empty**: a card that says why (nothing in the last 30 days but N older, or try another word) and Clear search and
  filters. A page with no rows at all keeps its own empty state.
- **The URL** keeps the state in the hash's query (`#/runs?q=fix&status=waiting&page=2`): back, reload and a shared link
  keep it. A change replaces the history entry. Parameters the toolbar does not own stay.
- **Keys**: `/` focuses the search (never while typing in another field or composing); Escape closes the suggestions,
  then clears. The `/` hint gives way to the field's own clear button once something is typed.

## Input methods

Chinese is typed through an input method, so the search box is built around its composition:

- Nothing filters, asks the server, redraws, replaces or moves the box while a composition is active
  (`compositionstart` … `compositionend`); input events with `isComposing` (or keyCode 229) are ignored. The list filters
  once, on `compositionend`, with the committed text. The facet popover's own search does the same.
- Enter, Escape and the arrow keys during a composition belong to the input method: no suggestion is picked, nothing is
  cleared.
- The toolbar is never redrawn while the focus is anywhere in it (the box, a suggestion picked with ↓, a facet's
  popover): `render()` (public/app.js) waits until the focus leaves the toolbar; live rows go in place
  (`crewListTools.feed`, `root.ltItems`); a terminal never takes the focus from it. Value, focus, selection and an active
  composition survive.
- A waiting redraw never runs against another page: once the address names a different route (a sidebar click before
  its hashchange), only route() draws, and a list writes its state only while the address is its own page.
- The composing state belongs to the box: a page left mid-composition (Back, a link: no compositionend) leaves nothing
  stuck, and the page's new box filters normally.

The UI test drives compositions through Chrome's DevTools protocol (`Input.imeSetComposition`, `Input.insertText`):
Pinyin (r → ru → ruan → 软) and Zhuyin-style (ㄖ → ㄖㄨ → ㄖㄨㄢ → ㄖㄨㄢˇ → 軟) on Tasks, Terminals (Launch… open) and
Activity (no request until the commit), and Crew with a live poll landing mid-composition. A real keyboard and input
method were not driven.

A change redraws the toolbar and the rows only. The search box stays the same element, so an input method's composition
in it is never broken; a live update of a page's rows goes in place (`root.ltItems(rows)`) or waits until the field is
left (`soft()` in `public/app.js`).

## Pages

| Page | Facets | Sorts | Notes |
| --- | --- | --- | --- |
| Tasks `#/runs` | status, workflow, project | newest, oldest, title | The last 30 days by default (a Task in flight always shows); "N more older than 30 days are not shown · Include them". Show archived sits in the toolbar's row, right above the list. `#/runs?project=<id>` is the project facet (`/api/wruns` rows carry `project`). The Agent rounds panel follows the filter. |
| Workflows | source (built in / mine) | name, recently changed | Held and trashed workflows keep their own sections. |
| Skills | source, used by a node, workflow | name, recently added | Role skills stay below. |
| Projects | kind, status | name, busiest | |
| Crew `#/crew` | status (was Recent / Working), role, model, project | newest, oldest | The 40-round cap is paging now. |
| Terminals | state, project | recently used, name | The page's list (and the list under Launch… beside the tabs). The jump menu keeps its own search. |
| Library | type, time (was the type and time switches), status, project | newest, title | Artifacts and merged code in one list; a page draws its artifacts as cards and its code as rows. |
| Review room | zone, repository, state | by zone, newest | Under "by zone", a page's rooms are drawn in their zones and repositories, each zone counting all its matches; 封存 is folded unless filtering. The search box keeps `data-room-search`. |
| Activity | type, actor, task | newest, oldest | Filtered and paged by the server; `#/activity/<task>` is the task facet. |

## Lists the server filters

A list the server caps is never filtered over its first rows only:

- **Activity**: `GET /api/activity?page=N&size=…` (`src/activity-list.ts`) filters, counts and pages firstmate's whole
  event log: free words (`q`, both languages of a summary, either Chinese script), exact values (`type=`, `actor=`,
  `task=`) and `key:value` prefixes (`tok.type=` …). Without `page` the endpoint answers as before (an array, at most 500).
- **Agent rounds** on Tasks: `GET /api/node-runs?runs=R-1,R-2` keeps only those runs' rounds before the newest 200, and
  `X-Total-Count` says how many there are; the panel says when it shows the newest 200 of more.

The other lists' endpoints answer every row (`/api/wruns`, `/api/wf`, `/api/skills`, `/api/projects/overview`,
`/api/crew/live`, `/api/terminals`, `/api/artifacts`, `/api/review-room`); the toolbar filters them in the page. The
Library's merged code is what the GitHub sync keeps (its newest 50 merged pull requests, `MERGED_KEPT` in
src/github.ts): when it holds that many, the list says so.

## Tests

- `tests/list-tools.ts`: the pure part (`compute`, `parse`, `suggest`, `pageList`, the query) with the vendored OpenCC.
- `tests/activity-list.ts`: the server's Activity paging.
- `tests/list-tools-ui.mjs`: every page on the real server (rows from the test, Activity from the fixture log), at 1440
  and 390, with screenshots in `tests/out/list-tools`.
