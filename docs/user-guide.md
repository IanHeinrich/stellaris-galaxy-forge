# Stellaris Galaxy Forge user guide

Everything the app and the command line can do, in the order you are
likely to need it.

- [Using it](#using-it)
  - [Opening a save](#opening-a-save)
  - [The map](#the-map)
  - [The dock](#the-dock)
  - [Selecting](#selecting)
  - [Moving systems](#moving-systems)
  - [Hyperlanes](#hyperlanes)
  - [Nebulae](#nebulae)
  - [Undo, redo and the change log](#undo-redo-and-the-change-log)
  - [Validation](#validation)
  - [Layers](#layers)
  - [Game data](#game-data)
  - [Saving](#saving)
  - [Steam Cloud saves](#steam-cloud-saves)
  - [Static galaxy scenarios](#static-galaxy-scenarios)
  - [Closing](#closing)
- [Continuing your campaign](#continuing-your-campaign)
- [Restoring the original](#restoring-the-original)
- [Updates](#updates)
- [Command line](#command-line)

## Using it

You do not need to back anything up first: every save the app writes
leaves the previous file beside it as a backup (see "Saving" below).

### Opening a save

The app starts on a list of the documents it found on this machine: the
ones you opened recently, the saves grouped by campaign folder, newest
first, and the scenario scripts from your mods, your playset and the
install. It looks in the game's save folder:

- Windows: `%USERPROFILE%\Documents\Paradox Interactive\Stellaris\save games\<campaign>\`
- macOS: `~/Documents/Paradox Interactive/Stellaris/save games/<campaign>/`
- Linux: `~/.local/share/Paradox Interactive/Stellaris/save games/<campaign>/`

and in Steam's cloud folder for each Steam account on the machine,
`<Steam>\userdata\<account>\281990\remote\save games\`. Saves from the
cloud folder carry a "☁" flag; see "Steam Cloud saves" below for why
that matters. An ironman save carries a "⚿" flag.

A campaign row shows the empire, the folder, how many saves it holds and
when the newest was written; open it to see the saves themselves, each
with its empire, planet and fleet counts, file name, in-game date, game
version, size and the time it was last written. A scenario row shows its
system count, the mod it came from and whatever overrides it.

The field at the top filters by empire, campaign, file, scenario or mod.
The arrow keys move through the list, Enter opens the row, Shift+Enter
opens a save as a scenario, and the left and right arrows fold a campaign
open and shut. Two buttons sit along the foot of the screen: "New
scenario…", and "Browse…" for any `.sav` or scenario `.txt` file anywhere
on the machine.

With a document already open, Ctrl+O brings the same list back as a
dialog and Ctrl+Shift+O goes straight to a file picker. The File menu at
the left of the top bar holds the same actions, the four documents you
opened last, "Reload from disk", and "Open save as scenario…".

While a document opens, a card names the phase it is in: reading the
archive, building the galaxy, validating, and finishing.

### The map

Once open, the galaxy fills the window with the dock on the right and a
status bar along the bottom.

- Pan: hold the middle mouse button and drag, or hold W A S D or the
  arrow keys. A plain left drag on empty space does nothing.
- Zoom: mouse wheel, centred on the pointer.
- Home fits the whole galaxy in the window. F frames the selection, or
  puts the cursor in the search box when nothing is selected.
- Ctrl+K, or `/`, puts the cursor in the search box. It matches systems,
  empires, planets, fleets and nebulae; `s:`, `e:`, `p:`, `f:` and `n:`
  narrow it to one of those, and Tab cycles through them. The arrow keys
  move through the results, Enter goes to one and the map glides to it,
  Shift+Enter adds it to the selection without closing the list, and
  Escape closes.

Names appear as you zoom in, and further in each system draws what stands
in it. Hovering a star highlights it and its details; hovering a lane
highlights it and puts an "×" at its midpoint.

The status bar shows the number of systems, lanes and connected
components, a badge counting the issues raised since the file was opened
(click it for the Issues tab), what is selected, and a reminder of the
mouse and key controls for the current state. On the right it shows the
Steam Cloud badge where one applies, the time of the last save with the
backup path on hover, and the document's date, game version and the
version of the game data that was read.

On a Mac, read Cmd wherever Ctrl is written below.

### The dock

The panel down the right of the window is a set of tabs:

- **Inspector**: whatever the map selection is, and the galaxy itself
  when nothing is selected. A system's inspector has tabs of its own:
  Overview, Contents, Lanes, Data and Source for a save; a scenario
  swaps Data for Scripts, once game data is loaded. A row that names
  another entity drills into it and leaves a crumb; Backspace goes back
  one crumb, and the crumbs at the top go back further.
- **Empires**: every empire in the save, grouped by type. The eye hides
  an empire's territory on the map, the name goes to its capital, and
  "⊙" selects its systems and frames them.
- **Points of interest**: the leviathans, enclaves, marauders, fallen
  empires, landmarks and unique systems, grouped by kind. The eye beside
  a kind switches that kind on the map, and "⊙" selects the system.
- **Issues**: the validator's findings (see "Validation").
- **Changes**: the change log (see "Undo, redo and the change log").

For a scenario, the empires and the points of interest are read from the
initializer scripts and the game data rather than from the file's own
text, and the panels say so. Tab collapses the dock and brings it back
while the map has focus, and dragging its left edge resizes it.

### Selecting

- Click a system to select it. The Inspector shows its name, id, star
  class, planet count, nebula, owner and kind, its position, its
  hyperlanes with the stored length and the actual distance of each, its
  bypasses, planets, starbase, megastructures, fleets and flags. Click a
  hyperlane row to jump to that neighbour.
- Ctrl+click or Shift+click a system to add it to or remove it from the
  selection.
- Shift+drag on empty space draws a box; everything inside is selected
  (hold Ctrl as you release to add to the selection instead of replacing
  it).
- Ctrl+A selects every system.
- The Empires and Points of interest tabs each have a "⊙" button per row
  that selects what the row names.
- F frames the selection.
- Escape clears the selection. In the Inspector it steps back one crumb
  first, and it closes a menu, a dialog or the initializer browser
  before it touches the selection.

With several systems selected the Inspector lists them as chips, says
how many lanes run between them, how many owners they have and how many
are isolated, and offers the bulk actions described under "Hyperlanes".

### Moving systems

- Drag a system's star to move it. A ghost of the system and its lanes
  follows the pointer; release to apply. If the star you drag is part of a
  multi-selection, the whole selection moves together.
- Shift+Arrow nudges the selection by one unit in that screen direction;
  Ctrl+Shift+Arrow nudges by ten.
- For an exact position, type new x and y values in the "Position" fields
  of the Inspector's Overview tab and press Enter (or click elsewhere).
  Escape restores the field.

Moving a system keeps its lanes and recomputes the length stored on each
of them, on both ends. Nothing inside the system moves: planets, fleets
and stations are stored relative to their star. Only the galaxy map
changes.

### Hyperlanes

Adding a lane:

- Zoom in until a ring appears around the star under the pointer, then
  drag from the ring to another system. A rubber line follows the pointer
  and snaps to the nearest system; release to add the lane. The snap
  target shows as invalid when the two systems are already linked.
- At any zoom, Shift+drag from a star does the same.
- If the star you drag from is part of a multi-selection, a lane is drawn
  from every selected system to the target.
- With several systems selected, the Inspector (and the right-click menu
  on a selected system) offers "Connect to each other" (every missing
  pair, for up to five systems) and "Connect as mesh" with a
  sparse-to-dense slider; hovering the slider previews the lanes it would
  add.
- Right-click an unselected system while others are selected for "Connect
  selected to <name>".

Cutting a lane:

- Click a lane to select it. The Inspector names its endpoints and shows
  its stored length, the distance it spans and whether it is a bridge
  lane, with a "Cut" button. Delete (or Backspace) also cuts the selected
  lane.
- Hover a lane and click the "×" at its midpoint, or Shift+click the lane
  anywhere, to cut it in one go.
- Right-click a lane for "Cut".
- With several systems selected: "Cut hyperlanes between" removes every
  lane joining two selected systems; right-clicking an unselected system
  offers "Cut hyperlanes to selected".

Isolating a system removes every one of its lanes: right-click it and
choose "Isolate", or select several and use "Isolate" in the Inspector.

New lanes get the length the game's own generator would write, the whole
number just below the distance between the two stars. A lane whose stored
length disagrees with the distance is flagged with "!", and "Reset
length" (in the lane's inspector or its right-click menu) and "Reset lane
lengths" (for a selection) put it back. The game uses the stored length as
the lane's travel cost, so a long stored length on a short lane makes
fleets avoid it.

A lane a wayline network runs along is marked "wayline" in the list of a
system's hyperlanes, and the station itself is named in the system's
inspector by its level: Waystation, Wayport or Wayhold.

Stored lengths belong to a save. A scenario's lanes carry none, because
the game measures them from the two ends, so nothing in a scenario is
flagged stale and there is no length to reset.

### Nebulae

Switch the Nebulae layer on to see them; it starts off.

- Drag a nebula's ring to move the cloud; its name and centre marker only
  select it, so a nebula sitting on a star can still be moved. The systems
  stay where they are, and the nebula's member list is rewritten to
  whatever its radius now covers.
- Select a nebula and drag one of the four handles on its ring to resize
  it, or press `[` and `]` to change the selected nebula's radius by one,
  or by five with Shift.
- With a nebula selected, Shift+Arrow moves it as it moves a selection,
  and Delete removes it once you have agreed to what leaves with it.
- Click a nebula to select it. The Inspector shows its name, its centre,
  its radius and every system in it as a chip that jumps there.
- Right-click empty space for "New nebula here", which asks for the name
  it carries. Right-click a nebula for "Set radius…" and "Delete
  nebula".

### Undo, redo and the change log

Every edit is undoable: Ctrl+Z undoes, Ctrl+Y (or Ctrl+Shift+Z) redoes,
and the top bar has Undo and Redo buttons whose tooltips name the edit
they would apply.

The Changes tab lists every edit applied since the document was opened,
oldest first, with the undone ones greyed at the end. Click an entry to
undo or redo back to that point.

### Validation

The app checks the galaxy graph when the document opens and after every
edit. The Issues tab lists what it found, grouped by kind and error
first; click an issue to select and jump to the systems involved. The
tab can show what has been raised since the file was opened, what the
file arrived with, or all of it, and one kind at a time. The status bar
counts the new ones.

Errors are things the game cannot be expected to cope with: a lane listed
on one end only, a lane to a system that does not exist, or a lane from a
system to itself. Warnings are worth a look but legal: a duplicate lane
entry (the game itself writes some of these), a system with no lanes, a
system outside the galaxy radius, a galaxy split into more pieces than it
had when the file was opened, and a nebula whose member list and radius
disagree. A scenario adds two of its own: a file that transforms its
coordinates, so the map is not what the text says, and a system whose
position is written as a range for the generator to pick in, which a move
fixes to a point.

### Layers

The icons in the top bar switch the main map layers on and off:
hyperlanes, systems, names, system details, empires, bypasses, nebulae
and, for a scenario, spawn points, with a button each for leviathans and
enclaves. The number keys do the same: 1 hyperlanes, 2 systems, 3 names,
4 system details, 5 empires, 6 bypasses, 7 points of interest, 8 nebulae
and 9 issue highlights.

The Layers menu at the right of the top bar holds every layer, in
groups. A save offers hyperlanes, systems, star classes, names, system
details and colonies under "Map"; empires, bypasses, points of interest
with a row per kind, and nebulae under "Overlays"; and issue highlights
under "Editing". "Reset to defaults" at the foot puts them all back.

Two guides sit under "Overlays" as well, on by default for a scenario
and off for a save. "Map border" draws where the map ends: the ±500
square a scenario's coordinates must fall in, or a save's galaxy radius.
"L-Cluster" draws the circle the game builds the L-Cluster in, which is
the same spot for every galaxy size, or on a save that already has one a
circle around its systems.

A save with waystations also offers a Waylines layer under "Overlays":
the game derives a wayline between two stations of one network joined by
a lane or a bypass, and the map draws it as a dashed band along that lane
with each station badged by its level.

A save opens with hyperlanes, systems, names, system details, empires and
nebulae on and everything else off. A scenario opens with everything on
except nebulae, waylines, issue highlights and the day-one claims and
day-one bypasses that the scripts add. A layer you switch on yourself
stays on the next time you open a document, and "Reset to defaults" puts
back the set for the kind of document that is open. A scenario splits both the bar and the menu into
what the file itself says, what its initializers place and what the
day-one scripts add, with an "all" button over each of the last two: `0`
switches the initializer layers, `` ` `` the script ones.

### Game data

When the app finds your Stellaris install (and any mods active for the
save), the map draws with the game's own art and names: star sprites,
map icons and empire, star and planet names come from your install,
matching your DLC and mod set. Without an install to read, the map falls
back to procedural stars and generated names.

The button at the right of the top bar says what was read: the install,
the playset in load order, and whatever could not be read or had to be
chosen between. If the install is not found at first run, the app asks
for it, and you can point it at a folder yourself or turn game data off.

### Saving

Ctrl+S, or "Save" in the File menu, writes the document back to the file
it came from. The top bar shows "Saving… n%" while it writes; a large
late-game save can take a moment.

The app never overwrites your original in place. It writes the new file
next to the old one, renames the old one to
`<name>.sav.bak-<yyyymmdd-hhmmss>` (local time; a `-1`, `-2` suffix is
added if a second save lands in the same second) and only then moves the
new file into place. If writing fails, the original is put back; if even
that fails, the error message tells you where the backup is. After a
successful save the status bar shows the time it landed, with the backup
path on hover.

The first save's backup is the file you opened, byte for byte. Each
later save backs up the file the save before it wrote, so the earliest
stamp is the untouched original.

"Save as…" (Ctrl+Shift+S) writes to a path you choose, which then becomes
the open file. A backup is made only if a file already existed there.
Saving a new Paint a Galaxy scenario this way opens in the mod's own
`map/setup_scenarios` folder. File → "Save into the Paint a Galaxy
mod…" saves an already-open scenario there too. Steam can replace a
workshop mod's folder when it updates, so keep a copy of a map you care
about elsewhere as well. Once the file lands there the status bar says
what to do next: start a new game in Stellaris, choose the Elliptical
shape, and pick the size the scenario's header names it under.

### Steam Cloud saves

Stellaris keeps its saves in your Documents folder, but if Steam Cloud is
on for the game a second copy lives in Steam's own folder
(`<Steam>\userdata\<account>\281990\remote\save games\`). Steam
synchronises that folder and can overwrite a file you edited with the
copy it holds in the cloud.

The app flags such files with "☁" in the open list and "☁ Steam Cloud"
in the status bar, and asks for confirmation the first time you save one
in a session. Before you play an edited cloud save, close Steam or
disable Steam Cloud for Stellaris, so the cloud copy cannot replace your
edit.

### Static galaxy scenarios

A static galaxy scenario is the script a new campaign's galaxy can be
generated from instead of a random one: a `.txt` file under
`map/setup_scenarios/` in the game or in a mod, listing every system, its
position, its hyperlanes and what it starts with. The editor opens one the
way it opens a save, edits it as bytes, and writes it back with everything
it did not touch copied out exactly as it came in.

Opening one: the open list carries every scenario it can find, from your
mods, your playset and the install, with its system count and who
overrides it; or use "Browse…" and pick any `.txt`. A save row can be
opened as a scenario instead of as a save (the "as scenario" button, or
Shift+Enter), which turns that galaxy into one you can edit and start a
fresh campaign from, and "Export as scenario…" in the File menu does the
same for the open save. That one first shows what the export will hold:
how many empire seats it has (one spawn point on each empire's capital;
the header's empire count is sized from them), how the systems fall into
homes, fallen empires, marauders and the rest, what the file cannot carry
(the save's wormhole pairs; gateways and L-Gates are rebuilt by their own
initializers), which DLC or mods its initializers come from when game
data is loaded, and any home system whose initializer is not a generic
start. The dialog carries the same "For the Paint a Galaxy mod" checkbox
as the blank canvas below, and the written file opens with those facts
as `#` comment lines; the status bar's "Exported" time shows them again
in its tooltip. A save opened as a scenario lists the same warnings in
the Issues panel until it is closed.

"New scenario…" offers three ways to start. A blank canvas takes a name,
a galaxy size (or a radius of your own) and a core radius, and gives you
an empty file to place every system in yourself; its "For the Paint a
Galaxy mod" checkbox, ticked by default and remembered per machine,
writes spawn points in that mod's shape and a header sized for its
fixes. A galaxy from the game has you start a new game in Stellaris at
the size and shape you want, save on day one and open that save here,
which hands you the generator's layout, names and empires to edit. The
"Paint a galaxy" card opens paint-a-galaxy by Oatmeal Problem in your
browser, where you draw systems and lanes and download the scenario file
it exports. "Open a Paint a Galaxy file…" on the same card opens that
file here.

The checkbox is ticked by default because custom galaxies hit
game-breaking bugs in the generator that the Paint a Galaxy mod fixes.
Keep it ticked for any map you will play. If you write scenarios for a
mod of your own, untick it once.
Unticking it, on the blank canvas or on the Export as scenario dialog,
turns it off in both places, and ticking either one turns it back on in
both. Under the checkbox the app shows the mod's status: not
installed, with a link to subscribe on the Steam Workshop, installed but
not enabled in your playset, or enabled. The status keeps itself
current, so subscribing while the app is open is enough.

A scenario whose Paint a Galaxy layer is on carries a "Paint a Galaxy"
badge beside its name in the top bar. The layer turns itself on for a
file that already carries the mod's scripts or flags or the header Forge
writes for it, for one that sits inside the mod's own
`map/setup_scenarios` folder, for one you created with the checkbox
ticked, and for one opened from the Paint a galaxy card. There is no
switch for it otherwise. The badge warns when the mod (Steam Workshop
3532904115) is not enabled in your launcher's playset. When the mod is
not installed at all, clicking the badge opens its Workshop page.

A scenario whose layer is off shows a one-line notice under the top bar
that it needs the Paint a Galaxy mod unless it belongs to a mod of your
own, with the mod's status, a "Save into the Paint a Galaxy mod…"
button and "Not for me", which hides the notice for good on this
machine.

What can be edited: everything a save's galaxy offers, move systems, add
and cut lanes, add, move, resize, rename and remove nebulae, and, because a
scenario is a starting state rather than a game in progress, more besides.
Systems can be added, deleted and named. Each can be given an initializer,
which is what the game will place there: the star, its planets and moons,
their resources, megastructures, dig sites and starbase, all of which the
inspector and the map show before the game is ever started. A system can
carry a spawn weight, or be held for a human player or for the AI. An
empire that spawns on such a seat brings its own starting system in place
of the seat's initializer, but what that initializer spawns around it
still appears: a seat given Sol's initializer gets Alpha Centauri beside
the empire's home. The counts the new-game screen reads (AI empires,
advanced starts, fallen, marauder and nomad empires, wormhole pairs,
gateways and hyperlane density) are edited as min, max and default fields
in the Game setup section, with a note when a default falls outside its
range. The rest of the header is listed and edited key by key, and a pair
of systems can be barred from ever being linked.

In a scenario whose Paint a Galaxy layer is on, a spawn point is a seat
the mod fills by kind, so the inspector offers the kind from a select
instead of a weight. Enabled means any empire may start there. Preferred
seats are filled first, and in single player the player is seated first,
so one preferred seat is where you start. Reserved A to Z seats only an
empire whose species carries the matching Reserved Spawn trait, which
comes from the Reserved Spawns submod on the Steam Workshop, so subscribe
to it only if you reserve seats. Sol is a reserved seat the United
Nations of Earth counts as holding. On the map a reserved seat shows its
letter, Sol shows "Sol" and a preferred seat gets a star. The human and
AI reservations are hidden under the layer because the mod does not read
them. A system that still carries a plain weight in such a file shows a
"Use a Paint a Galaxy seat" button that converts it. The Game setup
section sums up the seats and the safe number of AI empires. When the
header's counts no longer match the seats, or its fallen empire counts
no longer match the fallen empire zones, an "Update counts" button there
and on the issue's row in Issues rewrites the empire keys the way the
mod's formulas do and sets the fallen empire keys to the zones, at most
six. Clearing a Game setup cell drops that key from the header.

Two selected systems can be made a wormhole pair, which the mod opens on
day one: choose "Link as wormhole pair" from the right-click menu or the
selection's actions, and "Unlink wormhole pair" parts them again. The
inspector's Wormhole pair section names the other end, with a link that
selects it, or says the partner is missing.

A scenario saved into the mod's folder is checked against the other
files there: when another file's header lists the same name, Issues
notes it, because the game shows one size per name.

A fallen empire zone is empty space. When the game starts, the Paint a
Galaxy mod creates a fallen empire's home system at the centre of the
zone and its other systems around it, then links them by hyperlane to
systems nearby. Nothing already on the map is used or moved, so the
ring must stay clear of your systems. The map draws each zone as a
dashed ring of radius 30 with a line to the system it is measured from,
in one of eight compass directions at a distance from 30 to 200. Every
zone belongs to one of your systems, which the mod measures the ring
from. Right-click a system and choose "Add fallen empire zone", or
right-click empty space and choose "Fallen empire zone here". Drag
the ring to move it: the mod can only place a fallen empire at eight
compass directions and distances from 30 to 200, so the map shows
those positions while you drag and the ring snaps to the nearest clear
one. Clicking the ring selects its system, and the inspector's Fallen
empire zone section sets the type of empire (random, or one of the six
kinds), the direction, the distance and whether the mod should fill
the ring with ordinary systems when no fallen empire lands there. A
ring that would cover a system is refused, and one
that later comes to cover a system after a move shows in Issues.

The mod also places fallen empires in rings you did not draw. Export as
scenario adds those automatic zones the way Paint a Galaxy itself does,
one per system where a ring of radius 30 fits, and they are drawn faint.
To choose how many there are, right-click empty space and pick "Fit
fallen empire zones…", or use the button in the scenario section of the
inspector. A slider sets the number, from none to every ring that fits,
and Forge spreads them as far apart as it can. Fitting again replaces
the automatic zones in one undoable step. Zones you placed or edited
are yours and are never replaced. A painted map with no automatic zones
shows in Issues, with a button that opens the same dialog.

Before a save, Forge warns when the map still has warnings or errors,
opens the Issues tab and offers "Save anyway". Once you have saved
anyway it stays quiet until a new issue appears.

The mod has limits of its own, from its Workshop page: the Advanced
Neighbors setting has no effect, every precursor is on regardless of
settings (the Precursor Selection mod works around it), Sol gets no
Sol-specific neighbours (the Local Cluster mod is the usual
workaround), nomads with random homes do not start in a nomad system,
and the game adds systems the map did not have: guaranteed worlds,
marauders, fallen empires, and some events.

In my test a Sol seat given Sol's own initializer did get Alpha Centauri
beside the empire's home, so try that before reaching for Local Cluster.

The initializer browser: Shift+I, the inspector, or the map's right-click
menu ("Set initializer…" on a system, "New system from…" on empty space)
opens a full-window list of every initializer your install and mods
define. Search across key, name, star
class, usage, mod and flags (`usage:`, `mod:`, `class:`, `flag:`,
`planets:>5`); the groups carry counts; pinned and recent entries sit at
the top; and a detail pane shows what the highlighted one spawns, with
its systems ringed on the map, before you assign it. The arrow keys
move, Enter assigns, Shift+Enter assigns and keeps the list open, Ctrl+D
pins, and Escape closes. One of them can be set as the default a new
system spawns from without being asked. Assigning to a whole selection is
one undo step.

Exporting: `sgf export-scenario <sav> <out>` writes a save's galaxy out as a
scenario script and leaves the save untouched; `--gamedata` localises the
system names from your install instead of writing the save's own keys
and names the DLC or mod each initializer comes from. After "wrote …" it
prints the export's report: empire seats, home initializers to review,
what was not carried over, and the system count per category.
`sgf new-scenario <name> <out>` writes an empty one to start from.

A scenario's `position` runs the same way as a save's `coordinate`: an
exported save loads in the game as the galaxy the map showed, with nothing
mirrored ([adr/0004-scenario-documents.md](adr/0004-scenario-documents.md)).

What the Scripts tab, the day-one claims layer and the day-one bypasses
layer show is a best guess. The editor follows initializers, star flags
and event targets to find the scripts that touch a system; it cannot
follow a script that iterates over a class of systems or addresses one by
name, and it reads conditions (`if`, `limit`) as if they were true. Treat
a claim or a bypass it draws as "a script mentions this system", not as
what the game will certainly do.

### Closing

"Close" in the File menu (Ctrl+W) closes the document; opening another
one or closing the window does the same. If there are unsaved edits the
app asks "Discard unsaved changes?"; Cancel keeps your session.

## Continuing your campaign

Launch Stellaris and load the save as usual; the game lists each folder
under `save games` as a campaign. Load it with the same DLC and mod set
the save was made with. Then, from what has been checked in-game on
4.4.6:

- A moved system sits at its new position with its lanes drawn to its old
  neighbours. The game takes a lane's travel cost from the stored length,
  which the editor recomputed when you moved the system.
- A new lane is drawn on the galaxy map and fleets can be sent across it
  in both directions.
- A cut lane is gone and the pathfinder routes around it. A fleet that
  was already in the middle of a jump along that lane finishes its jump
  normally; later routes no longer use the lane.
- An isolated system loads with no lanes and the game runs on without
  complaint.
- You can play on, save from the game, and open the game's own save in
  the editor again with your edits still in place.

Ironman saves have not been tested. The app treats every `.sav` file the
same way and has no special handling for them.

## Restoring the original

Every save from the app leaves the previous file next to it as
`<name>.sav.bak-<stamp>`. To go back, delete or move the edited `.sav`
and rename the backup to `<name>.sav`. If you saved several times there
is one backup per save; the earliest stamp is the untouched original.

## Updates

The app checks for a newer release when it starts. A badge appears in the
top bar when one is found; click it to open a dialog with the release
notes and four buttons:

- **Install and restart** downloads the update, checks it against the
  project's public key, and applies it. It asks about unsaved changes
  first, since the app has to close to run the install, then reopens
  itself on the new version.
- **Open releases page** takes you to the GitHub release instead.
- **Skip this version** hides the badge for that release; a later one
  still shows it.
- **Later** closes the dialog without deciding either way, so the badge
  stays.

The portable zip and the `.deb` and `.rpm` packages cannot install an
update themselves, so their dialog offers Open releases page, Skip this
version and Later, and no Install and restart.

The Help menu names the app's version, checks for an update right away
with "Check for updates…", and has a "Check for updates at start" switch
for the check the app makes on launch.

## Command line

The `sgf` binary does the same edits from a terminal. Run it from the
repository with `cargo run -q -p sgf-cli -- <command>`, or build it with
`cargo build --release -p sgf-cli` and use `target/release/sgf`. Editing
commands write in place, with the same backup as the app, unless `-o
<file>` names an output.

| Command | Does |
|---------|------|
| `sgf inspect <sav> [--galaxy]` | Print the header, section sizes and entity counts; `--galaxy` adds systems, lanes, components, nebulae and bypasses. |
| `sgf validate <doc>` | Print every issue the validator finds in the galaxy, and the ones the document itself raises; exits 1 if any is an error. |
| `sgf details <sav> <id>`, or `--all` | Print a system's planets, deposits, starbase and fleet presence; `--all` gives one line per system that has anything to show. |
| `sgf export-scenario <sav> <out> [--name <n>] [--gamedata] [--install <dir>]` | Write the save's galaxy as a static galaxy scenario script; the save is untouched. |
| `sgf new-scenario <name> <out> [--core-radius <r>]` | Write an empty static galaxy scenario script to start from. |
| `sgf roundtrip <in> <out> [--check]` | Load and write out unchanged; `--check` re-reads the output and asserts gamestate and meta are byte-identical. |
| `sgf move <sav> <id> <x> <y> [-o out]` | Move a system, recomputing the length of its lanes on both ends. |
| `sgf move-nebula <sav> <index> <x> <y> [-o out]` | Move a nebula's centre, by its index in file order; nothing else moves, and its member list follows the systems the radius now covers. |
| `sgf nebula add <doc> <x> <y> <radius> [--name <n>] [-o out]` | Add a nebula centred on (x, y); every system it reaches joins it. |
| `sgf nebula remove <doc> <index> [-o out]` | Remove the nebula at that index in file order; the ones after it renumber. |
| `sgf nebula radius <doc> <index> <radius> [-o out]` | Set a nebula's radius about its fixed centre. |
| `sgf nebula name <doc> <index> <name> [-o out]` | Rename a nebula. |
| `sgf lane add <doc> <a> <b> [--bridge] [-o out]` | Add a lane whose length is the floor of the distance, as the generator writes it. |
| `sgf lane remove <doc> <a> <b> [-o out]` | Remove every entry of the lane on both ends. |
| `sgf lane length <doc> <a> <b> <length> [-o out]` | Set a lane's stored length on both ends. |
| `sgf lane normalise <doc> <a> <b> [-o out]` | Rewrite the lane's length on both ends to the floor of the distance it spans. |
| `sgf lane prevent <scenario> <a> <b> [-o out]` | Bar the generator from ever linking two systems: one `prevent_hyperlane` statement. |
| `sgf lane allow <scenario> <a> <b> [-o out]` | Remove every `prevent_hyperlane` statement naming the two systems. |
| `sgf header set <scenario> <key> <value> [-o out]` | Write one key of a scenario's header as the raw text right of `=`, inserting it when the header lacks it. |
| `sgf header unset <scenario> <key> [-o out]` | Remove the header's first statement of that key. |
| `sgf spawn weight <scenario> <id> <base> [-o out]` | Write `spawn_weight = { base = N }`, or clear the base with `none`. |
| `sgf spawn reserve <scenario> <id> <human, ai or none> [-o out]` | Hold a system for a human player or for the AI, or take back whichever reservation stands. |
| `sgf isolate <sav> <id> [-o out]` | Remove every lane of a system. |
| `sgf synth --systems <n> [--seed <s>] [--waystations <a,b,c>] -o <out>` | Write a synthetic save with n systems, for stress testing; `--waystations` adds one network of those system ids and repeats. |
| `sgf gamedata [--install <dir>] [--lang <l>] [--no-mods]` | Find the Stellaris install and active mods; summarise what was read from them. |
| `sgf special <sav> [--install <dir>] [--no-gamedata]` | List the special systems of a save (leviathans, enclaves, landmarks and the rest). |
| `sgf texture <key> -o <png> [--install <dir>]` | Decode a game texture by key (`star_class:g_star`, `flag:human/flag_human_9.dds`, `empire_flag:<bg>:<category>/<file>:<c0>,<c1>,<c2>,<c3>`) to a PNG. |

System ids are the numbers shown as `#123` in the app.
