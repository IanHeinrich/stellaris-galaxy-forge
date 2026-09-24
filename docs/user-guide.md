# Stellaris Galaxy Forge user guide

Stellaris Galaxy Forge edits the galaxy map of a Stellaris save, or of a
static galaxy scenario that a new campaign can start from. It works on
Stellaris 4.x saves. I have checked the edits in-game on 4.4.6 and 4.5.0.

## Quick start

1. Start the app. It lists the saves and scenarios it found on this
   machine.
2. To edit a campaign, pick a save, press Enter and choose "Edit as
   save". To make a new galaxy, click "New scenario…", or pick a save and
   click "Open as scenario".
3. Drag a star to move it. Zoom in until a ring appears around a star,
   then drag from the ring to another system to draw a hyperlane. Ctrl+Z
   undoes.
4. Press Ctrl+S. The previous file stays beside the new one as a backup.
5. Load the save in Stellaris as usual. For a scenario, see
   [Play your scenario](#play-your-scenario).

On a Mac, read Cmd wherever this guide says Ctrl.

## Open a file

The Open screen lists your saves by campaign, newest first, and the
scenarios in your install and your mods. It finds saves in the game's
save folder and in Steam's cloud folder. Cloud saves are marked "☁" (see
[Steam Cloud saves](#steam-cloud-saves)) and Ironman saves "⚿".

Enter or a double-click opens the selected row. A save first asks whether
to edit it as a save or as a scenario. "Browse…" opens any `.sav` or
scenario `.txt` file. Once a document is open, Ctrl+O brings the list
back.

## Get around the map

- Hold the middle mouse button and drag to pan, or hold W A S D. The
  wheel zooms. Home fits the whole galaxy.
- F opens search. It finds systems, empires, planets, fleets and nebulae,
  and systems by what is in them, such as "gaia". Pin a search to keep
  its systems ringed on every save.
- The number keys 1 to 9 switch the main map layers. The Layers menu in
  the top bar holds every layer.
- The dock on the right has the Inspector, Empires, Points of interest,
  Issues and Changes tabs. With nothing selected, the Inspector shows the
  whole galaxy.

When the app finds your Stellaris install, the map uses the game's star
art and names, with your mods. Without it, the map draws plain stars and
generated names.

## Edit a save

### Select and move

Click a system to select it. Ctrl+click adds or removes one, and dragging
on empty space draws a selection box. Escape clears the selection.

Drag a star to move it, with the rest of the selection if it is selected.
Shift+Arrow nudges the selection. For an exact spot, type into the
Position fields on the Inspector's Overview tab. A moved system keeps its
lanes, and their lengths are updated. Its planets and fleets move with
it.

### Hyperlanes

- To add a lane, zoom in until a ring appears around a star, then drag
  from the ring to another system. Shift+drag from the star works at any
  zoom.
- To cut a lane, hover it and click the "×" at its middle.
- With several systems selected, the Inspector offers "Connect to each
  other", "Connect as mesh" and "Cut hyperlanes between".
- Right-click a system and pick "Isolate" to remove all its lanes.

The Connect lanes (C) and Cut lanes (X) brushes on the tool strip work in
broad strokes. `[` and `]` resize the brush, and holding Alt swaps the
two. Each stroke is one undo step.

When the lanes leave the galaxy in separate pieces, a "Join" button
appears beside Components in the Inspector. It links the pieces with the
shortest lanes that cross none.

The game uses a lane's stored length as its travel cost. A lane whose
length doesn't match its distance is marked "!", and "Reset length" fixes
it.

### Nebulae

Switch on the Nebulae layer first. Drag a nebula's ring to move it.
Select it and drag a handle on the ring, or press `[` and `]`, to resize
it. Right-click empty space for "New nebula here".

### Stars and empires

- Each star in a system's planet list has an "Edit" mark. Its page sets
  the star's type and size.
- With several systems selected, the Star class action gives them one
  class.
- In a Stellaris 4.5 save, an empire's page has Border and Fill colour
  pickers.
- With nothing selected, the Inspector can reveal which L-Gate outcome
  the save rolled, and change it until a gate opens.

### Symmetry

The Symmetry button under the tools, or M, repeats your edits about the
galaxy centre, as a mirror or a 2 to 8-fold rotation.

## Make a scenario

A static galaxy scenario is a `.txt` file the game can start a new
campaign from instead of a random galaxy. There are three ways to make
one:

- "New scenario…" then "Blank canvas" gives you an empty map.
- "New scenario…" then "A galaxy from the game": start a new game in
  Stellaris, save on day one, and open that save here. You get the game's
  layout, names and empires to edit.
- Pick any save and click "Open as scenario", or use File → "Export as
  scenario…". The save itself is left untouched.

The file starts with a `# created by` line naming Forge's version.
Saving an edited scenario from Forge or Paint a Galaxy adds Forge to that
line, so it lists every tool and version that wrote the file.

### The Paint a Galaxy checkbox

Each route has a "For the Paint a Galaxy mod" checkbox, ticked by
default. The game's generator has bugs with custom galaxies that the
[Paint a Galaxy mod](https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115)
fixes. Keep the box ticked for any map you will play. Untick it only for
a mod of your own.

A save converted for the mod makes your capital your seat. Each fallen
empire becomes a fallen empire zone at its old capital. The L-Cluster is
left out, because the game adds its own.

A scenario for the mod shows a "PaG" badge in the top bar. The badge
warns when the mod isn't installed or isn't enabled.

### What you can edit

Everything from [Edit a save](#edit-a-save), plus:

- Right-click empty space to add a system. "New system from…" lets you
  choose what it spawns.
- Paint systems (B) scatters new systems under the brush and joins them
  with lanes. Erase systems (E) removes them.
- Select systems and press Delete to remove them.
- Shift+I opens the initializer browser, which sets what a system
  spawns. It shows what each one places before you assign it.
- Right-click a system and pick "Set as spawn point".
- Right-click a lane and pick "Cut and prevent" to stop the game ever
  drawing it.
- Right-click empty space and pick "Add marauder clan here".
- With nothing selected, the Game setup section holds the counts the
  new-game screen offers, such as AI empires.

On a map for Paint a Galaxy you can also:

- Set each seat's kind. Enabled seats take any empire. Preferred seats
  are favoured. Sol is for the United Nations of Earth. Reserved A to Z
  seats are for one empire each.
- Right-click a system and pick "Add fallen empire zone". Drag the ring
  to move it, and drag from a system's ring onto it to choose what the
  fallen empire connects to.
- Link two selected systems with "Link as wormhole pair".
- Click "Update counts" when Game setup says the counts no longer match
  the seats and zones.

The Scripts tab and the day-one layers are a best guess at what scripts
will do on day one. The app can't follow every script.

## Play your scenario

### A map for Paint a Galaxy

1. Subscribe to the
   [Paint a Galaxy mod](https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115)
   on the Steam Workshop.
2. Use File → "Save into the Paint a Galaxy mod…". It saves into the
   mod's `map/setup_scenarios` folder, where the game looks for it. Steam
   can replace that folder when the mod updates, so keep a copy of your
   map somewhere else too.
3. In the Paradox launcher, enable Paint a Galaxy in your playset. If
   your map has reserved seats, enable the
   [Reserved Spawns submod](https://steamcommunity.com/sharedfiles/filedetails/?id=3762808682)
   as well.
4. In Stellaris, start a new game. Your map is listed as a galaxy size,
   under the name in the scenario's header. The status bar tells you the
   name when you save into the mod. The game doesn't ask for a shape
   once you pick it.
5. Keep AI empires at or below the "safe AI empires" number in Game
   setup. Past that, there are more empires than seats.

Give each map in the mod's folder its own name. The game shows only one
galaxy size per name.

On day one:

- Each empire starts on a seat and brings its own home system. Anything
  the seat's initializer spawns nearby still appears.
- Only the United Nations of Earth can start on a Sol seat. Only an
  empire whose species has the matching trait from the Reserved Spawns
  submod can start on a reserved seat. With "Weighted for its empire"
  ticked on the seat, that empire is certain to start there.
- A preferred seat is only the most likely start, even when weighted. An
  AI whose origin needs a special place, such as Fear of the Dark, is
  seated before you and draws by the same weights. In my test games such
  an AI took the weighted preferred seat two times in three.
- A save converted for the mod gives your capital a weighted Sol seat if
  you play the United Nations of Earth, and a weighted preferred seat
  otherwise.
- The mod builds each fallen empire in its zone and opens your wormhole
  pairs. The game adds its own L-Cluster.

The mod's Workshop page lists its limits. The Advanced Neighbors setting
has no effect. Every precursor is on. Sol gets no Sol-specific
neighbours, and the Local Cluster mod is the usual fix. Nomads with
random homes don't start in a nomad system. The game also adds systems
your map didn't have: guaranteed worlds, marauders, fallen empires and
some events.

### A plain scenario

A scenario made without the checkbox has to sit in the
`map/setup_scenarios` folder of a mod enabled in your playset. Without
Paint a Galaxy, the game gives a custom galaxy wrong homeworlds and no
marauders or fallen empires. Your own mod has to deal with those.

## Save and back up

Ctrl+S saves to the file you opened. "Save as…" (Ctrl+Shift+S) saves
somewhere else. Everything you didn't edit is written out exactly as it
was.

Each save keeps the previous file beside the new one, as
`<name>.sav.bak-<date>-<time>`. The earliest backup is the file you
opened. Each file keeps up to eight: the original, the three newest and a
spread of the rest.

If Stellaris wrote the file after you opened it, Save asks before
replacing it. When the map has issues, Save offers "Save anyway".

### Restore the original

Move or delete the edited `.sav`, then rename its earliest backup to
`<name>.sav`.

### Steam Cloud saves

With Steam Cloud on, Steam can overwrite an edited save with its cloud
copy. The app asks before the first save to a "☁" file. Before you play
an edited cloud save, close Steam or turn off Steam Cloud for Stellaris.

## Undo and issues

Ctrl+Z undoes and Ctrl+Y redoes. The Changes tab lists every edit since
you opened the file. Click one to go back to that point.

The Issues tab lists problems with the map, errors first. Errors are
things the game can't be expected to cope with, such as a lane listed on
one end only. Warnings are worth a look, such as a system with no lanes.
Click an issue to jump to it.

## Go back to your campaign

Launch Stellaris and load the save with the DLC and mods it was made
with. From what I've checked in-game:

- A moved system sits at its new position with its lanes.
- Fleets can use a new lane in both directions.
- A cut lane is gone and routes go around it.
- An isolated system has no lanes and the game runs on.
- You can play on, save in the game and open that save here again.

I haven't tested Ironman saves.

## Keys

| Key | Does |
| --- | --- |
| V, C, X | Select, Connect lanes, Cut lanes |
| B, E | Paint systems, Erase systems |
| M | Symmetry on or off |
| `[` `]` | Brush size, or nebula radius |
| Alt | Swap the brush while held |
| Shift+Arrow | Nudge by 1, or 10 with Ctrl |
| Shift+F | Frame the selection |
| Tab | Hide or show the dock |
| I, Shift+I | Issues tab, initializer browser |
| Delete | Delete or cut what is selected |

## Updates

The app checks for a new release when it starts and shows a badge when
it finds one. Click it for the release notes and "Install and restart".
The no-install zip and the `.deb` and `.rpm` packages send you to the
releases page instead. The Help menu has "Check for updates…" and turns
the check at start on or off.

## Command line

The `sgf` tool does the same edits from a terminal. It is on the
[Releases page](https://github.com/IanHeinrich/stellaris-galaxy-forge/releases)
beside the app. Editing commands save in place with the same backup as
the app, or write elsewhere with `-o <file>`. System ids are the numbers
shown as `#123` in the app. `sgf --help` lists every command, and
`sgf <command> --help` its options.

- Read a file: `inspect`, `validate`, `details`, `special`, `gamedata`.
- Edit the galaxy: `move`, `isolate`, `lane`, `nebula`, `move-nebula`,
  `star`, `planet-size`.
- Edit a scenario: `header`, `spawn`, `lane prevent` and `lane allow`.
- Make a scenario: `export-scenario <sav> <out>` and
  `new-scenario <name> <out>`. Add `--profile paint-a-galaxy` to write
  it for Paint a Galaxy.

For example, `sgf move game.sav 123 -150 80` moves system 123.
