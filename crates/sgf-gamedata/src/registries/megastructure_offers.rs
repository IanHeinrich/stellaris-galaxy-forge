//! Which megastructure types the add dialog offers: those a player builds from the build
//! menu, every stage after them, and the ruins a player can repair. What hides the others is
//! read from each type's files, but for the families held back by [`NOT_OFFERED_YET`].

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use sgf_core::cst::Node;

use crate::condition::{Condition, Subject};
use crate::install::script::{self, Def};
use crate::registries::megastructures::{
    MegastructureDef, MegastructureTypes, is_ruin, variant_stem,
};
use crate::registries::scripted_triggers::ScriptedTriggers;
use crate::scripts::ScriptIndex;

/// The first stages of the families the dialog leaves out for now, with every stage after
/// them and their ruins: crisis-path, origin and story structures, structures that become
/// warships, and the action stages of finished structures.
pub const NOT_OFFERED_YET: [&str; 38] = [
    "crisis_sphere_0",
    "galactic_crucible_0",
    "cosmogenesis_needle",
    "behemoth_egg",
    "behemoth_chrysalis",
    "behemoth_chrysalis_big",
    "dyson_sphere_disco",
    "shroud_seal",
    "waystation_megastructure",
    "war_moon_0",
    "war_planet_0",
    "war_system_0",
    "nomad_war_moon_0",
    "nomad_war_planet_0",
    "blokkat_prison_1_empty",
    "blokkat_shield_killer_0",
    "blokkat_star_fix_0",
    "orbital_arcology_0",
    "interstellar_habitat_0",
    "interstellar_habitat_2",
    "interstellar_habitat_4",
    "anti_sirens_shield",
    "ehof_sm_forge_phase0",
    "ehof_presphere_dyson",
    "r_square_world_ruined",
    "frameworld_decompressor_1",
    "frameworld_penrose_1",
    "frameworld_salvage_habitat_0",
    "blokkat_gigarelay_1",
    "kaiser_moon_1",
    "improbable_kaiser_moon_0",
    "stellarite_kaiser_moon_0",
    "pouchkinn_engine_1",
    "penrose_bomb_armed",
    "lunar_macroreplicator_make_moon",
    "planetcraft_printer_make_planet",
    "substellar_compressor_5",
    "psychic_beacon_4",
];

/// Whether the add dialog offers a type.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(tag = "offer", rename_all = "snake_case")]
#[ts(export, rename = "MegastructureOffer")]
pub enum Offer {
    #[default]
    Offered,
    Hidden {
        why: HiddenWhy,
    },
}

/// Why the add dialog does not offer a type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename = "MegastructureHiddenWhy")]
pub enum HiddenWhy {
    /// A player never starts it from the build menu: its `potential` fails for a player, or
    /// no stage up to it has a cost and a technology.
    NotBuilt,
    /// Its model is a ship's.
    ShipEntity,
    /// A fleet builds it.
    BuiltByFleet,
    /// Its completion removes it and leaves a fleet.
    LeavesFleet,
    /// Its completion removes it and leaves nothing.
    LeavesNothing,
    /// A state of a finished structure, on a cycle of `upgrade_from` it does not enter at.
    State,
    /// A ruin no offered stage repairs.
    RuinWithoutRestore,
    /// Its family is in [`NOT_OFFERED_YET`].
    NotOfferedYet,
}

/// What a type's own files say about building it from the build menu.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Build {
    pub potential: Option<Condition>,
    /// `resources` names a `cost`.
    pub cost: bool,
    /// `prerequisites` names a technology, or `potential` or `possible` asks for one.
    pub technology: bool,
    /// `potential` asks for a fleet from `from`: `is_<x>_fleet = yes`.
    pub by_fleet: bool,
    /// What its completion leaves when it removes the row and makes no starbase.
    pub leaves: Option<HiddenWhy>,
}

/// How deep the completion's scripted effects are followed.
const EFFECT_DEPTH: usize = 4;

/// The blocks whose effects run only on a condition.
const CONDITIONAL: [&str; 4] = ["if", "else_if", "else", "switch"];

impl Build {
    /// `def`'s build facts, its completion's effects followed through `scripts` and the
    /// triggers its `potential` and `possible` call through `triggers`.
    pub(crate) fn read(def: &Def, scripts: &ScriptIndex, triggers: &ScriptedTriggers) -> Self {
        let src = &def.src;
        let potential = def.node.find("potential", src);
        let possible = def.node.find("possible", src);
        let asks_technology = |block: Option<&Node>| {
            block.is_some_and(|block| {
                let mut found = Vec::new();
                script::find_deep(block, "has_technology", src, &mut found);
                let mut called = Vec::new();
                calls(block, src, &mut called);
                !found.is_empty()
                    || called.iter().any(|name| {
                        let call = Condition::Call(name.clone(), true);
                        technology(&call, triggers, &mut BTreeSet::new())
                    })
            })
        };
        Self {
            potential: potential.map(|block| Condition::of_def(block, def)),
            cost: def
                .node
                .find("resources", src)
                .is_some_and(|resources| resources.find("cost", src).is_some()),
            technology: !script::list_items(&def.node, "prerequisites", src).is_empty()
                || asks_technology(potential)
                || asks_technology(possible),
            by_fleet: potential.is_some_and(|block| asks_fleet(block, src)),
            leaves: def
                .node
                .find("on_build_complete", src)
                .filter(|_| def.node.find("starbase", src).is_none())
                .and_then(|block| leaves(block, src, scripts)),
        }
    }
}

/// The key of each `key = yes` below `node`: the scripted triggers it calls, among others.
fn calls(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        match (child.key_str(src), child.scalar_str(src)) {
            (Some(key), Some("yes")) => out.push(key.to_owned()),
            _ => calls(child, src, out),
        }
    }
}

/// Whether `condition` asks for a technology, through the scripted triggers it calls.
fn technology(
    condition: &Condition,
    triggers: &ScriptedTriggers,
    seen: &mut BTreeSet<String>,
) -> bool {
    match condition {
        Condition::Unknown(key) => key == "has_technology",
        Condition::Not(inner) => technology(inner, triggers, seen),
        Condition::All(items) | Condition::Any(items) => {
            items.iter().any(|item| technology(item, triggers, seen))
        }
        Condition::Call(name, _) => {
            seen.insert(name.clone())
                && triggers
                    .get(name)
                    .is_some_and(|called| technology(&called.condition, triggers, seen))
        }
        _ => false,
    }
}

/// Whether a `from` block below `node` asks `is_<x>_fleet = yes`.
fn asks_fleet(node: &Node, src: &[u8]) -> bool {
    let mut scopes = Vec::new();
    script::find_deep(node, "from", src, &mut scopes);
    scopes.iter().any(|scope| {
        scope.children().iter().any(|child| {
            child.scalar_str(src) == Some("yes")
                && child
                    .key_str(src)
                    .is_some_and(|key| key.starts_with("is_") && key.ends_with("_fleet"))
        })
    })
}

/// What a completion that removes its row whatever happens leaves in its place: a fleet,
/// or nothing when it spawns no structure, starbase, planet or ship. `None` when it keeps the
/// row or spawns one of those.
fn leaves(block: &Node, src: &[u8], scripts: &ScriptIndex) -> Option<HiddenWhy> {
    if !removes_row(block, src) {
        return None;
    }
    let mut keys = BTreeSet::new();
    effect_keys(block, src, scripts, 0, &mut keys);
    let has = |key: &str| keys.contains(key);
    if has("spawn_megastructure") || has("create_starbase") {
        None
    } else if has("create_fleet") || has("create_ship") {
        Some(HiddenWhy::LeavesFleet)
    } else if has("spawn_planet") {
        None
    } else {
        Some(HiddenWhy::LeavesNothing)
    }
}

/// `remove_megastructure = fromfrom` outside a conditional block.
fn removes_row(node: &Node, src: &[u8]) -> bool {
    node.children()
        .iter()
        .any(|child| match child.key_str(src) {
            Some("remove_megastructure") => child.scalar_str(src) == Some("fromfrom"),
            Some(key) if CONDITIONAL.contains(&key) => false,
            _ => removes_row(child, src),
        })
}

/// Every key below `node`, and below the scripted effects it calls, `depth` calls deep.
fn effect_keys(
    node: &Node,
    src: &[u8],
    scripts: &ScriptIndex,
    depth: usize,
    out: &mut BTreeSet<String>,
) {
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        out.insert(key.to_owned());
        if depth < EFFECT_DEPTH
            && let Some(effect) = scripts.effect(key)
        {
            effect_keys(&effect.node, &effect.src, scripts, depth + 1, out);
        }
        effect_keys(child, src, scripts, depth, out);
    }
}

/// A player's empire, as a `potential` is judged for it: not an AI, of the default country
/// type, with every global flag unknown.
struct Player<'a> {
    triggers: &'a ScriptedTriggers,
}

impl Subject for Player<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        match leaf {
            Condition::Call(name, want) if name == "is_ai" => Some(!want),
            Condition::CountryType(kind) => Some(kind == "default"),
            _ => None,
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        Some(self.triggers)
    }
}

/// `types` with each type's [`Offer`] decided.
pub(crate) fn offered(
    mut types: MegastructureTypes,
    triggers: &ScriptedTriggers,
) -> MegastructureTypes {
    let states = states(&types);
    let own: BTreeMap<&str, Option<HiddenWhy>> = types
        .iter()
        .map(|def| (def.key.as_str(), own(def, triggers, &states)))
        .collect();
    let entries: BTreeSet<&str> = types
        .iter()
        .filter(|def| own[def.key.as_str()].is_none() && def.build.cost && def.build.technology)
        .map(|def| def.key.as_str())
        .collect();
    let reached = after(&types, &entries, &own);
    let mut offers: BTreeMap<String, Offer> = types
        .iter()
        .map(|def| {
            let key = def.key.as_str();
            let offer = match own[key] {
                Some(why) => Offer::Hidden { why },
                None if reached.contains(key) => Offer::Offered,
                None => Offer::Hidden {
                    why: HiddenWhy::NotBuilt,
                },
            };
            (def.key.clone(), offer)
        })
        .collect();

    for def in types.iter().filter(|def| is_ruin(&def.key)) {
        let offer = offers.get_mut(&def.key).expect("every type has an offer");
        let unbuilt = Offer::Hidden {
            why: HiddenWhy::NotBuilt,
        };
        if *offer != Offer::Offered && *offer != unbuilt {
            continue;
        }
        let repaired = types.iter().any(|restore| {
            restore.upgrade_from.contains(&def.key)
                && restore.build.cost
                && restore.build.technology
                && matches!(
                    own[restore.key.as_str()],
                    None | Some(HiddenWhy::LeavesFleet)
                )
        });
        *offer = if repaired {
            Offer::Offered
        } else {
            Offer::Hidden {
                why: HiddenWhy::RuinWithoutRestore,
            }
        };
    }

    for key in not_offered_yet(&types) {
        let offer = offers.get_mut(&key).expect("every type has an offer");
        if *offer == Offer::Offered {
            *offer = Offer::Hidden {
                why: HiddenWhy::NotOfferedYet,
            };
        }
    }

    for (key, offer) in offers {
        if let Some(def) = types.get_mut(&key) {
            def.offer = offer;
        }
    }
    types
}

/// What hides `def` whatever stage the family starts from.
fn own(
    def: &MegastructureDef,
    triggers: &ScriptedTriggers,
    states: &BTreeSet<String>,
) -> Option<HiddenWhy> {
    let player = Player { triggers };
    let ship = |entity: &Option<String>| {
        entity
            .as_deref()
            .is_some_and(|name| name.ends_with("_ship_entity"))
    };
    if def
        .build
        .potential
        .as_ref()
        .is_some_and(|potential| potential.evaluate(&player) == Some(false))
    {
        Some(HiddenWhy::NotBuilt)
    } else if ship(&def.entity) || ship(&def.construction_entity) {
        Some(HiddenWhy::ShipEntity)
    } else if def.build.by_fleet {
        Some(HiddenWhy::BuiltByFleet)
    } else if let Some(leaves) = def.build.leaves {
        Some(leaves)
    } else if states.contains(&def.key) {
        Some(HiddenWhy::State)
    } else {
        None
    }
}

/// `from` and every type built over one of them, through `upgrade_from`; a stage hidden
/// whatever happens leads nowhere.
fn after<'t>(
    types: &'t MegastructureTypes,
    from: &BTreeSet<&'t str>,
    own: &BTreeMap<&str, Option<HiddenWhy>>,
) -> BTreeSet<&'t str> {
    let mut reached: Vec<&str> = from.iter().copied().collect();
    let mut next = 0;
    while let Some(&key) = reached.get(next) {
        next += 1;
        if own.get(key).is_some_and(Option::is_some) {
            continue;
        }
        for later in types.iter() {
            if later.upgrade_from.iter().any(|earlier| earlier == key)
                && !reached.contains(&later.key.as_str())
            {
                reached.push(&later.key);
            }
        }
    }
    reached.into_iter().collect()
}

/// The types on a cycle of `upgrade_from` that the cycle is not entered at: no type off the
/// cycle is built into them or swaps into them.
fn states(types: &MegastructureTypes) -> BTreeSet<String> {
    let earlier = |def: &MegastructureDef| -> BTreeSet<String> {
        let mut seen: Vec<&str> = Vec::new();
        let mut next = 0;
        let mut queue: Vec<&str> = def.upgrade_from.iter().map(String::as_str).collect();
        while let Some(&key) = queue.get(next) {
            next += 1;
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            if let Some(stage) = types.get(key) {
                queue.extend(stage.upgrade_from.iter().map(String::as_str));
            }
        }
        seen.into_iter().map(str::to_owned).collect()
    };
    let before: BTreeMap<&str, BTreeSet<String>> = types
        .iter()
        .filter(|def| !def.upgrade_from.is_empty())
        .map(|def| (def.key.as_str(), earlier(def)))
        .collect();
    let on_cycle = |key: &str| before.get(key).is_some_and(|set| set.contains(key));
    let mut out = BTreeSet::new();
    for def in types.iter().filter(|def| on_cycle(&def.key)) {
        let cycle: BTreeSet<&str> = before[def.key.as_str()]
            .iter()
            .map(String::as_str)
            .filter(|other| before.get(other).is_some_and(|set| set.contains(&def.key)))
            .collect();
        let entered = |member: &str| {
            let built_from_outside = types.get(member).is_some_and(|stage| {
                stage
                    .upgrade_from
                    .iter()
                    .any(|earlier| !cycle.contains(earlier.as_str()))
            });
            let swapped_from_outside = types.iter().any(|other| {
                !cycle.contains(other.key.as_str())
                    && other.swaps.iter().any(|swap| swap.into == member)
            });
            built_from_outside || swapped_from_outside
        };
        if !entered(&def.key) {
            out.insert(def.key.clone());
        }
    }
    out
}

/// Each listed family's stages, every type built over them, and their ruins and restores
/// with what repairs them. A type built over one of them and over a type outside them is left out.
fn not_offered_yet(types: &MegastructureTypes) -> BTreeSet<String> {
    let mut held: BTreeSet<String> = NOT_OFFERED_YET
        .iter()
        .filter(|key| types.get(key).is_some())
        .map(|key| (*key).to_owned())
        .collect();
    loop {
        let more: Vec<String> = types
            .iter()
            .filter(|def| !held.contains(&def.key))
            .filter(|def| {
                let built_over = !def.upgrade_from.is_empty()
                    && def
                        .upgrade_from
                        .iter()
                        .all(|earlier| held.contains(earlier) || types.get(earlier).is_none())
                    && def
                        .upgrade_from
                        .iter()
                        .any(|earlier| held.contains(earlier));
                let ruin_of = def
                    .variant_of
                    .as_ref()
                    .is_some_and(|working| held.contains(working));
                let named_for = variant_stem(&def.key).is_some_and(|stem| held.contains(stem));
                built_over || named_for || (is_ruin(&def.key) && ruin_of)
            })
            .map(|def| def.key.clone())
            .collect();
        if more.is_empty() {
            return held;
        }
        held.extend(more);
    }
}
