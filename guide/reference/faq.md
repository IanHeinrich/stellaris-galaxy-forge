---
title: FAQ
description: Answers to the questions players ask most about Galaxy Forge, each with a link to the page that has the details.
aliases: [faq, questions, frequently asked, help, can I, does it]
---
# FAQ

Questions players have asked on the Workshop page, with short answers.

## How do I open it again?

Galaxy Forge is a desktop app. Open it from the Start menu, or from
Applications on a Mac. Stellaris and its launcher don't start it. See
[Install and update](../start/install-and-update.md#open-it-again).

## Windows Defender or my browser flags the installer

The installer is signed, but the certificate is new, so SmartScreen may
still warn. Click More info, then Run anyway. See
[Install and update](../start/install-and-update.md#get-past-the-windows-warning).

## Does it work on Linux or Mac?

Yes. There are Mac, AppImage, `.deb` and `.rpm` builds on the Releases
page. I use Galaxy Forge on Windows. The Mac and Linux builds have had
less use. See
[Install and update](../start/install-and-update.md#install-on-linux).

## Is it a mod? Do I need to subscribe?

No. Galaxy Forge is an app, and the Workshop page is its home page. It
has no mod files, so subscribing installs nothing. You only need the
Paint a Galaxy mod, and only to play a scenario.

## Does it break Ironman or achievements?

Galaxy Forge only rewrites the parts of the save you edit. I haven't
tested Ironman saves or achievements. Keep the
[backup](../safety/saving.md#find-the-backups) until you know the save
works. See
[Go back to your campaign](../safety/back-to-campaign.md#ironman).

## Why do I need the Paint a Galaxy mod?

Stellaris gets some things wrong when it loads a hand-made galaxy. The
mod fixes them. Without it, the game builds no fallen empires. On a map
for the mod you can also place fallen empire zones and wormhole pairs,
and choose the kind of each seat. Untick its box only for a map meant for
a mod of your own. See
[Paint a Galaxy](../scenario/paint-a-galaxy.md#why-use-the-mod).

## Does it work with custom origins?

Yes, modded ones included. An origin that brings its own starting system
replaces the system on its seat when the game starts, as it does in a
random galaxy. See [Spawn points](../scenario/spawn-points.md).

## What is an initializer? Can I make a custom spawn system?

An initializer sets what a system spawns: its star, its planets and
anything else the game places there. You can give a system any
initializer from the game or your mods. The initializer browser shows the
file each one comes from, under Source. You can't edit or save
initializers yet. See [Initializers](../scenario/initializers.md).

## Can I save a system I edited as an initializer?

Not yet. Galaxy Forge reads initializers from the game and your mods,
but doesn't write them.

## How do I place wormholes myself?

In a save, or on a map for Paint a Galaxy, select two systems,
right-click one and choose "Link as wormhole pair". In a save you can
also drag a wormhole to a new place in its system. On any other scenario
the game places wormholes itself, from the Wormhole Pairs setting on the
new-game screen. See [Wormholes](../edit/wormholes.md).

## My Post-Apocalyptic seat isn't a tomb world

That's expected. The planets you see on a seat are what spawns when no
empire starts there. An empire that starts on the seat brings its own
home system, so a Post-Apocalyptic empire gets its tomb world when the
game starts. See [Spawn points](../scenario/spawn-points.md#who-starts-where-on-day-one).

## Can I change a system's star or its planets?

Yes, in a save. You can change a star's class and size, add and move
planets and moons, copy or move planets to another system, and
<kbd>Shift</kbd>-click several planets to edit them together. See
[Stars](../edit/stars.md),
[Arrange planets and moons](../system/arrange-planets.md),
[Copy and move planets](../system/copy-and-move-planets.md) and
[Edit several planets at once](../system/edit-several-planets.md).

## Can I add terraforming candidates?

Yes, in a save. On a planet's page, open Add modifier. The terraforming
candidate modifier for barren, frozen, toxic and grey goo worlds is at
the top. See
[Deposits and modifiers](../system/deposits-and-modifiers.md#make-a-planet-a-terraforming-candidate).

## Can I change a system's height?

Yes, in a save. Use the Height slider on a system's Overview tab, or the
Height brush. Scenarios have no heights, because the game ignores them
there. See [System heights](../edit/heights.md).

## Can I give systems to an empire?

No. Galaxy Forge shows who owns each system, but it can't change the
owner.

## Does it work with older versions of Stellaris?

It works with Stellaris 4.x saves. Hyperlane editing also works on saves
from 3.4 through 3.9. Adding systems and planets needs a 4.x save. See
[Supported game versions](versions.md).

## Could it be a website?

No. Galaxy Forge reads your Stellaris install and your mods from disk,
and a website can't do that.

## Can I turn a star into a planet?

No. You can change a star's class and size. See [Stars](../edit/stars.md).

## Something went wrong. Where do I report it?

Open an issue on GitHub and attach the save or scenario if you can. See
[Troubleshooting](troubleshooting.md#report-a-bug).
