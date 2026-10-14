---
title: Draw shapes of systems
description: Draw a line, circle, polygon, rectangle or star of new systems on the map of a scenario, with a live preview before you place it.
aliases: [shape, shapes tool, draw shapes, circle, ring, perfect circle, ellipse, arc, line, polygon, triangle, hexagon, rectangle, square, star shape, grid, hex grid, outline, scattered, fill, pending shape, place systems in a shape]
---
# Draw shapes of systems <Badge type="info" text="Scenario" />

The Shape tool (<kbd>O</kbd>, "Draw shapes" on the tool strip) places
new systems in an exact shape: a ring, a straight row, a star, or a circle
filled at random or in a grid. Saves don't have the tool.

## Draw a shape

1. Press <kbd>O</kbd>, or select Draw shapes on the tool strip.
2. Pick the shape in the options: Line, Circle, Polygon, Rectangle or
   Star.
3. Drag on the map to draw it. Until you do, the tool shows the shape at
   the centre of the galaxy.

The shape stays pending until you place it. The map shows what it would
add:

- Gold dots are the new systems, and lines between them are the new
  lanes.
- Hollow dots are points left out because they are too close to an
  existing system.
- Orange dots are points past the edge of the map. They are left out too.

A faint ring marks the edge of the galaxy, so you can judge the size.
The readout below the shape gives its size and system count, such as
"40% of the galaxy · 24 systems".

Press <kbd>Enter</kbd> or the Place button to add the systems and lanes.
Placing is one undo step. Press <kbd>Esc</kbd> to drop the pending
shape, and <kbd>Esc</kbd> again to go back to the Select tool.

## The shapes

- Line is a straight row of systems.
- Circle places systems in a ring. Set Arc below 360° for an arc, or
  Roundness below 100% for an ellipse.
- Polygon has 3 to 12 sides.
- Rectangle is a rectangle, or a square with <kbd>Shift</kbd> held.
- Star has 4 to 12 points. Inner radius sets how far out the dips between
  them sit, as a share of the radius.

## Move, resize and turn a shape

Handles on the pending shape adjust it:

- Drag the centre handle, or anywhere inside the shape, to move it.
- Drag a size handle to resize it.
- Drag the turn handle to rotate it.

The centre snaps to the middle of the galaxy and to systems, which makes
a ring around a home system exact. A rotation within a few degrees of a
45° step catches on it. Hold <kbd>Ctrl</kbd> when you press the mouse
button to turn this snapping off. <kbd>Shift</kbd> holds angles to 15°
steps and keeps a rectangle square.

<kbd>[</kbd> and <kbd>]</kbd> make the pending shape smaller and larger,
and can take it past the size of the galaxy.

## Outline, scattered or grid

The Fill option sets where the systems go:

- Outline puts them along the edge of the shape only.
- Scattered fills the shape at random, as the Paint brush does.
- Square grid fills it in rows and columns.
- Hex grid fills it in a honeycomb pattern.

A line has only Outline. A filled arc fills the slice between the arc
and its centre, so an arc of 180° fills a half disc.

For a scattered fill, "Line the edge with systems" also places a row of
systems along the edge. Untick it to leave only scattered systems
inside the shape, with lanes as natural as painted ones.

Size is a slider, with Small and Whole galaxy buttons for the two ends.
For an outline, Systems sets how many systems the edge gets. For a
scattered or grid fill, Spacing sets how far apart they are. The closest
spacing is the closest that still fills the whole shape. Shuffle rolls a
scattered fill again.

Exact values, folded under the options, take typed numbers for the
centre, the radius or the width and height, and the rotation.

## Lanes

- Follow the shape joins each system along the edge to the next, and
  closes a ring. It is on for an outline. A grid, or a scattered fill
  without its edge row, has no systems along the edge, so the option is
  hidden.
- Lanes works as it does for the Paint brush: Off, Among new, or New and
  nearby, which also links the shape to the systems around it. A scattered
  or grid fill starts on Among new.
- Lane density sets how many lanes the shape adds. At the left end, the
  lanes connect the systems without loops. At the right end, each system
  links to every neighbour.

New lanes never cross an existing lane or each other.

## Keep clear of existing systems

"Don't place on top of existing systems" is on by default. It leaves out
any point too close to a system that is already there. The status bar
says how many, such as "3 left out, too close to existing systems".
Untick it to place every point.

## Use symmetry with a shape

[Symmetry](brushes.md#use-symmetry) copies the shape around the centre of
the galaxy or mirrors it. Copies that land on each other become one, so a
circle centred on the pivot isn't doubled.

## Shapes remember their settings

Each shape remembers its own options. The next Circle you draw starts
with the last Circle's settings. With no shape pending, the options set
what the next shape starts with.
