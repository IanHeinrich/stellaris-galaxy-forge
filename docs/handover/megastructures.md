# Handover: megastructures in saves (investigation)

Written 2026-10-11 by a cloud session for the local session that picks this up.
Nothing has been implemented. The user asked for investigation only, so check
with them before writing code.

## What the user wants

1. Megastructures in saves: how to add, delete and position them, and how each
   kind is anchored in its system: a free point like a wormhole, a planet, the
   star, or something like a station.
2. All kinds: standalone ones, ones tied to a planet, ones with a bypass
   (gateway, L-Gate, Hyper Relay), ruined ones, and ones under construction.
   Modded ones matter too. The user named Gigastructural Engineering's
   Yggdrasil and Orchid complex, which change a planet the way the Dyson
   Sphere changes a star.
3. Drawing them in the system view. The user's guidance:
   - Make them look as close to the game as we can without the work
     spiralling. Stars and planets are the standard to match.
   - Get the scale right, so people don't have to launch the game to see
     what an edit looks like.
   - Icons aren't good enough. The user says stations look bad in the system
     view today next to stars and planets.

The user prefers clarifying questions before long answers on anything
ambiguous.

## Where it stands

- Save-format findings are below, from the four sample saves. Run
  `git lfs pull` first, because `testdata/*.sav` are LFS pointers until then.
- Web research found almost nothing on the save layout. The Paradox wiki and
  forums blocked automated fetches. The script-side facts come from three
  places:
  - a vanilla script mirror (about 3.6/3.7):
    https://gitlab.com/stellaris/game/-/tree/master/game/common/megastructures
  - Paradox's 4.5.1 script docs dumps:
    https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list
  - the CWTools config: https://github.com/cwtools/cwtools-stellaris-config
- Rendering: the agreed direction is to bake sprites from the game's own
  models (see "Drawing"). The next step is a time-boxed test that needs the
  local install, which is why this is moving to a local session.

Anything marked *(inferred)* has not been checked in game.

## Save format: what the samples show

### The row

The top-level `megastructures` section comes after `ship_design` and before
`bypasses`:

```
megastructures=
{
	0=none
	1=
	{
		type="ring_world_ruined"
		coordinate=
		{
			x=45.20385
			y=-0.00045
			origin=311
		}
		owner=16777227            # optional
		graphical_culture="…"     # optional (4.5 shroud_seal has one)
		planet=4294967295         # body it is tied to, or null
		bypass=0                  # only gateway/lgate/relay types
		orbitals=
		{
		}
		build_queue=4294967295
		dismantle_progress=0
		dismantle_finish_date="0.01.01"
	}
```

- 3.4 has no `dismantle_*` keys. It writes `coordinate={ … visual_height=0.000000 }`
  and puts braces on the key's line, as other 3.x blocks do.
- `type` holds the state: `_ruined`, `_restored`, `_permanently_ruined`, or a
  stage number. `crates/sgf-core/src/entity/facts/megastructure.rs` already
  reads it that way.
- No row has an `orbit` key.

### Ids

Ids follow the planet slot scheme, `slot | generation<<24`. A dead slot is
written `<id>=none`. The 4.5 sample has `14=none` and `16777231=none`
(slot 15, generation 1). There is no `last_created_megastructure` counter: the
samples have none, and the 4.5.1 scope list has none.
`crates/sgf-core/src/format/save/alloc.rs` (`SlotTable`) already handles
planets, deposits and ambient objects, and would likely extend to this table.

### Everything that names a megastructure

| Where | Shape | Seen in |
|---|---|---|
| System | `megastructures={ 6 7 8 9 }`, after `ambient_object` (or the last `planet=`) and before `star_class` | all samples |
| Owner country | `owned_megastructures={ 2 3 … }` | 4.4, 4.5 |
| Planet or star body | `megastructure=<id>`, after `planet_orbitals`, before `bombardment_damage` | 4.4 bodies 829 and 1117; 4.5 bodies 631 and 936 |
| Bypass | `bypasses.<id>.owner={ type=6 id=<mega> }`, plus `bypass=<id>` on the row | gateways and L-Gates |
| Timeline | `definition="timeline_first_megastructure"` with `data={ <country> <mega> } types={ country megastructure }` | 4.5 |
| Dead table | `dead_mega_structure={ map={ 16777231=0 } objects={ 0={ type="waystation_megastructure" solar_system=140 } } }` | 4.5 (empty in 4.4) |
| Flags (set by script) | planet `has_megastructure`, `megastructure`, `habitat`, `ruined_orbital_ring_planet`; system `ring_world_built`, `ruined_interstellar_assembly_system`; star `*_built`; country `built_*`, `first_megastructure` | various |

In 3.4, the Spy Orb's planet (952) has no `megastructure=` key pointing back.

The 4.5 `dead_mega_structure` entry is a waystation's construction site. It
was a megastructure row until the waystation was finished. That suggests a
structure under construction is an ordinary row with a stage-0 type
*(inferred)*. Not one of the samples has something under construction, and
none has a `buildable_megastructure`-like construction item.

### Where each kind stands

Positions are relative to the star, like everything inside a system.

| Anchor | Types in samples | Save shape |
|---|---|---|
| Free point | `gateway_ruined`, `shroud_seal` | Gateways sit between `inner_radius`+10 and about `outer_radius`. Shroud Seal at (−60.27, 0) |
| Fixed point | `lgate_base` | Always (21.2148, 21.2142): radius 30 at 45° |
| Tied to a planet | `orbital_ring_ruined`, 3.4 `spy_orb_ruined` | Same x/y as the planet, with `planet=<id>` |
| Tied to the star | `interstellar_assembly_ruined`, `strategic_coordination_center_ruined` | (0,0) with `planet=<star body>`; the star has `megastructure=<id>` |
| On the star, no link | `dyson_sphere_ruined` | (0,0) with `planet=4294967295`. The star body (4.5, body 801 in system 25) is untouched: plain `pc_g_star`, no `entity_name` |
| Ring world | `ring_world_ruined` | Four quadrants at radius 45.20 at 0/90/180/270°. A ruined quadrant is a row. A finished one is three planets (`pc_ringworld_tech`, `_seam`, `_habitable` or `pc_shattered_ring_habitable`) at the quadrant's angle −30/0/+30, radius 45.01/45.20, `orbit=45`. See 4.4 systems 246 and 311, and 4.5 system 203 |
| Planet only | 4.5 habitats | No row. A `pc_habitat` moon at (−7,−7) from its gas giant (`orbit=9.899`), flagged `megastructure`/`habitat`/`habitat_level_10`; the parent is flagged `has_megastructure`. 4.5 system 596 |

Planets don't move along their orbits, and nothing suggests positions are
recalculated on load. So every position is a fixed stored point, as with
wormholes *(inferred)*.

### What the editor does today

- **Reads:**
  - `crates/sgf-core/src/format/save/details/extract.rs` (`megastructures`)
    files each row under its system as `MegastructureSummary { id, kind,
    owner, planet }`. It has no coordinate.
  - The inspector lists rows in
    `app/src/panels/inspector/system/sections/Megastructures.tsx`.
- **Draws:**
  - Nothing at a megastructure's coordinate.
  - A row tied to a planet adds an icon beside that planet's name
    (`app/src/lib/details/nameIcons.ts`). The icon is
    `MEGASTRUCTURE_ICON_KEY = "sprite:GFX_ship_class_small#22"`.
  - Ring segments and habitats are drawn from their class icon (`flat` in
    `app/src/map/system/look.ts`).
- **Refuses:**
  - moving, copying or changing the class of a planet with a megastructure
    (`move_planet.rs`, `copy_bodies.rs`, `planet_class.rs`);
  - removing a planet with a megastructure (`remove_planet.rs`, which
    checks both the `megastructure=` key and rows naming the planet);
  - adding a system from a layout that runs `spawn_megastructure`
    (`crates/sgf-gamedata/src/layouts.rs`, `Unsupported::Megastructure`).
- **Moving a system:** `move_system.rs` rewrites only the system's own
  coordinate and lane lengths. Megastructure positions are relative to the
  star, so that is already correct.
- **Install side:** nothing reads `common/megastructures` into a list of
  types yet. `initializers.rs` only collects `spawn_megastructure` types.

## Script-side facts (from the web research)

- **Placement keys** in `common/megastructures` (CWTools):
  - `entity`, `construction_entity`, `construction_scale`, `scale_offset`
  - `entity_offset={x y}`, `place_entity_on_planet_plane`, `scales_with_planet`
  - `rotate_to_center`, `plane_offset`
  - `build_type` (`inside_gravity_well` / `outside_gravity_well` / `around_planet`),
    `build_outside_gravity_well`
  - `bypass_type`, `upgrade_from`, `placement_rules`, `possible`
  - hooks: `on_build_start`, `on_build_complete`, `on_dismantle_complete`
- **`spawn_megastructure`** (4.5.1): `type`, `name`, `owner`, `planet`,
  `coords_from`, `graphical_culture`, `orbit_distance`, `orbit_angle`,
  `random_pos`, `init_effect`.
- **Other effects:** `remove_megastructure`, `delete_megastructure` (no death
  graphics), `upgrade_megastructure_to`, `finish_upgrade`, `link_to`,
  `activate_gateway`, `set_owner`.
- **Anchors and `entity_offset` (3.6/3.7 scripts):**
  - Science Nexus (`think_tank`): planet, (0,−20)
  - Sentry Array (`spy_orb`): planet, (−15,−5) then (−15,−15)
  - Art Installation, Strategic Coordination Center, Interstellar Assembly:
    planet, (−27,−27)
  - Mega Shipyard: star, (−27,−27)
  - Matter Decompressor: black hole, (−20,−20)
  - Quantum Catapult: neutron star or pulsar
  - Orbital Ring: (0,0), on the planet's plane, scales with the planet
  - Habitat stage 0: (−7,−7)
  - Gateway and Hyper Relay: free placement between inner and outer radius

  The offset is in world units. A habitat under construction sits at
  (−7,−7), and the finished habitat moon is (−7,−7) from its gas giant.
- **Repairing is an in-place upgrade.** `X_restored` has
  `upgrade_from = X_ruined`, and its `on_build_start` sets the existing
  instance's graphical culture. So the id and coordinate stay, and `type`
  changes *(inferred)*.
  - A ruined gateway already has its bypass (`bypass_type = gateway`).
  - A ruined Hyper Relay has none, so restoring it needs a `bypasses` row.
  - `*_permanently_ruined` types have no repair path.
- **Ring worlds:** `ring_world_1` removes itself and spawns four
  `ring_world_2` rows at `orbit_distance=45`, which get new ids. Finishing a
  quadrant spawns three planets with angle offsets of ±30 and the
  `megastructure` flag, then removes the row.
- **Dyson Sphere:**
  - Each stage is its own model drawn over the star:
    `dyson_sphere_phase_01_entity` to `_05`, `dyson_sphere_destroyed_entity`.
    No script changes the star itself.
  - Completing it turns the system's molten and toxic worlds `pc_frozen`,
    and barren ones `pc_barren_cold`. Deleting it won't undo that.
- **Pitfalls reported in public:**
  - A leftover country flag such as `built_mega_shipyard_site` blocks
    rebuilding.
  - About 900 duplicate megastructures froze one game.
  - No public report of a crash from a dangling megastructure id.
- **Not found:** the Gigastructures source (no public repo; its wiki is on
  Fandom, which was blocked), and the Arc Furnace and Dyson Swarm
  definitions. Read both from the local install and the Gigastructures
  workshop folder.

## Edits, as currently understood

**Move within a system**
- Free points (gateways, Shroud Seal): like `MoveWormhole`
  (`crates/sgf-core/src/format/save/write/wormhole.rs`). Keep gateways
  between the inner and outer radius.
- L-Gate base, star-tied ones and ring quadrants: fixed.
- Tied to a planet: should move with the planet. That means rewriting the
  row's coordinate when the planet moves, and lifting the `move_planet.rs`
  refusal. Needs an in-game check.

**Delete**
1. Replace the row with `<id>=none`.
2. Remove the id from the system list and the owner's `owned_megastructures`.
3. Remove the body's `megastructure=` key.
4. For bypass ones: remove the bypass row, the system's `bypasses` entry, and
   the id from other gateways' `connections`. Use `RemoveWormholePair` as
   the pattern.

To test in game:
- Is a `dead_mega_structure` entry needed when the timeline names the id?
- Does a construction item that names the structure break?
- Should flags be cleared?

A finished ring world is planets, so deleting one goes through
`remove_planet`, which refuses today.

**Add**
1. Take a slot.
2. Write the row in the key order above.
3. Add the id to the system list, the owner list, and the body key.
4. Bypass ones also need a bypass row with `owner={ type=6 … }`. Gateways
   also need `connections`.

Catches:
- `on_build_complete` effects don't run (the Dyson Sphere's planet changes,
  flags, modifiers).
- It needs a registry of types from the install's `common/megastructures`:
  anchor, `bypass_type`, upgrade chain, `entity_offset`, models.

**Change stage or restore:** rewrite `type` in place, and add or remove the
bypass where the stage's `bypass_type` differs.

Every edit kind needs an in-game test before it ships (README "Scope",
CONTRIBUTING).

## Drawing: the agreed direction

The user rejected icons. The direction is to bake sprites from the game's own
3D models, the way planets are baked from surface maps
(`crates/sgf-gamedata/src/textures/planet_disc.rs`, `sphere.rs`, `dds.rs`).
One baker would serve megastructures, starbases and stations (fixing their
current look), gateways, L-Gates, habitats, ring segments and modded models.

1. Follow the chain: the type's `entity` (and `construction_entity`), then
   the `.asset` `entity = { pdxmesh … scale … }`, then the `pdxmesh` block,
   then the `.mesh` file and its textures. `planet_disc.rs` already maps
   `pdxmesh` names to `.mesh` files and reads the material stored in a mesh.
   It does not read geometry.
2. Parse the mesh geometry. The format is binary. The community Blender
   import add-on for Paradox `.mesh` files is a reference; check it, don't
   rely on memory.
3. Render it with a small software renderer in Rust: depth buffer, diffuse
   texture, simple light from the star's side. Use the editor's ring view
   angle: `app/src/map/system/layers/ring.ts` draws rings with a minor axis
   0.75 of the major, about 41° from straight down. Cache it like planet discs.
4. Scale: the sprite's size is the model's real size × the `.asset`
   `scale` × the megastructure's `construction_scale`/`scale_offset`. Then
   apply the same enlargement `app/src/lib/details/discs.ts` gives bodies
   (`DISC_PER_SIZE = 0.26`; Earth, size 16, is 4.2 units; stars ×1.8), so
   relative sizes hold. Position stays true: coordinate + `entity_offset`.
5. Ruined and under-construction come from the game's own models
   (`*_destroyed_entity`, `construction_entity`). Dim or ghost them only
   where no model exists.
6. Classify each row from the save, so unknown modded types still draw:
   - a `bypass` means a gateway-style marker;
   - a `planet=` link means tied to that body;
   - (0,0) with no link means the star;
   - anything else is a free point.

   Ring worlds need recognising by type, or from install data.

How to keep the work from spiralling: skip skeleton-driven attachments in
the first pass, bake the rest pose only, draw glow parts additively and skip
other special shaders, skip particles, and pick the model variant for the
owner's `graphical_culture`, falling back to the plain name.

## Next step

Still investigation, unless the user says otherwise. Run a time-boxed test
against the local install:

1. Find and read the definitions: the `.asset` and `.mesh` files for one
   starbase, `think_tank` (Science Nexus) and `dyson_sphere_5`, plus their
   `common/megastructures` entries in 4.5.x. Note `entity`, `entity_offset`,
   scale keys, and the graphical culture prefixes.
2. Parse one `.mesh` (geometry, UVs, bounding box) and bake a top-down sprite
   at the ~41° angle. A throwaway test binary or a test in `sgf-gamedata` is
   fine; don't wire it into the app yet.
3. Compare with in-game screenshots of the same objects. Ask the user for
   them, plus the save they came from.
4. Report: does it look close enough, what broke (attachments, shaders), and
   what the full baker would cost.

Also worth doing:
- Check the 4.x `entity_offset` values against the 3.6/3.7 ones above.
- Find where each type's UI icon sprite is defined, as a fallback.
- Look at a few Gigastructures entries (Yggdrasil, Orchid, Matrioshka
  Brain) to see whether they use `change_pc`/`set_planet_entity` on the
  body or a model drawn over it.
- Ask the user for a mid-game save with something under construction, a
  restored ruin, an owned gateway or relay, and a finished Dyson Sphere. It
  would answer most open save-format questions and belongs in `testdata/`.

## Reproducing the sample findings

```sh
git lfs pull
mkdir -p /tmp/sav && for f in 3.4 4.4-early 4.5-day-one; do
  mkdir -p /tmp/sav/$f && unzip -o -q testdata/$f.sav -d /tmp/sav/$f; done
grep -n "^megastructures=\|^dead_mega_structure=\|owned_megastructures" /tmp/sav/4.5-day-one/gamestate
```

The cloud session used a throwaway Python script to list each row with its
radius, angle, system radii and linked planet, plus every body with a
`megastructure` key or flag or a ring world or habitat class. Rewriting it
takes a few minutes. The tables above are its output.

## Rules to follow

Read these before writing code:
- `docs/engineering-rules.md` and `CONTRIBUTING.md`
- `docs/format-notes.md` and `docs/game-data-notes.md`

Findings that hold up should be added to the last two, in their style: a
fact, a sample reference, and the game version it was checked on. This
handover file is a working note; delete it once its content has moved into
those docs.
