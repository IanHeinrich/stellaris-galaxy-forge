---
title: Megastructures
description: Delete a megastructure from a save, such as a Hyper Relay, a Science Nexus or a ruined Orbital Ring.
aliases: [delete megastructure, remove megastructure, dyson sphere, dyson swarm, science nexus, hyper relay, relay, gateway, arc furnace, orbital ring, ruined orbital ring, cosmogenesis world]
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
- a save from before Stellaris 4.0
