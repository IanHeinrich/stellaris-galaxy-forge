# Stellaris save format notes

Notes on the `.sav` format as Stellaris 4.4 and 4.5 write it, with
examples from the sample saves in `testdata/`. The install is covered in
[game-data-notes.md](game-data-notes.md).

## Container

- A save is a zip (deflate) with exactly two root members, `gamestate`
  then `meta`, and DOS-epoch timestamps. Zipping a folder instead breaks
  the save.
- The members are always plain text, Ironman saves included. There is
  no signature or checksum, and the game loads edited saves.
- `cheated_on_save=yes` marks console use. Achievements depend on the
  game and mod checksum and on console use. Editing the save does not
  affect them.
- `meta` repeats the `gamestate` header: `version`, `name`, `date`,
  `required_dlcs`, the player flag, `meta_fleets` and `meta_planets`.

## Text

- Lines end in LF and are indented with tabs. The text is ASCII, with
  no BOM, no CR, no `#` comments and no backslash escapes.
- The grammar is Clausewitz: `key=value`, `key={ ... }` and nesting.
  Statements are separated by any whitespace, not by lines. All of
  these occur:
  - several pairs on one line, as in
    `0=shipyard\t\t\t\t1=solar_panel_network\t\t\t}`
  - tabs after `=`, as in `last_bombardment=\t\t\t"0.01.01"`
  - a block on the next line, as in `hyperlane=\n\t\t{`
  - inline blocks, as in `random={ 0 3366986288 }`
  - quoted keys, as in `"tech_lasers_1"="1"`
  - lists mixing bare scalars and blocks, as in
    `intel={ { 24 { intel=0 ... } } }`
  - scalar lists with a trailing space, as in `{ 54 55 56 }`
- **Indentation is unreliable.** Inside `colony` the game writes `22=`
  at column 0 at depth 3. Depth comes from counting braces and nothing
  else.
- Duplicate keys are normal at every level, and their order matters.
  `nebula=` and `saved_event_target=` repeat at top level, and a system
  repeats `planet=748 planet=749 ...`.
- Lists of anonymous objects are all laid out the same way. The `{` is
  followed by a newline and a line holding only indentation. After that,
  each entry is followed by a line holding a single space.

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
  line, and they have no indentation-only line. Each entry after the
  first starts with a single space. 3.10 onwards writes the shape above.

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

- Scalars are integers, decimals, quoted strings, `yes`/`no`, bare
  identifiers such as `none`, `planet` and `not_set`, and dates written
  as `"2206.11.16"`. Decimals are written to 5 places with trailing
  zeros stripped, and never with an exponent: `-333`, `-144.22`,
  `-339.74518`.
- The null reference id is `4294967295`, which is u32::MAX, as in
  `origin=4294967295`.
- Some ids in species, ship designs and orbitals carry high bits, such
  as `16777219` (2^24 + 3) and `2868903937`. Treat ids as `u64`.
- The engine resolves these name format keys in code, not through
  localisation: `%ADJECTIVE%`, `%ADJ%`, `%SEQ%` and `%ACRONYM%`. The
  `base` variable of `%ACRONYM%` renders as the initials of the
  capitalised words, so "United Nations of Earth" becomes "UNE".

## Top-level sections (by bytes)

A brace scan that ignores braces inside quotes splits the file into
top-level statements and leaves nothing over. In a typical save,
planets take 22.0% of the bytes, ships 18.6%, ship_design 17.5%,
country 17.3%, fleet 8.3%, construction 4.4%, galactic_object 2.5%,
ambient_object 1.6%, deposit 1.5%, leaders 1.4%, pop_jobs 1.0% and
army 0.7%.

The top level holds these counters: `last_created_species_ref`,
`last_created_country`, `last_created_system`, `last_created_fleet`,
`last_created_ship`, `last_created_leader`, `last_created_army`,
`last_created_design` and `last_created_ambient_object`. There is none
for planets or deposits.

## Galaxy

- Systems live in `galactic_object={ <id>={ ... } }`, with ids
  contiguous from 0. Every system has `coordinate`, `planet`,
  `star_class`, `storm`, `inner_radius`, `outer_radius`, `sector`,
  `initializer`, `starbases`, `index` and `name`. These keys are
  optional: `hyperlane`, `flags`, `asteroid_belts`, `fleet_presence`,
  `discovery`, `ambient_object`, `init_parent`, `colonies`,
  `timed_modifier`, `bypasses`, `megastructures`,
  `has_access_to_relay_network`, `natural_wormholes`, `aura_presence`,
  `inhibitor_owners` and `ftl_inhibitor_presence`.
- `hyperlane=` always comes straight after `star_class=`. A system with
  no lanes has no `hyperlane=` at all.
- Lanes are symmetric. Each lane is stored on both endpoints as
  `{ to=N length=L [bridge=yes] }`. Lanes from the generator have
  `length = floor(euclidean distance)` as an integer. Lanes made by
  scripts and events carry the exact distance as a decimal, as in
  `length=14.03876`. An edit keeps the form of the entry it rewrites,
  and a new lane uses the integer form.
- The game takes `length` as the lane's travel cost and trusts it. A
  lane set to 200 across a 33-unit gap makes the pathfinder detour. So
  lengths are recomputed when a system moves, and an override on a
  single lane has a real effect.
- The game writes duplicate lane entries. 708 lists `to=154` twice, and
  154 lists `to=708` twice. The validator raises one note per duplicated
  pair, and removing a lane removes every matching entry. The untouched
  sample gives two `lane_duplicate` notes, one `system_isolated` warning
  and no errors.
- A system with no lanes is legal. It loads, it draws without lanes,
  and time passes without error. Cutting a lane under a fleet in
  transit is safe. The fleet finishes its jump, and later routes avoid
  the lane.
- A lane-less system at one end of a wormhole pair counts as connected.
  The wormhole names both ends and works from the start, so the system
  raises no `system_isolated` warning and sits in the same component as
  its partner. In the sample, 789 reaches 788 through the wormhole,
  which leaves 790 as the only system nothing reaches.
- A gateway reaches the other open gateways. It connects a lane-less
  system only when another gateway is open somewhere else. An L-Gate
  reaches the L-Cluster once the L-Gates are open, and a save may never
  have got that far. So a lane-less L-Gate system stays a note.
- `bridge=yes` is set on both ends of the connector lanes the generator
  adds to join pockets it generated locally. The sample has 125 of
  these undirected lanes, and 3 of them are cut edges.
- The game draws `x` increasing to the left and `y` increasing
  downwards, so Sol at `(397, -180)` sits top-left. The camera applies
  those signs.
- `galaxy_radius=499.9288` sits at top level.
  `galaxy={ core_radius=112.5 ... }` holds the generation settings.
- Everything inside a system has `coordinate={ x y origin=<system id> }`,
  relative to the star at (0,0). That covers planets, fleets, ambient
  objects, wormhole endpoints and megastructures. Only
  `galactic_object`, `nebula` and `clusters` are absolute, with
  `origin=4294967295`.
- Moving a system changes its own `x`/`y` and the `length` of each of
  its lanes, on both ends. Nothing inside the system moves. The game
  keeps the moved system's lanes and draws them to the old neighbours.
- A planet's `orbit` is its orbital radius, and its `x`/`y` are the
  current point on that orbit. A moon has `moon_of=<planet>` and an
  `orbit` around its parent, and its coordinates are relative to the
  system. The reliable radius is the distance from the body's point to
  its parent's, or to the centre without one: `orbit` is usually within
  0.01 of it, but some bodies sit up to 0.8 off, an astral scar stores
  `orbit=0` while sitting far out, and one planet in the 4.4 sample
  stores a negative `orbit`. No angle is stored. A moon keeps its
  `moon_of` after the game deletes the planet, so the key can name a
  `none` slot (4.5 sample, system 40).
- Planets, deposits and construction queues are slot tables. An id is
  `slot | generation<<24`, and the table is sorted by slot. A dead slot
  keeps its old id as `<id>=none`. When the game reuses a dead slot, it
  raises the generation by one.
- System ids have no generation and no gaps. A gap crashes the game on
  load, so a new system takes `last_created_system`+1.
- When the game removes a deposit, its entry becomes `<id>=none` in
  place, even when it is the table's last entry. The id also leaves the
  planet's `deposits={ }`, and the key goes when its last id does. No
  save holds an empty `deposits`. In 4.x, `deposits` is the last key of
  a planet entry. A station over a removed deposit stays and produces
  nothing.
- A system the game spawns by script is a `galactic_object` entry with
  its keys in this order, and the editor writes an added system the same
  way: `coordinate={ x y origin=4294967295 visual_height }`, `name`,
  `planet=` per body (star first), `star_class`, `hyperlane`,
  `initializer`, `inner_radius`, `outer_radius`,
  `starbases={ 4294967295 }`, `sector=4294967295`, `index=0` and
  `storm=4294967295`. It has no `arm`.
- `inner_radius` is max(150, outermost reach + 30), where a moon
  reaches its own orbit plus its planet's. `outer_radius` is
  `inner_radius` + 100.
- Each body is a `planets.planet` entry. Its deposits are `deposit`
  entries holding `deposit_holder={ type=0 id=<planet> }`. Every body
  the editor adds gets an empty `planet_orbitals={ }` after its orbit and moon keys,
  as the game writes one on every body.
- A blocker deposit may carry `swap_type`, the deposit that clearing it
  reveals. The planet page shows it beside the blocker.
- The system's name is taken out of `random_name_database.star_names`,
  or out of `black_hole_names` when that pool holds it instead. Body
  names are templates. The star is `STAR_NAME_1_OF_1`, a planet is
  `PLANET_NAME_FORMAT` with a roman numeral, and a moon is
  `SUBPLANET_NAME_FORMAT` with the parent's whole name and a letter.
- A system with belts writes
  `asteroid_belts={ { type="icy_asteroid_belt" inner_radius=120 } }`
  after `hyperlane`, or after `star_class` when it has no lanes. It
  holds one block per initializer `asteroid_belt`, in script order,
  laid out like the `hyperlane` entries. `inner_radius` is the script's
  `radius` as written. A belt does not move the system's
  `inner_radius`, only the bodies do.

  An asteroid is a body whose class has `asteroid = yes`. Its entry
  looks like a planet's, at the belt's `orbit`, with `planet_size=5`,
  `entity=0` and no moons. It is named `ASTEROID_NAME_FORMAT` with the
  plain variables `prefix` (`"TR44-"`) and `suffix` (`"009"`), and it
  takes no numeral. The planets are numbered I, II, … in list order,
  skipping the asteroids.

  The names come from `random_name_database`. It holds the
  `asteroid_prefix` list, then one `asteroid_postfix` block per prefix
  in the same order. The game takes the suffix it used out of that
  prefix's block. The install's lists repeat names. The suffix list
  holds "863" twice, and the prefixes BT- and M4- each appear twice,
  each copy with its own block. So the game itself repeats asteroid
  names, and taking the second "863" can give a name the save already
  uses.

  All of this was checked on the 4.5.0 and 4.4.6 samples.
- A fixed system name from a layout, such as `NAME_Trappist`, is
  written like a pool name: `name={ key="NAME_Trappist" }`. A body's
  fixed name is a plain `name={ key="NAME_Vermilion" }`. It takes no
  numeral and uses none up. Its moons are `SUBPLANET_NAME_FORMAT` with
  the plain key as `PARENT`.
- When a layout gives the star as a class (`class = pc_m_star`, not
  `class = star`), the star is named with the system's name key itself
  instead of `STAR_NAME_1_OF_1`.
- A layout's `flags = { unique_system }` becomes
  `flags={ unique_system=62808000 }` on the system, just before
  `initializer=`, with one `name=value` per line. The value is the date
  the flag was set, in hours. Every flag set at generation carries the
  save's `game_started`, so the editor dates an added system's flags
  with it too. The game reads `unique_system` for its "Unique System"
  timeline entry when an empire takes the system.
- A body's `binary_flags` comes after `name`. Its bits are 1 for a name
  the layout fixed, 2 for an `entity_name`, 4 for surveyed, 8 for
  `prevent_anomaly`, 256 for a ring and 512 for a moon. 64 is set
  alongside any of them. A body with none of them writes no
  `binary_flags`. A plain moon is therefore 576, a fixed-name planet 65
  and a ringed planet 320.
- A layout's `entity = "…"` is written as `entity_name="…"` after
  `entity=`, and `entity=` is still written.
- A layout's `add_modifier = { modifier = X days = -1 }` becomes an
  item of the planet's
  `timed_modifier={ items={ { modifier="X" days=-1 } } }`, after
  `bombardment_damage`, laid out like the `hyperlane` entries. It
  writes no `planet_modifier`. That key belongs to the game's random
  modifier roll.
- The console's `add_modifier` writes a terraforming candidate
  (`terraforming_candidate`, `frozen_…` or `toxic_…`) the same way, as
  the last item of `items`. A planet without a `timed_modifier` gets
  one after `bombardment_damage`. Removing the last item removes the
  block.
- A star-class body other than the star, such as the Great Wound's
  black holes, has `carrier_binary_flags=3`, as the star does. A star
  off centre writes its `orbit` and position like a planet, and the
  planets still orbit the centre. The previously terraformed layout has
  one, at 40.
- The top-level `system_initializer_counter={ count={ 1 2 … }
  initializer={ "ai_system_01" … } }` holds two lists side by side. One
  is the layouts with `max_instances`, and the other is how often
  generation drew each. A layout that was drawn is still counted when
  its system did not survive. When the editor adds a system with a
  capped layout, it adds one to that layout's count, appending the
  entry if it is missing. It takes the one off again when the system is
  removed.
- Loading a save builds whatever a new system is missing. This was
  checked on 4.5.0 and 4.4.6, so the editor writes none of these:
  - a construction queue per body, and the planet's `build_queue`
  - an entry in every country's `intel_level` and
    `highest_intel_level`
  - the `terra_incognita` and `visited_objects` entries of countries
    that know every system
  - `randomized=yes` on the coordinate
- A nebula is a top-level `nebula={ coordinate name radius
  galactic_object=... }`. It is written as `coordinate={ x y
  origin=4294967295 randomized=yes visual_height=3.65056 }`,
  `name={ key="…" }` and `radius=N`, then one `galactic_object=<id>`
  per member in ascending order. Those lines are the membership. The
  game reads "inside a nebula" (the sensor text, the Nebula Refinery)
  from them alone. A name the user typed rather than a key has
  `literal=yes` inside its braces.
- Moving a cloud moves no system. It rewrites the lines to the systems
  the new centre and radius cover.
- A nebula has no id. It is identified by its index in file order, so
  removing one renumbers those after it. A new one goes at the end of
  the last `nebula=` section. In a save with none, it goes at the line
  start of the first top-level section after `galactic_object`.
- Event `game_start.50` dresses each member once, at game start, and
  nothing runs it again. The member's `timed_modifier` holds
  `{ modifier="nebula_cloaking" days=-1 }` (First Contact only),
  written after `index=` in the planet's `timed_modifier` shape. A
  turbulent member also gets `turbulent_nebula`. These modifiers give
  the numbers only.
- The cloud in the system view is one entry of the top-level
  `ambient_object` table. The system lists it by id in
  `ambient_object={ 318 }`, after its last `planet=`. The entry looks
  like this, wrapped here for reading:

  ```
  318={ coordinate={ x y origin=<system> } data="nebula_1" properties={
  coordinate={ x y origin } attach={ type=10 id=4294967295 }
  offset={ 0 0 0 } scale=1 entity_face_object={ type=10 id=4294967295 }
  appear_state="" } }
  ```

  `coordinate` is the star body's position in the system.
  `properties.coordinate` adds `0.33 * star size + 4.7` to x and
  `0.33 * star size + 8.7` to y. The type follows the star class
  (`nebula_1..4`, `rare_nebula_1..2`, `turbulent_nebula_1..2`). A
  system whose star class the event does not dress gets the modifier
  only.
- A member may list other nebula objects an initializer placed, such as
  Tiyun Ort's `nebula_L3_entity` or a home system's `rare_nebula_1`.
  The member's own cloud is the last one of those types without
  `flags`.
- Ids in the `ambient_object` table use the planets' slot scheme, and a
  dead one is `<id>=none`. `last_created_ambient_object`, after
  `planets`, names the last one created. On 4.5 the game keeps a
  hand-written entry, an unraised counter and a `none` slot through a
  load and save.
- When the editor takes a system into its first nebula, the system gets
  the modifier. Unless it already lists a cloud of its own, it also gets
  one of its star class's first calm type, placed past the table's
  highest slot, and the counter is raised to it if that is higher. A
  system leaving its last nebula loses both, and
  its cloud becomes `<id>=none`. A system that two sections list stays a
  member until neither does.
- `random_name_database.nebula_names` is the pool of unused nebula
  names, laid out like `star_names`. It holds the install's
  `nebula_names` less the names the galaxy's nebulae took. The 4.5.0
  sample holds 46 of the install's 55, and its 9 nebulae hold the rest.
  When the editor adds a nebula with a pooled name, it takes the name
  out of the pool. Removing that nebula, or renaming it to another
  name, puts the entry back where it was.
- `random_name_database.black_hole_names` is the pool of unused black
  hole names, laid out the same way. The 4.5.0 sample holds 55 and the
  4.4.6 sample 44. Neither shares a name with `star_names`. A system the
  editor adds takes its name from `star_names` first, then from
  `black_hole_names`, whatever its star class. Removing or renaming the
  system puts the entry back in the pool it came from. A rename also
  takes the new name out of whichever pool holds it.
- `natural_wormholes` and `bypasses` are keyed tables. A bypass row has
  `type`, `active`, `owner={ type=N id=M }` and
  `linked_to`/`connections`. Its `type` is gateway, lgate,
  shroud_tunnel and so on.
- A bypass's system comes from the system's own `bypasses` list. A
  wormhole's system comes from
  `natural_wormholes.<id>.coordinate.origin`, and the wormhole's
  `linked_to` names its partner bypass id.
- System `flags` mark the special kinds of system: `guardian`,
  `enclave`, `marauder_system`, `lgate`, `empire_home_system`,
  `galactic_landmark_system` and `hostile_system`. Every system names
  an `initializer`.
- `clusters` list their systems with an absolute `position`. `sectors`
  cover only part of the galaxy.
- Waystations (4.4) are starbases. Each is a `starbase_mgr` entry with
  `type="swaystation_<kind>"` and
  `level="starbase_level_waystation_<1-3>"`, listed in the system's
  `starbases`. A system with a waystation and no regular starbase
  writes `starbases={ 4294967295 <id> }`, with the null in the first
  slot.
- The top-level `waystation_networks` table maps a network id to
  `waystations={ <starbase ids> }`. Waylines are never stored. The game
  derives one between two stations of a network when a hyperlane or a
  bypass joins their systems. So cutting the lane ends the wayline, and
  nothing else needs editing.

## Global flags

- The top-level `flags={ ... }` block holds the galaxy's global flags,
  one per line. Most are a plain date int, such as
  `game_started=62808000`, which is always present. A timed flag is a
  block, `{ flag_date=62808000 flag_days=3156 }`.
- Event `distar.8000` in `events/distant_stars_events_3.txt` fires only
  from `on_game_start`. It rolls the L-Cluster outcome and sets at most
  one of these:
  - `gray_goo_crisis_set` with `active_gray_goo`, for the Gray Tempest
  - `dragon_season`, for the L-Drakes
  - `gray_goo_empire_set`, for the Dessanu Consonance

  When none of them is set, the cluster is empty. `active_gray_goo`
  only drives the Tempest's scripted text. The outcome flags carry the
  same date as `game_started`.
- `distar.10950` reads those flags when a gate first opens and sets
  `l_cluster_opened`. Once that flag is set, the outcome has spawned.
  The game's own test events `graygoo.25`, `graygoo.29` and
  `graygoo.30` (`events/gray_goo_events.txt`) switch outcomes only by
  removing and setting these flags.
- The 4.5 sample rolled the Gray Tempest, and its two flags close the
  block. The 4.4 sample has L-Gates and none of the outcome flags.

## Static galaxy scenarios

- The game reads scenarios only from `map/setup_scenarios/*.txt`, and
  there is no `static = yes` flag. The top-level keyword decides the
  kind. `setup_scenario = { … }` is a dynamic galaxy shape (`tiny` to
  `huge`, `num_stars`, `radius` 200 to 450).
  `static_galaxy_scenario = { … }` is a fixed layout, and that is the
  kind this editor writes.
- A mod that ships a static scenario empties the vanilla dynamic ones
  with 0-byte files of the same name.
- The header holds these scalars: `name`, `priority`, `default`,
  `num_empires = { min max }`, `num_empire_default`, `fallen_empire_*`,
  `marauder_empire_*`, `nomad_empire_*`, `advanced_empire_default`,
  `num_nebulas`,
  `colonizable_planet_odds`, `primitive_odds`,
  `num_wormhole_pairs(_default)`, `num_gateways(_default)`,
  `num_hyperlanes_default`, `random_hyperlanes = no`, `core_radius`,
  `crisis_strength`, `extra_crisis_strength = { 10 25 }` and an
  optional `supports_shape`. `name` is the string the game lists the
  scenario under, while Galaxy Shape shows "-" for it.
- The game applies an optional `coordinate_transform = { x = { add sub
  mul div } y = { … } z = { … } }` before placing systems. The editor
  shows positions untransformed and warns.
- The vanilla shapes in `map/galaxy/galaxy_shapes.txt` are
  `elliptical`, `ring`, `spiral_2`, `spiral_3`, `spiral_4`, `spiral_6`,
  `bar`, `starburst`, `cartwheel` and `spoked`. A scenario is listed
  only while a shape it names is selected, so Forge's export names all
  ten.
- `#` comments are legal anywhere, including before the block. Forge's
  export opens with a few. They say where the file came from, its
  counts, which DLC or mods its initializers need, and what the save had
  that the file does not (wormhole pairs). The scenario index ignores
  them.
- A system statement looks like this:

  ```
  system = { id = "2" name = "Coruscant" position = { x = 0 y = -56 }
  initializer = canon_coruscant_system_initializer spawn_weight = {
  base = 0 modifier = { add = 10000 has_country_flag = galactic_empire }
  } }
  ```

  A `spawn_weight` modifier takes `add` or `factor`, beside the
  triggers that gate it. The statement can also have `spawn_design`,
  `effect = { … }`, `z`, and range positions such as
  `x = { min max }`. Ids are quoted decimal strings.
  They are arbitrary and non-contiguous, unlike the save's contiguous
  `galactic_object` ids.
- Positions are absolute. They are integers in practice, and decimals
  are legal. There is no per-system `radius`, and the orientation
  matches the save's `coordinate`.
- `add_hyperlane = { from = "0" to = "9" }` is undirected. Files list
  both directions, and exact duplicates, as the save does.
  `prevent_hyperlane` blocks a lane the generator would otherwise add.
- `nebula = { name = "NAME_N_Heart_Galaxy" position = { … } radius = 60 }`
  has no member list. Membership goes by radius, and where radii overlap
  the nearest centre wins. A new nebula statement goes on the line
  before the closing brace.
- A system's `name` is a literal display string or a loc key. A
  nebula's `name` is always a `NAME_N_*` loc key. `initializer` names a
  block under `common/solar_system_initializers/**` in the install or
  an enabled mod ([game-data-notes.md](game-data-notes.md)).
- `#` comments appear anywhere, and a comment line can contain tabs,
  braces and quotes. The files use LF and tabs and are ASCII with no
  BOM. Trailing spaces occur.

## Relations

Id-keyed tables cross-reference each other, often in both directions.

- `planet.deposits={ ids }` ↔ `deposit.<id>.deposit_holder={ type=0 id=<planet> }`.
- `planet.colony=<id>` ↔ `colony.<id>`. 4.x moved pops, districts,
  buildings and jobs from planets into `colony`.
- `colony.pop_groups` ↔ `pop_groups.<id>.planet`, and
  `pop_groups.<id>.planet` holds the colony id, not the planet's.
- `colony.districts` points into `districts`, and
  `colony.buildings_cache` into `buildings`.
- A planet's pop count is `colony.<id>.num_sapient_pops`, the sum of
  its `pop_groups` sizes. `colony.<id>.species_information` has an
  entry per species with its `num_pops`, and the species' name is
  `species_db.<id>.name`.
- `colony.<id>.final_designation` is the designation the colony has.
  `designation` is written too only when the player chose one by hand.
- `galactic_object.planet=<id>` ↔ `planets.planet.<id>.coordinate.origin`.
- The star type is in two places, `galactic_object.star_class="sc_g"`
  and the star's planet row `planet_class="pc_g_star"`. Binary and
  trinary classes have several star planets. The install's star class
  lists its star bodies in order, one `planet = { key = pc_… }` each.
  Nothing else in the save caches the class.

  A save loads in 4.5.0 with every single-star system rewritten to
  `sc_black_hole` and `pc_black_hole`. These load too:
  - a pulsar or neutron star in place of a G star
  - a pulsar at the player's capital
  - a black hole under a ruined Dyson sphere or ring world
  - one binary class swapped for another

  A single-star class left with two star bodies also loads, and the
  system shows both stars as their bodies say. I haven't tried working
  megastructures or starbase modules that need a certain star.
- `planets.planet.<id>.planet_size=25` is a bare integer on every
  planet row, star bodies included. In the 4.4 sample, system 1's G
  star is 25 and two of its barren worlds are 28 and 19. I haven't
  tried a size outside the range the planet class generates with.
- A country's flag is `country.<id>.flag={ icon={ category file }
  background={ category file } colors={ ... } }`. `colors` lists bare
  entries. 4.4 writes the four flag colours. 4.5 writes two more, the
  map border colour and then the map fill colour.
- `flag.use_map_color=yes` sits beside the list only when the empire
  was created with Independent Map Color on. Only then does the game
  paint its territory in the fifth and sixth entries. Otherwise the
  border and fill are the first two flag colours, and 4.5 copies them
  into the fifth and sixth anyway.
- Primitives and fallen empires write `"null"` for every entry past the
  ones they use, as in
  `{ "red_orange" "black" "null" "null" "null" "null" }`.
- **Fleets have no owner field.** Ownership is in
  `country.<id>.fleets_manager.owned_fleets={ { fleet=N } ... }`.
- Leviathans are countries whose `type` is `guardian_dragon`,
  `guardian_fortress`, `tiyanki`, `voidworms`, `crystal`, `amoeba`,
  `cloud` or the like. They are located through
  `galactic_object.fleet_presence`.
- To find a system's owner, follow `galactic_object.starbases` to
  `starbase_mgr.starbases.<id>.station`, then to `ships.<id>.fleet`,
  then to the owning country. Sectors are not territory.
- A polymorphic reference is `{ type=N id=M }`, and what a code names
  depends on the field. `deposit.<id>.deposit_holder` writes `type=0`
  for a planet. `archaeological_sites.sites.<id>.location` and
  `ambient_object.<id>.properties.attach` write `type=2` for a planet.
  `attach` and `entity_face_object` write `type=10` with the null id on
  an object attached to nothing, which is nearly all of them. 4.5 writes
  `attach={ type=3 id=<n> }` on ten objects. I have not worked out what
  type 3 names.
- Many fields are caches the game recomputes: `produces`, `profits`,
  `stability`, `buildings_cache`, `military_power` and `economy_power`.

## 4.5 (Cygnus)

These are the shape changes seen in the 4.5 sample save
(`testdata/4.5-day-one.sav`), besides the flag colours above. The core
reads none of them. The save loads, validates and round-trips
byte-identically with no change to the reader.

- `galactic_object.<id>.arm=<0..2>` names the system's spiral arm. 590
  of the sample's 601 systems have it.
- The `galaxy.design` block is gone.
- `fleet.<id>.settings` is renamed `properties`.
- `pop_groups` is restructured.

## Save locations

- Windows: `%USERPROFILE%\Documents\Paradox Interactive\Stellaris\save games\<empire>_<id>\`
- macOS: `~/Documents/Paradox Interactive/Stellaris/save games`
- Linux: `~/.local/share/Paradox Interactive/Stellaris/save games`
- Steam Cloud mirrors saves and can overwrite a newer local file. Edit
  with Steam closed, or with cloud sync off for Stellaris.
- Cloud copies live under
  `<Steam>/userdata/<account>/281990/remote/save games/<campaign>/`,
  one tree per Steam account. 281990 is the game's app id. A file
  counts as a cloud save by its path prefix, before it is written.
- The install, definition files, localisation and mod registration are
  covered in [game-data-notes.md](game-data-notes.md).
