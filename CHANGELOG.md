# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version
numbers follow [Semantic Versioning](https://semver.org/). Entries under
Unreleased ship with the next release. `docs/engineering-rules.md` says how
a release is made.

## [Unreleased]

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
  create a custom scenario that retains the original Fallen Empires,
  starts you at your old capital, and inherits the previous game's
  settings.
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

Launch as Stellaris Galaxy Forge. The crates are `sgf-core`,
`sgf-gamedata` and `sgf-cli`, the command line is `sgf`, and macOS
universal builds are published beside Windows and Linux. The New scenario
dialog gains three starting points, waystations and waylines are drawn
from a save, and gateways and L-Gates get bypass badges. The shell sweep
lands, a spawn point can be reserved for a human player or the AI, and the
fixes below close the release out.

### Added

- The project is now Stellaris Galaxy Forge, and so is every download.
  A release carries the Windows installer, MSI and portable zip, the
  Linux AppImage, deb and rpm, a macOS universal `.dmg`, the `sgf`
  command-line tool for each platform and a `SHA256SUMS` file. The macOS
  builds are unsigned, so Gatekeeper needs persuading the first time.
- The New scenario dialog offers three ways to start: a blank canvas, a
  day-one save from the game opened as a scenario, or a paint-a-galaxy
  export by Oatmeal Problem.
- Waystations and waylines are drawn from a save: each network's
  stations, and the lines the game derives between two stations joined
  by a lane or a bypass. The inspector names a station by its level,
  Waystation, Wayport or Wayhold, with its type and its wayline network,
  and marks the lanes a wayline runs along. The map draws each wayline as
  the game does, a dashed band along the lane between two stations, behind
  a Waylines layer toggle that starts off. Cutting a lane ends a wayline
  only when no bypass still joins the pair.
- Gateways and L-Gates are drawn with the same badge as the points of
  interest, ring, plate, icon and label, on the side the
  point-of-interest badge does not take. A ruined gateway's badge draws
  at full strength, and a bypass badge keeps its star at every zoom as a
  notable point of interest does.
- Shell sweep: number keys 7, 8 and 9 toggle points of interest, nebulae
  and issue highlights. The status bar says when the document was saved
  and follows lane hover and ring drag. Backspace goes back in the
  inspector. Long flag lists gain a filter. Station and megastructure
  rows gain a focus button. Fleet rows show planet-killer and disabled
  states. Kind chips explain each special kind. The Game data menu lists
  diagnostics.
- A spawn point can be held for the AI as well as for a human player,
  one at a time. Clearing the spawn point takes the reservation with it.
  Reserving every other spawn point for the AI pins the human player to
  one system. A zero base with a modifier that adds weight counts as a
  spawn point, so a mod's AI start can be reserved without its weight
  being touched.

### Changed

- A spawn point held for a human player is marked with a person, one
  held for the AI with a robot, and an open one with both, on the map
  and on the Spawns button, in place of the triangle. The mark keeps one
  colour throughout.
- The group buttons are plain pills: each switches the bar's layers of
  its group on or off and remembers nothing. Day-one claims switch
  Empires on with them and go off with it. A shown point-of-interest
  kind switches its layer on. Nebulae has a bar toggle on both kinds of
  document, Empires closes the Initializers frame, and undo and redo
  stack.
- Moving a nebula in a save moves the cloud alone, as in a scenario: its
  systems stay where they are and its member list follows the new
  radius, with the same warning a system crossing a boundary gets.
- The planet list leads with the star under a system-total band. An
  artless star shows its class texture or a radiant glyph, and an
  artless planet the map's neutral marker. A random habitable class and
  the empire's ideal class count and tint as habitable, and the random
  classes say what they draw from. Script paths truncate with the full
  path on hover. The search field says what each kind can find, with its
  key as a badge.
- The changes list wraps instead of truncating and fills its tab. The
  initializer browser has a close button beside its search. The Changes
  rows, the initializer list and the inspector's drill rows can be
  operated from the keyboard. Every dialog dismisses on a press outside
  it the same way.
- Which layers are shown and the mesh slider's value persist per machine
  like the other hand-set preferences. What a document decides does not.
- An edit no longer waits on a read, a search or the inspector's
  details. Reads, searches and the registry getters run off the main
  thread, and the inspector's details are resolved once the document
  lock is released. Edits, undo and redo stay in order.
- The status bar says why auto-reload is off or incomplete, and how many
  times a file changed before a pause.
- A mod whose descriptor cannot be read is named on the Open screen's
  scenario list.
- Resetting a lane's length is one op and the core computes
  `floor(distance)`. `sgf lane normalise <doc> <a> <b>` does the same
  from the command line.
- Preventing a lane between two systems the file already links is
  refused with a message that says so, and a missing save or scenario
  file is reported as not found whatever the operating system calls it.
- Bypass map icons take their frame from the install's `common/bypass`
  definitions, and a leviathan badge names the country the initializer
  really spawns. The built-in tables are only the no-game-data fallback.
  The vanilla dragon now reads "Voidwyrm", as the game's own files say.

### Removed

- The Homeworlds, L-Gates, Hostiles and Precursors points of interest:
  the capital emblem and the spawn marks, the bypass badges, and the
  flags those two read already say the same, or say it better.
- The palette's `>` command mode: every command it listed lives in a
  menu or on a key, and the box now searches the document alone.

### Fixed

- `sgf validate` on a scenario reported nothing: it projected the file
  as a save. It now opens the document as the app does and prints the
  document's own issues too.
- `sgf inspect` and `sgf roundtrip` say they read saves only, instead of
  failing on the archive.
- Removing a nebula that an earlier edit in the same session had moved,
  resized or renamed was refused with "empty section" and rolled back.
  The erased statement is now seen as gone.
- A new scenario named with a quote or a backslash wrote a file the game
  could not read. The name is refused, and an exported scenario's file
  stem drops those characters.
- Removing lane pairs on a scenario accepted pairs that were not linked
  and recorded an inverse that would have added them. Both formats now
  refuse the same input, and a lane removal's inverse never names a
  system the galaxy does not hold.
- Renaming a scenario system that had no name recorded an inverse that
  wrote an empty name. Undo now removes the statement. An empty name is
  refused everywhere a name is required.
- A mod that redefines a vanilla country behind the same flag or event
  target lost to vanilla, and which file won could depend on an
  initializer key's spelling. The last file wins, in the game's own
  order. A prescripted country defined in a later file no longer loses
  to an earlier one whose definition name sorted first.
- A day-one script that gives a system away inside a scope the reader
  cannot follow claimed every system its loop matched. It now claims
  nothing there. A `link_wormholes` pairs with the spawn it follows, a
  wormhole spawned inside a `while` lands on the initializer's own
  system, and two elsewhere-spawns that both link back to an
  initializer's own system each pair once.
- The inspector's Contents tab stayed on "Reading the system's
  contents…" for ever when the read failed. It now says the read failed
  and tries again after the next edit.
- Editing a scenario header field rebuilt the whole map and reset the
  camera to the galaxy fit.
- A failed game-data load (a wrong path) left the old data loaded but
  the file watcher gone until the next successful load. A file change
  arriving while no data is loaded no longer stops the watcher for good.
- With the Scripts or Initializers layer off, a system carrying both an
  initializer gateway and a scripted wormhole still showed the hidden
  one.
- An empire's name kept the scale of its placeholder when the localised
  name arrived, so long names overflowed their region.
- The empire labels relayout the moment the Empires layer flips, instead
  of waiting for a zoom.
- A scenario system whose initializer names its star class (a black
  hole, a pulsar) is drawn with that star on the map and in its planet
  list, in place of the generic star.
- A nebula shrunk to a near-zero radius could no longer be dragged by
  its centre, and two quick "Add nebula" actions selected the wrong
  nebula.
- The spawn-weight refusal hint stayed on screen after the edit was
  abandoned.
- Name lookups still running when the game data was unloaded or reloaded
  wrote into the new registry or left a stale error, a resource-icon
  read that failed cached an empty set for the session, and a search
  that failed read as "no results".
- Opening a second document while one was still loading closed the Open
  dialog with nothing opened. The dialog now stays and says so.
- Clicking a group heading or the hint line in the search palette closed
  it, and a dialog no longer outlines its first choice before the
  keyboard reaches it.
- Undo and redo of an initializer edit now re-classify the special
  systems and territories, once per run.

## [0.4.0]

Scripted ownership and day-one claims, entity views (Contents, Data and
Source), game-data auto-reload, scenario header keys, spawn weights and
reservations, prevented lanes, the bypasses layer and three-source layer
groups.

### Added

- Scripted ownership: a system whose script chain sets an owner at
  galaxy generation is drawn as that empire's territory, with the name
  and flag colours its `create_country` and the localisation give it, in
  vanilla and in mods. The scripts a scenario's initializers reach are
  indexed (spawned initializers, scripted effects, events, on-actions,
  prescripted countries). The empire browser lists them beside the
  save's empires.
- Scripts section in a scenario system's inspector: every script that
  reaches the system, tagged as running at generation, on day 1 or
  later, one row per script with every line that names the system, and
  Show in Explorer and Open in editor, which reach any file under the
  loaded install, your user folder or a loaded mod.
- Day-one ownership: the `on_game_start` events that hand systems to an
  empire before the first frame, keyed on the star and global flags the
  initializers set, extend each territory. The inspector and the Empires
  browser mark those systems "day 1" with the event that claimed them,
  and "assumed" where the claim rests on a condition the editor cannot
  judge. A planet an initializer colonises shows the coloniser's emblem
  and plate as a save's does.
- Entity views: a planet, fleet, starbase, megastructure or system opens
  in the inspector with its facts, Contents rows that drill one level at
  a time, a Data tab over the parsed statement and a Source tab showing
  the current bytes with every changed range marked.
- Game data reloads itself: the loaded files are watched, a change
  rebuilds only the registry it belongs to and the map redraws. Bursts
  are debounced with a floor of two seconds, and a runaway writer pauses
  auto-reload after ten rebuilds in a minute until Resume is pressed in
  the status bar or the Game data menu.
- The scenario header is listed in the galaxy inspector key by key as
  raw text: each key can be edited, removed or added, and a value that
  would break the file (an unclosed quote, a comment, a second
  statement, an entity key) is refused before it is written. Prevented
  hyperlanes are listed in the Hyperlanes section, drawn dashed on the
  map, and can be allowed or added there. `sgf header set|unset` and
  `sgf lane prevent|allow` on the command line.
- Spawn points: a map layer marks every system with a spawn weight, and
  a scenario system has a spawn-point toggle and weight in the
  inspector, with "Set as spawn point" and "Remove spawn point" in its
  right-click menu for every selected system at once. Setting, weighting
  and clearing are ops of their own, so assigning an initializer no
  longer drops an author's weight. A system can be reserved for a human
  player (the `factor = 0 is_ai = yes` modifier the game reads). A
  weight's modifiers and `spawn_design` are read from the file and shown
  with the reservation they express. The galaxy view shows the core
  radius. `sgf spawn weight|reserve` on the command line.
- Scenario bypasses: the wormholes and gateways an initializer places at
  its own system, and the ones the day-one events place at systems their
  star flags name, are drawn by the bypasses layer as two toggles,
  "Bypasses" under Initializers and "Day-one bypasses" under Scripts,
  listed in the system inspector with their partner, and counted in the
  galaxy panel where the game places them at random instead.
- A scenario's map and inspector say what the file holds and what the
  scripts add. The layer bar splits into three framed groups, Scenario,
  Initializers and Scripts, each layer belonging to exactly one. Star
  classes, colonies and day-one claims are their own toggles.
  Initializers (`0`) and Scripts (backtick) each have a master that
  strips their layers and folds their sections. The initializer legend
  opens as a flyout beside the scrolling Layers menu. Every section and
  territory row carries the chip of the group that feeds it, with teal
  for derived, read-only information. A save keeps its flat bar and
  gains the star class and colony toggles.
- Nebulae can be added, removed, resized and renamed, in saves and
  scenarios, with membership kept in step on every change and refreshed
  when a nebula moves. A new nebula is named first, since the name is
  the handle it is dragged by, and creating one shows the nebulae layer.
  `sgf nebula add|remove|radius|name` on the command line, beside the
  existing `move-nebula`.
- Selecting several systems lists the actions the context menu offers on
  them, and a system chip deselects that system instead of jumping to
  it.
- Releases: merging a version bump to `main` tags the commit and
  publishes the installers, the command-line tool and a checksum file as
  a GitHub release, and the app carries its own hammer icon on every
  platform in place of Tauri's placeholder.

### Changed

- The scenario system inspector is reprioritised: the name is edited in
  place in the head, the planets follow the initializer, hyperlanes
  start closed, the spawn point is its own section with a "reserve for a
  human player" control, Scripts is a tab of its own and the Source tab
  wraps the file's long lines. The dock, the layer toggles and the
  search box leave the window while no document is open, and `F`
  searches when nothing is selected, as in the game.

### Fixed

- A leviathan's system no longer draws as an empire when a save is
  opened as a scenario: the guardian's country, which its vanilla
  initializer saves from a `last_created_country` block, now resolves to
  its own name instead of a raw token, and an owner no script resolves
  is listed but never drawn.
- A scenario system's Scripts list now shows only the scripts that act
  on that system, instead of every script that mentions its empire: it
  follows the targets saved in the system's own scope and reads the
  initializer's `flags` list.
- An empire flag whose colours the install does not name (a mod's
  `customcolor…`) composes untinted instead of not at all, so the
  empire's emblem and homeworld badge draw on the map.
- The system inspector's subtitle showed the star class key instead of
  its name and counted planets from the map projection rather than the
  system's contents.

## [0.3.0]

The shell redesign (tabbed dock, inspector navigator, search palette,
layers bar), static galaxy scenarios (open, edit, save, export, new), the
initializer browser, and the open screen with campaigns and scenarios.

### Added

- A new shell: one tabbed full-height dock (Inspector, Empires, Points
  of interest, Issues, Changes) that follows map and search selections,
  a top bar with the File menu, undo and redo, a centred search box and
  SVG layer toggles on the number keys with a grouped Layers menu, and a
  status bar carrying the issues badge. `F` frames the selection, and
  each point-of-interest kind is a layer of its own with a select-all
  row that reads mixed.
- Inspector navigator: a breadcrumb stack with Overview, Contents, Lanes
  and Data tabs. A system view carries game-art planet rows (class icon,
  size and pop glyphs, deposits), station, military and utility fleet
  rows with a ship-size badge, megastructures, initializer and flags.
  Galaxy, multi-selection and lane views share the same anatomy.
- Empires are grouped by type with pan-to-capital, select-and-fit and an
  eye that hides a territory. Points of interest are grouped by kind and
  by initializer file. Issues keeps the at-load baseline behind a
  filter, so only new issues are counted.
- Search palette: hits grouped by kind with icons and sublines, prefixes
  and Tab cycling, Shift+Enter to add to the selection, recent hits on
  an empty query, and systems, countries, planets, fleets, stations and
  nebulae found by their localised and templated names. It works with no
  document open, and a nebula hit pans the camera without selecting.
- First launch pauses on a setup card that explains the game data, names
  the install it found and offers Change or Continue. Later launches
  cover the load with a start screen.
- The File menu gains Open recent and Campaigns, and the Game data pill
  opens a menu with the path, Reload and the auto-load toggle.
- Static galaxy scenarios (`map/setup_scenarios/*.txt`) open, edit and
  save beside `.sav` files, byte for byte outside the edited statements:
  move systems, add and cut lanes, move nebulae. A scenario can also add
  and delete systems, name them and give them an initializer chosen from
  the loaded game data, vanilla and mod. New scenario from scratch,
  export a save as a scenario, or open a save as one. `sgf
  export-scenario` and `sgf new-scenario` on the command line.
- A scenario system's initializer gives the map and the inspector what
  it will spawn: the star, the planets and moons, their resources,
  megastructures, dig sites and a starbase. The map labels an unnamed
  system with its initializer, faded, with a legend that hides chosen
  initializers. A named system keeps its label at every zoom. The
  galactic core is drawn as a ring on both kinds.
- Initializer browser: a large overlay for choosing a scenario system's
  initializer, with search across key, name, star class, usage, mod and
  flags (`usage:`, `mod:`, `class:`, `flag:`, `planets:>5`), the groups
  with counts, pinned and recent entries, and a detail pane showing what
  the initializer spawns before it is assigned. Assigning to a
  multi-selection is one undo step. It opens from the inspector, the
  context menu, the palette and Shift+I, and the highlighted
  initializer's systems are ringed on the map.
- Open screen: the Open command and the empty state list recent
  documents of both kinds, the save campaigns with each save's empire,
  date, version, cloud and ironman flags loaded folder by folder, and
  every scenario file from your mods, the playset and the install with
  its system count and who overrides it. A save row opens as a save, or
  as a scenario from its "as scenario" button, with Shift+Enter or from
  the File menu. Activating it asks which. Opening or reloading either
  kind shows one loading overlay with the file name, the phase and a
  progress bar.
- A default initializer per machine, set from the browser. Right-click
  on empty space places a new system with it, with the last used one, or
  from the browser.
- The Game data menu lists the loaded mods.

### Changed

- The middle mouse button drags the camera. A left drag on empty space
  no longer pans, so it is free for the marquee.
- A system name is no longer hidden because another label overlaps it.

### Removed

- The editing lock and its `L` key: a drag always moves and an op always
  applies.

### Fixed

- The Open command did nothing: the dialog closed itself as it opened.
  Ctrl+O now opens the Open screen and Ctrl+Shift+O browses for a file.
- Definitions in subfolders of a mod's `common/` folders were not read,
  so a mod's initializers kept there did not resolve.

## [0.2.0]

Game data read from the install and its mods: star and planet art,
localised names, empire territories and colours, special systems
(leviathans, enclaves, marauders, fallen empires, landmarks), nebula
membership, per-system details (planets, deposits, starbases, fleets) and
Steam Cloud awareness.

### Added

- The map draws with your own install's art and names: star sprites by
  class, the game's map icons, and localised system, empire, planet and
  fleet names, matching your DLC and the mods active for the save.
  Nothing is bundled. With no install to read, the map falls back to
  procedural stars and generated names.
- Empire territories drawn as the game draws them: a region per country
  from discs clipped against foreign systems and lane bands severed by
  the nearest foreign neighbour, smoothed, coloured from the empire's
  own flag, with the emblem and the empire name fading in as the system
  names fade out. Borders meet unowned neighbours half way.
- Special systems from the save's flags, initializers and sectors:
  leviathans, enclaves, marauders, fallen empires, landmarks and
  uniques, each with a halo and ring on its star, the kind's game art on
  a plate, a label at every zoom and a tooltip. Marauder clans and
  fallen empires are marked by their territory instead. The legend
  counts each kind and selects it.
- System details under each star when zoomed in, laid out after the
  game's own map icon: the owner's emblem, starbase, megastructure,
  bypass, dig-site, pre-FTL and fleet icons with tooltips, a dense
  resource row with the game's resource sprites, and the free habitable
  planets stacked beside the star.
- Per-system contents read from the save: planets with class, size and
  pops, orbital deposits, starbases with their level, modules and
  buildings, megastructures, archaeology sites, pre-FTL worlds, and
  fleets with their military power, ship sizes, planet-killer and
  disabled states. `sgf details <sav> <id>`, or `--all`.
- Names built the way the game builds them: sequential numbers as
  ordinals, cardinals, roman or hex, acronyms from a base name, and the
  variable slots a template leaves for the caller, on countries, planets
  and fleets alike.
- Ownership follows the game's rules: a system with no sector belongs to
  whoever runs its first starbase (marauder clans, the Caravaneer
  citadel), and only countries whose type generates borders draw a
  territory, so fauna fleets and station-only countries are told apart
  from empires.
- Map layers for nebulae, bypasses and issues beside the existing ones,
  named after the game (Hyperlanes, Empires, System names and the rest),
  with hyperlanes, systems, system names, empires and system details on
  when the app starts.
- Nebulae: moving a system across a nebula's edge updates that nebula's
  member list, moving a nebula carries its members with it, and the
  validator flags a membership list out of step with the positions.
  `sgf move-nebula <sav> <index> <x> <y>`.
- Panels for the validator's issues and for the change log, a lock
  button, keyboard nudging and numeric position entry for an exact move.
- Steam Cloud awareness: saves found in Steam's own folder are badged in
  the open list and in the status bar, and the first save of such a file
  in a session asks for confirmation, since Steam can replace an edited
  file with its cloud copy.
- Saving reports its progress from the write path, so a large late-game
  save says how far it has got.
- More of the command line: `sgf gamedata` summarises the install, the
  active mods and what was read from them, `sgf special` lists a save's
  special systems, and `sgf texture` decodes a game texture by key
  (a star class, a flag, a composed empire flag) to a PNG.

## [0.1.0]

The galaxy editor: open a save, move systems, add and cut lanes, isolate,
undo and redo with a change log, validation, save with backup then
persist, a byte-identical round trip, the `sgf` command line (inspect,
validate, roundtrip, move, lane, isolate, synth) and the sample save
corpus.

### Added

- Open a Stellaris `.sav` and see its galaxy. The map fills the window,
  a drag or the middle mouse button pans, the wheel zooms on the
  pointer, and Home fits the whole galaxy. One pass over the gamestate
  indexes every statement by counting braces and builds the galaxy from
  it.
- Move a system by dragging its star, with a ghost of the system and its
  lanes following the pointer. Shift+Arrow nudges by one unit and
  Ctrl+Shift+Arrow by ten, and exact x and y can be typed in the panel.
  Moving recomputes the stored length of every lane on both of its ends.
  Nothing inside the system moves, because planets, fleets and stations
  are stored relative to their star.
- Add a hyperlane by dragging from the ring that appears around a
  zoomed-in star, or by Shift+dragging at any zoom. The rubber line
  snaps to the nearest system and refuses a pair that is already linked.
  A new lane gets the length the game's own generator would write, the
  whole number just below the distance between the two stars.
- Cut a lane by selecting it and pressing Delete, by clicking the cross
  at its midpoint, by Shift+clicking it, or from its right-click menu.
  Isolate removes every lane of a system at once.
- Multi-selection with Ctrl+click, Shift+click, a marquee and Ctrl+A.
  The selection moves as a rigid group, and takes bulk actions: connect
  every missing pair, connect the selection to one other system, cut the
  lanes between the selected systems, and isolate.
- Connect as mesh: a Delaunay beta-skeleton with a sparse-to-dense
  slider that previews the lanes it would add before any is applied.
- Every edit is undoable, with Ctrl+Z, Ctrl+Y and buttons whose tooltips
  name the edit they would apply. The Changes panel lists every edit
  since the file was opened, oldest first, with the undone ones greyed.
  Clicking an entry steps back to that point.
- A validator runs when a save opens and after every edit, with its
  counts in the status bar. A lane listed on one end only, a lane to a
  system that does not exist and a lane from a system to itself are
  errors. A duplicate lane entry, a system with no lanes, a system
  outside the galaxy radius, a stored length that disagrees with the
  distance and a galaxy split into more pieces than it had are warnings.
- Save (Ctrl+S) and Save as (Ctrl+Shift+S) write the file with a backup:
  the new bytes go to a file beside the old one, the old one is renamed
  `<name>.sav.bak-<timestamp>`, and only then does the new file take its
  place. A failed write puts the original back. Unsaved edits are
  guarded when you open another document, close one or close the window.
- The save is edited as bytes. Only the statements you changed differ,
  and everything else, including whatever a mod or a newer game version
  put there, is copied out untouched. A save opened and written back
  with no edits is byte-identical to the original, and a test asserts
  it.
- System names appear as you zoom in and thin out where they would
  overlap. A selected or hovered system keeps its name whatever else is
  on screen.
- The `sgf` command line does the same edits from a terminal, in place
  and with the same backup unless `-o` names an output: `inspect`,
  `validate`, `roundtrip --check`, `move`, `lane add|remove|length`,
  `isolate`, and `synth` for a synthetic save to test against.
- Checked in game on 4.4.6: a moved system sits at its new position with
  its lanes intact, a new lane can be flown in both directions, a cut
  lane is gone and the pathfinder routes around it, an isolated system
  loads without complaint, and the campaign can be played on and saved
  from the game again.

[Unreleased]: https://github.com/IanHeinrich/stellaris-galaxy-forge/compare/v0.5.0...HEAD
