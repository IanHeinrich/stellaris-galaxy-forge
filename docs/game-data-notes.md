# Game data and mod notes

Reference for the Stellaris install, its definition files, its
localisation and the launcher's mod registration, as of Stellaris 4.5.
Re-verify on every game version. Sibling of
[format-notes.md](format-notes.md), which covers the save itself.

## What the save references, and where it is defined

Every editable vocabulary is a set of top-level `key = { … }` blocks in
`common/<dir>/*.txt`, in the same Clausewitz syntax as `gamestate`.

| Save field | `common/` dir | Vanilla count | Attributes worth reading |
|---|---|---|---|
| `planet.planet_class="pc_…"` | `planet_classes/` (12 files) | 78 | `climate`, `initial`, star and gas-giant flags, which group the dropdown |
| `galactic_object.star_class="sc_…"` | `star_classes/` (2 files) | 36 | `planet = { key = pc_g_star }`, the `sc_` to `pc_` mapping a star-class change needs; binary and trinary classes carry several `planet=` blocks |
| `deposit.type="d_…"` | `deposits/` (26 files) | 587 | `is_for_colonizable`, `station`, `resources.category` (into `deposit_categories/`), which separate orbital, planetary and blocker |
| `planet.planet_modifier="pm_…"` | `planet_modifiers/` (1 file) | 71 | spawn rules only; the display name comes from localisation |
| `planet.timed_modifier.items[].modifier="…"` | `static_modifiers/` (37 files) | hundreds | effects; some `pm_` keys are also defined here |

Vanilla `common/` is 27 MB and English localisation 16 MB. Mods extend
every one of these vocabularies, and a large content mod can add hundreds
of star classes and ship more localisation than vanilla does.

The mapping from save field to definition dir is not derivable from the
files. It stays a hand-maintained table of about 30 rows that changes
only when the save format does.

## Syntax the save never uses

`gamestate` has no comments, variables or operators. Definition files add:

- `#` line comments, everywhere, including a trailing comment on the key
  line: `sc_binary_1 = { # X-ray Binary …`.
- `@name = value` at file top and `@name` references, **across files**:
  `planet_classes/00_planet_classes.txt` uses `@planet_standard_scale`,
  defined in `scripted_variables/00_scripted_variables.txt`. Enumerating
  keys does not need the values.
- Comparison operators `>`, `<`, `>=`, `<=` inside `potential` and
  `modifier` blocks.
- Typed literals `hsv { 0.59 0.45 0.95 }` and `rgb { … }`.
- `inline_script = { … }` template expansion in a few `deposits/` files,
  in vanilla only inside bodies and never at top level, so top-level key
  enumeration is unaffected. Re-check per version.

Everything else (duplicate keys, whitespace-separated statements, quoted
and bare values, nested blocks) is what the save lexer already handles.

## Localisation

`localisation/<lang>/*_l_<lang>.yml`; English has 134 files and 109,625
keys. It is **not YAML**:

- UTF-8 with BOM (`EF BB BF`).
- Lines are ` key:0 "text"`, and the `:0` version number is optional.
- Strings contain unescaped inner quotes:
  `"… the "§HGhost Signal§!," as it has been dubbed …"`. A YAML library
  fails; parse line by line with a regex anchored on the first `"` and
  the last `"`.
- `$other_key$` is a reference to resolve recursively:
  `sc_g:1 "$pc_g_star$"`, so star-class names are indirections through
  their star planet.
- `£energy£` is icon markup and `§H…§!` colour markup; strip both for
  display (`d_energy_1:0 "£energy£ +1"`).
- `localisation/replace/` is a layer that wins over every other file
  regardless of load order.
- Mods use the same layout, with per-language subfolders and optional
  `random_names/` subfolders.
- The game selects files by their **first line**, the header `l_<lang>:`
  after an optional BOM, not by the `_l_<lang>.yml` name, so a mod can
  ship `localisation/english/l_english_pf_misc.yml` and have it loaded.
  Opening every file to read its header is slow, so a file whose name
  follows the convention is matched by name and only the others are
  opened to check.

## Map art

- Star art sits on opaque black: `gfx/map/star_classes/a_star.dds` has an
  opaque black edge and an opaque white centre. The game composites star
  sprites additively rather than by alpha blending, so the map draws them
  with an additive blend when game data is loaded and falls back to a
  procedural glow otherwise.
- Mods can ship fully transparent overrides. An interface mod may replace
  `gfx/interface/system/map_gui_frame.dds` (`GFX_type_frame`,
  `interface/icons.gfx`) with an all-alpha-0 texture, and that sprite
  draws the map icon frame (`quadTextureSprite = "GFX_type_frame"`
  throughout `interface/mapicons.gui`), so such a mod set needs the frame
  drawn another way.
- Resource sprite names are inconsistent: `GFX_resource_energy`,
  `GFX_resource_physics` (for `physics_research`), `GFX_text_trade_value`
  (for the resource id `trade`, since deposits produce `trade`, not
  `trade_value`), `GFX_text_zro`, `GFX_resource_sr_dark_matter_large`
  (`interface/resources.gfx`, `interface/texticons.gfx`). `nanites` has a
  texture (`gfx/interface/icons/resources/nanites.dds`) and no sprite of
  its own, so a lookup probes `GFX_resource_<id>`, `GFX_text_<id>`, the
  same with the `sr_` prefix and the `_research`/`_value` suffix
  stripped, then the `_large` variants, in that order.
- Map icons (`interface/mapicons.gfx`, used from `star_mapicon` in
  `interface/mapicons.gui`) index sheet frames from 1.
  `GFX_colonizability` and `_shadow` are 14-frame sheets coloured by the
  player species' habitability, frame 7 being the neutral blue-grey one
  the editor uses, having no species. `GFX_fleet_presence_icons` is a
  16-frame sheet whose frames 10, 11 and 12 are the yellow, blue and red
  fleet chevrons. `GFX_map_icon_bg` and `_bg_capital` are the owner
  name-plate textures, faded unstretched for 15 px at each end.
  `GFX_map_icon_flag_capital_decoration` has 2 frames. Bypass icons are
  `GFX_ship_class_small` frames named by each bypass's `icon_frame`
  (`common/bypass/00_bypasses.txt`: gateway, quantum catapult and shroud
  tunnel 25, wormhole 12, starlit wormhole 59, L-Gate and relay bypass 30).
- Icon frames the game draws: white segments for an owner-built starbase,
  dashed green for a bypass (an L-Gate on a dark red disc), solid blue
  for anything that merely exists in the system (megastructures,
  archaeology sites, pre-FTL worlds, enclave and marauder stations).
  Gateways and L-Gates appear in the save both as a `bypasses` entry
  (`type="gateway"` / `type="lgate"`) and as a `megastructures` entry
  (`type="gateway_ruined"` / `type="lgate_base"`).

## Where mods are registered

All under the user data dir (`Documents/Paradox Interactive/Stellaris/`
on Windows and macOS, `~/.local/share/Paradox Interactive/Stellaris/` on
Linux):

| File | Contents | Trust |
|---|---|---|
| `dlc_load.json` | `enabled_mods: ["mod/ugc_….mod", …]` **in load order**, plus `disabled_dlcs`. What the game last launched with; an empty list means vanilla. | Ground truth for what the game will load. |
| `mod/ugc_<steamId>.mod` | One descriptor per installed mod: `name`, `path`, `supported_version`, `version`, `tags`, optional `dependencies`, optional `replace_path`. | First choice for a mod's directory. |
| `mods_registry.json` | Launcher registry keyed by uuid: `dirPath`, `displayName`, `gameRegistryId` (the `.mod` file), `steamId`, `requiredVersion`, `status`. | `dirPath` goes stale when mods move between Steam libraries. |
| `launcher-v2.sqlite` | `playsets(id, name, isActive)` and `playsets_mods(playsetId, modId, enabled, position)`; `mods` mirrors the registry. | Every playset with its order, not just the active one. |

Resolution order for a mod's directory: the `.mod` descriptor's `path`,
then the registry's `dirPath`, then
`<steam library>/steamapps/workshop/content/281990/<steamId>`. Verify the
directory exists before using it. The app loads the active playset, which
is what the game loads.

Install discovery: Steam's `libraryfolders.vdf` lists every library, and
the game is app `281990` under `steamapps/common/Stellaris`.
`launcher-settings.json` in the game root carries
`"rawVersion": "v4.5.0"`, comparable with the save's
`meta.version="Cygnus v4.5.0"`. Always allow a manual path as a fallback
for GOG, the Paradox launcher and unusual layouts.

## The save records DLCs, not mods

`meta.required_dlcs` lists DLC names only, and neither `meta` nor
`gamestate` names a mod. Which mods a save was made with can only be
**inferred**: collect every `pc_`, `sc_`, `d_`, `pm_` and modifier key
the save uses, subtract vanilla, and match the remainder against each
installed mod's definitions. That is the basis of the mismatch warning,
which names a key the save uses and the mod defining it when that mod is
not in the active playset.

## Override semantics

The game loads vanilla, then each enabled mod in `dlc_load.json` order.
Within a `common/` dir files are processed in filename order:

- A mod file with the **same filename** as an earlier one replaces that
  file entirely.
- The **same key** in a differently-named file overrides last-wins in
  most `common/` dirs. A few dirs are first-wins or treat duplicates as
  errors, which is irrelevant for the *set* of keys and relevant for
  attributes.
- `replace_path = "common/xyz"` in a descriptor discards every earlier
  file in that folder.
- Localisation: same key, last loaded wins, and `replace/` wins over all.

Implementation: per dir, build `filename → winning path` across layers,
parse in filename order, and let later keys replace earlier ones. Mod
content in the planet-class, star-class, deposit and planet-modifier dirs
is additive in practice, but the layering must still be right for names.

## What definitions cannot give us

Vocabulary, not rules. Whether a deposit may sit on a given planet is a
`potential = { … }` trigger block, arbitrary script the editor does not
evaluate. Tier 1 filters on cheap structural attributes (deposit
category, `is_for_colonizable`, planet `climate`) and Tier 2 permits any
key. The game remains the oracle for whether a combination loads.

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

- `galactic_object.sector` is often null (`4294967295`), and a system
  with no sector is still owned by whoever runs its first starbase. That
  is how marauder clans and enclaves hold territory. The chain is
  `galactic_object.starbases` to `starbase_mgr.starbases.<id>.station`
  to `ships.<id>.fleet` to the country whose
  `fleets_manager.owned_fleets` lists that fleet: in the sample save,
  system 12 "Quiet Dark" has `starbases={ 44 }`, station 683, fleet 143,
  and country 20, of `type="dormant_marauders"`.
- `common/country_types/00_country_types.txt` sets
  `generate_borders = no` for `enclave`, `primitive`,
  `caravaneer_fleet`, `faction` and `nice_faction`, while
  `caravaneer_home` has `generate_borders = yes`, so the Caravaneer
  citadel gets a territory. `is_space_critter = yes` marks fauna
  (`tiyanki`, `amoeba`, `crystal`, `cloud`, …) and every `guardian*`
  type. The marauder types are `dormant_marauders`, `awakened_marauders`
  and `ruined_marauders`.
- `BORDER_SYSTEM_RADIUS = 35` and `BORDER_HYPERLANE_THICKNESS = 20` are
  in `common/defines/00_defines.txt`. `flags/colors.txt` names each
  empire colour's `flag`, `map` and `ship` rgb; the map fills a territory
  with the country's second flag colour and outlines it with the first.

## Names

`name = { key = "…" literal = yes variables = { … } }` is the save's
name-template shape. `PLANET_NAME_FORMAT` is `"$PARENT$ $NUMERAL$"` and
`SUBPLANET_NAME_FORMAT` is `"$PARENT$$NUMERAL$"`
(`localisation/english/main_1_l_english.yml`); `STAR_NAME_1_OF_2` is
`"$NAME$ A"` (`localisation/english/distant_stars_l_english.yml`).
Country names use `AofB`/`AofBpfx` templates, for example
`"{AofB{<imperial_mil> [This.GetCapitalSystemNameOrRandom]}}"`
(`common/random_names/00_empire_names.txt`). Species name lists live
under `localisation/english/name_lists/*.yml`.

## Nebulae

Each top-level `nebula` block lists its member `galactic_object=<id>`
systems explicitly, and the game never re-derives membership from
positions. `radius` is typically 30.

## Scenario files

`map/setup_scenarios/*.txt` is layered the same as `common/`: vanilla
ships one grammar-reference file, entirely commented out, and a mod adds
its own scenario files and can empty a vanilla dynamic scenario with a
0-byte file of the same name. Grammar and the `setup_scenario` /
`static_galaxy_scenario` dispatch: [format-notes.md](format-notes.md).

A galaxy size defined twice under one name, in two differently named
files, is kept twice, and the "too many systems" warning uses the higher
star count. I haven't checked in-game which of the two definitions the
game takes.

A scenario `system.initializer` names a block under
`common/solar_system_initializers/**`, resolved like any other vocabulary
here: install first, then enabled mods in load order. `usage` sorts the
vanilla set: `misc_system_init` 196, `origin` 14, `custom_empire` 9,
`nomad_init` 7 (marauders), `fallen_empire_init` 7, `empire_init` 6. An
initializer's category comes from `usage`, and its defining file and mod
from where it was read, rather than from a hand-kept list.

## References (for edge cases, never for bundling)

- `jomini` (Rust) parses this dialect including comments and operators.
- CWTools' config rules document each `common/` dir's schema.
- Irony Mod Manager is a working implementation of the layering rules.
