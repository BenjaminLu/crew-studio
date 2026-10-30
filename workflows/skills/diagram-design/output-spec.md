# Output (diagram-design's output spec, as the review room embeds a figure)

One `<svg viewBox="0 0 W H" role="img">`, at most 2400 × 2400, nothing around it. Elements: svg g rect path line polyline
polygon circle ellipse text tspan marker defs title desc. Attributes: geometry (x y width height rx ry cx cy r x1 y1 x2 y2
points d dx dy viewBox; `transform="translate(x, y)"` on a g only), presentation (fill stroke stroke-width stroke-dasharray
stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity font-size font-weight font-family font-style text-anchor
dominant-baseline letter-spacing marker-start marker-mid marker-end), markers (markerWidth markerHeight refX refY orient
markerUnits), identity (id role aria-label aria-labelledby) and baton's contract: `data-node` on every shape a reader may
pick (a state, a component), `data-edge="from>to"` on every connector (add `#2` for a second one between the same two),
`data-cite="diff:path:Lx-y"` on a connector that opens code, `data-en`, `data-hant`, `data-hans` on every text (the
visible text one of them). Colours only `var(--fig-…)`, fonts only `var(--fig-sans|mono|serif)`. No script, style,
foreignObject, image, use, link, href, class, filter, or url() other than a marker of the same figure: Studio drops them.

Studio rebuilds the figure element by element (never as markup), keeps your ids to the figure, and shows each text in the
captain's language from its three attributes. A `<title>` and `<desc>` first, for the figure's accessible name.

## Size

Draw at the size it will be read: about 600–1000 wide for a report section. Body text 12–16px, arrow labels 12px. A figure
taller than wide is fine (the report scrolls); one wider than about 1100 scrolls sideways, so split it or turn it top down.
