# Studio cards in the Inbox

R-002's cards only showed on the run page; the captain had to look for them there.

Done when (`tests/runtime-ui.mjs`; red on 0163ed2, where #/inbox lists only firstmate cards):
1. An open Studio card shows in #/inbox beside firstmate's cards, labelled with its run (a link), workflow and node, and the sidebar Inbox count includes it. — "a Studio card shows in the Inbox labelled with its run, workflow and node, and the sidebar Inbox count includes it".
2. It is answered there with the same buttons; it then leaves the Inbox and the count drops. — "answered from the Inbox: the card leaves it and the count drops".
3. The one-way door confirmation works there too: without the tick the answer is refused, with it the answer goes. — "a one-way Studio card in the Inbox refuses an answer without the door tick …".
4. At 390, light and dark, the Inbox with a Studio card has no sideways scroll. — "the Inbox with a Studio card renders at 390 …".
Takeover area: two small edits in public/app.js (updateNav adds Studio's open cards to the count; viewInbox renders Studio's section from public/runtime.js).
