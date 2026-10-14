---
title: Draw shapes of systems
description: Draw a line, circle, polygon, rectangle or star of new systems on the map of a save or scenario, or arrange systems you already have into one, with a live preview before you place it.
aliases: [arrange, arrange systems, tidy systems, erase with a shape, shape, shapes tool, draw shapes, circle, ring, perfect circle, ellipse, arc, line, polygon, triangle, hexagon, rectangle, square, star shape, grid, hex grid, outline, scattered, fill, pending shape, place systems in a shape]
---
# Draw shapes of systems <Badge type="tip" text="Save" /> <Badge type="info" text="Scenario" />

The Shape tool (<kbd>O</kbd>, "Draw shapes" on the tool strip) places
new systems in an exact shape: a ring, a straight row, a star, or a circle
filled at random or in a grid. It works in Stellaris 4.x saves and in
scenarios. A 3.x save doesn't offer the tool.

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

## In a save <Badge type="tip" text="Save" />

A shape adds up to 200 systems to a save. It is meant for clusters, not
whole galaxies. A scenario allows 1,000.

- Galaxy Forge keeps new systems at least 10 units from every other system,
  the spacing the game spawns systems at. Points closer than that are always left out,
  whatever "Don't place on top of existing systems" says. Spacing can't go
  below 10.
- The status bar also counts points left out because they were too close
  to each other.
- The edge of the map is the galaxy's own circle.
- Each new system gets planets and deposits for its star, as "Add system
  here" does for one system. Names don't repeat.

Afterwards you can change each new system like any added system: pick a
different star class or Reroll it on its page, or delete it while the save
is open. The whole shape is one undo step.

In a scenario, the shape adds plain systems. The game fills them when it
makes the galaxy.

## Stars <Badge type="tip" text="Save" />

Stars chooses the star class of the systems a shape adds to a save:

- Random, the default, uses the game's usual mix.
- A star class, listed between Random and A mix…, gives every system that
  class.
- A mix… uses only the classes you tick, rolled by the game's odds.

Special systems such as Sol are not offered. The preview colours each point
as its star, and Shuffle rolls the stars again.

For a cluster of black holes, pick Black hole.

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
  closes a ring. No other lanes run between two systems on the edge, so a
  star or ring keeps a clean outline. Systems inside the shape and nearby
  still link to the edge. It is on for an outline. A grid, or a scattered
  fill without its edge row, has no systems along the edge, so the option
  is hidden.
- Lanes works as it does for the Paint brush: Off, Among new, or New and
  nearby, which also links the shape to the systems around it. A scattered
  or grid fill starts on Among new.
- Lane density sets how many lanes the shape adds. The left end lays the
  fewest lanes, and the new lanes form no loops of their own. At the right
  end, each system links to every neighbour.

New lanes never cross an existing lane or each other.

## Keep clear of existing systems

"Don't place on top of existing systems" is on by default. It leaves out
any point too close to a system that is already there. The status bar
says how many, such as "3 left out, too close to existing systems".
Untick it to place every point. In a save, points within 10 units of a
system are left out either way.

## Use symmetry with a shape

[Symmetry](brushes.md#use-symmetry) copies the shape around the centre of
the galaxy or mirrors it. Copies that land on each other become one, so a
circle centred on the pivot isn't doubled.

Arrange works only with symmetry off, because it moves only the systems
you selected.

## Arrange systems into a shape

Arrange moves systems you already have onto a shape, such as a ring of
systems you painted by hand.

1. Select the systems.
2. Right-click one of them and pick Arrange…. The button is also with the
   other selection actions in the inspector.
3. Adjust the shape. It starts centred where you right-clicked and sized
   to fit the selection. The first time it is a circle. After that it is
   the last shape you arranged into.
4. Press <kbd>Enter</kbd> or Arrange 7 systems.

The map shows where each system goes. The count is fixed to the selection.
Each system goes to the nearest free point, so their order around a ring
follows where they were. Outline puts them along the edge, and a scattered
or grid fill spreads them evenly inside the shape.

The whole arrange is one undo step. <kbd>Esc</kbd> moves nothing and puts
back the tool you had.

Lanes chooses what happens to the lanes between the selected systems:

- Keep, the default, keeps every lane. Each lane stretches to follow the
  move. A lane that would cross another is orange in the preview.
- Rebuild takes those lanes out and adds new ones, as a new shape would:
  Follow the shape, Lanes and Lane density work as above. New and nearby
  joins the arranged systems back to the systems around them.
- Clear takes those lanes out and adds none.

Lanes to systems outside the selection always stay.

Arrange won't place a system on top of another. If points of the shape
land too close to other systems or past the edge, the Arrange button is
off and says why. Move or resize the shape until they fit. In a save,
"too close" means within 10 units.

## Erase with a shape <Badge type="info" text="Scenario" />

Hold <kbd>Alt</kbd> and drag with the Shape tool to erase every system
inside the shape you draw, as <kbd>Alt</kbd> turns Paint into Erase. The
systems to be erased are ringed in orange until you let go. As with the
Erase brush, special systems stay unless you set the Erase brush to take
them. A line has no inside, so it erases nothing.

## Shapes remember their settings

Each shape remembers its own options. The next Circle you draw starts
with the last Circle's settings. With no shape pending, the options set
what the next shape starts with.
