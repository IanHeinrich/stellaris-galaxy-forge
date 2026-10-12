---
title: Megastructures
description: Add or delete a megastructure in a save, such as a Hyper Relay, a Science Nexus or a ruined Orbital Ring, or delete a whole ring world.
aliases: [megastructure, add megastructure, delete megastructure, remove megastructure, dyson sphere, dyson swarm, science nexus, hyper relay, relay, gateway, arc furnace, orbital ring, ruined orbital ring, ruined megastructure, megastructure owner, cosmogenesis world, ring world, ringworld, delete ring world, shattered ring]
---
# Megastructures <Badge type="tip" text="Save" />

The system view shows each megastructure as its model from the game.
[Megastructures and starbases](system-view.md#megastructures-and-starbases)
says how to find them and open their pages.

## Add a megastructure

You can add most megastructures your Stellaris install and enabled mods
define to a system in a Stellaris 4.x save. You need the game data
loaded. The ones you can't add yet are listed at the end of this
section.

The megastructure is added finished, with the modifiers, deposits and
counters its construction adds. An Arc Furnace gives the planets of its
system its mining bonus and deposit, and a Dyson Swarm gives its star
its modifier. The app reads these from your game files and mods.

The game's other build effects don't run, so a Dyson Sphere doesn't
freeze the system's planets. A planet whose class or model the
megastructure would change stays as it is. In a system no one owns, the
megastructure has no owner, so effects from the owner's events don't
apply. An Arc Furnace there adds no mining bonus.

The app leaves out a construction's effects when it can't tell whether
they apply, and ones it doesn't write yet, such as a modifier the
construction removes. After the add, the status bar says how many it
left out.

1. Open the system in the [system view](system-view.md).
2. Right-click where the megastructure goes:
   - For one built on or around a body, such as a Science Nexus or an
     Arc Furnace, right-click the planet, moon or star and select Add
     megastructure.
   - For a Hyper Relay or a Gateway, right-click empty space and select
     Add megastructure here.
3. Pick a megastructure from the list on the left.
4. Click one of its stages in the tiles beside the list.
5. Click Add.

The new megastructure's page opens in the Inspector. Press
<kbd>Ctrl</kbd>+<kbd>Z</kbd> to take it out again, with everything its
construction added.

The list shows each megastructure once, under Base game or the name of
the mod that adds it. Its build stages, ruins and variants are inside
it, so a Dyson Sphere is one entry in the list and not one for each
stage. Type in the box above the list to filter it by megastructure or
stage name.

The tiles show the stages of the megastructure you picked, each with its
model, in the order they are built. Its ruined and restored versions come
after them. A mod that has several versions of one megastructure, such
as the Dyson Sphere for each star class in Gigastructural Engineering,
shows one row of tiles for each, with a label above the row. A tile
marked No model yet is a megastructure the app can't draw yet.

The preview beside the tiles shows the stage you clicked, with the
game's description and what it produces each month. The dialog opens on
the megastructure you added last, if it fits where you right-clicked.
Otherwise it opens on a Dyson Sphere on a star, a Science Nexus on a
planet, or a Hyper Relay in empty space.

A Dyson Sphere and the other megastructures the game builds only around
a star are offered only on a star. A second Hyper Relay or Gateway in a
system is greyed out, and the preview says why.

A Hyper Relay or a Gateway stands just outside the system's
[inner radius](../reference/glossary.md#inner-radius), in the direction
you right-clicked. A Hyper Relay links to the relays in the systems its
hyperlanes lead to, and a Gateway links to every other gateway.

A megastructure goes to the empire that owns its system.

A planet, moon or star holds one megastructure. If it already has one,
Add megastructure is greyed out. The game also marks a planet when a
megastructure is built there, and some planets keep that mark with no
megastructure left. Adding one to such a planet is refused, and the
dialog says why.

Some types are in the list greyed out. Select one to read the reason in
the preview. Galaxy Forge can't add these yet:

- Ring worlds. A ring world goes around a star, so it is greyed out on
  a star and is not in the list on a planet or in empty space.
- Megastructures that change their planet's class or size, such as an
  Automated Strip Mine.
- Megastructures that are built as a whole with more planets or
  sections, such as an Alderson Disk.

Types the game gives no name are left out of the list. Type part of the
type's key in the filter to find one.

Galaxy Forge can't add these yet, and they aren't in the list:

- L-Gates and the later stages of the Quantum Catapult.
- Megastructures that become a starbase when they are built: the Deep
  Space Citadel and the Nomads' waystations.

## Delete a megastructure

In a Stellaris 4.x save, you can delete a megastructure. Right-click it
in the system view and select Delete megastructure, or click the button
at the bottom of its page. The app asks before it deletes anything, and
one undo puts it all back.

- Deleting a Hyper Relay also removes its relay link. Deleting a
  gateway also removes its link to the other gateways.
- The planet under a megastructure stays, and a new megastructure can
  be built on it. A planet under an Arc Furnace shows again, and a
  planet that had a ruined Orbital Ring can have a new one built.
- A colony on a planet with an Orbital Ring or an Arc Furnace stays.
- Some megastructures make their planet, such as a Cosmogenesis World.
  Deleting one of those removes the colony on that planet first, and
  the confirmation lists what goes with it. The planet stays, and you
  can then delete it as any other planet.
- The modifiers and deposits its construction added go with it, as
  when it is dismantled in the game. An Arc Furnace's mining bonus
  leaves the planets of its system, and a Dyson Swarm's modifier leaves
  its star. The app reads which from your game files, so load the game
  data first. Without it, those modifiers and deposits stay.
- Anything else the megastructure did to its system stays as the game
  left it. Planets a Dyson Sphere froze stay frozen.

The menu item and the button say why when a megastructure can't be
deleted:

- an L-Gate, or a megastructure with any other link than a relay's or a
  gateway's
- a ring world, which is deleted whole: see
  [Delete a ring world](#delete-a-ring-world)
- a save from before Stellaris 4.0

## Delete a ring world

A ring world is deleted whole, with every section of it. In a Stellaris
4.x save, right-click one of its sections in the system view, or one of
its ruined sections, and select Delete ring world. The same button is at
the bottom of each section's page.

- The confirmation says how many planets go and names each colony on
  them. The colonies go first, with their pops, buildings and armies.
- Planets in the system that aren't part of the ring stay, such as the
  Interloper beside a shattered ring.
- The system can have a new ring world built afterwards.
- One undo puts the whole ring back.

A single section can't be deleted on its own. Its page and its menu
offer Delete ring world in place of Delete planet.

