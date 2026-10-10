//! What an initializer block states beyond its bodies and their places: the statements of
//! its `init_effect` that change what a save would show, the keys only an initializer has,
//! and, as written, every statement this reader does not model, so nothing it says is lost.
//!
//! A statement counts as stated when the `init_effect` runs it unconditionally, as one of its
//! own statements. The same statement under an `if`, a loop or a random choice is left in the
//! wrapper's text, and counted there.

use sgf_core::cst::Node;
use sgf_core::format::save::details::{
    AddedModifier, InlineScriptUse, RawStatement, UsageOdds, VariableUse,
};
use sgf_core::span::Span;

use crate::install::script::{self, Def, Range};
use crate::scripts::scope::{is_guard, keeps_scope};

/// The keys of a `planet` or `moon` block the reader models.
const BODY_KEYS: [&str; 19] = [
    "name",
    "class",
    "size",
    "orbit_distance",
    "orbit_angle",
    "change_orbit",
    "has_ring",
    "entity",
    "count",
    "home_planet",
    "starting_planet",
    "init_effect",
    "moon",
    "planet",
    "flags",
    "deposit_blockers",
    "modifiers",
    "modifier",
    "anomaly",
];

/// The keys of an initializer's own block the reader models. An `inline_script` it reads
/// in place is gone from the block by the time this list is consulted.
const SYSTEM_KEYS: [&str; 18] = [
    "class",
    "name",
    "planet",
    "change_orbit",
    "asteroid_belt",
    "flags",
    "init_effect",
    "usage",
    "usage_odds",
    "max_instances",
    "neighbor_system",
    "spawn_chance",
    "scaled_spawn_chance",
    "prevent_anomalies",
    "primitive_system",
    "inner_radius_offset",
    "outer_radius_offset",
    "namelist",
];

/// The statements of a body's `init_effect` the reader models.
const BODY_EFFECTS: [&str; 17] = [
    "add_deposit",
    "set_deposit",
    "clear_deposits",
    "add_blocker",
    "clear_blockers",
    "add_modifier",
    "clear_planet_modifiers",
    "set_name",
    "set_planet_entity",
    "change_pc",
    "set_planet_size",
    "set_planet_flag",
    "set_star_flag",
    "prevent_anomaly",
    "add_anomaly",
    "create_ambient_object",
    "create_archaeological_site",
];

/// The statements of a system's `init_effect` the reader models.
const SYSTEM_EFFECTS: [&str; 5] = [
    "set_star_flag",
    "create_ambient_object",
    "spawn_megastructure",
    "create_starbase",
    "create_archaeological_site",
];

const CREATE_AMBIENT_OBJECT: &str = "create_ambient_object";

/// A deposit statement of a body's `init_effect`, as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatedDeposit {
    Add(String),
    Set(String),
    /// `clear_deposits`: every deposit, or those of the named category.
    Clear(Option<String>),
    AddBlocker(String),
    ClearBlockers,
}

/// What a `planet` or `moon` block states of its body.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StatedBody {
    pub changed_class: Option<String>,
    /// A `change_pc` under a wrapper: the class it ends with is the script's to decide.
    pub class_by_script: bool,
    pub changed_size: Option<u32>,
    pub deposits: Vec<StatedDeposit>,
    /// `deposit_blockers = none`.
    pub no_blockers: bool,
    /// `modifier = pm_…`.
    pub modifier: Option<String>,
    /// `modifiers = none`.
    pub no_modifiers: bool,
    pub clears_modifiers: bool,
    pub added_modifiers: Vec<AddedModifier>,
    /// The block's `anomaly`, then each `add_anomaly`'s category.
    pub anomalies: Vec<String>,
    pub prevent_anomaly: bool,
    /// `entity`.
    pub entity: Option<String>,
    /// The last `set_planet_entity`'s `entity` or `picture`.
    pub set_entity: Option<String>,
    pub set_name: Option<String>,
    pub flags: Vec<String>,
    pub starting_planet: bool,
    pub home_planet: bool,
    /// The `type` of each `create_ambient_object` that runs on the body.
    pub ambient_objects: Vec<String>,
    pub other_keys: Vec<RawStatement>,
    pub script: Vec<RawStatement>,
    pub from_script: Option<String>,
    pub variables: Vec<VariableUse>,
}

/// One `neighbor_system` block.
#[derive(Debug, Clone, PartialEq)]
pub struct StatedNeighbor {
    pub initializer: String,
    pub distance: Option<Range>,
    pub hyperlane_jumps: Option<Range>,
}

/// What an initializer's own block states of its system.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StatedSystem {
    pub namelist: Option<String>,
    pub prevent_anomalies: bool,
    pub primitive_system: bool,
    pub inner_radius_offset: Option<f64>,
    pub outer_radius_offset: Option<f64>,
    pub usage_odds: Option<UsageOdds>,
    pub spawn_chance: Option<f64>,
    pub scaled_spawn_chance: Option<f64>,
    pub neighbors: Vec<StatedNeighbor>,
    /// Each `set_star_flag` its `init_effect` runs.
    pub flags: Vec<String>,
    /// The `type` of each `create_ambient_object` its `init_effect` runs, at any depth.
    pub ambient_objects: Vec<String>,
    pub other_keys: Vec<RawStatement>,
    pub script: Vec<RawStatement>,
    pub inline_scripts: Vec<InlineScriptUse>,
    /// The `inline_script` that gives the system its star class and every body.
    pub from_script: Option<String>,
    pub variables: Vec<VariableUse>,
}

/// What the `planet` or `moon` block `node` states, `from_script` the inline script it
/// was read from.
pub(crate) fn body(node: &Node, def: &Def, from_script: Option<String>) -> StatedBody {
    let src = &def.src;
    let mut out = StatedBody {
        from_script,
        variables: variables(node, def, &["moon", "planet", "init_effect"]),
        ..StatedBody::default()
    };
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        let scalar = child.scalar_str(src);
        match key {
            "flags" => out.flags.extend(items(child, src)),
            "deposit_blockers" => out.no_blockers = scalar == Some("none"),
            "modifiers" => out.no_modifiers = scalar == Some("none"),
            "modifier" => out.modifier = scalar.map(str::to_owned),
            "anomaly" => out.anomalies.extend(scalar.map(str::to_owned)),
            "entity" => out.entity = scalar.map(str::to_owned),
            "starting_planet" => out.starting_planet = scalar == Some("yes"),
            "home_planet" => out.home_planet = scalar == Some("yes"),
            "init_effect" => body_effects(child, def, &mut out),
            _ if BODY_KEYS.contains(&key) => {}
            _ => out.other_keys.push(raw(child, key, src, &[])),
        }
    }
    out
}

fn body_effects(block: &Node, def: &Def, out: &mut StatedBody) {
    let src = &def.src;
    for child in block.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        if !body_effect(child, key, def, out) {
            if keeps_scope(key) {
                out.class_by_script |= within(child, src, &["change_pc"]) > 0;
                out.ambient_objects
                    .extend(ambient_objects(child, src, true));
            }
            out.script.push(raw(child, key, src, &BODY_EFFECTS));
        }
    }
}

/// Reads `child`, keyed `key`, into `out` when it is a statement the reader models in the
/// shape it expects.
fn body_effect(child: &Node, key: &str, def: &Def, out: &mut StatedBody) -> bool {
    let src = &def.src;
    let scalar = child.scalar_str(src);
    let field = |name: &str| child.find(name, src).and_then(|n| n.scalar_str(src));
    let owned = |text: Option<&str>| text.map(str::to_owned);
    match key {
        "add_deposit" | "set_deposit" => {
            let Some(deposit) = owned(scalar) else {
                return false;
            };
            out.deposits.push(match key {
                "add_deposit" => StatedDeposit::Add(deposit),
                _ => StatedDeposit::Set(deposit),
            });
        }
        "clear_deposits" => match (scalar, field("category")) {
            (Some("yes"), _) => out.deposits.push(StatedDeposit::Clear(None)),
            (Some("no"), _) => {}
            (Some(category), _) | (None, Some(category)) => out
                .deposits
                .push(StatedDeposit::Clear(Some(category.to_owned()))),
            (None, None) => return false,
        },
        "add_blocker" => {
            let Some(deposit) = owned(field("type").or(scalar)) else {
                return false;
            };
            out.deposits.push(StatedDeposit::AddBlocker(deposit));
        }
        "clear_blockers" => {
            if scalar == Some("yes") {
                out.deposits.push(StatedDeposit::ClearBlockers);
            }
        }
        "add_modifier" => {
            let Some(modifier) = owned(field("modifier")) else {
                return false;
            };
            out.added_modifiers.push(AddedModifier {
                modifier,
                days: field("days").and_then(|days| def.number_of(days)),
            });
        }
        "clear_planet_modifiers" => out.clears_modifiers |= scalar == Some("yes"),
        "set_name" => {
            let Some(name) = owned(scalar.or_else(|| field("key"))) else {
                return false;
            };
            out.set_name = Some(name);
        }
        "set_planet_entity" => {
            let Some(entity) = owned(field("entity").or_else(|| field("picture"))) else {
                return false;
            };
            out.set_entity = Some(entity);
        }
        "change_pc" => {
            let Some(class) = owned(scalar.or_else(|| field("class"))) else {
                return false;
            };
            out.changed_class = Some(class);
        }
        "set_planet_size" => {
            let Some(size) = scalar.and_then(|s| def.number_of(s)) else {
                return false;
            };
            out.changed_size = Some(script::whole(size));
        }
        "set_planet_flag" | "set_star_flag" => {
            let Some(flag) = owned(scalar) else {
                return false;
            };
            out.flags.push(flag);
        }
        "prevent_anomaly" => out.prevent_anomaly |= scalar == Some("yes"),
        "add_anomaly" => {
            let Some(category) = owned(field("category").or(scalar)) else {
                return false;
            };
            out.anomalies.push(category);
        }
        CREATE_AMBIENT_OBJECT => {
            let Some(kind) = owned(field("type")) else {
                return false;
            };
            out.ambient_objects.push(kind);
        }
        "create_archaeological_site" => return scalar.is_some(),
        _ => return false,
    }
    true
}

/// What an initializer's own block `node` states, the keys an inline script supplied
/// already read in place.
pub(crate) fn system(node: &Node, def: &Def) -> StatedSystem {
    let src = &def.src;
    let mut out = StatedSystem {
        variables: variables(
            node,
            def,
            &["planet", "init_effect", "usage_odds", "neighbor_system"],
        ),
        ..StatedSystem::default()
    };
    let starbase = read_starbase(node, src);
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        let scalar = child.scalar_str(src);
        let number = || scalar.and_then(|s| def.number_of(s));
        match key {
            "namelist" => out.namelist = scalar.map(str::to_owned),
            "prevent_anomalies" => out.prevent_anomalies = scalar == Some("yes"),
            "primitive_system" => out.primitive_system = scalar == Some("yes"),
            "inner_radius_offset" => out.inner_radius_offset = number(),
            "outer_radius_offset" => out.outer_radius_offset = number(),
            "spawn_chance" => out.spawn_chance = number(),
            "scaled_spawn_chance" => out.scaled_spawn_chance = number(),
            "usage_odds" => out.usage_odds = Some(usage_odds(child, def)),
            "neighbor_system" => out.neighbors.extend(neighbor(child, def)),
            "init_effect" => system_effects(child, src, starbase, &mut out),
            _ if SYSTEM_KEYS.contains(&key) => {}
            _ => out.other_keys.push(raw(child, key, src, &[])),
        }
    }
    out
}

/// Reads the system's `init_effect` `block` into `out`. A statement counts as modelled only
/// in the shape its reader takes: `starbase` is the `create_starbase` the system's starbase
/// is read from, the first at any depth, when it states a `size`.
fn system_effects(block: &Node, src: &[u8], starbase: Option<Span>, out: &mut StatedSystem) {
    out.ambient_objects
        .extend(ambient_objects(block, src, false));
    for child in block.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        let scalar = child.scalar_str(src);
        let has = |field: &str| {
            child
                .find(field, src)
                .and_then(|n| n.scalar_str(src))
                .is_some()
        };
        let modelled = match key {
            "set_star_flag" => {
                if let Some(flag) = scalar {
                    out.flags.push(flag.to_owned());
                }
                scalar.is_some()
            }
            CREATE_AMBIENT_OBJECT | "spawn_megastructure" => has("type"),
            "create_archaeological_site" => scalar.is_some(),
            "create_starbase" => starbase == Some(child.span()),
            _ => false,
        };
        if !modelled {
            out.script.push(raw(child, key, src, &SYSTEM_EFFECTS));
        }
    }
}

/// The first `create_starbase` below `node`, a body's aside, when it states a `size`: the
/// one the system's starbase is read from.
fn read_starbase(node: &Node, src: &[u8]) -> Option<Span> {
    let first = first_below(node, "create_starbase", src)?;
    first
        .find("size", src)
        .and_then(|n| n.scalar_str(src))
        .map(|_| first.span())
}

fn first_below<'n>(node: &'n Node, key: &str, src: &[u8]) -> Option<&'n Node> {
    node.children()
        .iter()
        .find_map(|child| match child.key_str(src) {
            Some("planet" | "moon") => None,
            Some(found) if found == key => Some(child),
            _ => first_below(child, key, src),
        })
}

fn usage_odds(node: &Node, def: &Def) -> UsageOdds {
    let src = &def.src;
    if let Some(written) = node.scalar_str(src) {
        return match def.number_of(written) {
            Some(value) => UsageOdds::Number { value },
            None => UsageOdds::Unknown {
                written: written.to_owned(),
            },
        };
    }
    UsageOdds::Script {
        text: text(node, src),
        base: node
            .find("base", src)
            .and_then(|n| n.scalar_str(src))
            .and_then(|s| def.number_of(s)),
    }
}

fn neighbor(node: &Node, def: &Def) -> Option<StatedNeighbor> {
    let initializer = node.find("initializer", &def.src)?.scalar_str(&def.src)?;
    Some(StatedNeighbor {
        initializer: initializer.to_owned(),
        distance: def.range_in(node, "distance"),
        hyperlane_jumps: def.range_in(node, "hyperlane_jumps"),
    })
}

/// The `type` of each `create_ambient_object` below `node`: through the blocks that keep
/// the scope they are written in when `same_scope`, else through every block but a body's.
fn ambient_objects(node: &Node, src: &[u8], same_scope: bool) -> Vec<String> {
    let mut out = Vec::new();
    collect_ambient(node, src, same_scope, &mut out);
    out
}

fn collect_ambient(node: &Node, src: &[u8], same_scope: bool, out: &mut Vec<String>) {
    for child in node.children() {
        match child.key_str(src) {
            Some("planet" | "moon") => {}
            Some(CREATE_AMBIENT_OBJECT) => {
                out.extend(
                    child
                        .find("type", src)
                        .and_then(|t| t.scalar_str(src))
                        .map(str::to_owned),
                );
            }
            Some(key) if !same_scope || keeps_scope(key) => {
                collect_ambient(child, src, same_scope, out);
            }
            _ => {}
        }
    }
}

/// How many statements keyed one of `keys` lie below `node`, through blocks that keep the
/// scope they are written in.
fn within(node: &Node, src: &[u8], keys: &[&str]) -> u32 {
    node.children()
        .iter()
        .map(|child| match child.key_str(src) {
            Some(key) if keys.contains(&key) => 1,
            Some(key) if keeps_scope(key) && !is_guard(key) => within(child, src, keys),
            _ => 0,
        })
        .sum()
}

/// `node`, keyed `key`, as written, with the statements keyed one of `modelled` inside it.
fn raw(node: &Node, key: &str, src: &[u8], modelled: &[&str]) -> RawStatement {
    let inside = match keeps_scope(key) {
        true => within(node, src, modelled),
        false => 0,
    };
    RawStatement {
        key: key.to_owned(),
        text: text(node, src),
        modelled: inside,
    }
}

fn text(node: &Node, src: &[u8]) -> String {
    String::from_utf8_lossy(node.span().slice(src)).into_owned()
}

fn items(node: &Node, src: &[u8]) -> Vec<String> {
    node.children()
        .iter()
        .filter(|item| item.key.is_none())
        .filter_map(|item| item.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

/// Each value of `node` written as an `@variable`: its own keys', and the scalars one level
/// into a block not keyed one of `skip` (`size = { min = @a … }`).
fn variables(node: &Node, def: &Def, skip: &[&str]) -> Vec<VariableUse> {
    let src = &def.src;
    let mut out = Vec::new();
    let mut add = |key: String, value: Option<&str>| {
        if let Some(variable) = value.filter(|v| v.starts_with('@')) {
            out.push(VariableUse {
                key,
                variable: variable.to_owned(),
            });
        }
    };
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        if skip.contains(&key) {
            continue;
        }
        add(key.to_owned(), child.scalar_str(src));
        for inner in child.children() {
            if let Some(inner_key) = inner.key_str(src) {
                add(format!("{key}.{inner_key}"), inner.scalar_str(src));
            }
        }
    }
    out
}
