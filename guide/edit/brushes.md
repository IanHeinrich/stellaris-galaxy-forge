---
title: Brushes and symmetry
description: Connect, cut, paint and erase in broad strokes with the brushes, and mirror or repeat your edits with symmetry.
aliases: [brush, paint, erase, scatter systems, bulk, symmetry, mirror, rotate, rotation, radial, tool strip]
---
# Brushes and symmetry <Badge type="tip" text="Save" /> <Badge type="info" text="Scenario" />

The brushes on the tool strip work in broad strokes. Each stroke is one
undo step. While a brush is active, its options show beside the tool
strip. Every brush has a Size option, and <kbd>[</kbd> and <kbd>]</kbd>
resize it too.

## Connect and cut lanes with a brush

The Connect lanes (<kbd>C</kbd>) and Cut lanes (<kbd>X</kbd>) brushes
add and cut hyperlanes under the brush. Holding <kbd>Alt</kbd> swaps the
two. The Connect brush has a Lane density option, from sparse to dense
lanes.

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
- Lane density goes from sparse to dense lanes.

![The Paint brush options: Size, Density, Lanes set to New and nearby, and Lane density](../images/edit/paint-brush-options.png)

Erase has these options:

- Target picks Systems, which takes their lanes too, or Lanes only.
- With Also erase special systems ticked, the brush takes systems with
  an initializer, a spawn point or another special role. Without it, the
  brush leaves them.

![The Erase brush options: Size, Target set to Systems, and Also erase special systems](../images/edit/erase-brush-options.png)

The Height brush (<kbd>H</kbd>) is on the
[System heights](heights.md#shape-heights-with-the-height-brush) page.

## Use symmetry <Badge type="info" text="Scenario" />

In a scenario, the Symmetry button under the tools, or
<kbd>Shift</kbd>+<kbd>M</kbd>, mirrors your edits around the centre of
the galaxy or repeats them around it. Pick "Mirror left–right", "Mirror
top–bottom", or a 2-, 3-, 4-, 6- or 8-fold rotation. Saves have no
symmetry.

![The Symmetry menu, with Off, the two Mirror buttons and the Rotate choices](../images/edit/symmetry-control.png)

![A scenario with 6-fold rotation on, its six guide lines meeting at the centre of the galaxy](../images/edit/symmetry-6-fold.png)
