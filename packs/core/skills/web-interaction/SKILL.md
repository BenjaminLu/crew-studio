---
name: web-interaction
description: Make web pages respond honestly — every action gives feedback, keeps the user's input, and recovers from errors.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [designer, developer, builder]
    formats: [web]
---

# Web interaction

- Every action answers within a moment: a pressed state, a busy state, then the result or the reason it failed.
- Never lose what the user typed. A refresh, a failed save or a re-render keeps their input.
- Put an error next to the thing it is about, in words that say what to do next.
- Disable an action only while it cannot work, and say why.
- Destructive actions ask once, or offer undo.
- Empty, loading, error and full states are designed, not left blank.
- Links go somewhere; buttons do something. Do not mix them.
- Touch targets are at least 44 px; nothing depends on hover alone.
- The page stays usable with slow or failed requests.
