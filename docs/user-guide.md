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
[Steam Cloud saves](#steam-cloud-saves)) and Ironman saves "⚿". On the
Saves tab, a save shows the name you gave it in the game, with its date
underneath.

The Recent list holds the last 10 documents you opened. The All tab
shows the newest 5, and "Show all" opens the rest under Recent. Clear
empties the list. Files you have deleted drop off it.

Enter or a double-click opens the selected row. A save first asks whether
to edit it as a save or as a scenario. "Browse…" opens any `.sav` or
scenario `.txt` file. Once a document is open, Ctrl+O brings the list
back.

## Get around the map

- Hold the middle mouse button and drag to pan, or hold W A S D. The
  wheel zooms. Home fits the whole galaxy.
- F opens search. It finds systems, empires, planets, fleets and nebulae,
  and systems by what is in them, such as "gaia", or by their precursor,
  such as "Vultaum". Pin a search to keep its systems ringed on every
  save.
- The number keys 1 to 9 switch the main map layers. The Layers menu in
  the top bar holds every layer.
- Turn on Precursors in the Layers menu to see where each precursor's
  anomalies can turn up in a save. Anomalies appear when a science ship
  surveys a planet, so the layer shows the systems that can have them,
  not the planets that will. Each precursor has its own ring colour.
  A system in two precursors' regions shows a split ring, and a system
  in none has a thin grey ring. The menu lists every precursor with its
  number of systems. Click the eye beside one to hide its rings. The
  layer needs game data from your Stellaris install.
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
two groups: unique systems such as Zevox and Sol, and other special
systems such as Trappist. Hover an entry to see its star, planets, belts
and notable bodies. A warning mark means the galaxy already has that
system and the game normally places only one. You can still add another.
A lock means the save doesn't have the DLC the system belongs to, so its
events won't run. The game's scripted extras for special systems, such
as anomalies and background clouds, are not added. Sol comes without an
empire, so Earth is an uncolonised continental world. Other named
systems, such as New Bratulla and Vultaumar, come without their empires,
pre-FTL civilisations, guardians and fleets. Reroll on the new
system's page builds the same special system again. Picking a star class
there generates a regular system around that star.

A system added inside a nebula joins it. To take out a system you added
this session, select it and press Delete, or right-click it and pick
"Delete system". Systems the save already had can't be deleted.

### Stars and empires

- Each star in a system's planet list has an "Edit" mark. Its page sets
  the star's type and size.
- With several systems selected, the Star class action applies one
  class to all of them.
- An empire's page has a Name field at the top. Type a new name to
  rename the empire. Renaming your own empire also renames the save on
  the load game screen.
- A pre-FTL civilisation's page shows its age, such as Stone Age.
- An empire's page sets its flag: the emblem, the background, and the
  primary and secondary colours. For the player's empire, the load game
  screen shows the new flag too.
- In a Stellaris 4.5 save, the page also has Independent Map Color. With
  it on, pick the border and fill colours. With it off, the map uses the
  flag's primary and secondary colours.
- With nothing selected, the Inspector can reveal which L-Gate outcome
  the save rolled. You can change it until a gate opens.

### Planet, moon, star and asteroid pages

Click a body in a system's Planets list, or a moon in a body's own Moons
list, to open its page in the Inspector. F search finds a planet by name
too.

- A star's page opens with its type and size to edit, as [Stars and
  empires](#stars-and-empires) describes.
- Rename a planet or moon in its Name field. Moons named after a
  planet take its new name too.
- Change a planet's or moon's size in its Size field. On a colony, the
  game demolishes districts over a lowered cap within a month.
- In a Stellaris 4.x save, change a planet's or moon's look in its Model
  field, such as the Ocean Paradise, Earth or Previously Terraformed
  look. The looks the game uses on the planet's class come first.
  Default puts back its class's look. A class change in game, such as
  terraforming, also puts it back.
- In a Stellaris 4.x save, the Modifiers section lists a planet's
  features and timed modifiers. Remove one with the ✕ on its row. Add
  modifier, under the list, lists the modifiers that act on a planet,
  its pops or its jobs. Search by name or effect, or pick a chip:
  Features, Terraforming, Positive, Negative or Other. Pick Permanent or
  a number of days before you click Add. A timed modifier runs out in
  game after those days. Adding or removing a timed modifier does what
  the console's `add_modifier` and `remove_modifier` do. A planet
  feature also has a line of its own, which is added and removed with
  it, as the game writes a rolled feature.
- A barren, frozen, toxic or grey goo world's terraforming candidate
  modifier is at the top of Add modifier, under "Usual for this
  planet". With it, the planet can be terraformed once the empire has
  Climate Restoration. Frozen worlds also need Hydrocentric, and toxic
  worlds need Detox.
- In a Stellaris 4.x save, the Anomaly section shows the anomaly on a
  planet, moon or star: its name, which empires have found it, and the
  game's description of it. Remove it with the ✕ on its row. When it
  has none, Add anomaly lists the anomalies you can add. Search by name,
  or pick a level chip. The ones that can turn up on that body come
  first, under "Usual for this planet". Some only turn up on stars, such
  as the ones around pulsars and black holes. A body holds one anomaly,
  so the list closes after you add one.
- If you have surveyed the planet, the added anomaly shows in game right
  away, ready for a science ship to research. If you haven't, it turns up
  when you survey the planet. Anomalies that run their own script when
  the game places them, such as precursor ones, aren't offered, because
  the game wouldn't run that script. The AI's own anomalies aren't
  offered either.
- In a Stellaris 4.x save, the Dig site section shows a planet's
  archaeological site: its stage, its clues, whether a fleet is
  excavating it, and the game's description of it. Remove it with the
  ✕. A science ship excavating a removed site stops on the game's first
  day and waits in orbit. A planet without a site has Add dig site.
  Search by name, or pick Found by surveys or Event only. A planet holds
  one site, so the list closes after an add. The two site types that do
  something in game as they are created aren't listed.
- In a Stellaris 4.x save, a planet or moon has a Ring checkbox to give
  it a ring or take its ring away.
- Deposits are shown with the game's own art and the district capacity
  they add up to, one row per type: what each one yields, or what it does
  while unworked. A blocked deposit shows a blocker mark, the tech and
  resources needed to clear it, and how long clearing takes.
- Remove a deposit with the ✕ on its row. Add deposit, under the
  deposits, lists every deposit type but blockers. The ones the game
  places on that body come first, under "Usual for this planet". Type
  to search by name, resource or category, or pick a category chip.
  Special holds the deposits only events place. Orbital deposits of one
  resource, such as +1 to +10 Energy, share a row: click an amount to
  add that one.
- The bottom of the deposit, blocker, modifier and dig site lists shows
  the game's description of the row you hover. Without the pointer on a
  row, it describes the row the arrow keys are on.
- Add blocker, under the Blockers heading, works the same way for
  blockers. Its chips pick the blockers a tech clears, the ones that need
  no tech or can't be cleared, and Special for blockers that do more than
  take away districts. The heading shows even when the body has none.
- Both lists stay open until you press Done or Escape. A mining or
  research station over a removed deposit stays in game and still costs
  about 1 energy a month.
- Colonised planets take deposit edits too. The game catches up on its
  next month tick, so the page warns you first when it will take
  something away. You then press Remove anyway or Add anyway, or
  Cancel.
  - Districts over a lowered cap are demolished. The save doesn't store
    the caps, so the page counts what the deposits give. It says "may"
    when something else adds to the cap too.
  - A zone or building that needs the removed deposit goes, such as
    Crystal Mines without a rare crystals deposit, or the Xeno Zoo
    without Alien Pets.
  - Removing a blocker that is being cleared cancels the clearing. What
    was spent on it isn't refunded.
- On a planet that is terraforming, the game changes its deposits when
  the terraforming finishes, added ones included.
- Modifiers come next, each with what it changes and how many days are
  left.
- Moons are listed below and open their own pages the same way.
- A colonised planet has a Colony section: its owner, designation, when
  it was colonised, and its pops by species.
- In an older save, a planet with an anomaly waiting on it shows an
  Anomaly row in About: the anomaly's name, and which empires have
  found it.

The breadcrumb above the page goes back: "‹" for one step, a name in it
for that page, or "Galaxy" for the whole map.

### System view

Open one system to see its star, planets, moons and asteroid belts laid
out the way the game draws them. There are five ways in:

- Double-click the system on the map.
- Select the system and press Enter or M.
- Right-click the system and choose Open system view.
- Click Open system view in the Planets header of the system's page.
- Select the system and use View → Open system view.

Each body sits on its orbit around the star, or around its planet for a
moon. Hyperlanes show as arrows at the edge, pointing to the
neighbouring systems. Click an arrow to see the lane's length.
Double-click it to open that neighbour's view. Wheel zooms and
middle-drag pans, as on the galaxy map. A large save can take a moment
to read a system, and the status bar says "Reading the system…" until
the bodies appear.

Systems in a scenario open the same way and show what their initializer
sets. Where it leaves an orbit or an angle to chance, the view shows one
example roll, the way the game might place the bodies. Click Roll again
next to the system's name, or use View → Roll again, to see another. A
random planet class shows a question mark.

Select a scenario body to see its ranges. The band is the range its
distance can fall in, and the wedge is the range of its angle. The body
or orbit that the distance and angle are measured from is outlined in
blue. The body's page lists its orbit step, its angle step and whether
it has a ring. Click the name in the angle step to go to the body it
turns from.

A scenario system whose initializer is `random`, missing or unknown to
your install gets its planets rolled when the game starts. So does one
whose initializer places its planets only through a script. The view
shows faint placeholder planets for it, rolled by the game's rules for
its star. You can't select them.

Press 2 in a system view to turn on Orbit radii. Each orbit shows its
radius. The selected body always shows a line out to it with its
radius.

The status bar counts the system's bodies and belts. With a body's page
open in the Inspector, it shows that body's orbit and angle.

#### Move planets and moons

In a save, you can move planets, moons and asteroids. In a binary or
trinary system you can move the stars too, and their planets move with
them. A star at the system's centre stays where it is. Ring world
segments stay where they are too, and can't have moons.

Drag a body to move it. Its distance and its angle both follow the
pointer, in whole units and whole degrees. Near another orbit, it lands
on that orbit. Hold Shift to snap the angle to 15° steps. Hold Ctrl to
change only one of them: drag along the orbit to change the angle, or
across orbits to change the distance. While Ctrl is held, the body
stays with what it orbits. Its moons move with it. Press Esc during a
drag to put it back.

Drop a planet on another planet to make it a moon of that planet. Drag
a moon away from its planet to make it a planet again. A planet that
has moons of its own can't become a moon. A moon keeps its name after
it moves to another planet, so Sol IIIa can end up orbiting Sol IV.

In a binary or trinary system, drop a planet on another star to make it
orbit that star. Its moons come with it. It lands where you drop it,
clear of the star, and on one of the star's orbits when it's near one.
To bring it back, drop it on the star at the centre or drag it well away
from its star.

To move a body without it becoming a moon or leaving what it orbits,
right-click it and choose Lock to, followed by what it orbits. A locked
body shows a small lock. You can still drag it along its orbit and out
or in, but it stays with its planet or star. Choose Unlock on the same
menu to let it go. The lock only lasts while the save is open and isn't
saved in the file.

Shift+Arrow moves the body whose page is open. Left and Right move it
along its orbit, and Up and Down move it out and in. Each press moves it
1° or 1 unit. Ctrl+Shift+Arrow moves it 10. The arrows on their own
still pan the view.

You can make the same edits in the Orbit block on the body's page.

- Orbits picks the star at the centre, another star or a planet. A new
  moon goes on the next free moon orbit of its planet. A planet moved to
  another star goes just past that star's outermost planet. A body moved
  to the star at the centre stays where it is.
- Orbit radius is its distance from what it orbits.
- Angle is where it stands on that orbit, in degrees. A moon's radius
  and angle are measured from its planet.

If you move a planet or a belt near or past the system's inner radius,
the inner radius moves out with it. How far out follows the defines in
your install and mods. The system view draws the hyperlane exits on the
inner radius circle.

#### Move planets to another system

In a save, you can move planets and moons to another system. Click a
planet in the system view, then Ctrl- or Shift-click more to add them.
Right-click one of them and choose Cut. The planets stay where they are
for now. They are dimmed with a dashed outline, and a bar at the top of
the map says what you're moving. Press Esc to cancel.

To paste, right-click another system on the galaxy map, or right-click
empty space in that system's view, and choose Paste. A single planet
lands where you right-clicked. Several planets go into the next free
orbits past the system's outermost planet. The whole move is one edit,
so one undo puts it all back.

- A planet takes its moons with it. A moon you cut on its own becomes a
  planet in the new system.
- A planet takes its own mining or research station with it. Other
  fleets stay where they are, even if they're parked at the planet.
- Planets keep their names, so Meissa II can end up in Gilprim.
- Stars, planets with a megastructure, such as a habitat or an arc
  furnace, and occupied planets can't be moved.

You can move a colony or a station into another empire's system. The
game changes its ownership to that empire. A station changes owner as
soon as the save loads, and a colony about a month later through an
event. The Paste item warns you when this will happen. A colony moved into space
no one owns stays yours.

To move a single planet, you can also use the System field on its page.
Type a system's name and pick it from the list. The nearest systems come
first.

#### Asteroid belts and the inner radius

The system's page has a Belts section. You can change the inner radius
and each belt's kind and radius there, or remove a belt. Removing a belt
leaves its asteroids where they are. Changing a belt's radius moves its
asteroids with it. The kinds come from your install, so you need the
game data loaded to change one.

In the system view, each belt and the inner radius has six small ring
handles. They show when you point at the belt or the circle. Drag any
of them to change the radius. Right-click a belt's handle and choose Remove
belt to remove it. Its asteroids stay where they are. Right-click empty
space and choose Add belt here to add a belt at that distance from the
star.

Each body's name sits on a plate under it. A colonised planet's plate
has a bar in its owner's colour. Names, System details and Nebulae
still work while a system is open, with their own settings, so you can
have them on in the galaxy and off in a system. With System details on,
each body's resources show under its name. A colony's name shows its
owner's flag. A body's name also shows icons for its megastructures,
dig site, anomaly and pre-FTL civilisation. Hover an icon or a resource
to see what it is. A system inside a nebula shows faint clouds behind
it while Nebulae is on. The other layer
buttons and the tool rail are for the galaxy, so they are hidden while
a system is open. Undo and redo still work from the Edit menu and their
keys.

To get back to the galaxy, press Esc or M, click "Galaxy" in the crumb
at the map's top left, right-click and choose Back to galaxy, or use View → Back
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

- Set each seat's kind. Enabled seats accept any empire. The 1st
  Player seat is for you, or the host in multiplayer. Sol is for the
  United Nations of Earth. Reserved seats A to Z and Alpha to Omega are
  for one specific empire each.
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
- A 1st Player seat goes to the first player, or the host in
  multiplayer. Other empires can still start there now and then. An AI
  whose origin needs a special place, such as Fear of the Dark, is
  seated before you and can draw it. With "Weighted for its empire"
  ticked, you are all but certain to get it.
- A save converted for the mod gives your capital a weighted Sol seat if
  you play the United Nations of Earth, and a weighted 1st Player seat
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
| Shift+Arrow in a system view | Move the open body 1° along its orbit or 1 unit out or in, or 10 with Ctrl |
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
  `star`, `planet-size`, `modifier`, `dig-site`, `deposit`, `add-system`.
  `deposit add` and `deposit remove` change a planet's deposits.
  `add-system` adds systems from a JSON spec you write, or rolls one from
  the install's own rules with `--generate`, a special layout included
  with `--layout`.
- Edit a scenario: `header`, `spawn`, `lane prevent` and `lane allow`.
- Make a scenario: `export-scenario <sav> <out>` and
  `new-scenario <name> <out>`. Add `--profile paint-a-galaxy` to write
  it for Paint a Galaxy.

For example, `sgf move game.sav 123 -150 80` moves system 123.
