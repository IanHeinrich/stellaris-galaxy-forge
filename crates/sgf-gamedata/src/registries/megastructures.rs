//! `common/megastructures`: the model each megastructure type is drawn with, where that
//! model stands against the row's coordinate and whether it turns to face the star, how the
//! type is placed when built, what it produces, the types it links to, and where the editor
//! can add one.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sgf_core::ops::MegastructureDismantle;
use ts_rs::TS;

use sgf_core::cst::Node;

use crate::construction::{self, Construction};
use crate::dismantle;
use crate::scripts::ScriptIndex;

use crate::install::layers::{Layout, VANILLA};
use crate::install::script::{self, Def};
use crate::registries::registry::{FromDef, Registry};

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
    /// Where the editor adds a row of this type, read once every type is loaded.
    pub placement: Placement,
    /// What its `on_dismantle_complete` takes back from its system and owner.
    pub dismantle: MegastructureDismantle,
    /// The mod whose file won for this type; `None` for the base game.
    pub source: Option<String>,
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
}

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

/// The stem of a variant's key: what stands before its variant suffix. `None` for a
/// working type.
fn variant_stem(key: &str) -> Option<&str> {
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
    /// A ring world quadrant, which the game writes as several rows and planets.
    RingWorld,
    /// Building it makes a starbase.
    BecomesStarbase,
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
            ruined_orbital_ring: def.flag("is_ruined_orbital_ring"),
            spawns_starbase: def.node.find("starbase", &def.src).is_some(),
            activates_gateway: activates_gateway(def),
            sets_has_megastructure: sets_has_megastructure(def),
            planet_possible_star: planet_possible_star(def),
            placement: Placement::Body { star_only: false },
            dismantle: MegastructureDismantle::default(),
            source: None,
            construction: Construction::default(),
            family: None,
        }
    }
}

/// `types` with each type's [`Placement`] resolved; the first rule that matches wins. A
/// variant placed around a body takes the placement of the first stage of the working type
/// it belongs to, as [`families`] links them, when that stage too stands around a body.
pub(crate) fn placed(mut types: MegastructureTypes, scripts: &ScriptIndex) -> MegastructureTypes {
    let families = families(&types, scripts);
    let resolved: Vec<(String, Placement, bool, Option<Family>)> = types
        .iter()
        .map(|def| {
            let flags = stages(&types, def).any(|stage| stage.sets_has_megastructure);
            let own = placement(&types, def);
            let taken = match own {
                Placement::Body { .. } => families.get(&def.key).and_then(|family| {
                    let working = types.get(&family.working)?;
                    let placement = placement(&types, first_stage(&types, working));
                    matches!(placement, Placement::Body { .. }).then(|| (placement, family.clone()))
                }),
                _ => None,
            };
            match taken {
                Some((placement, family)) => (def.key.clone(), placement, flags, Some(family)),
                None => (def.key.clone(), own, flags, None),
            }
        })
        .collect();
    for (key, placement, flags, family) in resolved {
        if let Some(def) = types.get_mut(&key) {
            def.placement = placement;
            def.sets_has_megastructure = flags;
            def.family = family;
        }
    }
    types
}

/// Each variant's working type: one the files link it to, through any chain of
/// `upgrade_from` and scripted effect branches, else the first working type, in key order,
/// whose key is its stem or starts with it.
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
            None => types
                .iter()
                .filter(|other| variant_stem(&other.key).is_none())
                .find(|other| {
                    other.key == stem
                        || other
                            .key
                            .strip_prefix(stem)
                            .is_some_and(|rest| rest.starts_with('_'))
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

fn placement(types: &MegastructureTypes, def: &MegastructureDef) -> Placement {
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
    if def.key.starts_with("ring_world") {
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
            star_only: first_stage(types, def).planet_possible_star,
        },
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
    let mut found = Vec::new();
    if let Some(block) = def.node.find("on_build_complete", &def.src) {
        script::find_deep(block, "set_planet_flag", &def.src, &mut found);
    }
    found
        .iter()
        .any(|flag| flag.scalar_str(&def.src) == Some("has_megastructure"))
}

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

/// Every type `defs`, the definitions of `common/megastructures`, holds, each with what its
/// dismantle takes back and its build chain adds as `scripts` resolve the effects they call,
/// and the mod of `layout` whose file defines it.
pub(crate) fn load(
    defs: &BTreeMap<String, Def>,
    scripts: &ScriptIndex,
    layout: &Layout,
) -> MegastructureTypes {
    defs.iter()
        .map(|(key, def)| {
            let mut kind = MegastructureDef::read(key.clone(), def);
            kind.source = layout
                .layer_of(&def.file)
                .map(|(layer, _)| layer.name.clone())
                .filter(|name| name != VANILLA);
            kind.dismantle = dismantle::read(def, scripts);
            kind.construction = construction::read(defs, key, scripts);
            (key.clone(), kind)
        })
        .collect()
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
    let axis = |key: &str| {
        block
            .find(key, &def.src)
            .and_then(|n| n.scalar_str(&def.src))
            .and_then(|text| def.number_of(text))
            .unwrap_or(0.0)
    };
    (axis("x"), axis("y"))
}
