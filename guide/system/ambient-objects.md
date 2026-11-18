---
title: Ambient objects
description: Add, move or delete an ambient object, such as a derelict ship, a wrecked station or a debris field, in a scenario's systems.
aliases: [ambient object, ambient objects, derelict ship, abandoned ship, wreck, wrecked station, debris, debris field, add ambient object, move ambient object, delete ambient object, scenery]
---
# Ambient objects <Badge type="info" text="Scenario" />

Ambient objects are a system's scenery: derelict ships, wrecked
stations, debris fields, clouds and storms. In a scenario, you can add
them to a system, move them and delete them. The game places them in the
system when a new game starts. Adding needs the game data loaded.

## Add an ambient object

1. Open the system in the system view.
2. Right-click empty space where the object goes and select Add ambient
   object here.
3. Pick an object from the list. Type in the box above the list to
   filter it.
4. Click the Add button.

The object's page opens in the Inspector. Press <kbd>Ctrl</kbd>+<kbd>Z</kbd>
to take it out again.

The list puts the objects the game's initializers place first, under
Placed in systems. Every other object, your enabled mods' included, is
under Other objects. The preview beside the list says whether the game
shows the object's name, whether you can select it in the game, and
which initializers place it.

Two objects with the same name show their keys under the name, so you
can tell them apart.

Some objects, such as clouds and storms, have no model to show. They
have a plain square in the list and a plain ring in the system view.

## Move or delete an ambient object

- Drag an ambient object in the system view, or type a Distance and
  Angle in the Position block on its page.
- To remove one, click Delete ambient object at the bottom of its page.
  Galaxy Forge asks first, and <kbd>Ctrl</kbd>+<kbd>Z</kbd> puts it
  back.
- Rows marked From the initializer or From the file can't be moved or
  deleted. The system view leaves out the objects the initializer
  places, because the game picks their spot.
- Ambient objects show with the megastructures. Press <kbd>7</kbd> in a
  system view to hide them, or turn off Megastructures and starbases in
  the Layers menu. Adding an ambient object or a megastructure turns the
  layer back on.

## Objects in a binary or trinary system

The game places an ambient object about the system's main star, so the
Distance and Angle on its page are measured from that star. Where the
initializer puts the main star at random, the object moves with the
star when a new game starts.
