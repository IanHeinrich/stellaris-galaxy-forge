---
title: Megastructures
description: Add, move or delete a megastructure in a save, such as a Hyper Relay, a Science Nexus or a ruined Orbital Ring, add a habitat, or add or delete a whole ring world.
aliases: [megastructure, add megastructure, move megastructure, drag megastructure, delete megastructure, remove megastructure, dyson sphere, dyson swarm, science nexus, hyper relay, relay, gateway, arc furnace, orbital ring, ruined orbital ring, ruined megastructure, megastructure owner, cosmogenesis world, ring world, ringworld, add ring world, delete ring world, shattered ring, add habitat, delete habitat, habitat central complex]
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

The megastructure is added already built, with the modifiers, deposits
and counters that building it adds. An Arc Furnace gives the planets of its
system its mining bonus and deposit, and a Dyson Swarm gives its star
its modifier. The app reads these from your game files and mods.

The game's other build effects don't run, so a Dyson Sphere doesn't
freeze the system's planets. A planet whose model the megastructure
would change stays as it is. In a system no one owns, the
megastructure has no owner, so effects from the owner's events don't
apply. An Arc Furnace there adds no mining bonus.

Some megastructures change the class or size of the planet they're built
at, such as an Automated Strip Mine or the Orchid Project from
Gigastructural Engineering. For these, the dialog shows a Planet choice
under the stages, and they're offered on a planet only:

- Change to, with the new class, is picked when the dialog opens. The
  planet changes as it does in the game, in the same edit as the
  megastructure.
- Keep adds only the megastructure. The planet keeps its class and size.

The app leaves out an effect of building it when it can't tell whether
the effect applies, and effects it can't add yet, such as a modifier
that building it removes. After the add, the status bar says how many
it left out.

1. Open the system in the [system view](system-view.md).
2. Right-click where the megastructure goes:
   - For one built on a planet, moon or star, such as a Science Nexus
     or an Arc Furnace, right-click the planet, moon or star and select
     Add megastructure.
   - For a Hyper Relay, a Gateway or an L-Gate, right-click empty space
     and select Add megastructure here.
3. Pick a megastructure from the list on the left.
4. Click one of its stages in the tiles beside the list.
5. Click Add.

The new megastructure's page opens in the Inspector. Press
<kbd>Ctrl</kbd>+<kbd>Z</kbd> to take it out again, with everything that
building it added.

The list shows each megastructure once, under Base game or the name of
the mod that adds it. Its build stages, ruins and variants are inside
it, so a Dyson Sphere is one entry in the list and not one for each
stage. Each entry shows the megastructure's picture from the game's
construction menu on the left. Under the name, mods that give a
megastructure a type and category show them, such as "Kilostructure ·
Science Production" in Gigastructural Engineering. The base game gives
none. The last line says how many stages it has and what else it comes
in, such as "4 stages · by star class" or "3 stages · ruins".
Type in the box above the list to filter it by megastructure or stage
name.

The tiles show the stages of the megastructure you picked, each with its
model, in the order they are built. Above a stage's short name, a tile
shows its place in the build order, such as "3 of 4". Its ruined and restored
versions come after the stages. A mod that has several versions of one
megastructure shows one row of tiles for each, with a label above the
row. A tile marked No model yet is a megastructure whose model the app
can't show yet.

With Gigastructural Engineering, a Dyson Sphere, Dyson Swarm,
Matrioshka Brain or Star Lifter is one row, not one for each star
class. Add writes the version the game builds at the star you
right-clicked. It picks that version from the star's class and from the
save's Gigastructural Engineering settings for star scaling. In a save
without star scaling, Add writes the generic version. Megastructures
switched off in those settings, such as Maginot worlds, are still in the
list.

Giga's wrecked warships are listed as wrecks. Their repaired stage turns
into a ship, so it isn't listed.

Click a stage to see it in the details panel beside the tiles. From the
top, the panel shows:

1. The stage's picture from the game's construction menu, or its model
   when the game gives no picture.
2. The stage's name, and a line such as "Stage 3 of 4: Maturity".
3. The game's description, with its colours and icons.
4. Produces each month.
5. Empire effects, which the megastructure gives its owner.
6. It also adds, which lists the modifiers and deposits that building it
   adds.

A part the stage has nothing for is left out. The Add button names what
it adds, such as "Add Maturity, stage 3 of 4".

The dialog opens on the megastructure you added last, if it fits where
you right-clicked. Otherwise it opens on a Dyson Sphere on a star, a
Science Nexus on a planet, or a Hyper Relay in empty space.

A Dyson Sphere and the other megastructures the game builds only around
a star are offered only on a star. A Science Nexus, an Arc Furnace and
the others the game never builds on a star aren't offered on a star. A
second Hyper Relay, Gateway or L-Gate in a system is greyed out, and the
preview says why.

A Hyper Relay, a Gateway or an L-Gate goes where you right-clicked.
A Hyper Relay links to the relays in the systems its hyperlanes lead to,
and a Gateway links to every other gateway.

An L-Gate is added closed and links to nothing. When the L-Gates open in
the game, it links to the L-Cluster. The app also gives its system the
mark the game keeps on every L-Gate system, which the link needs.

A megastructure goes to the empire that owns its system.

A planet, moon or star holds one megastructure. If it already has one,
the megastructures in the dialog are greyed out, and only a habitat can
be added there. The game also marks a planet when a
megastructure is built there, and some planets keep that mark with no
megastructure left. Adding one to such a planet is refused, and the
dialog says why.

Some megastructures are greyed out in the list. Select one to read the
reason in the preview. Galaxy Forge can't add these yet:

- Megastructures that change their planet in a way the app can't tell
  from your game files, such as only on a condition.
- Megastructures that turn their planet into a class the app can't give
  a planet, such as a Planetary Computer.
- Megastructures whose building also creates other planets or sections,
  such as an Alderson Disk.

Megastructures the game gives no name are listed last, under Unnamed
megastructures. They
show only when what you type in the filter is part of the key of one of
their stages.

Galaxy Forge can't add these yet, and they aren't in the list:

- The later stages of the Quantum Catapult.
- Megastructures that become a starbase when they are built: the Deep
  Space Citadel and the Nomads' waystations.
- Some Gigastructural Engineering megastructures that Galaxy Forge
  doesn't support yet.

The list also leaves out megastructures you can't build or that aren't
structures:

- Placeholders.
- Arkships and other structures that are really ships.
- Crisis and event structures, such as the Galactic Crucible, the
  Behemoth egg and the Shroud Seal.
- Ruins that have no repair.

## Move within a system

In a Stellaris 4.x save, you can move a megastructure to another place
in its system. Hold the pointer over a megastructure in the system view
and its tooltip says how it moves, or why it stays where it is.

A Hyper Relay, a Gateway, an L-Gate or the Shroud Seal sits in open
space. Drag it anywhere in its system. It moves in whole units and degrees, and <kbd>Shift</kbd> snaps
the angle to 15° steps. Its links to other relays or gateways stay as
they are.

A megastructure built on a planet, moon or star belongs to it. It moves
in one of two ways:

- A Science Nexus and most others sit beside their planet, and you drag
  them as you drag a moon. Drop one anywhere in the system and it
  stays there, still belonging to its planet. When you move the planet,
  it moves with it. To put it back beside its planet, right-click it and
  select the Snap to item that names the planet.
- An Orbital Ring, an Arc Furnace, a Dyson Sphere and the others that
  wrap round their planet or star in the game always sit on it. Drag
  one and drop it on another planet, moon or star to move it there.
  Dropped anywhere else, it goes back to where it was.

Either kind moves to another planet, moon or star of the same system
when you drop it on one. While you drag, the planets, moons and stars
it can move to are ringed.

An Arc Furnace hides its new planet, and its old planet shows again.
A finished Arc Furnace can also go on a star, which it hides nothing of:
the star looks as before, with the furnace round it. The modifiers and
deposits that building it added stay where they are, so an Arc
Furnace's mining bonus stays on the planets of its system.

While you drag, a planet, moon or star that can't take the megastructure
is ringed in red when the pointer is over it, and the status bar says
why:

- It already has a megastructure.
- The megastructure can only be attached to a star, such as a Dyson Sphere, and
  you're over a planet or a moon. In a system with one star,
  such a megastructure has nowhere to go.
- The megastructure can't be attached to a star, as with a Science Nexus, and
  you're over a star. Only a finished Arc Furnace can go on
  a star, not its earlier stages or its ruin.

Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> to move it back.

These stay where they are:

- Quantum Catapults, because moving them hasn't been tested in game.
- Ring world sections.
- Deep Space Citadels and the Nomads' waystations, which come with a
  starbase.
- Megastructures that are part of a larger structure, such as the
  sections of an Alderson Disk.
- A megastructure whose building created its planet, such as a
  Cosmogenesis World.
- A megastructure at the system's centre that isn't attached to a
  planet or star, as with some ruined Dyson Spheres.

## Add a habitat

In a Stellaris 4.x save, you add a habitat from the same dialog as a
megastructure. You need the game data loaded.

1. Open the system in the [system view](system-view.md).
2. Right-click a planet or star and select Add megastructure.
3. Pick Habitat Central Complex from the list.
4. Click Add.

Add puts in the habitat the finished complex makes, not the complex.
The habitat is a planet that orbits the planet or star you
right-clicked, where the game puts one. It orbits further out round a
star than round a planet. The new habitat is selected, and its page
opens in the Inspector. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> to take it
out again.

- The habitat has no owner and no colony, as when the game finishes
  one. Colonise it in the game.
- It has the habitat skin of the empire that owns the system. In a
  system no one owns, it has the default habitat skin.
- The restored Habitat Central Complex adds the same habitat, and also
  the major orbital the game builds round the planet or star when a
  restored complex is finished. The orbital belongs to the empire that
  owns the system, and is left out where the planet or star already has
  a megastructure.
- The ruined Habitat Central Complex is added as a ruin, like any other
  megastructure.

You can add a habitat where the game wouldn't let you build one, such
as a second habitat in a system, or one round an asteroid or a black
hole. Galaxy Forge can't put a habitat round anything that orbits a
planet, such as a moon, so Habitat Central Complex is greyed out there.

A planet or star can have more than one habitat. Each new one goes as
far round it from the others as it can, so a second habitat goes
opposite the first.

To delete a habitat, right-click it and select Delete planet, as for
any other planet. No ruined Habitat Central Complex is left behind. The
planet or star it orbited loses the mark the game keeps for its
habitat, and the system loses its own mark once no habitat is left in
it. Deleting a habitat you added as the restored complex also deletes
its orbital, unless another habitat you added still orbits the same
planet or star. The orbital then goes with the last of them.

## Add a ring world

In a Stellaris 4.x save, you can add a whole ring world round a star,
with each quadrant at the stage you pick. You need the game data loaded.

Clearing the system for a ring world deletes its planets and colonies.
You choose whether to clear it in step 7.

1. Open the system in the [system view](system-view.md).
2. Right-click the star and select Add megastructure.
3. Pick Ring World. It is offered only on a star.
4. Click one of its two tiles:
   - Site adds the construction site, as for any other megastructure.
   - Ring adds the whole ring world.
5. With Gigastructural Engineering enabled, pick a size under Size:
   Ring World, Titanic, Behemoth or Gargantuan. Site and Ring then add
   that size's site or ring. Without the mod there is no size to pick.
6. For Ring, pick a stage for each quadrant, A to D: Finished, Frame,
   Ruined or Damaged. The buttons after Set all give every quadrant the
   same stage. The larger rings have no Damaged stage.
7. Under Planets, pick what happens to the system's planets:
   - Keep leaves every planet, moon and asteroid belt where it is. The
     dialog opens with this picked.
   - Clear system deletes every planet, moon and asteroid belt first,
     as the game does when it builds the frame.
     The stars stay. A megastructure on a planet that is deleted goes
     with it. The line above the Add button says what goes, such
     as "Clearing deletes 6 planets, 2 moons and 1 belt, and the colony
     on Lachium I."
8. Click Add Ring World. For a larger size the button names it, such as
   Add Titanic Ringworld.

Clear system is off when a starbase orbits one of the planets it would delete,
and the dialog names that planet. A Dyson Sphere round the star stays.
Clearing leaves any ring already in the system.

Rings of different sizes can share a system.
Galaxy Forge doesn't ask for the smaller ring first, as Gigastructural
Engineering does when you build them in the game.

A finished quadrant is three sections, as the game builds them: a tech
section, a seam and a habitable section. The sections have no colony,
so colonise them in the game. A frame quadrant is the frame the game
builds before the sections. A ruined quadrant is a ruined section, and a
damaged quadrant is damaged sections, as the game's initializers make
them.

The ring world goes to the empire that owns the system, and its sections
are drawn in that empire's style. In a system no one owns, it has no
owner.

Ring is greyed out, and the details panel says why, in a system that:

- has more than one star, or none
- already has a ring where the new one would go. The reason names
  that ring's orbit.

A site on the star doesn't stop you adding a ring.

A mod's ring world that Galaxy Forge can't add yet is greyed out too,
with the reason.

Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo the add. The planets and belts
it cleared come back.

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
- The modifiers and deposits that building it added go with it, as
  when it is dismantled in the game. An Arc Furnace's mining bonus
  leaves the planets of its system, and a Dyson Swarm's modifier leaves
  its star. The app reads which from your game files, so load the game
  data first. Without it, those modifiers and deposits stay.
- Anything else the megastructure did to its system stays as the game
  left it. Planets a Dyson Sphere froze stay frozen.

The menu item and the button say why when a megastructure can't be
deleted:

- an L-Gate the save had when you opened it, or a megastructure with any
  other link than a relay's or a gateway's, because deleting those
  hasn't been tested in game
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

