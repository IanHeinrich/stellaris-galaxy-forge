# Paint a Galaxy integration

This page covers what Stellaris Galaxy Forge writes and reads for the
Paint a Galaxy mod (`oatmealproblem/paint-a-galaxy`, MIT). It is written
for the Paint a Galaxy maintainer and for Forge contributors.

## What Forge writes under the Paint a Galaxy profile

A scenario written without Paint a Galaxy's dialect is in the game's own
format. It carries none of the mod's flags or scripts, and it loads with
no mod installed. In the app, the "For the Paint a Galaxy mod" checkbox
picks the dialect. The New scenario dialog's blank route and the Export
as scenario dialog share that checkbox. It is ticked by default and
remembered per machine. On the CLI, `export-scenario` and `new-scenario`
take `--profile paint-a-galaxy`, and the default is `plain`. All of the
dialect is written in `crates/sgf-core/src/export/paint/`, on top of a
plain draft. The exact statement shapes below come from that module.

Every scenario Forge writes opens with a `# created by` line, under either
profile. Paint a Galaxy writes a `# created by` line of its own. The
line names the tool and version that last wrote the file, and in
brackets where that tool got the file from:

```
# created by Stellaris Galaxy Forge <version> (converted from save <file>)
# created by Stellaris Galaxy Forge <version>
# created by Stellaris Galaxy Forge <version> (imported from txt created by Paint a Galaxy 1.4.2 (imported from generic txt))
```

The `#` is followed by a zero-width space (U+200B) and then an ordinary
space, so a comment someone types by hand is never taken for the line.
The examples here show it as `# created by`.

A save's export writes the first form, with `(`, `)` and line breaks
dropped from the file name. A new scenario writes the second. When Forge
saves an edited scenario whose first line is a `# created by` line, it
wraps that line in its own, as in the third. The chain grows by one level
each time the file passes to another tool or version. A line that already
names this version of Forge is kept as it is.

When the wrapped line would name more than ten writers, Forge keeps the
eight newest (its own included), one `...` level, and the original writer
with its note. It never adds a second `...`. A line whose brackets do not
parse is wrapped whole.

Some files open with the `# Exported by` or `# Written by` comment that an
earlier Forge wrote. Forge puts `# created by Stellaris Galaxy Forge
<version> (imported from txt created by an earlier Stellaris Galaxy
Forge)` above that comment. A file with Paint a Galaxy's scripts or flags
but no line was made by a Paint a Galaxy from before the line. Forge puts
`# created by Stellaris Galaxy Forge <version> (imported from txt created
by Paint a Galaxy)` above its first line. A file neither tool made gets
no line. A file
saved without edits is written unchanged. A byte order mark stays in
front, and the line uses the file's own line ending.

Below that line, the header opens with a comment that names Forge and the
mod. Then comes the block that `generate_galaxy_txt.ts` writes for `S`
spawn systems and `systems` systems in total, where `R` of the spawn
systems are reserved for one empire. Forge adds its own `core_radius` to
it. Where a placeholder below names the setup, a save's export takes that
default from the save's own setup screen, which is the top-level `galaxy`
block:

```
# created by Stellaris Galaxy Forge <version> ...
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {
	name = "<name>"
	priority = 10
	supports_shape = elliptical
	supports_shape = ring
	supports_shape = spiral_2
	supports_shape = spiral_3
	supports_shape = spiral_4
	supports_shape = spiral_6
	supports_shape = bar
	supports_shape = starburst
	supports_shape = cartwheel
	supports_shape = spoked
	random_hyperlanes = no
	num_wormhole_pairs = { min = 0 max = <max(5, setup)> }
	num_wormhole_pairs_default = <setup, else 1>
	num_gateways = { min = 0 max = <max(5, setup)> }
	num_gateways_default = <setup, else 1>
	num_hyperlanes = { min = 0.5 max = 3 }
	num_hyperlanes_default = <setup, else 1>
	colonizable_planet_odds = 1.0
	primitive_odds = 1.0
	fallen_empire_max = <min(Z, 6)>
	marauder_empire_max = <clan homes>
	extra_crisis_strength = { 10 25 }
	num_empires = { min = 0 max = <S-1> }
	num_empire_default = <min(setup, S-R-1), else min(round((S-1)/2), S-R-1)>
	advanced_empire_default = <min(setup, S-1), else round((S-1)/8)>
	nomad_empire_default = <min(setup, S-1), else round((S-1)/10)>
	nomad_empire_max = <S-1>
	fallen_empire_default = <typed zones, else band>
	marauder_empire_default = <clan homes>
	crisis_strength = <setup crises, else band>
	core_radius = <Forge's own>
```

`supports_shape` lists the ten vanilla shapes in the game's order, with
the save's own shape moved to the front. The plain profile does the same.
`colonizable_planet_odds` and `primitive_odds` are always 1.0. They don't
set the Habitable worlds and Pre-FTL sliders, and the game applies
`colonizable_planet_odds` on top of the Habitable worlds setting, so a
save's 0.25 would cut habitable worlds twice (checked in game on 4.5.1).
`marauder_empire_max` and `marauder_empire_default` are both
the number of marauder clans whose home the map holds. `R` counts the
1st Player, reserved and Sol seats. `S-R-1` becomes `S-R` when the map
has a 1st Player seat or the player's own seat is a reserved or Sol
seat, since `R` already counts it. Paint a Galaxy sizes its safe count
the same way.

Without a setup (a scenario re-exported, or a new empty scenario),
two keys come from a band on the system count:

| Systems   | `fallen_empire_default` | `crisis_strength` |
|-----------|-------------------------|-------------------|
| below 400 | 0                       | 0.5               |
| from 400  | 1                       | 0.75              |
| from 600  | 2                       | 1.0               |
| from 800  | 3                       | 1.25              |
| from 1000 | 4                       | 1.5               |

`crisis_strength` always comes from the band. `fallen_empire_max` is `Z`,
the number of fallen empire zones the export places, typed and automatic
together. It is capped at the six kinds the mod knows, and
`fallen_empire_default` is capped at that too. "Update counts" in the
editor writes both fallen empire keys as `min(Z, 6)`, counting every zone
on the map. The validator warns when `fallen_empire_max` is not that
number, or when `fallen_empire_default` is higher than the number of
zones.

Both profiles leave out the L-Cluster's systems and their lanes, because
the game adds its own. Forge knows these as `Category::LCluster`, a
system with an `lcluster*` initializer or flag. A save's comment block
says `# Left out: N L-Cluster systems (the game adds its own)`.
Marauders, ratlings, enclaves, guardians and guaranteed colonies are
kept.

The spawn systems are the capitals of the playable ("default")
countries, plus every system that already carries a Paint a Galaxy
script, plus every system with a spawn weight above zero. Forge writes
them in ascending id order, and the one at position `i` gets:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|n| }
```

Here `n = i % 10`. The capital of the player's country is written as the
player's seat instead. The player's country is the first `player` entry
in the save. If it carries the `human_1` flag, which marks the United
Nations of Earth, the seat is the Sol seat:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 has_country_flag = human_1 } }
```

Otherwise it is a 1st Player seat, which Paint a Galaxy writes as
`PREFERRED`:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|n| modifier = { add = 100000 has_country_flag = painted_galaxy_host } }
```

The mod sets `painted_galaxy_host` on the first country whose ruler is
created, which is the player in single player and the host in
multiplayer. It does so from `on_ruler_created`, before the galaxy is
generated.

Each empire draws its seat at random from the free seats, weighted by
`spawn_weight`. Empires draw in placement order, and the player is not
always placed first. An AI whose origin needs special placement (Fear of
the Dark, or a federation origin's leader) is seated in an earlier pass.
It draws by the same weights. In my runs, a preferred seat with an
unconditioned 100000 went to such an AI two times in three. That was
before the mod tied the seat to the host.

A weight alone never makes a seat certain. A seat is certain only when
every other empire weighs it at zero, and the mod's Sol and reserved
kinds do that. Sol multiplies the weight to zero and adds 1000 for
`human_1`. A reserved seat does the same for the matching Reserved
Spawns trait. A 1st Player seat multiplies to zero and adds 100 for
`painted_galaxy_host`, but the mod's leader-age term comes after the
multiply, so every other empire still weighs it at 0 or 10. The
`modifier` carries the kind's own condition and adds 100000. The empire
that can take the seat is then all but sure to draw it whenever it is
placed, and no other empire gains anything. An AI seated before the
player can still draw a 1st Player seat at 10, against the 10 to 20 of
each enabled seat.

The report names the seat as `player_seat` and its kind as
`player_seat_kind`. The player's seat always gets one of the game's
ordinary `basic_init_0N` systems, whatever the save's capital had,
because the player's empire brings its own home.

A Sol seat naming `sol_system_initializer`, as Paint a Galaxy writes it,
works in game (checked on 4.5). The UNE starts on it. When no one plays
the UNE, the seat stays empty and the game still builds Sol there. The
mod's `painted_galaxy_une.1` event then puts the UNE on that Sol as the
parent of a human Lost Colony, such as the Commonwealth of Man. The event
needs Sol's initializer on the seat. With a generic start, no Sol is
built.

A system that already carries a preferred, reserved or Sol script keeps
that script's kind and random value rather than being reset to plain
"enabled". A spawn system with no `initializer` is given one of the
game's ordinary systems. A spawn system whose initializer the report
lists under `home_initializers` gets one too. That is a home that is not
a generic start, such as `shattered_ring_start` or one of the game's
random empire starts, and the report's entry says `replaced`.

The ordinary system is `basic_init_01`, `02`, `03`, `05` or `06`, at the
game's own odds of 20, 20, 10, 6 and 4. The pick is a weighted draw
keyed by a hash of the system's id, so neighbouring ids land
independently and the same id always gets the same system.
`basic_init_04` is left out because its last body can be an ice
asteroid.

On an ordinary system the game builds a homeworld for the empire's own
class at 100% habitability. The random empire starts,
`random_empire_init_0N`, build the homeworld before the game knows the
species, and most empires on one start at 30 to 50% (checked on 4.5).
That is why a random empire start on a seat counts as a home to replace,
not as a generic start. On 4.5, an origin with its own start system,
such as Shattered Ring or Ocean Machines, replaced a random empire start
on its seat. I have not checked it on an ordinary system.

Every empty system within two lane jumps of a spawn, if it still has no
`initializer`, gets the mod's random-list filler and the flag that marks
it as automatic:

```
initializer = painted_galaxy_rl_basic
effect = { set_star_flag = painted_galaxy_automatic_initializer }
```

Each wormhole pair (`BypassLink::Wormhole`) is flagged on both ends, with
`n` counting the pairs from 1:

```
effect = { set_star_flag = painted_galaxy_wormhole_<n> set_star_flag = empire_cluster }
```

1st Player and reserved seats are not chosen at export, apart from the
player's own. A seat's kind is
changed afterwards, in the inspector's Spawn point section. Forge does
not write the custom-initializer flag.

Apart from the header, these are the statements the profile writes on a
system:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|n| }
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|n| modifier = { add = 100000 } }
initializer = basic_init_0N
initializer = painted_galaxy_rl_basic
effect = { set_star_flag = painted_galaxy_automatic_initializer }
effect = { set_star_flag = painted_galaxy_wormhole_<n> set_star_flag = empire_cluster }
```

### Fallen empires from a save

Forge does not copy a save's fallen empires. The mod rebuilds a fallen
empire at game start from a typed zone. So for every country of type
`fallen_empire` or `awakened_fallen_empire` that has a capital, in
ascending country id order, Forge does the following.

- It leaves out the country's cluster. The cluster is the capital, every
  system the country owns, every fallen empire system within 120 of the
  capital, and every generic system inside the ring of 30 the mod fills
  at the capital. A fallen empire system is one with a `fallen_*` or
  `ai_system_*` initializer. A playable capital, or a system already in
  an earlier cluster, is never taken. If a kept system loses its last
  lane to the cluster, it gets a lane to its nearest kept system.
- It centres a typed, preferred zone on the old capital's exact
  position. The zone's kind follows the capital's initializer, by the
  mod's own table in `events/painted_galaxy_fe.txt`. `fallen_1` is
  materialist, `fallen_2` spiritualist, `fallen_3` xenophile, `fallen_4`
  xenophobe, `fallen_machine` machine and `fallen_hive` hive. Anything
  else is random.
- It creates a new system as the zone's anchor. The anchor takes the next
  free id (max id + 1, ascending per fallen empire). Its name is empty,
  so the game names it. It gets `initializer = painted_galaxy_rl_basic`,
  then the automatic-initializer flag followed by the zone's flags:
  `preferred`, typed, and no `fallback`. It also gets one lane to its
  nearest kept system.
- The anchor stands at `capital − offset`. Forge tries the distances 40,
  50, 30, 60, 70, … 200 and takes the first one that has a direction
  where the anchor lies on the map, at least 20 from every kept system
  and outside every ring. Among the directions at that distance, the one
  farthest from its nearest kept system wins.
- The ring at the capital may not be clear, because a seat, a marauder
  camp or another cluster's system lies inside it. Then the zone goes on
  the existing system within 200 of the capital whose nearest clear grid
  position lies closest to it, and the report says `exact = false`. If no
  such position exists, the cluster is still left out, and the report's
  `anchor` is `None`.
- Kept systems that had a lane into the cluster are linked to the zone
  by custom connections, under the ids 0, 1, 2… in fallen empire order.
  That way the mod lays the fallen empire's hyperlanes where the save had
  them. Only kept systems outside every cluster are linked, and the
  report's `links` counts them.

The automatic candidates then run over what is left, keeping 60 away
from every typed centre. `fallen_empire_default` is the number of typed
zones. The report lists each fallen empire as `FallenEmpireReport { name,
kind, systems_left_out, anchor, exact, links }`.

### Fallen empire zones

A zone is a set of star flags on an anchor system:

```
effect = { set_star_flag = painted_galaxy_fe_spawn
           set_star_flag = painted_galaxy_fe_spawn_<e|se|s|sw|w|nw|n|ne>
           set_star_flag = painted_galaxy_fe_spawn_<random|materialist|spiritualist|xenophobe|xenophile|machine|hive>
           set_star_flag = painted_galaxy_fe_spawn_distance_<30..200 step 10>
           set_star_flag = painted_galaxy_fe_spawn_preferred    # placed by the user
           set_star_flag = painted_galaxy_fe_spawn_fallback }   # fill with random systems if unused
```

The zone's centre is the anchor's position plus an offset. For distance
`d` and `k = d/√2`, the offsets are e (−d, 0), se (−k, +k), s (0, +d),
sw (+k, +k), w (+d, 0), nw (+k, −k), n (0, −d) and ne (−k, −k).

At game start the mod spawns the fallen empire's home system there with
`spawn_system`, at exactly `d` in that orientation. It spawns the
satellites 15–25 units around the home, each within the bearing range
its event names for the kind. The first tier of satellites is hyperlaned to the
home, and the rest to the satellite spawned before them. Materialist and
xenophile get seven satellites in three branches. Spiritualist gets six,
and xenophobe and hive get nine. Machine gets four, all on the home.
Random gets three chains of two. Forge draws that tree as the zone's
ghost. The mod reads a missing kind as `random` and a missing distance as
40, and Forge reads them the same way.

Forge edits only the `painted_galaxy_fe_spawn*` and
`painted_galaxy_fe_custom_connection*` flags of a system's `effect`
block. Every other flag stays where it is. Forge refuses a zone whose
ring of radius 30 would contain a system, or whose centre lies beyond
±470. Every change made in Forge sets
`painted_galaxy_fe_spawn_preferred`.

By default the mod gives each system of the new fallen empire a hyperlane
to its mutually nearest outside system within 100. Custom connections
override that. The anchor carries `painted_galaxy_fe_custom_connections`
and `painted_galaxy_fe_custom_connection_id_<n>`. Every system carrying
`painted_galaxy_fe_custom_connection_to_<n>` gets a hyperlane to the
nearest system of the fallen empire built in that zone, from any
distance. If the anchor has the custom flag and no system is linked to
it, the fallen empire gets no hyperlanes at all. The ids run from 0 to
99, and an id is galaxy-wide. The mod stops at the first `_id_` flag an
anchor carries, so one anchor takes one id.

Forge reads the flags into `SystemNode.fe_link` (`custom`, `id`, `to`).
`SetFeLinks { anchor, linked }` writes the whole set of systems linked to
a zone. The anchor keeps the id it has, or takes the lowest free one.
Every listed system gets the `_to_` flag, and every other system loses
it. An empty list clears the anchor's custom flag and id.
`SetFeLinkFlags` is the exact inverse.

Issues reports a zone that takes custom connections with nothing linked,
a link whose id no zone takes, and two zones on one id. It also notes a
link from farther than 100, as information. A system inside the ring is
already refused as a blocked zone.

Automatic candidates follow Paint a Galaxy's own rule. Forge checks every
system that anchors no zone and tries the directions in the order e, se,
s, sw, w, nw, n, ne. The first direction whose centre `C` at distance 40
meets all of these becomes a `random`, non-preferred zone:

- `|C| ≥ 130`
- `dist(C, (−420, −420)) ≥ 100`
- `|C.x|, |C.y| ≤ 470`
- no system within 30
- no accepted zone centre within 60

An export places none of these candidates, only the typed zones of the
save's own fallen empires. "Fit fallen empire zones" (`fe_zone::fit`)
removes every non-preferred zone and runs the rule again. It then keeps
the `count` candidates farthest from each other and from the preferred
zones. All of that is one op. `fe_zone::candidate_count` is the most it
can keep.

### Marauder clans

A marauder clan is one system whose initializer is `marauder_N_1`, where
N is 1, 2 or 3 (the game's `marauder_initializers.txt`). That
initializer's `init_effect` creates the clan's country and flags the
system `marauder_capital_N`. The clan's two raid bases are
`marauder_N_2` and `marauder_N_3`. In a random galaxy the home spawns
them itself with `neighbor_system`. In a static galaxy nothing does. So
on day one Paint a Galaxy adds the two bases beside every
`marauder_capital_N` system that has no `marauder_system` hyperlane
neighbour.

Forge does not rely on that. It treats a clan as three systems and adds
the two bases itself, each hyperlaned to the home. A clan drawn that way
spawns the same on a plain scenario and a painted one. There are only
three clans, and a clan spawns from its home alone, so the map decides
how many there are.

Forge reads each system's marauder role from its initializer, in saves
and scenarios alike. The role goes into `SystemNode.marauder` as
`Home(N)` or `Base(N)`. On any scenario, Forge reports a clan with two
homes, because only one of them spawns. It also reports a raid base with
no hyperlane to its clan's home, because nothing spawns there. On a
painted map it notes a home within 30 of a seat, as information, since
that empire takes the raids first. "Update counts" writes
`marauder_empire_max` and `marauder_empire_default` as the number of
clans with a home, beside the seven keys above. The header check reports
a `marauder_empire_max` that is not that number, or a default above it.

## What Forge reads

Forge reads a system as a Paint a Galaxy spawn when the `add` scalar of
its `spawn_weight` starts with `value:painted_galaxy_spawn_weight|`. The
rest is read as `|KEY|value|` pairs (`PREFERRED|yes`, `RESERVED|<name>`,
`SOL|yes`, `RANDOM_VALUE|n`). Forge skips a key it does not know instead
of rejecting it, so a parameter that a later Paint a Galaxy build adds
still reads back as a seat.

The seat is weighted for its holder when the block carries exactly one
`modifier`, and that modifier holds `add = 100000`, the kind's own
condition and nothing else. The condition is
`has_country_flag = painted_galaxy_host` for a 1st Player seat,
`has_country_flag = human_1` for Sol, and
`has_trait = trait_painted_galaxy_reserved_spawn_<x>` for reserved `x`.
A 1st Player seat with an empty condition, as Forge wrote it before
Paint a Galaxy tied the seat to the host, also reads as the player's.
Forge writes the host condition when it next changes that seat.
An enabled seat has no such marker. Forge treats any other modifier
content, or a marker shaped for another kind, as foreign script. The seat
then reads as its kind alone, and Forge neither rewrites nor clears the
block.

A reserved seat is named by a lowercase letter `a` to `z` or a Greek
letter spelled out, `alpha` to `omega`, as Paint a Galaxy names them.
Forge refuses any other name when it sets a seat. On read, whatever
follows `RESERVED|` is taken as the name. The mod resolves the weight
from the seat kind rather than from a number, so setting a base spawn
weight on a system that already carries a script is refused. What
changes instead is its Paint a Galaxy spawn kind.

Forge treats a scenario as painted, and turns on its Paint a Galaxy
layer, when the `painted_galaxy_` prefix appears anywhere in the text. It
does the same when the header carries the comment Forge itself writes
under the profile.
