# Stellaris Galaxy Forge user guide

Stellaris Galaxy Forge edits the galaxy map of a Stellaris save, or a
static galaxy scenario that a new campaign starts from. It works with
Stellaris 4.x saves. I've tested the edits in-game on 4.4.6 and 4.5.0.

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

Drag a star to move it. If it is part of a selection, the whole
selection moves. Shift+Arrow nudges the selection. For an exact spot,
type into the Position fields on the Inspector's Overview tab. A moved
system keeps its hyperlanes and their lengths are updated. Its planets
and fleets move with it.

To delete several systems you added since opening the save, select them,
right-click one and pick "Delete N added systems". Systems that were
already present in the save cannot be deleted.

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

When the galaxy is in separate pieces, a "Join" button appears beside
Components in the Inspector. It reconnects the pieces with the shortest
hyperlanes that don't cross any others.

The game uses a hyperlane's stored length as its travel cost. A lane
whose length doesn't match its distance is marked "!". "Reset length"
fixes it.

### Nebulae

Switch on the Nebulae layer first. Drag a nebula's ring to move it.
Select it and drag a handle on the ring, or press `[` and `]`, to resize
it. Right-click empty space for "New nebula here". The new nebula uses a
name from the game's own name list. You can rename it on its page.

### Add a system

Right-click empty space and pick "Add system here", then Random or a
star class. The last entry, Special, lists the game's special systems in
two groups: unique systems such as Zevox, and other special systems such
as Trappist. Hover an entry to see its star, planets, belts and notable
bodies. A warning mark means the galaxy already has that system and the
game normally places only one. You can still add another. A lock means
the save doesn't have the DLC the system belongs to, so its events won't
run. The game's scripted extras for special systems, such as anomalies
and background clouds, are not added. Reroll on the new system's page
builds the same special system again. Picking a star class there
generates a regular system around that star.

A system added inside a nebula joins it. To take out a system you added
this session, select it and press Delete, or right-click it and pick
"Delete system". Systems the save already had can't be deleted.

### Stars and empires

- Each star in a system's planet list has an "Edit" mark. Its page sets
  the star's type and size.
- With several systems selected, the Star class action applies one
  class to all of them.
- In a Stellaris 4.5 save, an empire's page has Border and Fill colour
  pickers.
- With nothing selected, the Inspector can reveal which L-Gate outcome
  the save rolled. You can change it until a gate opens.

### Planet, moon, star and asteroid pages

Click a body in a system's Planets list, or a moon in a body's own Moons
list, to open its page in the Inspector. F search finds a planet by name
too.

- A star's page opens with its type and size to edit, as [Stars and
  empires](#stars-and-empires) describes. Any other body's page shows its
  class and size instead.
- Barren, frozen, toxic and grey goo worlds have a Terraforming
  candidate checkbox. It does what the console's `add_modifier` does. The planet
  can be terraformed once the empire has Climate Restoration. Frozen
  worlds also need Hydrocentric, and toxic worlds need Detox.
- Deposits are shown with the game's own art and the district capacity
  they add up to, one row per type: what each one yields, or what it does
  while unworked. A blocked deposit shows a blocker mark, the tech and
  resources needed to clear it, and how long clearing takes.
- Modifiers come next, each with what it changes and how many days are
  left.
- Moons are listed below and open their own pages the same way.
- A colonised planet has a Colony section: its owner, designation, when
  it was colonised, and its pops by species.

The breadcrumb above the page goes back: "‹" for one step, a name in it
for that page, or "Galaxy" for the whole map.

### System view

Open one system to see its star, planets, moons and asteroid belts laid
out the way the game draws them. There are four ways in:

- Double-click the system on the map.
- Select the system and press Enter or M.
- Right-click the system and choose Open system view.
- Click Open system view in the Planets header of the system's page, or
  use View → Open system view.

Each body sits on its orbit around the star, or around its planet for a
moon. Hyperlanes show as arrows at the edge, pointing to the
neighbouring systems. Click an arrow to see the lane's length. Double-click it to open that neighbour's view. Wheel zooms and
middle-drag pans, as on the galaxy map. A large save can take a moment
to read a system, and the status bar says "Reading the system…" until
the bodies appear.

Systems in a scenario open the same way and show what their initializer
sets. Where it leaves an orbit or an angle to chance, the view draws the
range as a band or an arc. A body with no angle set is drawn faded, and
a random planet class shows a question mark.

The status bar counts the system's bodies and belts. With a body's page
open in the Inspector, it shows that body's orbit and angle.

Each body's name sits on a plate under it. A colonised planet's plate
has a bar in its owner's colour. Names, System details and Nebulae
still work while a system is open, with their own settings, so you can
have them on in the galaxy and off in a system. With System details on,
each body's resources show under its name. A system inside a nebula
shows faint clouds behind it while Nebulae is on. The other layer buttons and
the tool rail are for the galaxy, so they are hidden or greyed out. Undo and redo still work
from the Edit menu and their keys.

To get back to the galaxy, press Esc or M, click "Galaxy" in the crumb at the
map's top left, right-click and choose Back to galaxy, or use View → Back
to galaxy. Backspace goes back too once the Inspector has no page left
to step back from. The galaxy map is where you left it.

## Make a scenario

A static galaxy scenario is a `.txt` file that a new game starts from
instead of generating a random galaxy. There are three ways to make one:

- "New scenario…" then "Blank canvas" gives you an empty map.
- "New scenario…" then "A galaxy from the game": start a new game in
  Stellaris, save on day one, and open that save here. You get the game's
  own layout, names and empires to edit.
- Pick any save and click "Open as scenario", or use File → "Export as
  scenario…". The original save remains unchanged.

The file starts with a `# created by` line naming the Galaxy Forge
version. Each time Galaxy Forge or Paint a Galaxy saves the file, it adds
itself to that line, so the line lists every tool and version that wrote
the file.

### The Paint a Galaxy checkbox

Each route has a "For the Paint a Galaxy mod" checkbox, ticked by
default. Stellaris has some limitations when loading hand-made galaxies,
and the
[Paint a Galaxy mod](https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115)
fixes them. Keep the box ticked for any map you plan to play. Untick it
only for a mod of your own.

When a save is converted for the mod, your capital becomes your seat and
each fallen empire becomes a fallen empire zone at its old capital. The
L-Cluster is left out because the game adds its own.

A scenario for the mod shows a "PaG" badge in the top bar. The badge
warns you when the mod isn't installed or isn't enabled.

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
- Right-click a hyperlane and pick "Cut and prevent" so the game never
  generates it.
- Right-click empty space and pick "Add marauder clan here".
- With nothing selected, the Game setup section sets the counts offered
  on the new-game screen, such as the number of AI empires.

On a map for Paint a Galaxy you can also:

- Set each seat's kind. Enabled seats accept any empire. Preferred
  seats are favoured. Sol is for the United Nations of Earth. Reserved
  seats A to Z are for one specific empire each.
- Right-click a system and pick "Add fallen empire zone". Drag the ring
  to move it, and drag from a system's ring onto it to choose what the
  fallen empire connects to.
- Link two selected systems with "Link as wormhole pair".
- Click "Update counts" when Game setup says the counts no longer match
  the seats and zones.

The Scripts tab and the day-one layers are a best guess at what scripts
will do on day one. Galaxy Forge can't follow every script.

#### Symmetry

In a scenario, the Symmetry button under the tools, or Shift+M, mirrors your
edits around the centre of the galaxy or repeats them 2 to 8 times
around it. Saves have no symmetry.

## Play your scenario

### A map for Paint a Galaxy

1. Subscribe to the
   [Paint a Galaxy mod](https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115)
   on the Steam Workshop.
2. Use File → "Save into the Paint a Galaxy mod…". It saves into the
   mod's `map/setup_scenarios` folder, where the game looks for it. Steam
   may replace that folder when the mod updates, so keep another copy of
   your map somewhere safe.
3. In the Paradox launcher, enable Paint a Galaxy in your playset. If
   your map has reserved seats, enable the
   [Reserved Spawns submod](https://steamcommunity.com/sharedfiles/filedetails/?id=3762808682)
   as well.
4. In Stellaris, start a new game. Your map appears as a galaxy size,
   under the name in the scenario's header. The status bar shows you the
   name when you save into the mod. Once you pick your map, the game
   doesn't ask for a galaxy shape.
5. Keep AI empires at or below the "safe AI empires" number in Game
   setup. Above that, there are more empires than seats.

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
  seated before you and uses the same weights. In my test games such an
  AI took the weighted preferred seat two times in three.
- A save converted for the mod gives your capital a weighted Sol seat if
  you play the United Nations of Earth, and a weighted preferred seat
  otherwise.
- The mod builds each fallen empire in its zone and opens your wormhole
  pairs. The game adds its own L-Cluster.

The mod's Workshop page lists its limits. The Advanced Neighbors setting
has no effect. Every precursor is enabled. Sol gets no Sol-specific
neighbours, and the Local Cluster mod is the usual fix. Nomads with
random homes don't start in a nomad system. The game also adds systems
your map didn't have: guaranteed habitable worlds, marauders, fallen
empires and some event systems.

### A plain scenario

A scenario made without the checkbox has to sit in the
`map/setup_scenarios` folder of a mod enabled in your playset. Without
Paint a Galaxy, empires can start on the wrong homeworlds, and marauders
and fallen empires may fail to appear. Your own mod has to deal with
those.

## Save and back up

Ctrl+S saves to the file you opened. "Save as…" (Ctrl+Shift+S) saves
somewhere else. Only the parts you changed are rewritten. Everything else
is copied unchanged.

Each save keeps the previous file beside the new one, as
`<name>.sav.bak-<date>-<time>`. The earliest backup is the file you
originally opened. Up to eight backups are kept per file: the original,
the three newest and a spread of the rest.

If Stellaris wrote the file after you opened it, Save asks before
replacing it. When the map has issues, Save offers "Save anyway".

### Restore the original

Move or delete the edited `.sav`, then rename its earliest backup to
`<name>.sav`.

### Steam Cloud saves

Steam Cloud can restore the original save over your edited copy. Galaxy
Forge warns you before the first save to a "☁" file. Before you play an
edited cloud save, close Steam or disable Steam Cloud for Stellaris.

## Undo and issues

Ctrl+Z undoes and Ctrl+Y redoes. The Changes tab lists every edit since
you opened the file. Click one to go back to that point.

The Issues tab lists problems with the map, errors first. Errors are
things the game can't be expected to cope with, such as a hyperlane that
exists at only one end. Warnings are worth a look, such as a system with
no hyperlanes. Click an issue to jump to it.

## Go back to your campaign

Launch Stellaris and load the save with the DLC and mods it was made
with. From what I've checked in-game:

- A moved system sits at its new position with its lanes.
- Fleets can use a new lane in both directions.
- A cut lane is gone and routes go around it.
- An isolated system has no hyperlanes and the game carries on.
- You can keep playing, save in the game and open that save here again.

I haven't tested Ironman saves.

## Keys

| Key | Does |
| --- | --- |
| V, C, X | Select, Connect lanes, Cut lanes |
| B, E | Paint systems, Erase systems |
| Shift+M | Symmetry on or off, in a scenario |
| `[` `]` | Brush size, or nebula radius |
| Alt | Swap the brush while held |
| Shift+Arrow | Nudge by 1, or 10 with Ctrl |
| Shift+F | Frame the selection |
| Enter | Open the selected system's view |
| M | Open the selected system's view, or back to the galaxy |
| Esc, Backspace | Back to the galaxy from a system view |
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

The `sgf` tool makes the same edits from a terminal. It is on the
[Releases page](https://github.com/IanHeinrich/stellaris-galaxy-forge/releases)
beside the app. Editing commands save in place with the same backup as
the app, or write elsewhere with `-o <file>`. System ids are the numbers
shown as `#123` in the app. `sgf --help` lists every command, and
`sgf <command> --help` its options.

- Read a file: `inspect`, `validate`, `details`, `special`,
  `special-layouts`, `gamedata`. `special-layouts` lists the layouts a
  system can be rerolled from, and how many systems in the save already
  use each. `shape` and `roundtrip` check a save's structure: `shape`
  lists every key path with its count, and `roundtrip` writes the save
  out unchanged.
- Edit the galaxy: `move`, `isolate`, `lane`, `nebula`, `move-nebula`,
  `star`, `planet-size`, `terraform-candidate`, `deposit`, `add-system`.
  `deposit add` and `deposit remove` change the deposits on an
  uncolonised planet.
  `add-system` adds systems from a JSON spec you write, or rolls one from
  the install's own rules with `--generate`, a special layout included
  with `--layout`.
- Edit a scenario: `header`, `spawn`, `lane prevent` and `lane allow`.
- Make a scenario: `export-scenario <sav> <out>` and
  `new-scenario <name> <out>`. Add `--profile paint-a-galaxy` to write
  it for Paint a Galaxy.

For example, `sgf move game.sav 123 -150 80` moves system 123.
