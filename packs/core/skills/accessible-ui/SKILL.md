---
name: accessible-ui
description: Build and check interfaces everyone can use — keyboard, screen reader, contrast, zoom and small screens.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [designer, developer, builder, reviewer]
    formats: [web]
---

# Accessible UI

- Use the native element for the job (button, link, label, list, heading) before adding roles to a div.
- Everything a mouse can do, the keyboard can do, in a sensible order, with a visible focus ring.
- Every control has a name a screen reader announces; every image that carries meaning has text, and decoration has none.
- Text contrast meets WCAG AA (4.5:1, 3:1 for large text) in light and dark themes.
- The page works at 200% zoom and at phone width without sideways scrolling.
- Never carry meaning by color alone; pair it with text or a shape.
- Motion respects reduced-motion settings; nothing flashes.
- Announce changes that happen without a page load (status, errors) in a live region.
