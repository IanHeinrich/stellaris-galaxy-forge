---
title: Prepare for a new game
description: Choose what a new game takes from a scenario made from a save, row by row or from a preset.
aliases: [prepare, presets, keep everything, keep the galaxy, keep the layout, row by row, starting positions, reroll, apply, old capitals]
---
# Prepare for a new game <Badge type="info" text="Scenario" />

A save opened as a scenario keeps everything the old game placed: old
capitals, origin systems, the systems events made, leviathans and
wormhole pairs. Prepare for a new game sets what the new game takes from
the map, row by row or from a preset.

## Open Prepare for a new game

After "Open as scenario", the Galaxy page shows only this section, with
Apply at the bottom so it stays in view. Click "Not now" to see the
whole Galaxy page instead. On any scenario, use File → "Prepare for a
new game…", or select nothing and open the section on the Galaxy page.
It needs game data from your Stellaris install to sort the systems into
rows.

While the section is open, the map shows the galaxy as your choices would
leave it.

<Annotated :marks="[
  { n: 1, box: [8, 70, 210, 50], label: 'The three presets' },
  { n: 2, box: [8, 165, 330, 30], label: 'Keep leviathans, marauders and L-Gates away from starting positions' },
  { n: 3, box: [8, 226, 330, 480], label: 'Row by row: one choice per kind of system' },
  { n: 4, box: [250, 722, 85, 24], label: 'Apply' }
]">

![The Prepare for a new game section, with the three presets, the box that keeps threats away and the first rows of Row by row](../images/scenario/prepare-section.png)

</Annotated>

## Start from a preset

- Keep everything leaves the map as it is, the old capitals' home
  systems included. New empires start in them.
- Keep the galaxy leaves the galaxy as it is, but every empire gets a
  random starting system at an old capital's position. Sol and the old
  origin systems become normal systems.
- Keep the layout keeps only the star positions, hyperlanes and nebulae.
  Galaxy Forge draws new starting positions, and on a Paint a Galaxy map
  new fallen empire zones. The game rolls everything else, as if this
  were a new random galaxy.

## Choose row by row

Under "Row by row" each row has its own choice, from Starting positions
to System names. Hover over a row to ring its systems on the map and to
see a card beside the inspector. The card says what the row holds and
what each choice does. Each choice has a tag for who places those things
in the new game:

- Galaxy Forge: this map places them, where you see them now.
- The game: the game places them when the game starts, by the in-game
  galaxy setting where one applies, otherwise at random. You don't see
  where until then.
- No one: they aren't placed at all.

The same tags show in each row's list. Under a row you've changed, one
line says what that choice does.

A custom map gets no fallen empires without Paint a Galaxy, so on a
plain scenario the Fallen empires row can't be changed.

New random positions and New random zones are drawn by Galaxy Forge. The
map rings each new starting position and each new fallen empire zone,
and a legend at its bottom left counts them. Click Reroll to draw them
again.

## Keep leviathans, marauders and L-Gates away from starting positions

In a random galaxy the game keeps these threats away from empires. On a
custom map it doesn't, so a leviathan, a marauder clan or the L-Gate can
spawn right next to a starting position.

This box is ticked by default. Every system the game would roll within
2 hyperlane jumps of a starting position becomes a normal system
instead. The line under the box counts them. Hover over the box to ring
them on the map.

## Apply your choices

Apply makes every change as one step, and <kbd>Ctrl</kbd>+<kbd>Z</kbd>
undoes it. On a scenario opened from a save, undoing the Apply brings
the setup back.
