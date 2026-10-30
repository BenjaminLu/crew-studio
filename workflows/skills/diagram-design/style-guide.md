# Style guide (diagram-design's, mapped to the review room)

The room owns the colours: a figure names roles, never values. `var(--fig-paper | card | card-2 | ink | muted | soft | rule
| rule-strong | accent | accent-tint | ok | ok-tint | amber | amber-tint | seal | seal-tint | link)`. Studio defines each for
the light and the dark theme, so a figure is right in both without a second drawing. One accent: if four things want it,
you have not decided what is focal. No rainbow: colour means something or it is not there.

## Typography

| Role | Font | Size | Use |
|---|---|---|---|
| node name | `var(--fig-sans)` 600 | 12–16px | human-readable labels |
| sublabel | `var(--fig-mono)` | 12px (Latin may go to 9px) | ports, fields, URLs, SQL |
| arrow label | `var(--fig-mono)` | 12px | annotation on a connector |
| tag / eyebrow | `var(--fig-mono)`, tracked | 12px with Chinese, 8px Latin only | type tags |
| callout | `var(--fig-serif)` italic | 14px | an editorial aside |

Mono is for technical content only; names go in sans.

## Chinese labels

Measure per character: every wide or full-width character (Han, and full-width punctuation `（）「」，。：`) costs 1em, every
other character about 0.6em (sans) or 0.62em (mono). Size the box for the longest of the three languages. Chinese text is
never under 12px: if it does not fit, cut the words, do not shrink them. Arrow labels, tags and legends in Chinese switch to
12px sans, no tracking, no capitals, and their mask grows to match.

## Stroke, radius, spacing

Strokes 0.8 (tags), 1 (most), 1.2 to 1.6 (emphasis). Radius 4 (tags), 6 (boxes), 8 (containers). Grid 4: every coordinate,
size and gap divisible by 4.
