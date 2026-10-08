---
title: Hyperlanes
description: Draw and cut hyperlanes, connect several systems at once, join a split galaxy and fix lane lengths.
aliases: [lanes, connections, link systems, connect systems, cut lane, remove lane, isolate, join, mesh, prevent lane, lane length]
---
# Hyperlanes <Badge type="tip" text="Save" /> <Badge type="info" text="Scenario" />

Hyperlanes join systems. You can draw them one at a time, in broad
strokes with a [brush](brushes.md), or between every system you select.

## Draw a hyperlane

Zoom in until a ring appears around a star, then drag from the ring to
another system. <kbd>Shift</kbd>+drag from the star works at any zoom.

![A new hyperlane between a selected system and the star whose ring it was dragged to](../images/edit/lane-drawn.png)

## Cut a hyperlane

Hover a lane and click the "×" at its middle. Right-click a system and
select "Isolate" to remove all its lanes.

Right-clicking a lane also offers Cut.

![The right-click menu on the lane from Usksion to Xraneax, with Cut](../images/edit/lane-menu.png)

![The right-click menu on the system Xraneax in a save, with Open system view and Isolate](../images/edit/system-menu-save.png)

## Connect or cut several systems at once

With several systems selected, the Inspector offers "Connect to each
other", "Connect as mesh" and "Cut hyperlanes between".

"Connect to each other" links every selected system to every other one.
It works on up to 5 systems. "Connect as mesh" links each system only to
its near neighbours, so it suits a large selection. Its Mesh density
slider goes from sparse to dense. Point at the row to preview the new
lanes on the map.

## Join a split galaxy

When the galaxy is in separate pieces, click "Join" beside Components
in the Inspector. It connects the pieces with the shortest hyperlanes
that don't cross any others.

## Reset a lane's length <Badge type="tip" text="Save" />

The game uses a hyperlane's stored length as its travel cost. A lane's
page marks the length with "!" when it doesn't match the distance
between its systems. Click "Reset length" on the lane's page, or right-click
the lane and select "Reset length". Either sets the length to that
distance.

## Prevent a lane <Badge type="info" text="Scenario" />

Right-click a hyperlane and select "Cut and prevent" so the game never
generates it. Right-click a prevented lane and select "Allow" to undo
that.
