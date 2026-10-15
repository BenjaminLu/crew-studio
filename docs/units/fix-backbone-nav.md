# Fix round 1 for [unit:backbone-nav]

Answers backbone-nav#1 (embedded views on a cold load), #2 (the nav observer re-triggering itself), #3 (tests weaker than their lines), #4 (labels computed once; Library is 成品庫), #5 (attention counts on hidden items). #6 (the private path in the test) belongs to legacy class C1.

Done when (each line is proved by `tests/backbone-ui.mjs`; the new assertions are red on the base):

1. An embedded view waits for its own data and the host re-renders when it arrives: the Inbox lists captured intents on a cold load; Crew shows the activity log on a cold load (activity folds into Crew). — "the inbox lists captured intents on a cold load …", "Crew shows the activity log on a cold load …".
2. A nav item added after load lands in labs and the page stays responsive (the observer disconnects while it rearranges). — "an item added later lands in labs and the page stays responsive".
3. The gear sits in the sidebar foot and opens Settings; Settings holds Doctor, Phone pairing, Roadmap and Show labs; each labs deep link shows the roadmap panel with its text, milestone and a Show labs button that renders the real page; unticking hides labs again; each roadmap row has its milestone and description; `?labs=1` renders the labs page. — "the gear is at the sidebar foot …", "clicking the gear opens Settings", "settings holds …", "#/<route> without labs shows the roadmap panel (text, milestone, Show labs) …", "the panel's Show labs renders the real page …", "unticking Show labs …", "the roadmap lists each planned item with its milestone …", "?labs=1 turns labs on and the labs page renders".
4. Switching to zh-TW relabels the backbone items and the gear; Library reads 成品庫. — "switching to zh-TW relabels the backbone items and the gear".
5. Attention counts sit on backbone items: open intents on Inbox, the Doctor's count on the gear (the cards count was already on Inbox). — "the attention counts sit on the backbone …".
