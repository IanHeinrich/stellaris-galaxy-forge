---
title: Select and move systems
description: Select one or many systems and move them to a new place on the galaxy map.
aliases: [move system, drag star, relocate, reposition, nudge, rotate, turn, pivot, position, coordinates, selection box, multi select]
---
# Select and move systems <Badge type="tip" text="Save" /> <Badge type="info" text="Scenario" />

Most edits start by selecting systems.

## Select systems

Click a system to select it. <kbd>Ctrl</kbd>+click adds or removes one,
and dragging on empty space draws a selection box. <kbd>Esc</kbd> clears
the selection.

![A selected system on the map, marked by a yellow ring](../images/edit/selected-system-ring.png)

## Move a system

Drag a star to move it. If it is part of a selection, the whole
selection moves. <kbd>Shift</kbd>+arrow nudges the selection. For an
exact position, type coordinates into the Position fields on the
Inspector's Overview tab. A moved system keeps its hyperlanes and their lengths are updated.
Its planets and fleets move with it.

![A system's Overview tab in the Inspector, with its Position fields, Height slider, hyperlanes and planets](../images/edit/system-inspector.png)

You can move a system past the galaxy edge, as far out as you like. To
add new systems out there, see
[Systems outside the galaxy edge](add-systems.md#systems-outside-the-galaxy-edge).

## Rotate a selection

To turn a group of systems, select two or more. A round handle appears
above them on the map. Drag it to turn the selection about its centre. Hold <kbd>Shift</kbd>
to snap the turn to 15°. To turn about another point, drag the pivot
marker there first. The Inspector's Rotate section has a button that puts
the pivot back at the centre.

For an exact turn, type an angle in the Rotate section of the selection
page and press <kbd>Enter</kbd>, or use the 90° left, 90° right and 180°
buttons. A positive angle turns clockwise. The typed angle stays in the
field, so you can apply it again.

Tick **Nebulae too** and the nebulae centred inside the selection turn
with it. Each turn is one undo step.

To remove systems, see [Delete systems](add-systems.md#delete-systems).
