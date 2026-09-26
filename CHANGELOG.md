# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version
numbers follow [Semantic Versioning](https://semver.org/). Entries under
Unreleased ship with the next release. `docs/engineering-rules.md` says how
a release is made.

## [Unreleased]

### Added

- Double-click a system, or select it and press M, to open the system
  view. It shows the star, the planets on their orbits, their moons and
  the asteroid belts. Esc, M or the Galaxy link at the top left returns
  to the galaxy map.
  - Planets show their surface, atmosphere and rings, lit from their
    star.
  - Each body's name sits under it. A colonised planet's name has a bar
    in its owner's colour. With System details on, the body's resources
    show under its name.
  - A system inside a nebula shows faint clouds behind it.
  - Names, System details and Nebulae have their own settings in the
    system view.
  - Click a body to open its page in the Inspector. Green arrows at the
    edge point along each hyperlane. Double-click one to go to the next
    system.
  - Scenario systems open too, laid out from their initializer. A
    distance the initializer leaves to chance shows as a band. An angle
    left to chance shows as an arc. A planet with no angle shows as a
    ghost on its whole orbit.

### Changed

- Symmetry is on Shift+M. M now opens and leaves the system view.

### Fixed

- The Inspector shows a system's inner and outer radius when the save
  writes them with decimals.

## [0.14.1] - 2026-09-25

### Changed

- Hyper relays no longer show the megastructure icon beside a system's
  name. On the Bypasses layer, the square that marks a relay is much
  fainter.

### Fixed

- On the Waylines layer, each waystation's level now shows when zoomed
  out. Zoomed in, the station has only its white ring.

## [0.14.0] - 2026-09-25

### Added

- Barren, frozen, toxic and grey goo planets have a Terraforming
  candidate checkbox on their page. It does what the console's
  `add_modifier` does. The planet can then be terraformed with Climate
  Restoration, plus Hydrocentric for frozen worlds or Detox for toxic
  ones. In a system's planet list, these planets show an Edit mark.
- On the command line, `sgf add-system --generate` can roll the new
  system again before saving. `sgf nebula add` picks a name from the
  save when you leave one out.

### Changed

- A system added inside a nebula joins it, with the nebula's cloud and
  cloaking.
- Added systems roll their deposits with the game's own minimums. A
  habitable world no longer always gets a blocker.
- The planet page shows the yields of Dragon Hoard and the artifact
  deposits.
- The dock's tabs move onto a second row when the dock is narrow, so
  their names are no longer cut off.
- The L-Gate, a nebula's name and radius, and a system's position use
  the same edit boxes as every other field.
- Auto-reload picks up more of a mod's files, including its deposits,
  planet and star classes, modifiers and name lists.
- The export report and the add-system picker use the game's names for
  mods and star classes.

### Fixed

- Del and Edit → Delete remove a system you added to a save.
- Opening a save no longer turns symmetry off the next time you start
  the app.
- Pinned searches past the sixth no longer hide the rings of the first
  six.
- Without game data, planet lists and pages show class names such as
  "Tropical World", and stars keep their Edit mark.
- A mod's ordinary systems no longer show the Unique badge.
- Adding a marauder clan right after a paint stroke no longer fails.
- Arrow keys no longer drop presses when you nudge a selection quickly.
- A system's issue ring shows its worst issue.

## [0.13.0] - 2026-09-25

### Added

- You can add star systems to a save. Right-click empty space and pick
  "Add system here" for a random system, or one around a star you choose.
  It comes with planets, moons, asteroid belts and deposits, rolled from
  the game's own rules at the save's resource abundance. Adding systems
  needs game data and a Stellaris 4.x save that isn't Ironman.
  - The new system opens on its page. Until you reopen the file you can
    roll it again, change its star, rename it or delete it. A small green
    plus marks it on the map.
  - Right-click a selection to delete every system in it that you added.
    The save's original systems cannot be deleted.
  - You can also add the game's unique systems, such as Zevox.
- Planets, moons, stars and asteroids in a save have their own inspector
  page. It shows deposits with the game's art and what each one gives,
  blockers and what clearing them costs, modifiers, moons, and a summary
  for colonies.
- A save system's planet list shows how far out each body orbits.

### Changed

- "New nebula here" places the nebula straight away, using names from the
  game's own name-lists. You can rename it on its page. Once the names run out,
  or in a scenario without game data, it's called New Nebula.
- Symmetry is disabled for saves.
- The Connect brush says when the lane density is too low to add any
  lanes.

### Fixed

- Nebulae added in the editor now show the 'cloud' graphics inside their systems and
  correctly hide ships, as the game's own nebulae do. A system that joins or leaves
  a nebula gains or loses both.
- A planet's orbital station link opens the station, not an unrelated
  ship.
- The update screen formats release notes with their headings and
  bullets.

## [0.12.0] - 2026-09-24

### Added

- A system's stars can be edited in a save: type and size per star, or
  one star class for several selected systems at once.
- Binary and trinary systems show each of their stars on the map.
- In a Stellaris 4.5 save, an empire's map colours can be picked from
  its inspector page.
- The inspector has a Back button, and fields you can edit have an
  outlined style.

### Changed

- The L-Gate outcome is hidden again each time you open a save.

### Fixed

- Hyperlanes can be added and removed in saves from Stellaris 3.4 to
  3.9.
- Waystations no longer clutter the whole-galaxy view or get dimmed
  under empire territories.

## [0.11.1] - 2026-09-23

### Changed

- Saves open with the Star classes and Colonies layers on.

### Fixed

- "Reset layers to defaults" no longer makes every later document open
  with the layers of the one that was open at the time.

## [0.11.0] - 2026-09-23

### Added

- Search finds systems by what is in them, such as "salvager", "gaia",
  "l-gate" or "leviathan". Every match is highlighted on the map.
- Pinned searches. Pin a search and its systems are highlighted in their
  own colour on every save you open.
- The Galaxy panel can reveal which L-Gate outcome the save rolled, and
  change it until a gate opens. It stays hidden until you click Reveal.
- Save asks before replacing a file that changed on disk since you
  opened it, for example after Stellaris autosaved over it.

### Changed

- Preventing lanes in a scenario is done from the map's right-click
  menus instead of the Inspector. It follows the symmetry mode.
- A crash or power cut during a save can no longer leave a half-written
  file behind.

### Fixed

- Salvager Enclaves are labelled as such on the map instead of just
  "Enclave".

## [0.10.1] - 2026-09-23

### Changed

- Alt on the Erase brush with "Lanes only" connects lanes instead of painting systems.
- Delete removes the selected systems on a scenario, one or several, after a confirm. Edit > Delete does the same.
- Shift+F with a nebula selected frames the nebula.
- `sgf export` names a scenario after the output file, as the app does. `sgf gamedata` reports the largest galaxy size and the Paint a Galaxy mod's status.

### Fixed

- The system selected after painting or adding one could be the wrong one.
- The Open screen asked its questions in a different order from the File menu, and asked the Paint question for a painted scenario outside the mod's folder.
- After a failed open the inspector could still show the previous document.
- A Join that left islands apart reported it as an error. "View issues" saved the dock's state as a preference.
- Removing a system after renaming or moving it left an empty line in the scenario file. A Paint seat with a hand-edited value above its range is now folded into range.
- The warning after adding an isolated system names the system, and the selection summary no longer says "1 lanes".
- The brush circle follows Alt without a pointer move, and switching tool by key clears the hover hints.
- Errors while watching the game files show in the status bar instead of being missed.

## [0.10.0] - 2026-09-22

### Added

- Brushes for building galaxies by hand. In a scenario, Paint scatters
  systems as you drag and joins them with hyperlanes, and Erase removes
  them. Connect and Cut draw and remove hyperlanes in saves too. Each
  stroke is one undo step.
- Symmetry mirrors or rotates your edits about the galaxy centre, 2 to 8
  ways. Adding, moving and deleting systems, lanes, initializers and
  brush strokes all repeat. Pick it from the button under the tools.
- Join islands links separate clusters of systems into one galaxy.
- Delete several selected systems of a scenario at once.
- A filter box for long selections.
- The Issues panel warns when a scenario has far more systems than the
  game's largest galaxy, or uses an initializer more times than the game
  allows.

### Changed

- A tidier window. The top bar is one row with File, Edit, View and Help
  menus, and it replaces the window's title bar. Tools, undo and redo sit
  on a strip down the left of the map.
- Dragging on empty space draws a selection box.
- The Open dialog is rebuilt. Tabs split saves from scenarios, saves are
  grouped by empire, and a details panel describes the selected file.
- Opening a scenario handles Paint a Galaxy more clearly. It asks before
  editing a plain scenario for the mod, and warns when the mod is off.

### Fixed

- Large scenarios stay quick. They open faster, and painting, deleting
  and selecting thousands of systems no longer freezes the editor.

## [0.9.0] - 2026-09-22

### Added

- The Windows installer, the portable app and the `sgf` command-line tool
  are signed. Windows no longer warns that the publisher is unknown.

### Changed

- The Issues tab says what each issue is, what it costs you in game and
  how to put it right. Hovering a flagged system on the map shows the
  same words.
- Issue headings drop the internal code in front of them and no longer
  run off the edge of the panel.
- Saving a map with issues offers a third choice, View issues. It takes
  you to the list and leaves a bar there with Save anyway on it, so you
  can read what was flagged and then save without starting over.
- The filter buttons read "From my edits", "Already in the save" and
  "Everything".
- A marauder clan's two other systems are called outposts rather than
  raid bases, in the inspector and the Issues tab alike.
- A system's Hyperlanes list cuts one lane at a time. This is the only
  way to remove a lane the map cannot draw, such as one from a system
  to itself.

### Fixed

- A system a wormhole reaches is no longer reported as having no
  hyperlanes, and nor is one whose gateway is open when another gateway
  is open elsewhere. A system reached only by its L-Gate is now a note,
  since the L-Gates may never be opened.
- A hyperlane the save lists twice is reported once instead of once per
  end, and as a note. Stellaris writes these duplicates itself and they
  do no harm.
- Empire seats that the Paint a Galaxy export has already given a
  generic start are no longer flagged as needing one.
- Right-clicking no longer opens a menu offering Back, Refresh and
  Print. The map, the panels and text boxes keep the menus they had.

## [0.8.0] - 2026-09-22

### Changed

- Empire borders and fills use the map colours set in Stellaris 4.5's
  empire creator. Empires without map colours keep their flag colours.
- Adding a marauder clan from the map, or the raid bases a marauder home
  is missing, is a single undo step.
- The "Listed under shapes" row in Game setup is renamed "Supported
  shapes", and the note after saving into Paint a Galaxy no longer tells
  you to choose Elliptical. The game's new-game screen treats a static
  map as a galaxy size and never asks for a shape.

## [0.7.0] - 2026-09-21

### Added

- Full Paint a Galaxy integration. This mod fixes native Stellaris spawn
  issues, ensuring custom empires actually appear. The editor now tracks
  your installation, supports all mod-specific data, and automatically
  saves scenarios to the correct directory.
- Custom Fallen Empire placement. Create, move, and configure Fallen
  Empire zones. Connect them to your network by manually drawing
  hyperlanes or letting the mod auto-link to the nearest systems.
- Native Marauder clans. Spawn clans in empty space or across three
  selected systems without needing any mods. The map displays them
  exactly as the game does, complete with black borders and skull
  emblems.
- Turn finished saves into fresh scenarios. Export an existing save to
  create a custom scenario that retains the original Fallen Empires and
  inherits the previous game's settings. The United Nations of Earth
  starts at its old capital. Any other empire's old capital is the
  likeliest start, not a certain one.
- In-editor game setup. Configure galaxy shapes and entity counts for new
  scenarios directly in the app. An "Update counts" button automatically
  syncs these values based on your current map.
- Save validation. The editor now prompts for confirmation before you
  accidentally save a map with unresolved issues.
- UI enhancements. Added visual guide layers for the map edge and
  L-Cluster, alongside detailed hover tooltips for all map icons.

### Changed

- Moving a system on a save with many empires no longer hitches on
  release. The territories are recomputed in a worker and the outlines
  follow a beat later. The recompute itself is cheaper too, since only
  the pieces of territory near the moved system are rebuilt.

### Removed

- The "Reserve for a human player" and "Reserve for the AI" checkboxes
  on a spawn point, and the `sgf spawn reserve` command. The game does
  not evaluate `is_ai` while it lays out a galaxy, so the modifier the
  editor wrote never held a seat for anyone or barred anyone from it. A
  spawn point is now a spawn point for any empire. A modifier already in
  a file is kept and listed as written.

## [0.6.1] - 2026-09-20

### Changed

- Backups are capped at eight per file: the original, the three newest
  and four spread over the time between. Older ones in between are
  deleted as new ones arrive.
- A save that changes nothing writes nothing and makes no backup.

## [0.6.0] - 2026-09-20

### Added

- The app checks for a newer release at launch and shows a badge. The
  dialog installs and restarts, opens the releases page, skips the
  version or leaves the decision for later.
- The Help menu adds the app's version, a manual check and a switch for
  the check at launch.

## [0.5.2] - 2026-09-20

### Changed

- A nebula is moved by dragging its ring, and resized only by the four
  handles that appear on the ring once it is selected. Its name and
  centre marker now just select it. A nebula whose name sits on a star
  could not be dragged without moving the star first. The cursor shows a
  move arrow on the ring and a resize arrow on a handle.

## [0.5.1] - 2026-09-20

### Changed

- The open screen's footer carries a "New scenario…" button and a
  "Browse…" button beside one sentence about opening a save as a save or
  as a scenario, in place of the keyboard hints and the two rows at the
  end of the list.
- A save opens with hyperlanes, systems, names, system details, empires
  and nebulae drawn, and every other layer off. Layers you switch on
  yourself still stay on across opens. Reset to defaults restores the
  set for the kind of document that is open. Scenarios keep their
  defaults.
- The open screen no longer lists dynamic scenarios (the game's own
  `setup_scenario` files and any other `.txt` without a
  `static_galaxy_scenario` block), which the editor cannot open. A static
  scenario that fails to read is still listed with the reason.

## [0.5.0]

### Added

- A new scenario can start from a blank canvas, a day-one save or a
  Paint a Galaxy export.
- Waystations, waylines, gateways and L-Gates are drawn on the map.
- A spawn point can be reserved for the AI as well as for a human
  player.

### Changed

- Moving a nebula in a save moves only the cloud. Its systems stay
  where they are.
- The layer group buttons switch a whole group on or off, and the layers
  you pick are remembered.
- More of the app can be used from the keyboard, and edits no longer
  wait for a search or the inspector.
- Bypass icons and leviathan names come from your install's files.

### Removed

- The search box's command mode. Every command it listed is in a menu
  or on a key.

### Fixed

- A scenario named with a quote or a backslash no longer writes a file
  the game cannot read.
- A mod that redefines a vanilla country wins over vanilla, as it does
  in the game.
- Day-one scripts no longer claim systems they might not match, and
  scripted wormholes pair with the right systems.
- Many smaller fixes to undo, nebulae, labels, layers and game data
  reloads.

## [0.4.0]

### Added

- Systems that scripts or day-one events give to an empire are drawn as
  its territory.
- The inspector opens planets, fleets, starbases, megastructures and
  systems with their contents and source text.
- A scenario's header keys, spawn points, prevented lanes and nebulae
  can be edited.
- Wormholes and gateways that a scenario's scripts place are drawn on
  the map.
- Game data reloads itself when its files change.
- Releases are published on GitHub.

### Fixed

- A leviathan's system no longer draws as an empire when a save is
  opened as a scenario.
- Empire flags that use mod colours draw on the map.

## [0.3.0]

### Added

- A new layout with a tabbed dock, a top bar with search and layer
  toggles, and a status bar.
- Static galaxy scenarios open, edit and save like saves. In a scenario
  you can also add, delete and name systems and pick their initializers.
- An initializer browser with search, filters and a preview of what each
  one spawns.
- A search palette finds systems, empires, planets, fleets, stations and
  nebulae by name.
- The Open screen lists recent documents, your campaigns and every
  scenario from your mods and the install.

### Changed

- The middle mouse button pans the map. A left drag on empty space
  draws a selection box.

### Removed

- The editing lock. A drag always moves a system.

## [0.2.0]

### Added

- The map uses your install's star art, icons and names, matching your
  DLC and the save's mods.
- Empire territories are drawn as the game draws them, with each
  empire's colours, emblem and name.
- Leviathans, enclaves, marauders, fallen empires and landmarks are
  marked on the map.
- Zooming in shows each system's owner, starbase, resources and fleets.
- Moving a system across a nebula's edge updates the nebula.
- Saves in Steam Cloud are badged, and saving one asks you to confirm
  first.

## [0.1.0]

### Added

- Open a Stellaris save and see its galaxy.
- Move systems, and add or cut hyperlanes, one at a time or for a whole
  selection.
- Undo and redo every edit.
- Save keeps a backup of the original, and leaves everything you didn't
  edit as it was.
- The `sgf` command-line tool makes the same edits from a terminal.
