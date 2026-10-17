---
name: visual-design-review
description: Judge a page or image against its design direction — hierarchy, spacing, type, color — and name each fix precisely.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [designer, reviewer, judge]
    formats: [web, document]
---

# Visual design review

- Review against the agreed direction and the brief, not your own taste. Quote the line of the direction each finding rests on.
- Look in this order: what the eye sees first (hierarchy), alignment and spacing rhythm, type scale and line length, color and contrast, then detail.
- Check the real output at the sizes it ships in (phone, laptop, both themes), from captures, not from the code.
- Each finding names where (screen, element), what is off, and the specific change: a value, a size, a color, a move.
- Separate blocking problems (wrong, unreadable, broken layout) from polish.
- Say what works and must stay, so a fix does not undo it.
