---
title: Megastructures
description: Delete a megastructure from a save, such as a Hyper Relay, a Science Nexus, a ruined Orbital Ring or a whole ring world.
aliases: [delete megastructure, remove megastructure, dyson sphere, dyson swarm, science nexus, hyper relay, relay, gateway, arc furnace, orbital ring, ruined orbital ring, cosmogenesis world, ring world, ringworld, delete ring world, shattered ring]
---
# Megastructures <Badge type="tip" text="Save" />

The system view shows each megastructure as its model from the game.
[Megastructures and starbases](system-view.md#megastructures-and-starbases)
says how to find them and open their pages.

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

