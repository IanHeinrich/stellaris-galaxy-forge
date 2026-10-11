---
title: Megastructures
description: Add or delete a megastructure in a save, of any type your install and mods define, such as a Hyper Relay, a Science Nexus or a ruined Orbital Ring.
aliases: [megastructure, add megastructure, delete megastructure, remove megastructure, dyson sphere, dyson swarm, science nexus, hyper relay, relay, gateway, arc furnace, orbital ring, ruined orbital ring, ruined megastructure, megastructure owner, cosmogenesis world]
---
# Megastructures <Badge type="tip" text="Save" />

The system view shows each megastructure as its model from the game.
[Megastructures and starbases](system-view.md#megastructures-and-starbases)
says how to find them and open their pages.

## Add a megastructure

You can add any megastructure your Stellaris install and enabled mods
define to a system in a Stellaris 4.x save. You need the game data
loaded.

The megastructure is added finished. The game's build effects don't
run, so a Dyson Sphere doesn't freeze the system's planets. A planet
whose class or model the megastructure would change stays as it is.

1. Open the system in the [system view](system-view.md).
2. Right-click where the megastructure goes:
   - For one built on or around a body, such as a Science Nexus or an
     Arc Furnace, right-click the planet, moon or star and select Add
     megastructure.
   - For a Hyper Relay or a Gateway, right-click empty space and select
     Add megastructure here.
3. Pick the type and the owner, and click Add.

The new megastructure's page opens in the Inspector. Press
<kbd>Ctrl</kbd>+<kbd>Z</kbd> to take it out again.

The Type list groups each megastructure's stages under its first stage,
so the stages of a Dyson Sphere sit together. Type in the box at the top
of the list to filter it. A Dyson Sphere and the other megastructures
the game builds only around a star are offered only on a star.

A Hyper Relay or a Gateway stands just outside the system's
[inner radius](../reference/glossary.md#inner-radius), in the direction
you right-clicked. A Hyper Relay links to the relays in the systems its
hyperlanes lead to, and a Gateway links to every other gateway.

The owner starts as the system's owner. A ruined, derelict or destroyed
megastructure starts with no owner. You can pick any empire, or No
owner.

A planet, moon or star holds one megastructure. If it already has one,
Add megastructure is greyed out.

Galaxy Forge can't add these yet, so they aren't in the list:

- Ring worlds.
- L-Gates and the later stages of the Quantum Catapult.
- Megastructures that become a starbase when they are built, such as
  the Deep Space Citadel.

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
- What the megastructure did to its system stays as the game left it.
  Planets a Dyson Sphere froze stay frozen, and the system and its
  owner keep their modifiers.

The menu item and the button say why when a megastructure can't be
deleted:

- an L-Gate, or a megastructure with any other link than a relay's or a
  gateway's
- a megastructure that a fleet is building or upgrading
- a save from before Stellaris 4.0
