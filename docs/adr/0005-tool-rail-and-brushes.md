# ADR 0005: Tool rail and brushes

Accepted

## Context

ADR 0003 made the map modeless: what is under the pointer at press decides what a drag does. That suits editing
one system or one lane at a time. Laying out a galaxy by hand needs broad strokes as well: paint a region full of
systems, erase a region, connect or cut every lane a stroke crosses, and repeat a stroke about the centre. A
stroke over empty space already means a marquee or nothing, so these actions cannot be read from the press
alone.

## Decision

Select stays modeless, exactly as ADR 0003 describes, and is the tool the map opens on. Brushes are the one
explicit mode. A tool rail at the map's left edge holds the tools, with undo and redo at its foot. Each tool is
also a key:

| Key | Tool |
|---|---|
| `V` | Select |
| `B` | Paint systems, on a scenario only |
| `E` | Erase systems, on a scenario only |
| `C` | Connect lanes brush |
| `X` | Cut lanes brush |
| `M` | Symmetry on and off |

`[` and `]` shrink and grow the brush. `Alt` inverts a brush: the model reads it at each input, so the circle
follows it while held, and a stroke keeps the brush it was pressed with. `Esc` drops a stroke in progress, and a
second `Esc` returns to Select. A tool the open document cannot take is refused, and opening such a document or
closing the document returns to Select.

The active brush's options float over the map's top-left corner beside the rail, and only while a brush is
active, so the map never resizes when the tool changes. The layer toggles stay in the top bar: actions sit on
the left, filters on the top.

A stroke previews on the map while the button is held and commits as one op, a `Batch`, on release, so a stroke
is one undo step. Middle-drag, the wheel and WASD pan and zoom in every tool.

`InteractionController` holds one `MapModel` per tool and swaps it when the tool changes, resetting the
outgoing model first so no drag is left half done. Select maps to `GestureModel`; the brushes map to a second
model behind the same `MapIntent` interface.

## Consequences

- The brush model is tested without a canvas, as the gesture model is.
- The rail takes a strip of the map's width whenever a document is open.
- A brush on a save is limited to lanes, since a save cannot add or remove systems.
- Symmetry and the brush settings persist per machine; the tool itself does not.

## Amendment: symmetry is a global mode

Symmetry is not a brush option. It is a mode of editing that applies in every tool: adding, moving, deleting
and isolating systems, adding and cutting lanes, and setting initializers and spawns each reach the counterparts
at every image in the same op, as every brush stroke does. Its button sits below the tools and opens a flyout
that picks the kind, and `M` turns it on and off. Its guides show whenever it is on.

Every single edit goes through one store helper, `symmetricOp`, which widens the op the action built. A seat
edit goes through `symmetricSeat` instead, which builds each counterpart's seat from that counterpart. A drag
finds its counterparts once when it starts and reuses them for the preview and the commit. A counterpart is the
system within 0.5 map units of the image, found through the spatial grid.
