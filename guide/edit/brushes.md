---
title: Brushes and symmetry
description: Connect, cut, paint and erase in broad strokes with the brushes, and mirror or repeat your edits with symmetry.
aliases: [brush, paint, erase, spread, gather, even spacing, relax, scatter systems, bulk, symmetry, mirror, rotate, rotation, radial, tool strip]
---
# Brushes and symmetry <Badge type="tip" text="Save" /> <Badge type="info" text="Scenario" />

The brushes on the tool strip work in broad strokes. Each stroke is one
undo step. While a brush is active, its options show beside the tool
strip. Every brush has a Size option, and <kbd>[</kbd> and <kbd>]</kbd>
resize it too.

## Connect and cut lanes with a brush

The Connect lanes (<kbd>C</kbd>) and Cut lanes (<kbd>X</kbd>) brushes
add and cut hyperlanes under the brush. Holding <kbd>Alt</kbd> swaps the
two. The Connect brush has a Lane density option. The left end lays the
fewest lanes, and the new lanes form no loops of their own. At the right
end, each system links to every neighbour.

![The Connect lanes brush active on the tool strip, with its Size and Lane density options](../images/edit/connect-brush-options.png)

## Paint and erase systems <Badge type="info" text="Scenario" />

Paint systems (<kbd>B</kbd>) scatters new systems under the brush and
joins them with lanes. Erase systems (<kbd>E</kbd>) removes them.
Holding <kbd>Alt</kbd> swaps the two.

Paint has these options:

- Density goes from sparse to dense. The number beside it is the
  distance between painted systems.
- Lanes picks which lanes a stroke adds: Off, Among new, or New and
  nearby, which also links the new systems to the ones around them.
- Lane density sets how many lanes a stroke adds. The left end lays the
  fewest lanes, and the new lanes form no loops of their own. At the right
  end, each system links to every neighbour.

![The Paint brush options: Size, Density, Lanes set to New and nearby, and Lane density](../images/edit/paint-brush-options.png)

Erase has these options:

- Target sets what the brush removes. Systems removes the systems and
  their lanes. Lanes only removes the lanes and leaves the systems.
- Tick Also erase special systems to let the brush remove systems with
  an initializer, a spawn point or another special role. Leave it
  unticked to keep them.

![The Erase brush options: Size, Target set to Systems, and Also erase special systems](../images/edit/erase-brush-options.png)

To lay systems out in a ring, a line or a star, use the Shape tool on
[Draw shapes of systems](shapes.md).

The Height brush (<kbd>H</kbd>) is on the
[System heights](heights.md#shape-heights-with-the-height-brush) page.

## Spread and gather systems

Spread systems (<kbd>R</kbd>) moves the systems under the brush towards
even spacing. Drag it over a clump to spread the systems out, or over a
hole to close it up. It adds and removes nothing. Hold the brush still to
keep spreading. Holding <kbd>Alt</kbd> turns it into Gather, which pulls
the systems under the brush towards its centre.

Spread has these options:

- Strength sets how far each pass moves a system.
- Tick Also move special and home systems to let the brush move points
  of interest such as guardians and fallen empires, spawn points,
  wormhole and gateway systems, and empires' homes. Leave it unticked to
  keep them in place. With no game data loaded, the brush can't tell
  which systems are points of interest, so only the others stay.

Lanes stay, and their lengths follow the systems. A move that would make
two lanes cross stops short, and the brush moves no system further past
the edge of the map. In a save, the brush stops a system short rather than
bring it closer than 10 units to another, the gap the game keeps between
systems it places. Two systems already closer than that can still move
apart. Under symmetry, each system's copies move with it, and a system on
a mirror line or at the centre of a rotation stays on it. Each stroke is
one undo step.

## Use symmetry <Badge type="info" text="Scenario" />

In a scenario, symmetry mirrors your edits around the centre of the
galaxy or repeats them around it. Click the Symmetry button under the
tools and pick "Mirror left–right", "Mirror top–bottom", or a 2-, 3-,
4-, 6- or 8-fold rotation. <kbd>Shift</kbd>+<kbd>M</kbd> turns symmetry
off, and on again with the last choice. Saves have no symmetry.

![The Symmetry menu, with Off, the two Mirror buttons and the Rotate choices](../images/edit/symmetry-control.png)

![A scenario with 6-fold rotation on, its six guide lines meeting at the centre of the galaxy](../images/edit/symmetry-6-fold.png)
