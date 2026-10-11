---
title: Fallen empires, marauders and L-Gates
description: Place fallen empire zones and marauder clans on a scenario, see where fallen empires hold territory, and keep threats away from starting positions.
aliases: [fallen empire, fe zone, fallen empire territory, fallen empire borders, marauder, marauders, raiders, l-gate, lgate, leviathan, threats]
---
# Fallen empires, marauders and L-Gates <Badge type="info" text="Scenario" />

A scenario can say where fallen empires and marauder clans go.
Leviathans and the L-Gate come from initializers. A system with one of
those initializers gets a leviathan or the L-Gate there. The game can
also roll them onto the systems it fills at random.

## Add a fallen empire zone <Badge type="warning" text="Paint a Galaxy" />

On a map for Paint a Galaxy, right-click a system and select "Add fallen
empire zone". Drag the ring to move it, and drag from a system's ring
onto it to choose what the fallen empire connects to.

A system's page has Add zone in its Fallen empire zone section too.

![A scenario system's page, with its Spawn point, Fallen empire zone and Initializer sections](../images/scenario/scenario-system-inspector.png)

## See a fallen empire's territory

A system whose initializer is a fallen empire's home, such as
`fallen_machine`, becomes that fallen empire's territory. So do the
systems that initializer gives outposts to, as long as each is within
the distance the initializer allows for it. Turn on the Empires layer
to see the borders, and open the Empires tab to find the fallen empire
under Fallen empires. Select one of its systems and the Inspector names
the fallen empire as the owner.

The game names a fallen empire at random when a new game starts, so
Galaxy Forge names it by its kind, such as "Materialist Fallen Empire".
It takes a colour from the same palette as other territories with no
colours of their own. When two fallen empires of the same kind are on
the map, a system either could hold goes to the nearer home system.
Moving a system doesn't change which one holds it until you next change
an initializer. This needs game data from your Stellaris install.

## Add a marauder clan

Right-click empty space and select "Add marauder clan here". This adds
the clan's home and its two outposts.

To make a clan from systems already on the map, select three systems
joined by hyperlanes. Click "Make these marauder clan N" in the
Inspector, or select it from the right-click menu. The system with a
hyperlane to both others becomes the clan's home, and the other two its
outposts.

## Keep threats away from starting positions

In [Prepare for a new game](prepare.md#keep-leviathans-marauders-and-l-gates-away-from-starting-positions),
leave "Keep leviathans, marauders and L-Gates away from starting
positions" ticked and click Apply. Every system the game would fill at random within 2
hyperlane jumps of a starting position becomes a normal system.
