# Game data and mod notes

Notes on the Stellaris install, its definition files, its localisation
and how the launcher registers mods. The save itself is covered in
[format-notes.md](format-notes.md).

## What the save references, and where it is defined

Each editable vocabulary is a set of top-level `key = { … }` blocks in
`common/<dir>/*.txt`, written in the same Clausewitz syntax as
`gamestate`.

| Save field | `common/` dir | Vanilla count | Attributes worth reading |
|---|---|---|---|
| `planet.planet_class="pc_…"` | `planet_classes/` (12 files) | 78 | `climate`, `initial`, and the star and gas-giant flags. These group the dropdown. |
| `galactic_object.star_class="sc_…"` | `star_classes/` (2 files) | 36 | `planet = { key = pc_g_star }` maps `sc_` to `pc_`, which a star-class change needs. Binary and trinary classes have several `planet=` blocks. |
| `deposit.type="d_…"` | `deposits/` (26 files) | 587 | `is_for_colonizable`, `station`, and `resources.category`, which points into `deposit_categories/`. Together they tell orbital, planetary and blocker deposits apart. |
| `planet.planet_modifier="pm_…"` | `planet_modifiers/` (1 file) | 71 | Spawn rules only. The display name comes from localisation. |
| `planet.timed_modifier.items[].modifier="…"` | `static_modifiers/` (37 files) | hundreds | Effects. Some `pm_` keys are defined here too. |

Vanilla `common/` is 27 MB, and the English localisation is 16 MB. Mods
extend every one of these vocabularies. A large content mod can add
hundreds of star classes and ship more localisation than vanilla does.

The files don't say which definition dir a save field maps to, so that
mapping is a hand-maintained table of about 30 rows. It only changes
when the save format does.

## Syntax the save never uses

`gamestate` has no comments, variables or operators. Definition files
add these:

- `#` line comments, anywhere. A comment can trail the key line, as in
  `sc_binary_1 = { # X-ray Binary …`.
- `@name = value` variables at the top of a file, and `@name`
  references to them. A reference can point into another file. For
  example, `planet_classes/00_planet_classes.txt` uses
  `@planet_standard_scale`, which is defined in
  `scripted_variables/00_scripted_variables.txt`. Listing the keys
  doesn't need the values.
- Comparison operators `>`, `<`, `>=`, `<=` inside `potential` and
  `modifier` blocks.
- Typed literals `hsv { 0.59 0.45 0.95 }` and `rgb { … }`.
- `inline_script = { … }` template expansion, in a few `deposits/`
  files. In vanilla it only appears inside bodies, not at top level, so
  listing the top-level keys isn't affected. Check this again on each
  version.

The save lexer already handles everything else: duplicate keys,
whitespace-separated statements, quoted and bare values, and nested
blocks.

## Localisation

Localisation lives in `localisation/<lang>/*_l_<lang>.yml`. English has
134 files and 109,625 keys. Despite the extension, the files are **not
YAML**.

- They are UTF-8 with a BOM (`EF BB BF`).
- Each line reads ` key:0 "text"`. The `:0` version number is optional.
- Strings can contain unescaped quotes, for example
  `"… the "§HGhost Signal§!," as it has been dubbed …"`. A YAML library
  fails on these. Parse line by line instead, with a regex anchored on
  the first `"` and the last `"`.
- `$other_key$` is a reference, and it has to be resolved recursively.
  Star-class names use it to point at their star planet:
  `sc_g:1 "$pc_g_star$"`.
- `£energy£` is icon markup, as in `d_energy_1:0 "£energy£ +1"`.
  `§H…§!` is colour markup. Strip both before display.
- Files in `localisation/replace/` win over every other file, whatever
  the load order.
- Mods use the same layout. They have a subfolder per language, and can
  have `random_names/` subfolders too.
- The game picks the files for a language by their first line, the
  `l_<lang>:` header after an optional BOM. It ignores the
  `_l_<lang>.yml` part of the name. A mod can ship
  `localisation/english/l_english_pf_misc.yml` and the game loads it.
  Opening every file to read its header is slow. So when a file's name
  follows the convention, the editor matches it by name, and it opens
  only the other files to check their header.

## Map art

- Star art sits on opaque black. `gfx/map/star_classes/a_star.dds`, for
  example, has an opaque black edge and an opaque white centre. The game
  draws star sprites additively instead of alpha blending them. The
  editor's map uses an additive blend too when game data is loaded.
  Without game data it draws a procedural glow.
- Mods can ship fully transparent overrides. An interface mod may
  replace `gfx/interface/system/map_gui_frame.dds` with a texture whose
  alpha is 0 everywhere. That texture is the `GFX_type_frame` sprite in
  `interface/icons.gfx`, and it draws the map icon frame
  (`quadTextureSprite = "GFX_type_frame"` throughout
  `interface/mapicons.gui`). With a mod like that enabled, the frame has
  to be drawn some other way.
- Resource sprite names don't follow one pattern. These come from
  `interface/resources.gfx` and `interface/texticons.gfx`:
  `GFX_resource_energy`, `GFX_resource_physics` for `physics_research`,
  `GFX_text_trade_value` for the resource id `trade`, `GFX_text_zro`
  and `GFX_resource_sr_dark_matter_large`. Deposits produce `trade`,
  not `trade_value`, so `trade` is the id to look up.
- `nanites` has a texture (`gfx/interface/icons/resources/nanites.dds`)
  but no sprite of its own. So a sprite lookup for a resource tries
  these names in order:
  1. `GFX_resource_<id>`
  2. `GFX_text_<id>`
  3. the same with the `sr_` prefix and the `_research`/`_value` suffix
     stripped
  4. the `_large` variants
- Map icons are defined in `interface/mapicons.gfx` and used from
  `star_mapicon` in `interface/mapicons.gui`. Their sheet frames are
  numbered from 1.
- `GFX_colonizability` and `_shadow` are 14-frame sheets, coloured by
  the player species' habitability. The editor has no species, so it
  uses frame 7, the neutral blue-grey one.
- `GFX_fleet_presence_icons` is a 16-frame sheet. Frames 10, 11 and 12
  are the yellow, blue and red fleet chevrons.
- `GFX_map_icon_bg` and `_bg_capital` are the owner name-plate
  textures. They fade out over 15 px at each end, and those ends are not
  stretched. `GFX_map_icon_flag_capital_decoration` has 2 frames.
- Bypass icons are frames of `GFX_ship_class_small`. Each bypass picks
  its frame with `icon_frame` in `common/bypass/00_bypasses.txt`.

  | Bypass | Frame |
  |---|---|
  | gateway, quantum catapult, shroud tunnel | 25 |
  | wormhole | 12 |
  | starlit wormhole | 59 |
  | L-Gate, relay bypass | 30 |

- The game draws white segments around an owner-built starbase's icon.
  A bypass gets a dashed green frame, and an L-Gate also sits on a dark
  red disc. Anything that merely exists in the system gets a solid blue
  frame: megastructures, archaeology sites, pre-FTL worlds, and enclave
  and marauder stations.
- Gateways and L-Gates appear in the save twice. Each has a `bypasses`
  entry (`type="gateway"` or `type="lgate"`) and a `megastructures`
  entry (`type="gateway_ruined"` or `type="lgate_base"`).
- A planet class's surface map takes three steps to find. The class
  names a model family, `entity = "continental_planet"`, and the models
  are the `entity = { … }` blocks named `continental_planet_01_entity`,
  `_02_entity` and so on in `gfx/models/planets/**/*.asset`. The editor
  draws `_01_` for the whole family, then tries `<entity>_entity` and
  the bare name. Each block has several `meshsettings`, and the surface
  is the one named `planet_geosphereShape`. The others are the poles,
  the clouds and the clouds' shadow. Its `texture_diffuse` is a bare
  file name. The file sits beside the `.asset` file, or in
  `gfx/models/planets/` when it isn't there. Some entities name no
  surface map, and those planets keep a plain tinted disc. The vanilla
  maps are 2048x1024 DXT1 with 12 mip levels, and the disc is baked
  from level 3, 256x128. A class's `atmosphere_color` is written as
  `hsv { h s v }` with each value from 0 to 1.
- A gas giant's ring is `gfx/models/planets/ring_tiling_diffuse.dds`, a
  32x1024 radial strip wrapped round a flat ring mesh. Row 0 (v = 0) is
  the outer edge and the last row the inner one. The ring spans 1.39 to
  2.12 planet radii.
- A star's sphere has no surface map of its own. The lettered stars,
  the neutron star and the pulsar all use `base_star.mesh`,
  `neutron_star.mesh` or `pulsar.mesh`, whose material is the
  `PdxMeshStar` shader with `nospec.dds` in every slot. That shader
  (`PixelPdxMeshStar` in `gfx/FX/pdxmesh.shader`) draws veins of lava
  over stone from three maps and three colours, then turns towards the
  planet class's `atmosphere_color` at the limb and brightens the limb.
- The maps and colours live in `gfx/worldgfx/*.txt`, one `gfx_settings`
  block per lighting class. Its `world` is the star class's `class`
  (`world = k_star` in `star_k_class.txt`). It names
  `tex_lava_noise`, `tex_lava_diffuse` and `tex_stone_diffuse`, and
  gives `lava_bright_color`, `lava_hot_stone_color` and
  `lava_cold_stone_color`, each with an `_intensity` that multiplies
  it. The colours are `hsv { … }`, and the intensities run up to 10.
  The noise map (`gfx/worldgfx/lava_noise.dds`) is a DXT1 cube map,
  six 1024x1024 faces with no mips. The brown dwarf's world uses its
  own maps, and the black hole's and `system_view.txt` give no lava colours.
  `default.txt` is `world = default`, the settings a class without its
  own falls back on.
- A body in a binary or trinary is lit by the `class` inside its own
  `planet = { key = … class = … }` block. `sc_binary_1`, class
  `a_star`, has a pulsar lit as `pulsar`.
- The brown dwarf is drawn as a planet is. Its entity,
  `t_star_class_star_entity`, is in
  `gfx/models/planets/distant_stars_planets/_distant_stars_star_entities.asset`
  beside the M giant's. It uses `planet_clouded_mesh` with a
  `planet_geosphereShape` override of `brown_dwarf_01_diffuse.dds` and
  the `PdxMeshPlanetEmissive` shader. The neutron star's and pulsar's
  entities and their polar outbursts are only in `_star_entities.asset`.
- The rest of a star's look in the system view comes from particles
  (`gfx/particles/stars_and_planets/<class>_class_star.asset`, named
  from the entity's `particle`) and, for the neutron star and pulsar,
  the attached outburst meshes, additive and UV-animated over
  `neutron_core_outburst.dds` and `pulsar_core_outburst.dds`. The editor
  bakes the sphere from the shader and draws the glow, beams, jets and
  wisps itself.

## Where mods are registered

These files all sit in the user data dir. That is
`Documents/Paradox Interactive/Stellaris/` on Windows and macOS, and
`~/.local/share/Paradox Interactive/Stellaris/` on Linux.

| File | Contents | Trust |
|---|---|---|
| `dlc_load.json` | `enabled_mods: ["mod/ugc_….mod", …]` in load order, plus `disabled_dlcs`. It holds what the game last launched with. An empty list means vanilla. | This is what the game will load. |
| `mod/ugc_<steamId>.mod` | One descriptor per installed mod, with `name`, `path`, `supported_version`, `version` and `tags`. `dependencies` and `replace_path` are optional. | The first place to look for a mod's directory. |
| `mods_registry.json` | The launcher's registry, keyed by uuid, with `dirPath`, `displayName`, `gameRegistryId` (the `.mod` file), `steamId`, `requiredVersion` and `status`. | `dirPath` goes stale when mods move between Steam libraries. |
| `launcher-v2.sqlite` | `playsets(id, name, isActive)` and `playsets_mods(playsetId, modId, enabled, position)`. `mods` mirrors the registry. | Has every playset and its order, including the inactive ones. |

To find a mod's directory, try the `.mod` descriptor's `path` first,
then the registry's `dirPath`, then
`<steam library>/steamapps/workshop/content/281990/<steamId>`. Check
that the directory exists before using it. The app loads the active
playset, which is what the game loads.

Finding the install starts with Steam's `libraryfolders.vdf`, which
lists every library. The game is app `281990`, under
`steamapps/common/Stellaris`. `launcher-settings.json` in the game root
has `"rawVersion": "v4.5.0"`, which can be compared with the save's
`meta.version="Cygnus v4.5.0"`. Always offer a manual path as a
fallback, for GOG, the Paradox launcher and unusual layouts.

## The save records DLCs, not mods

`meta.required_dlcs` lists DLC names only. Neither `meta` nor
`gamestate` names a mod. The only way to tell which mods a save was made
with is to infer it. Collect every `pc_`, `sc_`, `d_`, `pm_` and
modifier key the save uses, take away the vanilla ones, and match what
is left against each installed mod's definitions. The mismatch warning
works this way. When the mod that defines a key the save uses is not in
the active playset, the warning names the key and the mod.

## Override semantics

The game loads vanilla first, then each enabled mod in `dlc_load.json`
order. Within a `common/` dir it processes files in filename order.

- A mod file with the same filename as an earlier one replaces that
  whole file.
- When the same key turns up in a file with a different name, the last
  one loaded wins in most `common/` dirs. A few dirs keep the first one
  or treat duplicates as errors. That matters for attributes. The set of
  keys is the same either way.
- `replace_path = "common/xyz"` in a descriptor discards every earlier
  file in that folder.
- For a localisation key, the last file loaded wins. Files in
  `replace/` win over all of them.

To apply this, build a `filename → winning path` map for each dir across
the layers. Then parse the files in filename order and let later keys
replace earlier ones. In practice, mods only add to the planet-class,
star-class, deposit and planet-modifier dirs. The layering still has to
be right there for the names.

## What definitions cannot give us

Definitions tell us which keys exist. They don't give us the rules for
using them. Whether a deposit may sit on a given planet is decided by a
`potential = { … }` trigger block. That is arbitrary script, and the
editor does not evaluate it. Tier 1 filters on cheap structural
attributes: deposit category, `is_for_colonizable` and planet
`climate`. Tier 2 permits any key. The game is still the oracle for
whether a combination loads.

## Rolling deposits and weights

- A deposit without `is_for_colonizable` is not for colonisable bodies:
  the game reads the missing key as `no`
  (`common/deposits/99_README_DEPOSITS.txt`). A deposit is orbital when
  its `station` names a station class. `none`, or no `station`, means the
  colony works it.
- A habitable world is topped up to `MIN_BLOCKED_DEPOSITS` and
  `MIN_UNBLOCKED_DEPOSITS` only from deposits with
  `use_for_min_max_adjustments = yes`, as the same README says. In 4.5 all
  52 flagged deposits are non-blockers, so vanilla has no blocker top-up.
  The two sample saves have 7 of 80 and 9 of 79 unowned habitable worlds
  with no blocker. `DEPOSIT_USED_CATEGORY_WEIGHT` is not part of that rule
  and is not read.
- A weight `modifier` that writes both `factor` and `add` multiplies first,
  then adds. No vanilla modifier writes both. I haven't checked the order
  in game. `FACTOR_BEFORE_ADD` in `crates/sgf-gamedata/src/weight.rs`
  holds it.

## Ownership and borders

- `galactic_object.sector` is often null (`4294967295`). A system with
  no sector is still owned by whoever runs its first starbase. That is
  how marauder clans and enclaves hold territory.
- To find that owner, follow `galactic_object.starbases` to
  `starbase_mgr.starbases.<id>.station`, then to `ships.<id>.fleet`,
  then to the country whose `fleets_manager.owned_fleets` lists that
  fleet. In the sample save, system 12 "Quiet Dark" has
  `starbases={ 44 }`, station 683, fleet 143, and country 20, of
  `type="dormant_marauders"`.
- `common/country_types/00_country_types.txt` sets
  `generate_borders = no` for `enclave`, `primitive`,
  `caravaneer_fleet`, `faction` and `nice_faction`. `caravaneer_home`
  has `generate_borders = yes`, so the Caravaneer citadel gets a
  territory.
- `is_space_critter = yes` marks the fauna types (`tiyanki`, `amoeba`,
  `crystal`, `cloud`, …) and every `guardian*` type. The marauder types
  are `dormant_marauders`, `awakened_marauders` and `ruined_marauders`.
- `BORDER_SYSTEM_RADIUS = 35` and `BORDER_HYPERLANE_THICKNESS = 20` are
  in `common/defines/00_defines.txt`.
- `flags/colors.txt` names the `flag`, `map` and `ship` rgb of each
  empire colour. The map fills a territory with the country's second
  flag colour and outlines it with the first. An empire with
  `flag.use_map_color=yes` (4.5) is painted in its fifth and sixth
  `colors` entries instead, the map border and fill
  ([format-notes.md](format-notes.md)).

## Names

The save stores a name as a template of the shape
`name = { key = "…" literal = yes variables = { … } }`.

- `PLANET_NAME_FORMAT` is `"$PARENT$ $NUMERAL$"` and
  `SUBPLANET_NAME_FORMAT` is `"$PARENT$$NUMERAL$"`. Both are in
  `localisation/english/main_1_l_english.yml`.
- `STAR_NAME_1_OF_2` is `"$NAME$ A"`, in
  `localisation/english/distant_stars_l_english.yml`.
- Country names use `AofB` and `AofBpfx` templates from
  `common/random_names/00_empire_names.txt`, for example
  `"{AofB{<imperial_mil> [This.GetCapitalSystemNameOrRandom]}}"`.
- Species name lists are in `localisation/english/name_lists/*.yml`.

## Nebulae

Each top-level `nebula` block lists its member systems explicitly, as
`galactic_object=<id>` entries. The game never works membership out
again from positions. `radius` is typically 30.

## Copies of 4.5 the core keeps

Two things the save ops need are copied from Stellaris 4.5 into
`sgf-core` instead of being read from the install, all in
`crates/sgf-core/src/format/save/write/game_tables.rs`. They are a
check on every game update:

- The nebula dressing of the start event `game_start.50`
  (`events/game_start.txt`): the calm cloud types each star class
  weighs, the class A stars an `ocean_paradise_nebula` flag gives
  `rare_nebula_1`, the turbulent type each calm type pairs with, the
  cloud's offset beside its star (`0.33 * size` plus 4.7 and 8.7), and
  that `nebula_cloaking` comes with First Contact. A new star class, or
  a changed table, gets no cloud or the wrong one until it is copied
  here.
- `SPAWN_SYSTEM_BUFFER_DISTANCE = 10` from
  `common/defines/00_defines.txt`, how close an added system may stand
  to another.

## Scenario files

`map/setup_scenarios/*.txt` is layered the same way as `common/`.
Vanilla ships one grammar-reference file, and all of it is commented
out. A mod adds its own scenario files. It can also empty a vanilla
dynamic scenario with a 0-byte file of the same name. The grammar, and
the dispatch between `setup_scenario` and `static_galaxy_scenario`, are
in [format-notes.md](format-notes.md).

If two differently named files define a galaxy size under the same
name, both are kept. The "too many systems" warning uses the higher star
count of the two. I haven't checked in-game which of the two
definitions the game takes.

A scenario's `system.initializer` names a block under
`common/solar_system_initializers/**`. It is resolved like any other
vocabulary here, from the install first and then from the enabled mods
in load order. `usage` sorts the vanilla set:

| `usage` | Vanilla count |
|---|---|
| `misc_system_init` | 196 |
| `origin` | 14 |
| `custom_empire` | 9 |
| `nomad_init` (marauders) | 7 |
| `fallen_empire_init` | 7 |
| `empire_init` | 6 |

An initializer's category comes from its `usage`. Its defining file and
mod come from where it was read. There is no hand-kept list of them.

A scenario stores no positions, so a scenario system's bodies are laid
out from its initializer. Each block adds its `change_orbit` to a
running orbit, then each instance adds its `orbit_distance`. Each
instance turns its `orbit_angle` on from the body before. A planet's
moons do the same about the planet, starting from 0. System 217 of the
4.4 sample is Sol, and it matches this within a unit of radius and a
tenth of a degree once the whole system is turned by 180°, moons
included. I haven't checked whether that turn is drawn or fixed. A
ranged distance or angle shows as a range, and so does every body after
it. A ranged `count` is laid out as its rounded midpoint. A body with no
`orbit_angle` can be anywhere on its orbit, and the bodies after it turn
on from it by 0. A distance that names an undefined `@variable` puts the
body on its parent. The add-system roller walks the same way, but it
places each moon at its own `orbit_angle`, not on from the moon before.

## References (for edge cases, never for bundling)

- `jomini` (Rust) parses this dialect including comments and operators.
- CWTools' config rules document each `common/` dir's schema.
- Irony Mod Manager is a working implementation of the layering rules.
