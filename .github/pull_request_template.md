## What changed

<one or two sentences>

- [ ] `CHANGELOG.md` has an entry under Unreleased, or this PR carries the `skip-changelog` label
- [ ] A bug fix comes with a test that fails without the fix
- [ ] A change to what the map or panels draw has been looked at in the running app

## In-game checks

Tick the ones this change touches; the game is the oracle for anything it reads.

- [ ] A moved system loads at its new position with its lanes intact and travel cost following the recomputed length
- [ ] An added lane is drawn and a fleet can jump it in both directions
- [ ] A cut lane is gone and the pathfinder routes around it
- [ ] An isolated system loads with no lanes
- [ ] The game's own re-save opens in the editor with the edits in place
- [ ] The app's view of a region matches the game at the same zoom: star colours, borders, names and emblems, and at system zoom the resource icons, fleet markers and starbase or bypass colours
- [ ] A nebula added, resized, moved, renamed or removed shows in-game with the members the editor listed
- [ ] A cut lane between two waystations ends the wayline and the game loads without complaint
- [ ] A scenario loads with the intended orientation (no mirrored galaxy)
- [ ] A scenario system with a new initializer or spawn weight spawns as written
- [ ] A prevented lane is not generated; an edited header key takes effect
- [ ] An edited scenario in a local mod is picked up by auto-reload while the app is open
- [ ] An L-Gate outcome set in the editor is the one that spawns when a gate opens
- [ ] A system given a new star class loads with that star drawn on the galaxy map and in the system view
- [ ] A single star body given a new type or size loads drawn that way in the system view, and a month passes cleanly
- [ ] An empire given new map colours shows them as its border and fill; one set back to flag colours shows those
- [ ] An empire given a new emblem, background and flag colours shows that flag in game, its ships take the new primary colour, and with Independent Map Color off its border and fill follow the new colours; the player's new flag shows on the load game screen
- [ ] A renamed AI empire shows its new name in game and keeps it after a government reform. The player's renamed empire shows its new name in game and on the load game screen. A pre-FTL civilisation shows the same age in the app as in game
- [ ] An added system loads with its bodies, names and lanes; it can be surveyed, claimed and colonised, and survives a save and reload
- [ ] With the middle one of three added systems removed, the save loads, the renumbered system keeps its lanes and bodies, and it survives a save and reload
- [ ] A deposit added to an uncolonised planet shows on its page in game, a removed one is gone, and both hold after a save and reload
- [ ] A planet given a new size loads drawn at that size and a month passes cleanly
- [ ] A planet renamed shows the new name in game, its moons show it in theirs, and both hold after a save and reload
- [ ] A planet marked as a terraforming candidate shows the modifier in game and offers terraforming once Climate Restoration is researched; an unmarked one no longer does
- [ ] An added system rolled again loads as the new roll, with its name, position and lanes kept
- [ ] An added system renamed shows the new name on the galaxy map, its star, planets and moons
- [ ] A special layout placed in a save loads with its fixed bodies, flags and name
- [ ] A system added with a layout whose bodies have no orbit distance (a black hole system) loads with its planets where the app placed them, none on the star or on the orbit of the body before it, and a month passes cleanly
- [ ] A system added with Sol loads with each planet on the same side of the star, and Jupiter's four moons on the same sides of Jupiter, as in the game's own Sol (`testdata/4.4-early.sav`), and a month passes cleanly
- [ ] A nebula made turbulent or calm shows the change on its members in game
- [ ] A nebula added in a save draws its cloud over its members, and a system inside it is cloaked as the game's own members are
- [ ] The app's Sol from `testdata/4.4-early.sav` matches the game's Sol view: each planet on the same side of the star, the belts at the same radii, each moon about its planet
- [ ] Baxom (system 33) shows two stars either side of an empty centre with its planets circling the centre, and Alpha Centauri (system 278) shows the far companion's planets circling that star with their moons about them, as the game draws them
- [ ] In Sol, the system view's arrow to Alpha Centauri points where the game's own lane arrow does
- [ ] A scenario system with a `random` or unknown initializer opens in the system view with faint placeholder planets, which cannot be selected, rolled by the game's rules for its star, and the game rolls its own planets at generation
- [ ] In one 4.5 save the app wrote: a planet moved along its orbit, a planet with moons moved across orbits, a planet made a moon of a planet with a higher id, a moon detached, a belt added to a system without one, a belt's kind and radius changed, an inner radius moved, a companion star moved with its planets, a planet moved to orbit a companion star, a planet given a ring and one with its ring removed. Each body loads where the app drew it with its moons about it, the new moon is listed under its planet, the belt shows at its new radius and kind, the new ring shows and the removed one is gone, and all stay put after a month and a save and reload
- [ ] In one 4.5 save the app wrote: a planet with a moon, a colony, a planet with a station and a moon on its own moved to other systems, one placed at a chosen orbit, and a colony and a station moved into another empire's system. Each loads in its new system with its moons, pops and station, and the moon as a planet. The station passes to the other empire on load and the colony about a month later, and all hold after a save and reload
