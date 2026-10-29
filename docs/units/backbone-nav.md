# Unit backbone-nav: the backbone sidebar, labs, roadmap

What: the sidebar shows exactly the six backbone pages (Firstmate, Inbox, Crew, Runs, Workflows, Library) and a gear for Settings. Everything else is a lab behind a flag, listed on a Roadmap page.

Why: the captain asked to focus the layout on the backbone (2026-10-14). The labs code stays.

Done when (each line is proved by `tests/backbone-ui.mjs`, which does not exist on the base, so every line is red there):

1. The sidebar has exactly Firstmate, Inbox, Crew, Runs, Workflows, Library, in this order, at 1440 and 390 px, light and dark. — "the sidebar has exactly the six backbone items at …".
2. A gear at the sidebar foot opens Settings (Doctor, phone pairing, Roadmap, Show labs). — "the gear is at the sidebar foot …", "settings holds Doctor, pairing, roadmap and the labs switch".
3. Labs items are out of the sidebar without the flag; Show labs (Settings) or `?labs=1` brings them back and their pages work. — "labs items are out of the sidebar without the flag …", "Show labs puts the labs items back in the sidebar", "with labs on, a labs route shows its page", "?labs=1 turns labs on".
4. A deep link to a labs route without the flag shows "This is on the roadmap" with a link to enable labs, never a 404 (improve, retro, skill, packs, pack-draft, fileorg, docs, doc, skins, changes, change, gates, remote). — "#/<route> without labs shows the roadmap panel, not a 404".
5. The Roadmap page lists each planned item with its milestone, marked planned. — "the roadmap lists 7 planned items".
6. Home is the Inbox (it also lists captured intents); no sideways scroll; no page errors. — "home is the inbox at …", "no sideways scroll at …", "no page errors".

The existing UI suites turn labs on before visiting labs pages; their assertions are unchanged.
Note for the takeover branch: public/index.html gains one stylesheet and one script line; app.js, inbox and crew code are untouched (the inbox list of intents is appended by public/backbone.js).

Later (2026-10-29, feat/terminal-focus): the sidebar gained Terminals right after Firstmate (its own icon, in the full sidebar and the 64 px rail), so the backbone is Board, Firstmate, Terminals, Inbox, Crew, Tasks, Workflows, Skills, Library. `#/terminals` no longer lights Firstmate; its "waiting for you" count moved to the Terminals item (docs/units/web-terminal.md, "Focus mode").
