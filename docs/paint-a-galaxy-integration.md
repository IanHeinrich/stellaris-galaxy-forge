# Paint a Galaxy integration

What Stellaris Galaxy Forge writes and reads for Paint a Galaxy (PaG,
`oatmealproblem/paint-a-galaxy`, MIT), and a proposal for embedding the site
inside Forge with a postMessage protocol between the two. Audience: the Paint
a Galaxy maintainer and Forge contributors.

## Protocol

Neither side implements this yet: it stays here as a proposal for the
Paint a Galaxy maintainer.

Forge would load PaG in an iframe at:

```
<PaG URL>?embeddedMode=true&parentAppName=Stellaris%20Galaxy%20Forge
```

PaG is a hash router, so both query parameters must precede the `#`.
`parentAppName` is whatever the host calls itself; PaG never hardcodes a
host's name and uses the parameter for its own labels ("Send to Stellaris
Galaxy Forge").

PaG, when `embeddedMode=true`, replaces Download with "Send to
`<parentAppName>`" and posts the galaxy with
`window.parent.postMessage(message, "*")`. The target is `"*"` because
Forge's origin differs per platform (`http://tauri.localhost`,
`tauri://localhost`, `http://localhost:1420` in dev) and the message text is
not secret. External links (Community menu, the Workshop link in the Tweak
step) open in a new window (`target="_blank" rel="noopener"`) rather than
navigating the iframe.

PaG → Forge, the galaxy itself:

```json
{
  "source": "paint-a-galaxy",
  "type": "galaxy",
  "version": 1,
  "name": "<project name>",
  "txt": "<scenario text>"
}
```

`name` is optional: a missing, non-string or blank `name` would be shown to
the user as "Painted galaxy".

PaG → Forge, optional, posted on load:

```json
{
  "source": "paint-a-galaxy",
  "type": "ready",
  "version": 1
}
```

Forge → PaG, posted to `iframe.contentWindow` with the PaG origin as target,
on receiving `ready`:

```json
{
  "source": "stellaris-galaxy-forge",
  "type": "ready",
  "version": 1
}
```

Forge would accept a message only when all of the following hold: `event.origin`
is the PaG origin, `event.source === iframe.contentWindow`,
`source === "paint-a-galaxy"`, `type === "galaxy"`, and `txt` is a non-empty
string. Unknown `type` values are ignored rather than treated as errors, so
new message types can be added without breaking old hosts. `version` is
carried on every message for the same reason: a host or PaG build reading an
unfamiliar version can fall back instead of failing.

## What Paint a Galaxy needs to change

1. Read `embeddedMode` and `parentAppName` from `window.location.search`
   once at startup (a constant in `src/lib/constants.ts`, or a field on the
   `Editor` in `src/lib/editor.svelte.ts`).
2. `src/routes/sidebar.svelte`, `handle_download()`: in embedded mode, post
   the `galaxy` message to `window.parent` instead of calling
   `download_blob()`. Label the button "Send to `{parentAppName}`" and
   reword the Tweak step's "follow the instructions on the Workshop"
   sentence, which currently assumes a download.
3. `src/routes/header.svelte`: the Community links and the Tweak
   description's Workshop link get `target="_blank" rel="noopener"` in
   embedded mode, or the Community menu is hidden there.
4. Optional: post the `ready` message on load; hide Export JSON and other
   file-system-only items when embedded.
5. README note: inside a host's webview, IndexedDB (`idb-keyval`) is
   partitioned from the user's ordinary browser, so projects painted inside
   the host and on the public site are separate storage. Export JSON /
   Import remain the bridge between them. The companion mod needs no
   change for any of this.

## What Forge writes under the Paint a Galaxy profile

A scenario written without Paint a Galaxy's dialect is the game's own
format. It carries none of the mod's flags or scripts. A plain file needs no
mod installed to load. The dialect is chosen by the "For the
Paint a Galaxy mod" checkbox, which the New scenario dialog's blank route and
the Export as scenario dialog share (ticked by default, remembered per
machine), and by the CLI's `--profile paint-a-galaxy` flag on
`export-scenario` and `new-scenario` (default `plain`).
`crates/sgf-core/src/export/paint.rs` is the one module that writes it, laid
over a plain draft; the exact statement shapes below are drawn from it.

The header opens with a comment naming Forge and the mod, then the block
`generate_galaxy_txt.ts` writes for `S` spawn systems (`R` of them reserved
for one empire) and `systems` systems in total, plus Forge's own
`core_radius`. A save's export takes its defaults from the save's own setup
screen (the top-level `galaxy` block) where the placeholders below name it:

```
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
	colonizable_planet_odds = <setup habitability, else 1.0>
	primitive_odds = <setup primitive, else 1.0>
	fallen_empire_max = <min(Z, 6)>
	marauder_empire_max = 3
	extra_crisis_strength = { 10 25 }
	num_empires = { min = 0 max = <S-1> }
	num_empire_default = <min(setup, S-R-1), else min(round((S-1)/2), S-R-1)>
	advanced_empire_default = <min(setup, S-1), else round((S-1)/8)>
	nomad_empire_default = <min(setup, S-1), else round((S-1)/10)>
	nomad_empire_max = <S-1>
	fallen_empire_default = <typed zones, else band>
	marauder_empire_default = <marauder countries, else band>
	crisis_strength = <band>
	core_radius = <Forge's own>
```

`supports_shape` lists the ten vanilla shapes in the game's order, with the
save's own shape moved to the front (the plain profile does the same, and
nothing else in its header changes). The setup's `primitive` and
`habitability` are passed through as set, on the game's own scale, without
conversion. `marauder_empire_default` is the number of `dormant_marauders`
countries the save holds, at most 3, or the band when it holds none.

Without a setup (a scenario re-exported, or a new empty scenario)
`fallen_empire_default` / `marauder_empire_default` / `crisis_strength` come
from a band on the system count: below 400 systems 0 / 1 / 0.5, from 400 1 /
1 / 0.75, from 600 2 / 2 / 1.0, from 800 3 / 2 / 1.25, from 1000 4 / 3 / 1.5.
`crisis_strength` is always the band. `fallen_empire_max` is the number of
fallen empire zones the export places, `Z`, typed and automatic together,
capped at the six kinds the mod knows, and `fallen_empire_default` is capped
at that too. "Update counts" in the editor writes both fallen keys as
`min(Z, 6)` over every zone the map holds, and the validator warns when
`fallen_empire_max` is not that number or `fallen_empire_default` exceeds
the zones.

The L-Cluster's systems (`Category::LCluster`: an `lcluster*` initializer or
flag) are left out under both profiles, with their lanes, since the game adds
its own; a save's comment block says `# Left out: N L-Cluster systems (the
game adds its own)`. Marauders, ratlings, enclaves, guardians and guaranteed
colonies are kept.

Spawn systems are the capitals of the playable ("default") countries, union
every system that already carries a Paint a Galaxy script, union every
system with a spawn weight above zero. Each is written, in ascending id
order as position `i`:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|n| }
```

`n = i % 10`. The capital of the player's country (the first `player`
entry of the save) is written as the player's seat instead:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|n| modifier = { add = 100000 } }
```

`spawn_weight` is a weighted random draw over the free seats, in placement
order, and the player's country is placed first. The mod weighs a preferred
seat at 110 to 120 against 10 to 20 for an enabled one, so a plain preferred
seat is the player's only about a third of the time. None of the mod's own
kinds can pin a seat to an arbitrary empire: Sol and a reserved letter are
1000 but need the UNE's flag or a trait. The unconditional `modifier` makes
the seat heavier than every other by far, so the first empire placed draws
it. The site's importer reads the kind by substring and discards
modifiers, so a round trip through the site degrades this seat to a plain
preferred one. The report names the seat as `player_seat`. The player's
seat is always given a generic `random_empire_init_0N` start, whatever the
save's capital had: in my test the game would not seat the United Nations
of Earth on a seat that named `sol_system_initializer`, the UNE's own
initializer, and put it on the next seat instead. A system that
already carries a preferred, reserved or Sol script keeps that script's kind
and random value rather than being reset to plain "enabled". A spawn system
with no `initializer`, or one whose initializer the report lists under
`home_initializers` (a home that is not a generic start, such as
`shattered_ring_start`), is given `random_empire_init_0N` (`N` = `id % 6 +
1`), and the report's entry says `replaced`. Every empty system within two
lane jumps of a spawn, and still without an `initializer`, gets the mod's
random-list filler and the flag that names it automatic:

```
initializer = painted_galaxy_rl_basic
effect = { set_star_flag = painted_galaxy_automatic_initializer }
```

Each wormhole pair (`BypassLink::Wormhole`) is flagged on both ends, `n`
counting the pairs from 1:

```
effect = { set_star_flag = painted_galaxy_wormhole_<n> set_star_flag = empire_cluster }
```

Preferred and reserved seats are not chosen at export; the seat kind is
changed afterwards in the inspector's Spawn point section. The
custom-initializer flag is not written.

The statements the profile writes on a system, beside the header above:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|n| }
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|n| modifier = { add = 100000 } }
initializer = random_empire_init_0N
initializer = painted_galaxy_rl_basic
effect = { set_star_flag = painted_galaxy_automatic_initializer }
effect = { set_star_flag = painted_galaxy_wormhole_<n> set_star_flag = empire_cluster }
```

### Fallen empires from a save

A save's fallen empires are not copied. The mod rebuilds a fallen empire at
game start from a typed zone, so for every country of type `fallen_empire`
or `awakened_fallen_empire` with a capital, ascending by country id:

- Its cluster is left out: the capital, every system the country owns, every
  fallen empire system (`fallen_*` or `ai_system_*` initializer) within 120
  of the capital, and every generic system inside the ring of 30 the mod
  fills at the capital. A playable capital or a system already in an earlier
  cluster is never taken. A kept system that loses its last lane to the
  cluster gets one to its nearest kept system.
- A typed, preferred zone is centred on the old capital's exact position.
  Its kind follows the capital's initializer by the mod's own table
  (`events/painted_galaxy_fe.txt`): `fallen_1` materialist, `fallen_2`
  spiritualist, `fallen_3` xenophile, `fallen_4` xenophobe, `fallen_machine`
  machine, `fallen_hive` hive, anything else random.
- The zone's anchor is a system created for it: the next free id (max id + 1,
  ascending per fallen empire), an empty name (the game names it),
  `initializer = painted_galaxy_rl_basic`, the automatic-initializer flag
  followed by the zone's flags (`preferred`, typed, no `fallback`), and one
  lane to its nearest kept system. The anchor stands at `capital − offset`
  for the first distance of 40, 50, 30, 60, 70, … 200 with a direction whose
  anchor lies on the map, at least 20 from every kept system and outside
  every ring; among the directions at that distance, the one farthest from
  its nearest kept system wins.
- When the ring at the capital is not clear (a seat, a marauder camp or
  another cluster's system inside it), the zone goes on the existing system
  within 200 of the capital whose nearest clear grid position lies closest
  to it, and the report says `exact = false`. When no such position exists
  the cluster is still left out and the report's `anchor` is `None`.
- The kept systems that had a lane into the cluster are linked to the zone
  by custom connections, under the ids 0, 1, 2… in fallen empire order, so
  the mod lays the fallen empire's hyperlanes where the save had them. A
  kept system in no cluster is the only kind linked, and the report's
  `links` counts them.

The automatic candidates then run over what is left, keeping their 60 from
every typed centre, and `fallen_empire_default` is the number of typed zones.
The report lists each fallen empire as `FallenEmpireReport { name, kind,
systems_left_out, anchor, exact, links }`.

### Fallen empire zones

A zone is star flags on an anchor system:

```
effect = { set_star_flag = painted_galaxy_fe_spawn
           set_star_flag = painted_galaxy_fe_spawn_<e|se|s|sw|w|nw|n|ne>
           set_star_flag = painted_galaxy_fe_spawn_<random|materialist|spiritualist|xenophobe|xenophile|machine|hive>
           set_star_flag = painted_galaxy_fe_spawn_distance_<30..200 step 10>
           set_star_flag = painted_galaxy_fe_spawn_preferred    # placed by the user
           set_star_flag = painted_galaxy_fe_spawn_fallback }   # fill with random systems if unused
```

The zone's centre is the anchor's position plus, for distance `d` and
`k = d/√2`: e (−d, 0), se (−k, +k), s (0, +d), sw (+k, +k), w (+d, 0),
nw (+k, −k), n (0, −d), ne (−k, −k). At game start the mod spawns the
fallen empire's home system there with `spawn_system` at exactly `d` in
that orientation, and its satellites 15–25 units around it, each at a
bearing range its event names for the kind. The first tier of satellites
is hyperlaned to the home and the rest to the satellite spawned before
them: materialist and xenophile get seven in three branches, spiritualist
six, xenophobe and hive nine, machine four all on the home, random three
chains of two. Forge draws that tree as the zone's ghost. A missing kind
reads as `random`, a missing distance as 40, and Forge reads them the same
way.

Forge edits only the `painted_galaxy_fe_spawn*` and
`painted_galaxy_fe_custom_connection*` flags of a system's `effect`
block. Every other flag stays where it is. A zone whose ring of radius 30
would contain a system, or whose centre lies beyond ±470, is refused.
Every change made in Forge sets `painted_galaxy_fe_spawn_preferred`.

By default the mod gives each system of the new fallen empire a hyperlane
to its mutually nearest outside system within 100. Custom connections
override that. The anchor carries `painted_galaxy_fe_custom_connections`
and `painted_galaxy_fe_custom_connection_id_<n>`, and every system
carrying `painted_galaxy_fe_custom_connection_to_<n>` gets a hyperlane to
the nearest system of the fallen empire built in that zone, from any
distance. The custom flag with no system linked to it leaves the fallen
empire with no hyperlanes at all. The ids run from 0 to 99, an id is
galaxy-wide, and the mod stops at the first `_id_` flag an anchor
carries, so one anchor takes one id. Forge reads the flags into
`SystemNode.fe_link` (`custom`, `id`, `to`). `SetFeLinks { anchor,
linked }` writes the whole set of systems linked to a zone: the anchor
keeps the id it has or takes the lowest free one, every listed system
gets the `_to_` flag and every other system loses it. An empty list
clears the anchor's custom flag and id. `SetFeLinkFlags` is the exact
inverse. Issues report a zone that takes custom connections with nothing
linked, a link whose id no zone takes, two zones on one id and, as
information, a link from farther than 100. A system inside the ring is
already refused as a blocked zone.

Automatic candidates follow Paint a Galaxy's own rule. For every system
that anchors no zone, in direction order e, se, s, sw, w, nw, n, ne, the
first direction whose centre `C` at distance 40 has `|C| ≥ 130`,
`dist(C, (−420, −420)) ≥ 100`, `|C.x|, |C.y| ≤ 470`, no system within 30
and no accepted zone centre within 60 becomes a `random`, non-preferred
zone. An export places none of them, only the typed zones of the save's
own fallen empires. "Fit fallen empire zones" (`fe_zone::fit`) removes
every non-preferred zone, runs the rule again and keeps the `count`
candidates farthest from each other and from the preferred zones, as one
op. `fe_zone::candidate_count` is the most it can keep.

### Marauder clans

A marauder clan is one system whose initializer is `marauder_N_1`, N being
1, 2 or 3 (the game's `marauder_initializers.txt`). That initializer's
`init_effect` creates the clan's country and flags the system
`marauder_capital_N`. The clan's two raid bases are `marauder_N_2` and
`marauder_N_3`. In a random galaxy the home spawns them itself with
`neighbor_system`. In a static galaxy nothing does, so on day one Paint a
Galaxy adds the two bases beside every `marauder_capital_N` system that
has no `marauder_system` hyperlane neighbour. Forge does not rely on that:
it treats a clan as three systems and adds the two bases itself, each
hyperlaned to the home. A clan drawn that way spawns the same on a plain
scenario and a painted one. Only three clans exist, and a clan spawns
from its home alone, so the map decides how many there are.

Forge reads the role from the initializer on every system, in a save and
in a scenario alike (`SystemNode.marauder`, `Home(N)` or `Base(N)`), and
reports on any scenario a clan with two homes (only one spawns) and a
raid base with no hyperlane to its clan's home (nothing spawns there). On
a painted map it also notes, as information, a home within 30 of a seat,
since that empire takes the raids first. "Update empire counts" writes
`marauder_empire_max` and `marauder_empire_default` as the number of
clans with a home, beside the seven keys above, and the header check
reports a `marauder_empire_max` that is not that number or a default
above it.

## What Forge reads

A system reads as a Paint a Galaxy spawn when its `spawn_weight`'s `add`
scalar starts with `value:painted_galaxy_spawn_weight|`; what follows is
read as `|KEY|value|` pairs (`PREFERRED|yes`, `RESERVED|<letter>`,
`SOL|yes`, `RANDOM_VALUE|n`), and a key this editor does not know is passed
over rather than rejected, so a parameter a later Paint a Galaxy build adds
still reads back as a seat. The seat is the player's when the block carries
exactly one `modifier` and that modifier holds `add = 100000` and nothing
else. Any other modifier content is foreign script: the seat reads as its
kind alone and the block is neither rewritten nor cleared. A reserved seat's letter is written as one
lowercase ASCII letter, matching the star flags Paint a Galaxy itself uses;
on read, whatever follows `RESERVED|` is taken as the letter. Because the
mod resolves the weight from the seat kind rather than from a number,
setting a base spawn weight on a system that already carries a script is
refused; its Paint a Galaxy spawn kind is what changes instead.

Forge treats a scenario as painted, and turns its Paint a Galaxy layer on,
when the `painted_galaxy_` prefix appears anywhere in the text or the
header carries the comment Forge itself writes under the profile.
