# Stellaris save format notes

Reference for the `.sav` format as Stellaris 4.4 and 4.5 write it, with
examples from the sample saves in `testdata/`. Sibling of
[game-data-notes.md](game-data-notes.md), which covers the install.

## Container

- Zip (deflate), exactly two root members, `gamestate` then `meta`,
  DOS-epoch timestamps. Zipping a folder instead breaks the save.
- Always plain text, Ironman included. No signature or checksum, and the
  game loads edited saves. `cheated_on_save=yes` marks console use;
  achievements depend on the game and mod checksum and on console use,
  not on save edits.
- `meta` repeats the `gamestate` header: `version`, `name`, `date`,
  `required_dlcs`, the player flag, `meta_fleets`, `meta_planets`.

## Text

- LF, tab indentation, ASCII, no BOM, no `#` comments, no backslash
  escapes, no CR.
- Clausewitz grammar: `key=value`, `key={ ... }`, nesting. Statements are
  separated by **any** whitespace, not by lines: several pairs per line
  (`0=shipyard\t\t\t\t1=solar_panel_network\t\t\t}`), tabs after `=`
  (`last_bombardment=\t\t\t"0.01.01"`), a block on the next line
  (`hyperlane=\n\t\t{`), inline blocks (`random={ 0 3366986288 }`),
  quoted keys (`"tech_lasers_1"="1"`), lists mixing bare scalars and
  blocks (`intel={ { 24 { intel=0 ... } } }`), scalar lists with a
  trailing space (`{ 54 55 56 }`).
- **Indentation is unreliable**: inside `colony` the writer emits `22=`
  at column 0 at depth 3. Depth comes from brace counting only.
- Duplicate keys are normal at every level and order matters: repeated
  top-level `nebula=` and `saved_event_target=`, repeated
  `planet=748 planet=749 ...` inside a system.
- Anonymous-object lists share one shape: `{`, newline, an
  indentation-only line, then each entry followed by a line holding a
  single space.

  ```
  \t\thyperlane=
  \t\t{
  \t\t\t
  \t\t\t{
  \t\t\t\tto=752
  \t\t\t\tlength=33
  \t\t\t}
  \x20
  \t\t}
  ```

- Saves from 3.4 to 3.9 put every block's opening brace on its key's
  line, drop the indentation-only line, and start each entry after the
  first with a single space. 3.10 onwards writes the shape above.

  ```
  \t\thyperlane={
  \t\t\t{
  \t\t\t\tto=398
  \t\t\t\tlength=37
  \t\t\t}
  \x20{
  \t\t\t\tto=386
  \t\t\t\tlength=19
  \t\t\t}
  \x20
  \t\t}
  ```

- Scalars: integers; decimals to 5 places, trailing zeros stripped, no
  exponents (`-333`, `-144.22`, `-339.74518`); quoted strings; `yes`/`no`;
  bare identifiers (`none`, `planet`, `not_set`); dates as `"2206.11.16"`.
- Null reference id is `4294967295` (u32::MAX): `origin=4294967295`.
- Some ids carry high bits, `16777219` (2^24 + 3) and `2868903937`, in
  species, ship designs and orbitals. Treat ids as `u64`.
- Name format keys are resolved in engine code, not localisation:
  `%ADJECTIVE%`, `%ADJ%`, `%SEQ%`, `%ACRONYM%` (whose `base` variable
  renders to the initials of the capitalised words, "United Nations of
  Earth" to "UNE").

## Top-level sections (by bytes)

A quote-aware brace scan partitions the file into top-level statements
with no residue. Typical shares: planets 22.0%, ships 18.6%, ship_design
17.5%, country 17.3%, fleet 8.3%, construction 4.4%, galactic_object
2.5%, ambient_object 1.6%, deposit 1.5%, leaders 1.4%, pop_jobs 1.0%,
army 0.7%.

Top-level counters: `last_created_species_ref`, `last_created_country`,
`last_created_system`, `last_created_fleet`, `last_created_ship`,
`last_created_leader`, `last_created_army`, `last_created_design`,
`last_created_ambient_object`. None for planets or deposits.

## Galaxy

- `galactic_object={ <id>={ ... } }`, ids contiguous from 0. Every system
  has `coordinate`, `planet`, `star_class`, `storm`, `inner_radius`,
  `outer_radius`, `sector`, `initializer`, `starbases`, `index`, `name`.
  Optional: `hyperlane`, `flags`, `asteroid_belts`, `fleet_presence`,
  `discovery`, `ambient_object`, `init_parent`, `colonies`,
  `timed_modifier`, `bypasses`, `megastructures`,
  `has_access_to_relay_network`, `natural_wormholes`, `aura_presence`,
  `inhibitor_owners`, `ftl_inhibitor_presence`.
- `hyperlane=` always immediately follows `star_class=`, and is omitted
  entirely when the system has no lanes.
- Lanes are symmetric, stored on both endpoints as
  `{ to=N length=L [bridge=yes] }`. Generator lanes use
  `length = floor(euclidean distance)` as an integer; script and event
  lanes carry the exact distance as a decimal (`length=14.03876`). Edits
  preserve the form of the entry they rewrite; new lanes use the integer
  form. The game takes `length` as the lane's travel cost and trusts it:
  a lane set to 200 across a 33-unit gap makes the pathfinder detour. So
  lengths are recomputed on move, and per-lane overrides are real.
- The game writes duplicate lane entries: 708 lists `to=154` twice and
  154 lists `to=708` twice. Duplicates are a validator note, one per
  pair, and removing a lane removes every matching entry. The untouched
  sample gives two `lane_duplicate` notes, one `system_isolated` warning
  and no errors.
- Lane-less systems are legal: an isolated system loads, draws without
  lanes, and time passes without error. Cutting a lane under a fleet in
  transit is safe, the fleet finishes its jump and later routes avoid it.
- A lane-less system that is one end of a wormhole pair is connected:
  the wormhole names both ends and works from the start, so the system
  is no `system_isolated` warning and it counts in the same component as
  its partner. In the sample 789 rides the wormhole to 788, which leaves
  790 the only system nothing reaches. A gateway reaches the other open
  gateways, so it connects a lane-less system only when another gateway
  is open elsewhere. An L-Gate reaches the L-Cluster once the L-Gates
  are open, which a save may never have reached, so a lane-less L-Gate
  system stays a note.
- `bridge=yes`, flagged on both ends, marks generator connector lanes
  joining locally generated pockets: 125 undirected lanes in the sample,
  3 of them cut edges.
- The game draws `x` increasing to the left and `y` increasing downwards,
  so Sol at `(397, -180)` sits top-left; the camera applies those signs.
- `galaxy_radius=499.9288` at top level; `galaxy={ core_radius=112.5 ... }`
  holds the generation settings.
- Everything inside a system (planets, fleets, ambient objects, wormhole
  endpoints, megastructures) has `coordinate={ x y origin=<system id> }`
  relative to the star at (0,0). Only `galactic_object`, `nebula` and
  `clusters` are absolute (`origin=4294967295`). Moving a system changes
  its own `x`/`y` and the `length` of each lane on both ends, nothing
  inside moves, and the game keeps the moved system's lanes and draws
  them to the old neighbours.
- Planet `orbit` is the orbital radius, `x`/`y` the current point on that
  orbit. A moon has `moon_of=<planet>`, `orbit` around its parent, and
  system-relative coordinates.
- Planets, deposits and construction queues are slot tables. An id is
  `slot | generation<<24`, the table is sorted by slot, and a dead slot
  keeps its old id as `<id>=none`. The game reuses a dead slot with the
  generation one higher. System ids have no generation and no gaps: a
  gap crashes the game on load, so a new system takes
  `last_created_system`+1.
- When the game removes a deposit, its entry becomes `<id>=none` in
  place, the table's last entry included, and the id leaves the planet's
  `deposits={ }`. The key goes with its last id: no save holds an empty
  `deposits`. In 4.x `deposits` is the last key of a planet entry. A
  station over a removed deposit stays, and produces nothing.
- A system the game spawns by script (and one the editor adds) is a
  `galactic_object` entry in this order: `coordinate={ x y
  origin=4294967295 visual_height }`, `name`, `planet=` per body (star
  first), `star_class`, `hyperlane`, `initializer`, `inner_radius`,
  `outer_radius`, `starbases={ 4294967295 }`, `sector=4294967295`,
  `index=0`, `storm=4294967295`. It has no `arm`. `inner_radius` is
  max(150, outermost reach + 30), where a moon reaches its own orbit plus
  its planet's, and `outer_radius` is `inner_radius` + 100. Each body is
  a `planets.planet` entry with `deposit` entries holding
  `deposit_holder={ type=0 id=<planet> }`. The name is taken out of
  `random_name_database.star_names`. Names are templates:
  `STAR_NAME_1_OF_1`, `PLANET_NAME_FORMAT` with a roman numeral,
  `SUBPLANET_NAME_FORMAT` with the parent's whole name and a letter.
- A system with belts writes `asteroid_belts={ { type="icy_asteroid_belt"
  inner_radius=120 } }` after `hyperlane` (after `star_class` when it has
  no lanes), one block per initializer `asteroid_belt` in script order,
  laid out like the `hyperlane` entries. `inner_radius` is the script's
  `radius` as written. A belt does not move the system's `inner_radius`:
  only the bodies do. An asteroid (`asteroid = yes` class) is a body
  entry like a planet at the belt's `orbit`, `planet_size=5`,
  `entity=0`, with no moons. It is named `ASTEROID_NAME_FORMAT` with
  plain variables `prefix` (`"TR44-"`) and `suffix` (`"009"`), and takes
  no numeral: the planets are numbered I, II, … in list order, skipping
  the asteroids. The names come from `random_name_database`: the
  `asteroid_prefix` list, then one `asteroid_postfix` block per prefix in
  the same order, and the game takes the suffix it used out of that
  prefix's block. The install's lists repeat names: the suffix list holds
  "863" twice, and the prefixes BT- and M4- each appear twice, each copy
  with its own block. So the game itself repeats asteroid names, and
  taking the second "863" can give a name the save already uses.
  Checked on the 4.5.0 and 4.4.6 samples.
- Loading a save builds whatever a new system is missing: a construction
  queue per body (and the planet's `build_queue`), an entry in every
  country's `intel_level` and `highest_intel_level`, the
  `terra_incognita` and `visited_objects` entries of countries that know
  every system, and `randomized=yes` on the coordinate. Checked on 4.5.0
  and 4.4.6, so the editor writes none of them.
- A nebula is a top-level `nebula={ coordinate name radius
  galactic_object=... }`, written as `coordinate={ x y origin=4294967295
  randomized=yes visual_height=3.65056 }`, `name={ key="…" }`,
  `radius=N`, then one `galactic_object=<id>` per member, ascending.
  Those lines are the membership and there is no system-side reference,
  so moving a cloud moves no system: it rewrites the lines to the systems
  the new centre and radius cover, and deleting a cloud erases the block
  and nothing else. A nebula has no id, it is identified by file-order
  index, so removing one renumbers those after it. A new one goes at the
  end of the last `nebula=` section, or, in a save with none, at the line
  start of the first top-level section after `galactic_object`.
- `natural_wormholes` and `bypasses` are keyed tables; a bypass row has
  `type` (gateway, lgate, shroud_tunnel, ...), `active`,
  `owner={ type=N id=M }`, `linked_to`/`connections`. A bypass's system
  comes from the system's own `bypasses` list, a wormhole's from
  `natural_wormholes.<id>.coordinate.origin`, and a wormhole's
  `linked_to` names its partner bypass id.
- System `flags` mark the special kinds: `guardian`, `enclave`,
  `marauder_system`, `lgate`, `empire_home_system`,
  `galactic_landmark_system`, `hostile_system`. Every system names an
  `initializer`. `clusters` list their systems with an absolute
  `position`, and `sectors` cover only part of the galaxy.
- Waystations (4.4) are starbases: a `starbase_mgr` entry with
  `type="swaystation_<kind>"` and
  `level="starbase_level_waystation_<1-3>"`, listed in the system's
  `starbases`. A system with a waystation and no regular starbase writes
  `starbases={ 4294967295 <id> }`, the null in the first slot. The
  top-level `waystation_networks` table maps a network id to
  `waystations={ <starbase ids> }`. A wayline is never stored: the game
  derives one between two stations of a network whose systems a hyperlane
  or a bypass joins, so cutting a lane ends it with no other edit.

## Global flags

- The top-level `flags={ ... }` block holds the galaxy's global flags,
  one per line. Most are a plain date int (`game_started=62808000`,
  always present); a timed flag is a block
  `{ flag_date=62808000 flag_days=3156 }`.
- `distar.8000` (`events/distant_stars_events_3.txt`), fired only from
  `on_game_start`, rolls the L-Cluster outcome and sets at most one of
  `gray_goo_crisis_set` with `active_gray_goo` (Gray Tempest),
  `dragon_season` (L-Drakes) or `gray_goo_empire_set` (Dessanu
  Consonance). None of them means an empty cluster. `active_gray_goo`
  only drives the Tempest's scripted text. The outcome flags carry the
  same date as `game_started`.
- `distar.10950` reads those flags when a gate first opens and sets
  `l_cluster_opened`, after which the outcome has spawned. The game's own
  test events `graygoo.25`, `graygoo.29` and `graygoo.30`
  (`events/gray_goo_events.txt`) switch outcomes only by removing and
  setting these flags.
- The 4.5 sample rolled the Gray Tempest, and its two flags close the
  block. The 4.4 sample has L-Gates and none of the outcome flags.

## Static galaxy scenarios

- `map/setup_scenarios/*.txt` is the only folder the game reads for
  scenarios, and there is no `static = yes` flag. The top-level keyword
  decides the kind: `setup_scenario = { … }` is a dynamic galaxy shape
  (`tiny` to `huge`, `num_stars`, `radius` 200 to 450),
  `static_galaxy_scenario = { … }` a fixed layout, the kind this editor
  writes. A mod shipping a static scenario empties the vanilla dynamic
  ones with 0-byte files of the same name.
- Header scalars: `name` (the string the game lists the scenario under;
  Galaxy Shape shows "-"), `priority`, `default`,
  `num_empires = { min max }`, `num_empire_default`, `fallen_empire_*`,
  `marauder_empire_*`, `advanced_empire_default`,
  `colonizable_planet_odds`, `primitive_odds`,
  `num_wormhole_pairs(_default)`, `num_gateways(_default)`,
  `num_hyperlanes_default`, `random_hyperlanes = no`, `core_radius`,
  `crisis_strength`, `extra_crisis_strength = { 10 25 }`, optional
  `supports_shape`. Optional `coordinate_transform = { x = { add sub mul
  div } y = { … } z = { … } }` is applied by the game before placing
  systems; the editor shows positions untransformed and warns. The
  vanilla shapes (`map/galaxy/galaxy_shapes.txt`) are `elliptical`,
  `ring`, `spiral_2`, `spiral_3`, `spiral_4`, `spiral_6`, `bar`,
  `starburst`, `cartwheel`, `spoked`; a scenario is listed only while a
  shape it names is selected, so Forge's export names all ten.
- `#` comments are legal anywhere, including before the block; Forge's
  export opens with a few that say where the file came from, its counts,
  which DLC or mods its initializers need, and what the save had that the
  file does not (wormhole pairs). The scenario index ignores them.
- `system = { id = "2" name = "Coruscant" position = { x = 0 y = -56 }
  initializer = canon_coruscant_system_initializer spawn_weight = { base
  = 0 modifier = { add = 10000 has_country_flag = galactic_empire } } }`.
  Also valid: `spawn_design`, `effect = { … }`, `z`, range positions
  `x = { min max }`. Ids are quoted decimal strings, arbitrary and
  non-contiguous, unlike the save's contiguous `galactic_object` ids.
  Positions are absolute, integers in practice and decimals legal, there
  is no per-system `radius`, and orientation matches the save's
  `coordinate`.
- `add_hyperlane = { from = "0" to = "9" }` is undirected, and files list
  both directions and exact duplicates as the save does.
  `prevent_hyperlane` blocks a lane the generator would otherwise add.
- `nebula = { name = "NAME_N_Heart_Galaxy" position = { … } radius = 60 }`
  has no member list: membership is by radius, nearest centre winning
  where radii overlap. A new nebula statement goes on the line before the
  closing brace.
- System `name` is a literal display string or a loc key, nebula `name`
  is always a `NAME_N_*` loc key. `initializer` names a block under
  `common/solar_system_initializers/**` of the install or an enabled mod
  ([game-data-notes.md](game-data-notes.md)).
- `#` comments appear anywhere, including comment lines containing tabs,
  braces and quotes. LF, tabs, ASCII, no BOM, trailing spaces occur.

## Relations

Id-keyed tables cross-reference each other, often in both directions.

- `planet.deposits={ ids }` ↔ `deposit.<id>.deposit_holder={ type=0 id=<planet> }`.
- `planet.colony=<id>` ↔ `colony.<id>` (4.x moved pops, districts,
  buildings and jobs from planets into `colony`); `colony.pop_groups` ↔
  `pop_groups.<id>.planet`; `colony.districts` into `districts`;
  `colony.buildings_cache` into `buildings`. A planet's pop count is
  `colony.<id>.num_sapient_pops`, the sum of its `pop_groups` sizes, and
  `pop_groups.<id>.planet` holds the colony id, not the planet's.
- `galactic_object.planet=<id>` ↔ `planets.planet.<id>.coordinate.origin`.
- Star type is `galactic_object.star_class="sc_g"` **and** the star's
  planet row `planet_class="pc_g_star"`; binary and trinary classes own
  several star planets.
  The install's star class lists its star bodies in order, one
  `planet = { key = pc_… }` each. Nothing else in the save caches the
  class. A save with every single-star system rewritten to
  `sc_black_hole` and `pc_black_hole` loads in 4.5.0. So do a pulsar or
  neutron star in place of a G star, a pulsar at the player's capital, a
  black hole under a ruined Dyson sphere or ring world, and one binary
  class swapped for another. A single-star class left with two star
  bodies also loads, and the system shows both stars as their bodies
  say. Working megastructures and starbase modules that need a certain
  star have not been tried.
- `planets.planet.<id>.planet_size=25` is a bare integer on every planet
  row, star bodies included. In the 4.4 sample, system 1's G star is 25
  and two of its barren worlds are 28 and 19. A size outside the range the
  planet class generates with has not been tried.
- `country.<id>.flag={ icon={ category file } background={ category file }
  colors={ ... } }`. `colors` lists bare entries: the four flag colours,
  and in 4.5 two more, the map border colour then the map fill colour.
  4.4 writes four. `flag.use_map_color=yes` sits beside the list only
  when the empire was created with Independent Map Color on, and only
  then does the game paint its territory in the fifth and sixth entries.
  Otherwise the border and fill are the first two flag colours, and 4.5
  mirrors them into the fifth and sixth anyway. Primitives and fallen
  empires write `"null"` for every entry past the ones they use, e.g.
  `{ "red_orange" "black" "null" "null" "null" "null" }`.
- Fleets carry **no owner field**: ownership is
  `country.<id>.fleets_manager.owned_fleets={ { fleet=N } ... }`.
  Leviathans are countries of `type` `guardian_dragon`,
  `guardian_fortress`, `tiyanki`, `voidworms`, `crystal`, `amoeba`,
  `cloud` and the like, located via `galactic_object.fleet_presence`.
- System ownership runs `galactic_object.starbases` to
  `starbase_mgr.starbases.<id>.station` to `ships.<id>.fleet` to the
  owning country. Sectors are not territory.
- Polymorphic references `{ type=N id=M }`: 0 = planet, 2 = galactic
  object, 10 = ambient object.
- Many fields are caches the game recomputes: `produces`, `profits`,
  `stability`, `buildings_cache`, `military_power`, `economy_power`.

## 4.5 (Cygnus)

Shape changes seen in the 4.5 sample save (`testdata/2201.03.25.sav`)
beside the flag colours above. None of them is read by the core, and the
save loads, validates and round-trips byte-identically with no change to
the reader.

- `galactic_object.<id>.arm=<0..2>` names the system's spiral arm, on
  590 of the sample's 601 systems.
- The `galaxy.design` block is gone.
- `fleet.<id>.settings` is renamed `properties`.
- `pop_groups` is restructured.

## Save locations

- Windows: `%USERPROFILE%\Documents\Paradox Interactive\Stellaris\save games\<empire>_<id>\`
- macOS: `~/Documents/Paradox Interactive/Stellaris/save games`
- Linux: `~/.local/share/Paradox Interactive/Stellaris/save games`
- Steam Cloud mirrors saves and can overwrite a newer local file: edit
  with Steam closed or cloud sync off for Stellaris. Cloud copies live
  under `<Steam>/userdata/<account>/281990/remote/save games/<campaign>/`,
  one tree per Steam account (281990 is the game's app id), and a file
  counts as a cloud save by path prefix, before it is written.
- Install, definition files, localisation and mod registration:
  [game-data-notes.md](game-data-notes.md).
