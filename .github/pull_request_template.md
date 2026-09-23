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
