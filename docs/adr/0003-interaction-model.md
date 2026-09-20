# ADR 0003: Map interaction model

Accepted

## Context

The galaxy editor's core loop is to move a system, connect two systems, cut a lane and isolate a system, all
while panning and zooming freely. A visible mode is discoverable but charges a switch for every action, while
modifier gestures are fast and invisible. Both were built behind one `MapIntent` interface and tried on a real
save.

## Decision

There are no modes. What is under the pointer when the button goes down decides what the drag means: a star,
the port band around it, a lane, a nebula, or empty space (`app/src/map/interaction/GestureModel.ts`). The
left button is for editing and never pans; the middle button pans wherever it starts, the arrow keys and WASD
pan while held, and the wheel zooms to the cursor. The model is a pure state machine that asks the map for
previews and sends every edit as an op, so nothing is changed client-side.

Because `Shift` is invisible, the discoverable path borrows the connection port from diagram tools. A star is
a point and a lane leaves it in any direction, so the port is the whole ring around the star rather than
arrows on four sides.

| Gesture | Effect |
|---|---|
| Hover a star, at `PORT_MIN_SCALE` or closer | a dashed ring appears just outside it: inside is move, the band is connect |
| Drag from inside the ring | moves the star, as a ghost with rubber lanes, and sends one `MoveSystem` on release |
| Drag from the band, or `Shift`+drag from the star | a lane grows from it; the nearest system inside the snap radius is ringed and the line snaps to it, an already-linked one shows as invalid, and a release anywhere else cancels |
| Click a system | selects it; `Shift` or `Ctrl` adds it to or takes it out of the selection |
| `Shift`+drag from empty space | a marquee, selecting every system inside it on release, adding to the selection when `Ctrl` is held |
| `Ctrl+A` | selects every system |
| Click a lane | selects it; `Shift`+click, or the "×" a hovered lane shows at its midpoint, cuts it |
| `Delete` or `Backspace` | cuts the selected lane, or removes the selected nebula |
| `Shift`+arrow key | nudges the selection one step across the screen, ten with `Ctrl` |
| Drag a nebula's centre or its ring | moves the cloud or resizes it; `[` and `]` step the selected one's radius |
| Right-click | a menu for whatever is under the pointer: a system, a lane, a nebula or empty space |
| `Esc` | drops a drag or a menu first, then clears the selection |

A drag from a star that is part of a multi-selection acts on the whole selection, for moving and for drawing
lanes alike, so bulk editing needs no extra mode. A system's menu isolates it, deletes it or makes it a spawn
point; a multi-selection's menu connects the systems to each other or as a mesh over a sparse-to-dense slider,
cuts the lanes between them, isolates them or resets their lane lengths, each row carrying its count. Empty
space creates a system or a nebula at that point.

Zoom gates the port band, not editing. Below `PORT_MIN_SCALE` no ring is drawn and a lane is drawn with
`Shift` instead, while a star keeps its pick radius in screen pixels at every zoom, so it can still be
selected and dragged with the whole galaxy in view. A press becomes a drag only past `DRAG_THRESHOLD_PX`.

## Consequences

- The model is tested without a canvas, because every pick is resolved before it is called and everything it
  asks for is a method on `MapIntent`.
- `Shift` still has to be taught somewhere, since below the zoom threshold no ring hints at it.
- Hit-testing carries screen-space work per hovered star: the port band, the snap target and the lane's
  midpoint button.
- A bulk edit is a single op, so a mesh of a hundred lanes is one undo step.
