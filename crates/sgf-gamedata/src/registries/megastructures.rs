//! `common/megastructures`: the model each megastructure type is drawn with, where that
//! model stands against the row's coordinate and whether it turns to face the star, how the
//! type is placed when built, what it produces, the types it links to, where the editor
//! can add one and whether the add dialog offers it.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sgf_core::ops::MegastructureDismantle;
use sgf_core::ops::rules::{FURNACE_ENTITY, FURNACE_FLAG};
use ts_rs::TS;

use sgf_core::cst::Node;

use crate::construction::{Construction, PlanetChange};
use crate::dismantle;
use crate::scripts::ScriptIndex;

use crate::install::inline_script;
use crate::install::layers::{Layout, VANILLA};
use crate::install::script::{self, Def};
use crate::install::walk::{self, CONDITIONAL, Scan, Script, Statement};
use crate::registries::megastructure_families::Resolved;
use crate::registries::megastructure_offers::{Build, Offer, always_removes_row};
use crate::registries::megastructure_swaps::{self, Swap, removes_row};
use crate::registries::registry::Registry;
use crate::registries::scripted_triggers::ScriptedTriggers;

pub use crate::registries::megastructure_families::{Family, Linked};
pub(crate) use crate::registries::megastructure_families::{is_ruin, placed};

pub type MegastructureTypes = Registry<MegastructureDef>;

/// The types as [`load`] reads them, before [`placed`] resolves how they link.
pub(crate) type ReadTypes = Registry<MegastructureRead>;

/// A megastructure type with everything the registry resolves across types, as the add
/// dialog reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, rename = "MegastructureTypeView")]
pub struct MegastructureDef {
    pub key: String,
    /// The model, without the graphical culture prefix the game puts before it; `None` when
    /// the type names none or `""`.
    pub entity: Option<String>,
    /// The model shown while this stage is built, without its culture prefix.
    pub construction_entity: Option<String>,
    /// `entity_offset` x and y: where the model stands from the row's coordinate, in save
    /// units. `(0, 0)` when the type writes none.
    pub entity_offset: (f64, f64),
    pub place_entity_on_planet_plane: bool,
    /// `scales_with_planet = yes`: the model grows with the planet it is built on.
    pub scales_with_planet: bool,
    /// The construction model's scale; 1 when the type writes none.
    pub construction_scale: f64,
    pub build_type: BuildType,
    /// The `common/bypass` type a row of this type stands for.
    pub bypass_type: Option<String>,
    /// The types this one is built over, in file order.
    pub upgrade_from: Vec<String>,
    /// `rotate_to_center`: the model turns to face the system's centre. Yes unless the type
    /// says no.
    pub rotate_to_center: bool,
    /// What `resources = { produces = { … } }` gives each month, per resource, in file order.
    pub produces: Vec<(String, f64)>,
    /// What `country_modifier` gives its owner, per modifier, in file order.
    pub country_modifier: Vec<(String, f64)>,
    /// `is_ruined_orbital_ring = yes`: the planet it stands on carries the ruin flag.
    pub ruined_orbital_ring: bool,
    /// The type names a `starbase` level, so building it makes a starbase.
    pub spawns_starbase: bool,
    /// `on_build_complete` runs `activate_gateway`.
    pub activates_gateway: bool,
    /// Building this stage, or a stage it is built over, sets the planet flag
    /// `has_megastructure` on its body.
    pub sets_has_megastructure: bool,
    /// A row of it may be moved onto a star, which keeps its own model: it is the finished
    /// stage of its chain, which nothing is built over, and building it or a stage it is built
    /// over hid its planet as an Arc Furnace does, under the model [`FURNACE_ENTITY`] with the
    /// flag [`FURNACE_FLAG`]. On the base game, the finished Arc Furnace.
    pub may_stand_on_star: bool,
    /// `placement_rules.planet_possible` asks for `is_star = yes` outside a `NOT`.
    pub planet_possible_star: bool,
    /// The first stage of its build chain, or of its working type's for a variant, asks for a
    /// body that is not a star: the editor never places it on a star.
    pub planet_only: bool,
    /// `potential = { always = no }`: the game makes it only from script, never as a build.
    pub script_only: bool,
    /// The types its `on_build_complete` turns the finished row into, such as one per star
    /// class, in file order: each [`Self::swaps`]' type once.
    pub turns_into: Vec<String>,
    /// Each swap of the finished row its `on_build_complete` makes, in the order it is written.
    pub swaps: Vec<Swap>,
    /// Whether the add dialog offers it.
    pub offer: Offer,
    /// Where the editor adds a row of this type, read once every type is loaded.
    pub placement: Placement,
    /// The class or size its build chain gives the planet it stands at, which the editor
    /// can write with the row; `None` for a type that changes neither.
    pub planet_change: Option<PlanetChange>,
    /// What its `on_dismantle_complete` takes back from its system and owner.
    pub dismantle: MegastructureDismantle,
    /// The mod whose file won for this type; `None` for the base game.
    pub source: Option<String>,
    /// The base game defines this type, whether or not a mod's file won.
    pub base_game: bool,
    /// For a ruined, restored, destroyed or derelict variant, the working type it belongs
    /// to, as the files or their keys link them.
    pub variant_of: Option<String>,
    /// A stage, row or variant of a ring world's chain, its site included: a chain one of
    /// whose stages spawns rows round the system that a stage built over them turns into
    /// ring world segments.
    pub ring_world: bool,
    /// What its build chain adds to its system and owner, replayed against a save system
    /// when a row of it is added.
    #[serde(skip)]
    #[ts(skip)]
    pub construction: Construction,
    /// For a ruined, restored, destroyed or derelict variant placed around a body, the
    /// working type whose placement it takes, and how the two were linked.
    #[serde(skip)]
    #[ts(skip)]
    pub family: Option<Family>,
    /// What its `on_build_complete` does beyond its own row.
    #[serde(skip)]
    #[ts(skip)]
    pub completes: Completes,
    /// `portrait`: the `GFX_` sprite the game's construction card shows for it.
    #[serde(skip)]
    #[ts(skip)]
    pub portrait: Option<String>,
}

impl MegastructureDef {
    pub const DIR: &'static str = "common/megastructures";

    /// The type `read` reads, as [`placed`] resolved it and with the add dialog's `offer`.
    pub(crate) fn resolved(read: &MegastructureRead, resolved: Resolved, offer: Offer) -> Self {
        Self {
            key: read.key.clone(),
            entity: read.entity.clone(),
            construction_entity: read.construction_entity.clone(),
            entity_offset: read.entity_offset,
            place_entity_on_planet_plane: read.place_entity_on_planet_plane,
            scales_with_planet: read.scales_with_planet,
            construction_scale: read.construction_scale,
            build_type: read.build_type,
            bypass_type: read.bypass_type.clone(),
            upgrade_from: read.upgrade_from.clone(),
            rotate_to_center: read.rotate_to_center,
            produces: read.produces.clone(),
            country_modifier: read.country_modifier.clone(),
            ruined_orbital_ring: read.ruined_orbital_ring,
            spawns_starbase: read.spawns_starbase,
            activates_gateway: read.activates_gateway,
            sets_has_megastructure: resolved.sets_has_megastructure,
            may_stand_on_star: resolved.may_stand_on_star,
            planet_possible_star: read.planet_possible_star,
            planet_only: resolved.planet_only,
            script_only: read.script_only,
            turns_into: read.turns_into.clone(),
            swaps: read.swaps.clone(),
            offer,
            placement: resolved.placement,
            planet_change: resolved.planet_change,
            dismantle: read.dismantle.clone(),
            source: read.source.clone(),
            base_game: read.base_game,
            variant_of: resolved
                .family
                .as_ref()
                .map(|family| family.working.clone()),
            ring_world: resolved.ring_world,
            construction: resolved.construction,
            family: resolved.family.filter(|_| resolved.takes_placement),
            completes: read.completes.clone(),
            portrait: read.portrait.clone(),
        }
    }
}

/// What one type's own definition says, with the scripted effects and triggers it calls.
#[derive(Debug, Clone)]
pub(crate) struct MegastructureRead {
    pub key: String,
    pub entity: Option<String>,
    pub construction_entity: Option<String>,
    pub entity_offset: (f64, f64),
    pub place_entity_on_planet_plane: bool,
    pub scales_with_planet: bool,
    pub construction_scale: f64,
    pub build_type: BuildType,
    pub bypass_type: Option<String>,
    pub upgrade_from: Vec<String>,
    pub rotate_to_center: bool,
    pub produces: Vec<(String, f64)>,
    pub country_modifier: Vec<(String, f64)>,
    pub ruined_orbital_ring: bool,
    pub spawns_starbase: bool,
    pub activates_gateway: bool,
    /// Its own `on_build_complete` sets the planet flag `has_megastructure`.
    pub sets_has_megastructure: bool,
    pub planet_possible_star: bool,
    /// `placement_rules.planet_possible` asks of the body itself for `is_star = no`.
    pub planet_possible_no_star: bool,
    /// The planet classes `placement_rules.planet_possible` asks of the body itself with
    /// `is_planet_class`, when it does not also ask for `is_star = yes`.
    pub planet_possible_classes: Vec<String>,
    pub script_only: bool,
    pub turns_into: Vec<String>,
    pub swaps: Vec<Swap>,
    pub dismantle: MegastructureDismantle,
    pub source: Option<String>,
    pub base_game: bool,
    pub completes: Completes,
    /// What its files say about building it from the build menu.
    pub build: Build,
    pub portrait: Option<String>,
    /// The definition it was read from, its inline scripts in place.
    pub def: Def,
}

impl MegastructureRead {
    /// Type `key` of `def`, which `layout` loaded, with what its dismantle takes back as
    /// `scripts` resolve the effects it calls and the swaps it makes as `triggers` name star
    /// classes. `vanilla` holds the keys the game's own files define.
    fn read(
        key: String,
        def: Def,
        scripts: &ScriptIndex,
        triggers: &ScriptedTriggers,
        layout: &Layout,
        vanilla: &BTreeSet<String>,
    ) -> Self {
        let model = |field: &str| {
            def.scalar(field)
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
        };
        let source = layout
            .layer_of(&def.file)
            .map(|(layer, _)| layer.name.clone())
            .filter(|name| name != VANILLA);
        let swaps = megastructure_swaps::read(&def, triggers);
        Self {
            entity: model("entity"),
            construction_entity: model("construction_entity"),
            entity_offset: offset(&def),
            place_entity_on_planet_plane: def.flag("place_entity_on_planet_plane"),
            scales_with_planet: def.flag("scales_with_planet"),
            construction_scale: def.number("construction_scale").unwrap_or(1.0),
            build_type: BuildType::of(&def),
            bypass_type: model("bypass_type"),
            upgrade_from: script::list_items(&def.node, "upgrade_from", &def.src),
            rotate_to_center: def.scalar("rotate_to_center") != Some("no"),
            produces: produces(&def),
            country_modifier: country_modifier(&def),
            ruined_orbital_ring: def.flag("is_ruined_orbital_ring"),
            spawns_starbase: def.node.find("starbase", &def.src).is_some(),
            activates_gateway: activates_gateway(&def),
            sets_has_megastructure: sets_has_megastructure(&def),
            planet_possible_star: planet_possible_star(&def),
            planet_possible_no_star: planet_possible_asks(&def, "is_star")
                .iter()
                .any(|value| value == "no"),
            planet_possible_classes: planet_possible_classes(&def),
            script_only: script_only(&def),
            turns_into: unique(swaps.iter().map(|swap| &swap.into)),
            swaps,
            dismantle: dismantle::read(&def, scripts),
            base_game: source.is_none() || vanilla.contains(&key),
            source,
            completes: Completes::read(&def),
            build: Build::read(&def, scripts, triggers),
            portrait: model("portrait"),
            key,
            def,
        }
    }
}

/// What a stage's `on_build_complete` writes beyond its own row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Completes {
    /// Under `fromfrom.planet`, a `change_pc` or `set_planet_size`.
    pub converts_body: bool,
    /// The scripted effects called under `fromfrom.planet` with `= yes`.
    pub body_effects: Vec<String>,
    /// Under `fromfrom.planet`, a `set_planet_entity` to [`FURNACE_ENTITY`] and the flag
    /// [`FURNACE_FLAG`] set.
    pub hides_body_as_furnace: bool,
    /// A `spawn_planet` outside any `if`, `else_if`, `else` or `switch`.
    pub spawns_planet: bool,
    /// How many `spawn_megastructure` stand outside any `if`, `else_if`, `else` or `switch`.
    pub spawns_rows: usize,
    /// The type of each `spawn_megastructure`, in file order.
    pub spawned: Vec<String>,
    /// The types a block spawns in place of the row, removing it with
    /// `remove_megastructure = fromfrom`, in file order.
    pub replaced_by: Vec<String>,
    /// It removes its own row with `remove_megastructure = fromfrom`, anywhere in it.
    pub removes_row: bool,
    /// It removes its own row with `remove_megastructure = fromfrom` outside any `if`,
    /// `else_if`, `else` or `switch`.
    pub always_removes_row: bool,
    /// The class of each `spawn_planet`, anywhere in it, in file order.
    pub planet_classes: Vec<String>,
    /// It has one `spawn_planet`, which puts its planet in the orbit of a body with
    /// `orbit_location = yes` rather than at the structure's own row.
    pub planet_in_body_orbit: bool,
}

impl Completes {
    fn read(def: &Def) -> Self {
        let Some(block) = def.node.find("on_build_complete", &def.src) else {
            return Self::default();
        };
        let src = &def.src;
        let mut hosts = Vec::new();
        script::find_deep(block, "fromfrom.planet", src, &mut hosts);
        let converts_body = hosts.iter().any(|host| converts(host, src));
        let hides_body_as_furnace = hosts.iter().any(|host| hides_as_furnace(host, src));
        let mut body_effects = Vec::new();
        for host in &hosts {
            walk::calls(host, src, &mut body_effects);
        }
        let mut rows = Vec::new();
        script::find_deep(block, "spawn_megastructure", src, &mut rows);
        let replaced_by = replacements(block, &Script::of_def(def));
        let mut removals = Vec::new();
        script::find_deep(block, "remove_megastructure", src, &mut removals);
        let mut planets = Vec::new();
        script::find_deep(block, "spawn_planet", src, &mut planets);
        Self {
            converts_body,
            body_effects,
            hides_body_as_furnace,
            spawns_planet: unconditional(def, block, "spawn_planet") > 0,
            spawns_rows: unconditional(def, block, "spawn_megastructure"),
            spawned: rows
                .iter()
                .filter_map(|row| spawned_type(row, src))
                .collect(),
            replaced_by,
            always_removes_row: always_removes_row(&Script::of_def(def), block),
            removes_row: removals
                .iter()
                .any(|removal| removal.scalar_str(src) == Some("fromfrom")),
            planet_classes: planets
                .iter()
                .filter_map(|planet| planet.find("class", src)?.scalar_str(src))
                .map(str::to_owned)
                .collect(),
            planet_in_body_orbit: matches!(&planets[..], [planet] if in_body_orbit(planet, src)),
        }
    }

    /// It builds a structure of several rows or planets: whatever happens, it spawns two rows
    /// or more, or it spawns a planet and does not stand in its place. A stage that takes its
    /// own row away and puts its one planet in the orbit of a body, as the base game's
    /// Cosmogenesis World does, is that planet alone.
    pub(crate) fn builds_whole(&self) -> bool {
        let becomes_planet = self.always_removes_row && self.planet_in_body_orbit;
        self.spawns_rows > 1 || (self.spawns_planet && !becomes_planet)
    }
}

/// Whether `spawn_planet` block `planet` puts its planet in the orbit of a body: its
/// `location` is not the structure's own row and it writes `orbit_location = yes`.
fn in_body_orbit(planet: &Node, src: &[u8]) -> bool {
    let field = |key: &str| planet.find(key, src).and_then(|node| node.scalar_str(src));
    field("orbit_location") == Some("yes")
        && field("location").is_some_and(|at| !at.eq_ignore_ascii_case(ROW))
}

/// The scope a megastructure's own effects name its row by.
const ROW: &str = "fromfrom";

/// Whether `node` holds a `change_pc` or `set_planet_size`.
fn converts(node: &Node, src: &[u8]) -> bool {
    CONVERTS.iter().any(|key| {
        let mut found = Vec::new();
        script::find_deep(node, key, src, &mut found);
        !found.is_empty()
    })
}

/// Whether scripted effect `effect`, called with `= yes`, holds a statement `matches`
/// accepts, itself or through the scripted effects it calls.
pub(crate) fn effect_reaches(
    effect: &str,
    scripts: &ScriptIndex,
    matches: fn(&Statement<'_>) -> bool,
) -> bool {
    let Some(def) = scripts.effect(effect) else {
        return false;
    };
    let mut found = false;
    walk::scan(
        &Script::of_def(def),
        &def.node,
        Some(scripts),
        &mut |statement| {
            found = matches(statement);
            if found { Scan::Stop } else { Scan::Enter }
        },
    );
    found
}

/// Whether `completes` changes the body it stands at, itself or through the scripted effects
/// it calls on that body.
pub(crate) fn changes_body(completes: &Completes, scripts: &ScriptIndex) -> bool {
    completes.converts_body
        || completes.body_effects.iter().any(|effect| {
            effect_reaches(effect, scripts, |statement| {
                CONVERTS.contains(&statement.key)
            })
        })
}

/// How many `key` statements stand below `block` of `def` outside a conditional block.
fn unconditional(def: &Def, block: &Node, key: &str) -> usize {
    let mut count = 0;
    walk::scan(&Script::of_def(def), block, None, &mut |statement| {
        if statement.key == key {
            count += 1;
            Scan::Skip
        } else if CONDITIONAL.contains(&statement.key) {
            Scan::Skip
        } else {
            Scan::Enter
        }
    });
    count
}

fn spawned_type(row: &Node, src: &[u8]) -> Option<String> {
    Some(row.find("type", src)?.scalar_str(src)?.to_owned())
}

/// The type each block of `block`, itself included, spawns where it also removes the row it
/// runs for.
fn replacements(block: &Node, script: &Script<'_>) -> Vec<String> {
    let mut out = Vec::new();
    let spawns_of = |node: &Node, out: &mut Vec<String>| {
        if node.scalar_span().is_none() && removes_row(node, script) {
            for kept in script.children(node) {
                if script.key(kept.node).as_deref() == Some("spawn_megastructure") {
                    out.extend(script.field(kept.node, "type"));
                }
            }
        }
    };
    spawns_of(block, &mut out);
    walk::scan(script, block, None, &mut |statement| {
        spawns_of(statement.node, &mut out);
        Scan::Enter
    });
    out
}

/// The effects that change the class or size of the body a structure stands at in place. A
/// model change alone is left out: the base game's Arc Furnace hides its planet that way.
const CONVERTS: [&str; 2] = ["change_pc", "set_planet_size"];

/// Where the editor adds a row of a type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "place", rename_all = "snake_case")]
#[ts(export, rename = "MegastructurePlacement")]
pub enum Placement {
    /// Tied to a body, a star only when `star_only`.
    Body { star_only: bool },
    /// At a point of the system's own: past its inner radius when `outside_gravity_well`.
    Free { outside_gravity_well: bool },
    /// Not added by the editor.
    Unsupported { why: Unsupported },
}

/// Why the editor does not add a type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, rename = "MegastructureUnsupported")]
pub enum Unsupported {
    /// It stands for a bypass other than a gateway, a relay or an L-Gate.
    Bypass { bypass: String },
    /// A ring world past its site, which the game writes as several rows and planets.
    RingWorld,
    /// Building it makes a starbase.
    BecomesStarbase,
    /// Building it, or a stage it is built over, changes the class or size of the planet it
    /// stands at in a way the editor cannot tell: on a condition, or through effects it
    /// cannot follow.
    ChangesBody,
    /// Building it makes its planet a class the editor gives no planet, such as an
    /// artificial one.
    FixedClass { class: String },
    /// It is part of a structure of several rows or planets that its chain spawns, such as an
    /// Alderson disk. Tied to a star only when `star_only`.
    WholeStructure { star_only: bool },
}

/// The bypass type a relay stands for.
pub const RELAY_BYPASS: &str = "relay_bypass";

/// The bypass types a row the editor adds may stand for, as the core adds them.
pub use sgf_core::format::save::BYPASS_KINDS as ADDED_BYPASSES;

/// Where a type is placed when it is built: `build_type`, or `outside_gravity_well` for the
/// older `build_outside_gravity_well = yes`. `around_planet` when neither is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BuildType {
    InsideGravityWell,
    OutsideGravityWell,
    #[default]
    AroundPlanet,
}

impl BuildType {
    fn of(def: &Def) -> Self {
        match def.scalar("build_type") {
            Some("inside_gravity_well") => Self::InsideGravityWell,
            Some("outside_gravity_well") => Self::OutsideGravityWell,
            _ if def.flag("build_outside_gravity_well") => Self::OutsideGravityWell,
            _ => Self::AroundPlanet,
        }
    }
}

/// `keys` in order, each once.
fn unique<'k>(keys: impl Iterator<Item = &'k String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for key in keys {
        if !out.contains(key) {
            out.push(key.clone());
        }
    }
    out
}

/// `potential = { always = no }`.
fn script_only(def: &Def) -> bool {
    def.node
        .find("potential", &def.src)
        .and_then(|potential| potential.find("always", &def.src))
        .is_some_and(|always| always.scalar_str(&def.src) == Some("no"))
}

/// Whether `host`, a `fromfrom.planet` block, gives its planet the Arc Furnace's model and
/// flag.
fn hides_as_furnace(host: &Node, src: &[u8]) -> bool {
    let mut models = Vec::new();
    script::find_deep(host, "set_planet_entity", src, &mut models);
    let model = models.iter().any(|set| {
        set.find("entity", src)
            .and_then(|entity| entity.scalar_str(src))
            == Some(FURNACE_ENTITY)
    });
    let mut flags = Vec::new();
    for key in FLAG_SETTERS {
        script::find_deep(host, key, src, &mut flags);
    }
    model
        && flags
            .iter()
            .any(|flag| flag.scalar_str(src) == Some(FURNACE_FLAG))
}

/// `on_build_complete` sets the planet flag `has_megastructure`.
fn sets_has_megastructure(def: &Def) -> bool {
    def.node
        .find("on_build_complete", &def.src)
        .is_some_and(|block| sets_flag_below(block, &def.src))
}

/// The planet and carrier flag setters below `node` set `has_megastructure`.
fn sets_flag_below(node: &Node, src: &[u8]) -> bool {
    let mut found = Vec::new();
    for key in FLAG_SETTERS {
        script::find_deep(node, key, src, &mut found);
    }
    found
        .iter()
        .any(|flag| flag.scalar_str(src) == Some(HAS_MEGASTRUCTURE))
}

/// The statement sets the planet flag `has_megastructure`, as Gigastructural Engineering's
/// `giga_set_has_mega_flag` does on a stage's body.
pub(crate) fn flags_megastructure(statement: &Statement<'_>) -> bool {
    FLAG_SETTERS.contains(&statement.key) && statement.value == Some(HAS_MEGASTRUCTURE)
}

const FLAG_SETTERS: [&str; 2] = ["set_planet_flag", "set_carrier_flag"];
const HAS_MEGASTRUCTURE: &str = "has_megastructure";

fn activates_gateway(def: &Def) -> bool {
    let mut found = Vec::new();
    if let Some(block) = def.node.find("on_build_complete", &def.src) {
        script::find_deep(block, "activate_gateway", &def.src, &mut found);
    }
    !found.is_empty()
}

fn planet_possible_star(def: &Def) -> bool {
    def.node
        .find("placement_rules", &def.src)
        .and_then(|rules| rules.find("planet_possible", &def.src))
        .is_some_and(|block| asks_star(block, &def.src))
}

/// The values `placement_rules.planet_possible` asks of the body itself for `key`.
fn planet_possible_asks(def: &Def, key: &str) -> Vec<String> {
    def.node
        .find("placement_rules", &def.src)
        .and_then(|rules| rules.find("planet_possible", &def.src))
        .map(|block| {
            own_asks(block, &def.src)
                .into_iter()
                .filter(|(asked, _)| asked == key)
                .map(|(_, value)| value)
                .collect()
        })
        .unwrap_or_default()
}

/// The planet classes `planet_possible` asks of the body itself, unless it also asks for a
/// star.
fn planet_possible_classes(def: &Def) -> Vec<String> {
    if planet_possible_asks(def, "is_star")
        .iter()
        .any(|v| v == "yes")
    {
        return Vec::new();
    }
    planet_possible_asks(def, "is_planet_class")
}

/// The scalar statements `block` asks of the body itself: its own, and those of the
/// `custom_tooltip` and `AND` blocks in it, but none under a scope change, a `NOT`, an `OR`
/// or an `if`.
fn own_asks(block: &Node, src: &[u8]) -> Vec<(String, String)> {
    let mut asked = Vec::new();
    for child in block.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        if let Some(value) = child.scalar_str(src) {
            asked.push((key.to_owned(), value.to_owned()));
        } else if key == "custom_tooltip" || key.eq_ignore_ascii_case("and") {
            asked.extend(own_asks(child, src));
        }
    }
    asked
}

/// Whether `block` holds `is_star = yes` outside a `NOT`.
fn asks_star(block: &Node, src: &[u8]) -> bool {
    block
        .children()
        .iter()
        .any(|child| match child.key_str(src) {
            Some("is_star") => child.scalar_str(src) == Some("yes"),
            Some(key) if key.eq_ignore_ascii_case("not") || key.eq_ignore_ascii_case("nor") => {
                false
            }
            _ => asks_star(child, src),
        })
}

/// Every type `defs`, the definitions of `common/megastructures`, holds, each read with the
/// inline scripts it calls in place of the calls, with what its dismantle takes back and its
/// completion leaves as `scripts` resolve the effects they call, the swaps it makes as
/// `triggers` name star classes, and the mod of `layout` whose file defines it. `vanilla`
/// holds the keys the game's own files define.
pub(crate) fn load(
    defs: &BTreeMap<String, Def>,
    vanilla: &BTreeSet<String>,
    scripts: &ScriptIndex,
    triggers: &ScriptedTriggers,
    layout: &Layout,
) -> ReadTypes {
    defs.iter()
        .map(|(key, def)| {
            let read = inline_script::expand(def, layout).unwrap_or_else(|| def.clone());
            let kind =
                MegastructureRead::read(key.clone(), read, scripts, triggers, layout, vanilla);
            (key.clone(), kind)
        })
        .collect()
}

fn country_modifier(def: &Def) -> Vec<(String, f64)> {
    let mut out: Vec<(String, f64)> = Vec::new();
    for block in def.node.find_all("country_modifier", &def.src) {
        for (key, amount) in def.numbers(block) {
            match out.iter_mut().find(|(k, _)| *k == key) {
                Some(entry) => entry.1 += amount,
                None => out.push((key, amount)),
            }
        }
    }
    out
}

fn produces(def: &Def) -> Vec<(String, f64)> {
    def.node
        .find("resources", &def.src)
        .and_then(|resources| resources.find("produces", &def.src))
        .map_or_else(Vec::new, |block| def.numbers(block))
}

fn offset(def: &Def) -> (f64, f64) {
    let Some(block) = def.node.find("entity_offset", &def.src) else {
        return (0.0, 0.0);
    };
    let axis = |key: &str| def.number_in(block, key).unwrap_or(0.0);
    (axis("x"), axis("y"))
}
