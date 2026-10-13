//! `common/megastructures`: the model each megastructure type is drawn with, where that
//! model stands against the row's coordinate and whether it turns to face the star, how the
//! type is placed when built, what it produces, the types it links to, where the editor
//! can add one and whether the add dialog offers it.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sgf_core::ops::{ClassChange, MegastructureDismantle};
use ts_rs::TS;

use sgf_core::cst::Node;

use crate::construction::{self, Construction, PlanetChange, UnsurePlanetChange};
use crate::dismantle;
use crate::scripts::ScriptIndex;
use sgf_core::format::save::ring_world;

use crate::install::inline_script;
use crate::install::layers::{Layout, VANILLA};
use crate::install::script::{self, Def};
use crate::install::walk::{self, CONDITIONAL, Scan, Script, Statement};
use crate::registries::megastructure_offers::{Build, Offer};
use crate::registries::megastructure_swaps::{self, Swap, removes_row};
use crate::registries::planet_classes::PlanetClasses;
use crate::registries::registry::{FromDef, Registry};
use crate::registries::scripted_triggers::ScriptedTriggers;

pub type MegastructureTypes = Registry<MegastructureDef>;

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
    /// `placement_rules.planet_possible` asks for `is_star = yes` outside a `NOT`.
    pub planet_possible_star: bool,
    /// `placement_rules.planet_possible` asks of the body itself for `is_star = no`.
    #[serde(skip)]
    #[ts(skip)]
    pub planet_possible_no_star: bool,
    /// The planet classes `placement_rules.planet_possible` asks of the body itself with
    /// `is_planet_class`, when it does not also ask for `is_star = yes`.
    #[serde(skip)]
    #[ts(skip)]
    pub planet_possible_classes: Vec<String>,
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
    /// What its files say about building it from the build menu.
    #[serde(skip)]
    #[ts(skip)]
    pub build: Build,
    /// `portrait`: the `GFX_` sprite the game's construction card shows for it.
    #[serde(skip)]
    #[ts(skip)]
    pub portrait: Option<String>,
}

/// What a stage's `on_build_complete` writes beyond its own row.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Completes {
    /// Under `fromfrom.planet`, a `change_pc` or `set_planet_size`.
    pub converts_body: bool,
    /// The scripted effects called under `fromfrom.planet` with `= yes`.
    pub body_effects: Vec<String>,
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
    /// The class of each `spawn_planet`, anywhere in it, in file order.
    pub planet_classes: Vec<String>,
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
            spawns_planet: unconditional(def, block, "spawn_planet") > 0,
            spawns_rows: unconditional(def, block, "spawn_megastructure"),
            spawned: rows
                .iter()
                .filter_map(|row| spawned_type(row, src))
                .collect(),
            replaced_by,
            removes_row: removals
                .iter()
                .any(|removal| removal.scalar_str(src) == Some("fromfrom")),
            planet_classes: planets
                .iter()
                .filter_map(|planet| planet.find("class", src)?.scalar_str(src))
                .map(str::to_owned)
                .collect(),
        }
    }

    /// It builds a structure of several rows or planets: whatever happens, it spawns two rows
    /// or more, or a mod's type spawns a planet. The base game's Cosmogenesis World spawns its
    /// planet too, and the editor has added it as a row since before this rule.
    fn builds_whole(&self, base_game: bool) -> bool {
        self.spawns_rows > 1 || (self.spawns_planet && !base_game)
    }
}

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
fn effect_reaches(
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

/// Whether `stage`'s `on_build_complete` changes the body it stands at, itself or through the
/// scripted effects it calls on that body.
fn changes_body(stage: &MegastructureDef, scripts: &ScriptIndex) -> bool {
    stage.completes.converts_body
        || stage.completes.body_effects.iter().any(|effect| {
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

/// The working type a variant takes its placement from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Family {
    pub working: String,
    pub linked: Linked,
}

/// How a variant was linked to its working type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Linked {
    /// The files name the two together: an `upgrade_from`, or a scripted effect branch that
    /// asks for the one and spawns the other in its place.
    Files,
    /// Their keys share a stem, the variant's suffix taken off.
    Stem,
}

/// The suffixes a variant's key adds to its family's stem.
const VARIANT_SUFFIXES: [&str; 5] = [
    "_permanently_ruined",
    "_ruined",
    "_restored",
    "_destroyed",
    "_derelict",
];

/// A ruined, destroyed or derelict variant: one a restore is built over.
pub(crate) fn is_ruin(key: &str) -> bool {
    VARIANT_SUFFIXES
        .iter()
        .any(|suffix| *suffix != "_restored" && key.contains(suffix))
}

/// The stem of a variant's key: what stands before its variant suffix. `None` for a
/// working type.
pub(crate) fn variant_stem(key: &str) -> Option<&str> {
    VARIANT_SUFFIXES
        .iter()
        .filter_map(|suffix| key.find(suffix))
        .min()
        .map(|at| &key[..at])
}

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
    /// It stands for a bypass other than a gateway or a relay.
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

/// The bypass types a row the editor adds may stand for.
pub const ADDED_BYPASSES: [&str; 2] = ["gateway", "relay_bypass"];

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

impl FromDef for MegastructureDef {
    const DIR: &'static str = "common/megastructures";

    fn read(key: String, def: &Def) -> Self {
        let completes = Completes::read(def);
        let model = |field: &str| {
            def.scalar(field)
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
        };
        Self {
            key,
            entity: model("entity"),
            construction_entity: model("construction_entity"),
            entity_offset: offset(def),
            place_entity_on_planet_plane: def.flag("place_entity_on_planet_plane"),
            scales_with_planet: def.flag("scales_with_planet"),
            construction_scale: def.number("construction_scale").unwrap_or(1.0),
            build_type: BuildType::of(def),
            bypass_type: model("bypass_type"),
            upgrade_from: script::list_items(&def.node, "upgrade_from", &def.src),
            rotate_to_center: def.scalar("rotate_to_center") != Some("no"),
            produces: produces(def),
            country_modifier: country_modifier(def),
            ruined_orbital_ring: def.flag("is_ruined_orbital_ring"),
            spawns_starbase: def.node.find("starbase", &def.src).is_some(),
            activates_gateway: activates_gateway(def),
            sets_has_megastructure: sets_has_megastructure(def),
            planet_possible_star: planet_possible_star(def),
            planet_possible_no_star: planet_possible_asks(def, "is_star")
                .iter()
                .any(|value| value == "no"),
            planet_possible_classes: planet_possible_classes(def),
            planet_only: false,
            script_only: script_only(def),
            turns_into: Vec::new(),
            swaps: Vec::new(),
            offer: Offer::Offered,
            placement: Placement::Body { star_only: false },
            planet_change: None,
            dismantle: MegastructureDismantle::default(),
            source: None,
            base_game: true,
            variant_of: None,
            construction: Construction::default(),
            family: None,
            completes,
            build: Build::default(),
            portrait: model("portrait"),
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

/// `types` with each type's [`Placement`] resolved; the first rule that matches wins. A type
/// whose chain changes its planet is placed as any other when the change can be told, with
/// the change as its [`MegastructureDef::planet_change`]. A
/// variant placed around a body takes the placement of the first stage of the working type
/// it belongs to, as [`families`] links them, when that stage too stands around a body.
/// Every stage and variant of a gateway or a relay stands where its bypass does. A stage
/// whose completion always swaps it for another type takes that type's placement.
pub(crate) fn placed(
    mut types: MegastructureTypes,
    scripts: &ScriptIndex,
    classes: &PlanetClasses,
) -> MegastructureTypes {
    let families = families(&types, scripts);
    let bypassed = bypass_groups(&types, &families);
    let whole = whole_structures(&types);
    let on_stars = star_stages(&types);
    let rings = ring_worlds(&types, &families);
    let resolved: Vec<Resolved> = types
        .iter()
        .map(|def| {
            let flags = stages(&types, def).any(|stage| {
                stage.sets_has_megastructure
                    || stage
                        .completes
                        .body_effects
                        .iter()
                        .any(|effect| effect_reaches(effect, scripts, flags_megastructure))
            });
            let mut change = None;
            let own = match placement(&types, def, &on_stars, &rings) {
                Placement::Body { .. } if bypassed.contains(&def.key) => Placement::Free {
                    outside_gravity_well: true,
                },
                Placement::Body { star_only }
                    if whole.contains(&def.key) && !rings.sites.contains(&def.key) =>
                {
                    Placement::Unsupported {
                        why: Unsupported::WholeStructure { star_only },
                    }
                }
                Placement::Body { star_only: false } => {
                    match planet_change(&types, def, scripts, classes) {
                        Ok(told) => {
                            change = told;
                            Placement::Body { star_only: false }
                        }
                        Err(why) => Placement::Unsupported { why },
                    }
                }
                own => own,
            };
            let taken = match own {
                Placement::Body { .. } => families.get(&def.key).and_then(|family| {
                    let working = types.get(&family.working)?;
                    let placement =
                        placement(&types, first_stage(&types, working), &on_stars, &rings);
                    matches!(placement, Placement::Body { .. }).then(|| (placement, family.clone()))
                }),
                _ => None,
            };
            let (placement, family) = match taken {
                Some((placement, family)) => (placement, Some(family)),
                None => (own, None),
            };
            Resolved {
                key: def.key.clone(),
                placement,
                change,
                flags,
                family,
            }
        })
        .collect();
    for resolved in resolved {
        let variant_of = families
            .get(&resolved.key)
            .map(|family| family.working.clone());
        if let Some(def) = types.get_mut(&resolved.key) {
            def.placement = resolved.placement;
            def.planet_change = resolved.change;
            def.sets_has_megastructure = resolved.flags;
            def.family = resolved.family;
            def.variant_of = variant_of;
        }
    }
    let off_stars: Vec<String> = types
        .iter()
        .filter(|def| {
            let working = def
                .family
                .as_ref()
                .and_then(|family| types.get(&family.working))
                .unwrap_or(def);
            off_stars(first_stage(&types, working), classes)
        })
        .map(|def| def.key.clone())
        .collect();
    for key in off_stars {
        if let Some(def) = types.get_mut(&key) {
            def.planet_only = true;
        }
    }
    let swapped: Vec<(String, Placement, Option<PlanetChange>)> = types
        .iter()
        .filter_map(|def| {
            let swap = def.swaps.iter().find(|swap| swap.always())?;
            let into = types.get(&swap.into)?;
            Some((
                def.key.clone(),
                into.placement.clone(),
                into.planet_change.clone(),
            ))
        })
        .collect();
    for (key, placement, change) in swapped {
        if let Some(def) = types.get_mut(&key) {
            def.placement = placement;
            def.planet_change = change;
        }
    }
    types
}

/// What [`placed`] reads of one type before writing it back.
struct Resolved {
    key: String,
    placement: Placement,
    change: Option<PlanetChange>,
    flags: bool,
    family: Option<Family>,
}

/// The class or size `def`'s build chain gives the planet it stands at, as its construction
/// walk keeps it. When a stage of the chain changes the planet, as [`changes_body`] reads
/// it, a change the walk cannot tell, or none where it should find one, refuses the type, and
/// so does a class no planet is given. A stage of another chain the type can be built over
/// does not count: the editor builds the first.
fn planet_change(
    types: &MegastructureTypes,
    def: &MegastructureDef,
    scripts: &ScriptIndex,
    classes: &PlanetClasses,
) -> Result<Option<PlanetChange>, Unsupported> {
    let flagged = chain(types, def).any(|stage| changes_body(stage, scripts));
    let change = match def.construction.planet_change() {
        Ok(Some(change)) => change,
        Ok(None) | Err(UnsurePlanetChange) if !flagged => return Ok(None),
        Ok(None) | Err(UnsurePlanetChange) => return Err(Unsupported::ChangesBody),
    };
    let fixed = change.class.as_ref().filter(|class| {
        classes
            .get(class)
            .is_none_or(|def| def.change() == ClassChange::Never)
    });
    match fixed {
        Some(_) if !flagged => Ok(None),
        Some(class) => Err(Unsupported::FixedClass {
            class: class.clone(),
        }),
        None => Ok(Some(change)),
    }
}

/// `def` and the stages it is built over, following the first of each `upgrade_from`, as its
/// construction is read.
fn chain<'t>(
    types: &'t MegastructureTypes,
    def: &'t MegastructureDef,
) -> impl Iterator<Item = &'t MegastructureDef> {
    let mut seen = vec![def];
    while let Some(earlier) = seen
        .last()
        .and_then(|stage| stage.upgrade_from.first())
        .and_then(|key| types.get(key))
    {
        if seen.iter().any(|s| s.key == earlier.key) {
            break;
        }
        seen.push(earlier);
    }
    seen.into_iter()
}

/// The first stages built only around a star: those whose `placement_rules` ask for one, and
/// the types a star's first stage turns into on completion, such as one per star class.
fn star_stages(types: &MegastructureTypes) -> BTreeSet<String> {
    let mut stars: BTreeSet<String> = types
        .iter()
        .filter(|def| def.planet_possible_star)
        .map(|def| def.key.clone())
        .collect();
    let turned: Vec<String> = types
        .iter()
        .filter(|def| stars.contains(&first_stage(types, def).key))
        .flat_map(|def| def.turns_into.iter().cloned())
        .collect();
    stars.extend(turned);
    stars
}

/// The types that belong to a structure of several rows or planets: each type whose build
/// spawns one whatever happens, and every type joined to them by `upgrade_from` or by a
/// spawn that does not replace the row.
fn whole_structures(types: &MegastructureTypes) -> BTreeSet<String> {
    let mut reached: Vec<&str> = types
        .iter()
        .filter(|def| def.completes.builds_whole(def.base_game))
        .map(|def| def.key.as_str())
        .collect();
    let mut links: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for def in types.iter() {
        let spawned = def
            .completes
            .spawned
            .iter()
            .filter(|key| !def.completes.replaced_by.contains(key));
        for other in def
            .upgrade_from
            .iter()
            .chain(spawned)
            .filter_map(|key| types.get(key))
        {
            links.entry(&def.key).or_default().push(&other.key);
            links.entry(&other.key).or_default().push(&def.key);
        }
    }
    let mut next = 0;
    while let Some(&key) = reached.get(next) {
        next += 1;
        for &linked in links.get(key).into_iter().flatten() {
            if !reached.contains(&linked) {
                reached.push(linked);
            }
        }
    }
    reached.into_iter().map(str::to_owned).collect()
}

/// Every type joined by `upgrade_from` or by [`families`] to a type that stands for a
/// gateway or a relay.
fn bypass_groups(
    types: &MegastructureTypes,
    families: &BTreeMap<String, Family>,
) -> BTreeSet<String> {
    let mut links: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut join = |a: &'_ str, b: &'_ str| {
        if let (Some(a), Some(b)) = (types.get(a), types.get(b)) {
            links.entry(&a.key).or_default().push(&b.key);
            links.entry(&b.key).or_default().push(&a.key);
        }
    };
    for def in types.iter() {
        for earlier in &def.upgrade_from {
            join(&def.key, earlier);
        }
    }
    for (variant, family) in families {
        join(variant, &family.working);
    }
    let mut reached: Vec<&str> = types
        .iter()
        .filter(|def| {
            def.bypass_type
                .as_deref()
                .is_some_and(|kind| ADDED_BYPASSES.contains(&kind))
        })
        .map(|def| def.key.as_str())
        .collect();
    let mut next = 0;
    while let Some(&key) = reached.get(next) {
        next += 1;
        for &linked in links.get(key).into_iter().flatten() {
            if !reached.contains(&linked) {
                reached.push(linked);
            }
        }
    }
    reached.into_iter().map(str::to_owned).collect()
}

/// Each variant's working type: one the files link it to, through any chain of
/// `upgrade_from` and scripted effect branches, else the first working type, in key order,
/// whose key is its stem or starts with it, read with its underscores and else without them.
fn families(types: &MegastructureTypes, scripts: &ScriptIndex) -> BTreeMap<String, Family> {
    let mut groups: Vec<Vec<String>> = Vec::new();
    for def in types.iter() {
        if variant_stem(&def.key).is_some() {
            for earlier in &def.upgrade_from {
                groups.push(vec![def.key.clone(), earlier.clone()]);
            }
        }
    }
    for effect in scripts.effects() {
        spawn_groups(&effect.node, &effect.src, &mut groups);
    }
    let mut links: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for group in &groups {
        let known: Vec<&str> = group
            .iter()
            .filter_map(|key| types.get(key).map(|def| def.key.as_str()))
            .collect();
        for pair in known.windows(2) {
            links.entry(pair[0]).or_default().push(pair[1]);
            links.entry(pair[1]).or_default().push(pair[0]);
        }
    }

    let mut out = BTreeMap::new();
    for def in types.iter() {
        let Some(stem) = variant_stem(&def.key) else {
            continue;
        };
        let mut seen = vec![def.key.as_str()];
        let mut next = 0;
        while let Some(&key) = seen.get(next) {
            next += 1;
            for &linked in links.get(key).into_iter().flatten() {
                if !seen.contains(&linked) {
                    seen.push(linked);
                }
            }
        }
        let mut working: Vec<&str> = seen
            .into_iter()
            .filter(|key| variant_stem(key).is_none())
            .collect();
        working.sort_unstable();
        let family = match working.first() {
            Some(&key) => Some(Family {
                working: key.to_owned(),
                linked: Linked::Files,
            }),
            None => [stem_rest, words_rest]
                .into_iter()
                .find_map(|rest| {
                    types
                        .iter()
                        .filter(|other| variant_stem(&other.key).is_none())
                        .find(|other| {
                            rest(&other.key, stem)
                                .is_some_and(|r| r.is_empty() || r.starts_with('_'))
                        })
                })
                .map(|other| Family {
                    working: other.key.clone(),
                    linked: Linked::Stem,
                }),
        };
        if let Some(family) = family {
            out.insert(def.key.clone(), family);
        }
    }
    out
}

/// What follows `stem` in `key`.
fn stem_rest<'k>(key: &'k str, stem: &str) -> Option<&'k str> {
    key.strip_prefix(stem)
}

/// What follows `stem` in `key` when the two are read without their underscores, as
/// Gigastructural Engineering's `ring_world_titanic_ruined` belongs to `ringworld_titanic_0`.
fn words_rest<'k>(key: &'k str, stem: &str) -> Option<&'k str> {
    let mut letters = stem.bytes().filter(|&b| b != b'_').peekable();
    for (at, byte) in key.bytes().enumerate() {
        if letters.peek().is_none() {
            return Some(&key[at..]);
        }
        if byte == b'_' {
            continue;
        }
        if letters.next() != Some(byte) {
            return None;
        }
    }
    letters.peek().is_none().then_some("")
}

/// Each block of `node` that asks with its `limit` for megastructure types and spawns one
/// in their place, as the types it names: those of `is_megastructure_type` in the limit,
/// outside a `NOT`, and those of `spawn_megastructure`'s `type` in the block.
fn spawn_groups(node: &Node, src: &[u8], out: &mut Vec<Vec<String>>) {
    for child in node.children() {
        if child.scalar_span().is_some() {
            continue;
        }
        if let Some(limit) = child.find("limit", src) {
            let mut group = Vec::new();
            asked_types(limit, src, &mut group);
            if !group.is_empty() {
                let before = group.len();
                spawned_types(child, src, &mut group);
                if group.len() > before {
                    out.push(group);
                }
            }
        }
        spawn_groups(child, src, out);
    }
}

fn asked_types(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        match child.key_str(src) {
            Some("is_megastructure_type") => {
                if let Some(kind) = child.scalar_str(src) {
                    out.push(kind.to_owned());
                }
            }
            Some(key) if key.eq_ignore_ascii_case("not") || key.eq_ignore_ascii_case("nor") => {}
            _ => asked_types(child, src, out),
        }
    }
}

/// The types the `spawn_megastructure` blocks in `node` spawn, leaving out a block with a
/// `limit` of its own.
fn spawned_types(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        if child.scalar_span().is_some() {
            continue;
        }
        if child.key_str(src) == Some("spawn_megastructure") {
            if let Some(kind) = child.find("type", src).and_then(|t| t.scalar_str(src)) {
                out.push(kind.to_owned());
            }
            continue;
        }
        if child.key_str(src) != Some("limit") && child.find("limit", src).is_none() {
            spawned_types(child, src, out);
        }
    }
}

fn placement(
    types: &MegastructureTypes,
    def: &MegastructureDef,
    on_stars: &BTreeSet<String>,
    rings: &RingWorlds,
) -> Placement {
    if let Some(bypass) = def
        .bypass_type
        .as_ref()
        .filter(|kind| !ADDED_BYPASSES.contains(&kind.as_str()))
    {
        let why = Unsupported::Bypass {
            bypass: bypass.clone(),
        };
        return Placement::Unsupported { why };
    }
    if rings.members.contains(&def.key) && !rings.sites.contains(&def.key) {
        return Placement::Unsupported {
            why: Unsupported::RingWorld,
        };
    }
    if def.spawns_starbase {
        return Placement::Unsupported {
            why: Unsupported::BecomesStarbase,
        };
    }
    // Some gateway stages leave `build_type` commented out; every gateway and relay stands
    // outside the gravity well.
    if def.bypass_type.is_some() {
        return Placement::Free {
            outside_gravity_well: true,
        };
    }
    match def.build_type {
        BuildType::OutsideGravityWell => Placement::Free {
            outside_gravity_well: true,
        },
        BuildType::InsideGravityWell => Placement::Free {
            outside_gravity_well: false,
        },
        BuildType::AroundPlanet => Placement::Body {
            star_only: on_stars.contains(&first_stage(types, def).key),
        },
    }
}

/// The types of the ring worlds, and of those the sites, the one stage of a ring the editor
/// adds as a row.
#[derive(Debug, Default)]
struct RingWorlds {
    members: BTreeSet<String>,
    sites: BTreeSet<String>,
}

/// Every type of a ring world: a chain one of whose stages spawns rows round the system
/// whatever happens, which a stage built over them turns into ring world segments, the planet
/// classes a save's ring is made of. From that stage, every stage it is built over or that
/// is built over it, every type it spawns and every variant of one of them belongs to the
/// ring. Its site is a working type of it that no stage is built over and none spawns.
fn ring_worlds(types: &MegastructureTypes, families: &BTreeMap<String, Family>) -> RingWorlds {
    let builds_segments = |spawned: &String| {
        types.iter().any(|stage| {
            stage.upgrade_from.contains(spawned)
                && stage
                    .completes
                    .planet_classes
                    .iter()
                    .any(|class| ring_world::is_segment(class))
        })
    };
    let mut members: Vec<&str> = types
        .iter()
        .filter(|def| {
            def.completes.spawns_rows > 1 && def.completes.spawned.iter().any(builds_segments)
        })
        .map(|def| def.key.as_str())
        .collect();
    let mut next = 0;
    while let Some(&key) = members.get(next) {
        next += 1;
        let Some(def) = types.get(key) else {
            continue;
        };
        let linked = types.iter().filter(|other| {
            def.upgrade_from.contains(&other.key)
                || other.upgrade_from.contains(&def.key)
                || def.completes.spawned.contains(&other.key)
                || families
                    .get(&other.key)
                    .is_some_and(|f| f.working == def.key)
                || families
                    .get(&def.key)
                    .is_some_and(|f| f.working == other.key)
        });
        for other in linked {
            if !members.contains(&other.key.as_str()) {
                members.push(&other.key);
            }
        }
    }
    let sites = members
        .iter()
        .filter_map(|key| types.get(key))
        .filter(|def| {
            def.upgrade_from.is_empty()
                && variant_stem(&def.key).is_none()
                && !types
                    .iter()
                    .any(|other| other.completes.spawned.contains(&def.key))
        })
        .map(|def| def.key.clone())
        .collect();
    RingWorlds {
        members: members.into_iter().map(str::to_owned).collect(),
        sites,
    }
}

/// The stage `def`'s chain starts from, following the first of each `upgrade_from`.
fn first_stage<'t>(
    types: &'t MegastructureTypes,
    def: &'t MegastructureDef,
) -> &'t MegastructureDef {
    let mut stage = def;
    let mut seen = vec![def.key.as_str()];
    while let Some(earlier) = stage.upgrade_from.first().and_then(|key| types.get(key)) {
        if seen.contains(&earlier.key.as_str()) {
            break;
        }
        seen.push(&earlier.key);
        stage = earlier;
    }
    stage
}

/// `def` and every stage it is built over, through each `upgrade_from`, each once.
fn stages<'t>(
    types: &'t MegastructureTypes,
    def: &'t MegastructureDef,
) -> impl Iterator<Item = &'t MegastructureDef> {
    let mut seen = vec![def];
    let mut next = 0;
    while let Some(stage) = seen.get(next).copied() {
        next += 1;
        for earlier in stage.upgrade_from.iter().filter_map(|key| types.get(key)) {
            if !seen.iter().any(|s| s.key == earlier.key) {
                seen.push(earlier);
            }
        }
    }
    seen.into_iter()
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
fn flags_megastructure(statement: &Statement<'_>) -> bool {
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

/// Whether the game never builds `def` on a star: its `planet_possible` asks for `is_star =
/// no`, or only for planet classes the install defines as no star.
fn off_stars(def: &MegastructureDef, classes: &PlanetClasses) -> bool {
    let named = &def.planet_possible_classes;
    def.planet_possible_no_star
        || (!named.is_empty()
            && named
                .iter()
                .all(|class| classes.get(class).is_some_and(|c| !c.star)))
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
/// inline scripts it calls in place of the calls, with what its dismantle takes back, its
/// build chain adds and its completion leaves as `scripts` resolve the effects they call, the
/// swaps it makes as `triggers` name star classes, and the mod of `layout` whose file defines
/// it.
pub(crate) fn load(
    defs: &BTreeMap<String, Def>,
    scripts: &ScriptIndex,
    triggers: &ScriptedTriggers,
    layout: &Layout,
) -> MegastructureTypes {
    let vanilla = vanilla_keys(layout);
    let defs: BTreeMap<String, Def> = defs
        .iter()
        .map(|(key, def)| {
            let read = inline_script::expand(def, layout).unwrap_or_else(|| def.clone());
            (key.clone(), read)
        })
        .collect();
    defs.iter()
        .map(|(key, def)| {
            let mut kind = MegastructureDef::read(key.clone(), def);
            kind.source = layout
                .layer_of(&def.file)
                .map(|(layer, _)| layer.name.clone())
                .filter(|name| name != VANILLA);
            kind.base_game = kind.source.is_none() || vanilla.contains(key);
            kind.dismantle = dismantle::read(def, scripts);
            kind.construction = construction::read(&defs, key, scripts);
            kind.swaps = megastructure_swaps::read(def, triggers);
            kind.turns_into = unique(kind.swaps.iter().map(|swap| &swap.into));
            kind.build = Build::read(def, scripts, triggers);
            (key.clone(), kind)
        })
        .collect()
}

/// The types the game's own files define, those a mod's file replaced included.
fn vanilla_keys(layout: &Layout) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    for file in layout.vanilla_files_in(MegastructureDef::DIR) {
        let Some((root, src)) = script::parse_file(&file, &mut Vec::new()) else {
            continue;
        };
        for node in root.children() {
            if let Some(key) = node.key_str(&src).filter(|key| !key.starts_with('@')) {
                keys.insert(key.to_owned());
            }
        }
    }
    keys
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
