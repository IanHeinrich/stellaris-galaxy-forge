---
title: System view
description: Open one system to see its star, planets, moons and belts laid out as in the game, and get back to the galaxy.
aliases: [open system, system map, planets view, orbits, orbit radii, roll again, inside a system, back to galaxy]
---
# System view <Badge type="tip" text="Save" /> <Badge type="info" text="Scenario" />

Open one system to see its star, planets, moons and asteroid belts laid
out as they are in the game.

## Open a system

There are five ways in:

- Double-click the system on the map.
- Select the system and press <kbd>Enter</kbd> or <kbd>M</kbd>.
- Right-click the system and choose Open system view.
- Click Open system view in the Planets header of the system's page.
- Select the system and use View → Open system view.

Each body sits on its orbit around the star, or around its planet for a
moon. Hyperlanes show as arrows at the edge, pointing to the
neighbouring systems. Click an arrow to see the lane's length.
Double-click it to open that neighbour's view. Wheel zooms and
middle-drag pans, as on the galaxy map. A large save can take a moment
to read a system, and the status bar says "Reading the system…" until
the bodies appear.

![The system view of Xraneax, with its star, planets and asteroid belt, lane arrows at the edge and the system's page in the Inspector](../images/system/system-view.png)

The status bar counts the system's bodies and belts. With a body's page
open in the Inspector, it shows that body's orbit and angle.

## See how a scenario system rolls <Badge type="info" text="Scenario" />

Systems in a scenario open the same way and show what their
[initializer](../scenario/initializers.md) sets. Where it leaves an orbit
or an angle to chance, the view shows one example roll, the way the game
might place the bodies. Click Roll again next to the system's name, or
use View → Roll again, to see another. A random planet class shows a
question mark.

Select a scenario body to see its ranges. The band is the range its
distance can fall in, and the wedge is the range of its angle. The body
or orbit that the distance and angle are measured from is outlined in
blue. The body's page lists its orbit step, its angle step and whether
it has a ring. Click the name in the angle step to go to the body it
turns from.

A scenario system whose initializer is `random`, missing or unknown to
your install gets its planets rolled when the game starts. So does one
whose initializer places its planets only through a script. The view
shows faint placeholder planets for it, rolled by the game's rules for
its star. You can't select them.

## Show orbit radii

Press <kbd>2</kbd> in a system view to turn on Orbit radii. Each orbit
shows its radius. The selected body always shows a line out to it with
its radius.

![The system view of Amory with Orbit radii on, each orbit labelled with its radius](../images/system/orbit-radii.png)

## Names and layers in a system

Each body's name sits on a plate under it. A colonised planet's plate
has a bar in its owner's colour. Names, System details, Nebulae and,
in a save, Bypasses still work while a system is open, with their own
settings, so you can have them on in the galaxy and off in a system.
With System details on, each body's resources show under its name. A
colony's name shows its owner's flag. A body's name also shows icons
for its megastructures, dig site, anomaly and pre-FTL civilisation.
Hover an icon or a resource to see what it is. A system inside a nebula
shows faint clouds behind it while Nebulae is on. The other layer
buttons and the tool rail are for the galaxy, so they are hidden while
a system is open. Undo and redo still work from the Edit menu and their
keys.

## Go back to the galaxy

Press <kbd>Esc</kbd> or <kbd>M</kbd>, click "Galaxy" in the crumb at the
map's top left, right-click and choose Back to galaxy, or use View →
Back to galaxy. <kbd>Backspace</kbd> goes back too once the Inspector has
no page left to step back from. The galaxy map is where you left it.
