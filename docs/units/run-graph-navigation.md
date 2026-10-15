# Navigate a large task graph

Task run graphs have run-only controls for zoom, drag pan, Fit all, Focus current and an expanded viewport. Desktop compares the complete topology while phone users can expand before touch-dragging; normal touch scrolling stays available outside expanded mode. Wheel zoom is pointer-anchored only inside expanded mode. Buttons use bounded center-anchored zoom. Pinch zoom is not implemented in this unit.

The existing Simple/Detail graph modes and stage expansion remain available. Clicking a node shows its full label, state and recorded note/error below the graph. The current stage, whether it is working/queued/waiting for the captain, and its recorded reason stay readable above the graph; the legend explains the state colors. The graph uses its existing setView API as the one viewport authority. Node positions, workflow versions and task state are not edited by navigation.

A six-pixel drag threshold prevents a pan from activating a node. Expanded mode keeps keyboard focus within its controls/nodes; Escape exits and restores the Expand button focus. Per-mode view state and expanded state survive run rendering. The editor's gesture implementation is unchanged.

Offline browser verification renders the exact node topology and lifecycle states read from local R-014 with captain brief/params/ctx excluded, and an80-node synthetic graph. The explicitly labelled waiting-reason text in fixture screenshots is synthetic; it is not evidence of the live task's actual error. Without local R-014, CI falls back to the bundled coffee topology. No authenticated live API request or mutation, actual model call or user browser session is used.

The matrix covers desktop/phone, light/dark and English/Traditional Chinese, actual SVG node bounds after fit, node detail selection, drag versus click, current focus, mouse pan, phone touch pan, pointer-anchor wheel zoom, bounded zoom, Simple mode and expanded Escape/focus restoration. Existing geometry/editor tests remain owning regressions.
