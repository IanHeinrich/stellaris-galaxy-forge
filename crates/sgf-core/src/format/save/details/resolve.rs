//! What the UI shows: the raw details with deposits summed per resource and planet
//! classes judged habitable by a [`DetailsResolver`].

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::as_u32;
use crate::format::save::details::{
    ArchaeologySite, BodyRole, FleetSummary, MegastructureSummary, RawPlanet, RawSystemDetails,
    WormholeSummary,
};
use crate::format::save::system_spec::BeltSpec;
use crate::projections::geometry;
use crate::projections::name::NameTemplate;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FleetPresence {
    /// Every fleet in the system's `fleet_presence`, stations included.
    pub fleet_count: u32,
    /// Fleets whose `ship_class` is `shipclass_military` or `shipclass_military_special`.
    pub military_count: u32,
    /// Ships in those fleets.
    pub ship_count: u32,
    /// Summed `military_power` of those fleets.
    pub military_power: f64,
}

impl FleetPresence {
    fn of(fleets: &[FleetSummary]) -> Self {
        let mut presence = Self {
            fleet_count: as_u32(fleets.len()),
            ..Self::default()
        };
        for fleet in fleets.iter().filter(|f| f.military) {
            presence.military_count += 1;
            presence.ship_count += fleet.ships;
            presence.military_power += fleet.military_power;
        }
        presence
    }
}

/// Turns save keys into what the UI shows. The heuristic implementation reads the key
/// itself; a game-data implementation reads the install's definitions.
pub trait DetailsResolver {
    /// What one deposit of this kind yields, as `(resource, amount)` pairs. `None` means
    /// the key is not an orbital deposit (a planetary feature or blocker) and is skipped.
    fn deposit_produces(&self, key: &str) -> Option<Vec<(String, f64)>>;
    /// Whether a planet class is habitable; `None` when unknown.
    fn planet_habitable(&self, class: &str) -> Option<bool>;
}

/// `d_<resource>_<n>` yields `n` of `<resource>`; keys without a numeric suffix are the
/// game's planetary features and blockers, never orbital deposits, and are skipped.
pub struct HeuristicResolver;

impl DetailsResolver for HeuristicResolver {
    fn deposit_produces(&self, key: &str) -> Option<Vec<(String, f64)>> {
        let resource = key.strip_prefix("d_").unwrap_or(key);
        let (resource, amount) = resource.rsplit_once('_')?;
        if amount.is_empty() || !amount.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(vec![(resource.to_owned(), amount.parse().unwrap_or(0.0))])
    }

    fn planet_habitable(&self, _class: &str) -> Option<bool> {
        None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemDetails {
    pub id: u32,
    pub resources: Vec<ResourceAmount>,
    pub planets: Vec<PlanetSummary>,
    pub starbase: Option<StarbaseSummary>,
    pub fleets: FleetPresence,
    /// In file order.
    pub fleets_present: Vec<FleetSummary>,
    pub megastructures: Vec<MegastructureSummary>,
    pub sites: Vec<ArchaeologySite>,
    pub with_game_data: bool,
    /// The system's `asteroid_belts`, in order.
    pub belts: Vec<BeltSpec>,
    /// A save's `inner_radius`; `None` in a scenario.
    pub inner_radius: Option<f64>,
    /// A save's natural wormholes and shroud tunnels, in file order; empty in a scenario.
    pub wormholes: Vec<WormholeSummary>,
    /// What only a scenario system's initializer says of the system. `None` in a save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub spawn: Option<SystemSpawn>,
}

/// What a scenario system's initializer says of the system beyond a save's fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemSpawn {
    /// How the game decides the system's star class.
    pub star: SpawnStar,
    /// The fewest and the most planets the initializer can spawn, its stars, moons and
    /// asteroids aside. `None` when an `inline_script` the install has no text for places
    /// bodies, so the game's count cannot be told.
    pub planets: Option<CountRange>,
    /// The fewest and the most moons, asteroids aside; `None` as for `planets`.
    pub moons: Option<CountRange>,
    /// The fewest and the most bodies of an asteroid class, or drawn as one; `None` as for
    /// `planets`.
    pub asteroids: Option<CountRange>,
    /// The `inline_script` that gives the system its star class and every body, by its
    /// `script`.
    pub from_script: Option<String>,
    /// The system's `flags`, then each `set_star_flag` its `init_effect` runs unconditionally.
    pub flags: Vec<String>,
    /// `namelist`: the star name list the system's name is drawn from.
    pub namelist: Option<String>,
    /// `prevent_anomalies = yes`: no generic anomaly appears on its bodies when surveyed.
    pub prevent_anomalies: bool,
    /// `primitive_system = yes`.
    pub primitive_system: bool,
    /// `inner_radius_offset`, as written. No game file says how the game applies it.
    pub inner_radius_offset: Option<f64>,
    /// `outer_radius_offset`, as written. No game file says how the game applies it.
    pub outer_radius_offset: Option<f64>,
    /// Each `create_archaeological_site` written directly in the system's own `init_effect`,
    /// on no body.
    pub sites: Vec<String>,
    /// Each `create_ambient_object` the system's and its bodies' `init_effect`s run.
    pub ambient_objects: Vec<AmbientObject>,
    /// How a random galaxy places the initializer: kept as written, whatever a placed
    /// system makes of them.
    pub usage: Option<String>,
    /// `usage_odds`: the weight a random galaxy draws the initializer with for its `usage`.
    pub usage_odds: Option<UsageOdds>,
    /// `spawn_chance`, `@variable`s resolved.
    pub spawn_chance: Option<f64>,
    /// `scaled_spawn_chance`, `@variable`s resolved.
    pub scaled_spawn_chance: Option<f64>,
    /// `max_instances`: the most systems a random galaxy makes from the initializer.
    pub max_instances: Option<u32>,
    /// Each `neighbor_system` block.
    pub neighbors: Vec<NeighborSystem>,
    /// Every statement of the block this reader does not model, as written.
    pub other_keys: Vec<RawStatement>,
    /// Each statement of the system's `init_effect` this reader does not model, as written.
    pub script: Vec<RawStatement>,
    /// Each `inline_script` read in place of its call.
    pub inline_scripts: Vec<InlineScriptUse>,
    /// Each value of the block written as an `@variable`.
    pub variables: Vec<VariableUse>,
    /// The `inner_radius` the game derives from the bodies it places, at fewest and most:
    /// the fewest from the bodies certain to spawn at their nearest, the most from every body
    /// that can spawn at its furthest. `min == max` when every body is fixed. The radius
    /// offsets are not applied. `None` when an `inline_script` the install has no text for
    /// places bodies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inner_radius: Option<Bounds>,
    /// The `radius` of each of the details' `belts`, in order, as written: a range when the
    /// game draws it, which the details' belt shows at its midpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub belt_radii: Option<Vec<Bounds>>,
}

/// A system's star class: fixed, drawn from a star list, or not one the install defines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SpawnStar {
    /// `class = sc_…`.
    Fixed { class: String },
    /// `class = rl_…`: the game draws one of `members` when it generates the galaxy.
    Rolled {
        list: String,
        members: Vec<ListMember>,
    },
    /// The initializer names no star class or list the install defines; `None` when it
    /// names none at all.
    Unknown { written: Option<String> },
}

/// The fewest and the most of something a draw can give, both included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CountRange {
    /// The fewest, included.
    pub min: u32,
    /// The most, included.
    pub max: u32,
}

/// One entry of an `rl_` list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ListMember {
    pub key: String,
    /// A star class's `spawn_odds`. `None` for a planet list, whose file gives no weights,
    /// and for a star class the install does not define.
    pub weight: Option<f64>,
}

/// A `create_ambient_object`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AmbientObject {
    /// Its `type`.
    pub kind: String,
    /// The body whose `init_effect` creates it; `None` for the system's own.
    pub body: Option<u32>,
}

/// An initializer's `usage_odds`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum UsageOdds {
    Number {
        value: f64,
    },
    /// A scalar that is neither a number nor an `@variable` the install defines, as written.
    Unknown {
        written: String,
    },
    /// A block of conditions, as written, with the `base` it writes.
    Script {
        text: String,
        base: Option<f64>,
    },
}

/// A `neighbor_system` block: the initializer it places and how far away.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeighborSystem {
    pub initializer: String,
    /// `distance`.
    pub distance: Option<Bounds>,
    /// `hyperlane_jumps`.
    pub hyperlane_jumps: Option<Bounds>,
}

/// A statement as the file writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RawStatement {
    pub key: String,
    /// The whole statement, key included.
    pub text: String,
    /// The statements inside it that this reader models where they are written
    /// unconditionally, such as an `add_deposit` under an `if`.
    pub modelled: u32,
}

/// An `inline_script` whose text was read in place of the call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InlineScriptUse {
    /// Its `script`, the path under `common/inline_scripts` without `.txt`.
    pub script: String,
    /// The keys its text writes at the top level, in order, each once.
    pub keys: Vec<String>,
}

/// A value written as an `@variable`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VariableUse {
    /// The key it is the value of, its block's key before a dot when it is a bound
    /// (`size.min`).
    pub key: String,
    /// As written, `@` included.
    pub variable: String,
}

/// What a scenario body's initializer says of it beyond a save's fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BodySpawn {
    /// `false` when the game may not spawn the body: a copy past the low end of its block's
    /// ranged `count`, or a body around one.
    pub always: bool,
    /// Which copy of its block it is, from 1.
    pub copy: u32,
    /// How many copies its block spawns.
    pub count: CountRange,
    /// How the game decides the body's class.
    pub class: SpawnClass,
    /// The class an unconditional `change_pc` gives the body once it spawns.
    pub changed_class: Option<String>,
    /// The size an unconditional `set_planet_size` gives the body once it spawns.
    pub changed_size: Option<u32>,
    /// The deposit statements its `init_effect` runs unconditionally, in order.
    pub deposits: Vec<DepositStep>,
    /// `deposit_blockers = none`: the body rolls no blockers.
    pub no_blockers: bool,
    /// The planet features the block and its `init_effect` state.
    pub features: StatedFeatures,
    /// The anomalies the block and its `init_effect` state, and what prevents others.
    pub anomalies: StatedAnomalies,
    /// The model it is drawn as: an unconditional `set_planet_entity`'s, else `entity`.
    pub entity: Option<String>,
    /// The name an unconditional `set_name` gives it.
    pub name: Option<String>,
    /// The block's `flags`, then each `set_planet_flag` and `set_star_flag` its
    /// `init_effect` runs unconditionally.
    pub flags: Vec<String>,
    /// `starting_planet = yes`: a planet an empire can start on.
    pub starting_planet: bool,
    /// `home_planet = yes`: the home planet of whoever is placed in the system.
    pub home_planet: bool,
    /// Every statement of the block this reader does not model, as written.
    pub other_keys: Vec<RawStatement>,
    /// Each statement of its `init_effect` this reader does not model, as written.
    pub script: Vec<RawStatement>,
    /// The `inline_script` its block was read from, by its `script`.
    pub from_script: Option<String>,
    /// Each value of the block written as an `@variable`.
    pub variables: Vec<VariableUse>,
    /// Whether a class the game can draw for it fits the orbit it lands at, and so whether it
    /// spawns. `None` when neither its class nor that of a body it orbits is drawn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub orbit_fit: Option<OrbitFit>,
    /// Whether it has a ring: fixed by `has_ring`, or rolled on its class's `chance_of_ring`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ring: Option<SpawnRing>,
    /// The deposits its own roll can give it, beside those its `init_effect` states.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rolled_deposits: Option<SpawnPool>,
    /// The planet features (`pm_*`) its own roll can give it, beside those its block states.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rolled_features: Option<SpawnPool>,
    /// The name the game gives it. `None` for a body the game never spawns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub naming: Option<SpawnName>,
}

/// Whether the game can draw a body a class at the orbits it can land at. A draw that no class
/// fits gives no body, and no body around it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum OrbitFit {
    /// A class fits at every orbit it can land at, around every star the system can draw.
    Always,
    /// At some orbits, or around some stars, no class fits: the game may not spawn it.
    Sometimes,
    /// No class fits at any orbit it can land at: the game never spawns it.
    Never,
    /// The system's star class is not one the install defines, so what fits cannot be told.
    Unknown,
}

/// A body's ring.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SpawnRing {
    /// `has_ring`, or a body that never has one: a star, a moon, or a class with no
    /// `chance_of_ring`.
    Fixed { ring: bool },
    /// Rolled when the body spawns. `chance`, 0 to 1, is its class's `chance_of_ring`, or for a
    /// drawn class the chance over the classes the draw gives; `None` when that varies with the
    /// orbit it lands at or the star the system draws.
    Rolled { chance: Option<f64> },
    /// Its class cannot be told before the game starts.
    Unknown,
}

/// What a body's own roll can give it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SpawnPool {
    /// It rolls none: its block blocks the roll, or its `init_effect` clears what it rolls.
    Fixed,
    /// Each thing the roll can draw, in the install's order.
    Rolled { entries: Vec<PoolEntry> },
    /// Its class cannot be told before the game starts, so nor can what it rolls.
    Unknown,
}

/// One thing a body's roll can draw.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PoolEntry {
    pub key: String,
    /// The chance, 0 to 1, that one draw gives it. For a deposit, among the draws that give
    /// one, whatever the galaxy's Resource Abundance; for a planet feature, the body's first
    /// draw. `None` when it varies with the class, size or surroundings the game draws.
    pub chance: Option<f64>,
}

/// The name the game gives a body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SpawnName {
    /// The block's `name`, or the name an unconditional `set_name` gives it, which wins.
    Fixed { name: String },
    /// Named after its system or the body it orbits, as a save writes the name: the
    /// localisation key `format` (`STAR_NAME_1_OF_2`, `PLANET_NAME_FORMAT`,
    /// `SUBPLANET_NAME_FORMAT`) with `$NAME$` or `$PARENT$` the name of `parent`, or of the
    /// system when `parent` is `None`, and `$NUMERAL$` one of `numerals`: one when it is
    /// certain, several when bodies before it may not spawn, none for a star.
    Template {
        format: String,
        parent: Option<u32>,
        numerals: Vec<String>,
    },
    /// Drawn when the game generates the galaxy: an asteroid's, from the asteroid name lists.
    Unknown,
}

/// How the game decides a body's class.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SpawnClass {
    /// The block names the class, or the system's fixed star class gives a star its own.
    Fixed { class: String },
    /// The game draws it when it generates the galaxy.
    Rolled { pool: ClassPool },
    /// The game decides it at the start in a way the install cannot tell; `written` is the
    /// block's `class`.
    Unknown {
        written: String,
        reason: UnknownClass,
    },
}

/// What a rolled class is drawn from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ClassPool {
    /// `random`, `random_colonizable`, `random_non_colonizable` or `random_asteroid`: the
    /// engine's draw among the classes that fit the body's orbit.
    Random {
        draw: String,
        /// The classes the draw can give at some orbit the body can land at, around some star
        /// the system can draw; `None` when the system's star class is not one the install
        /// defines.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        at_orbit: Option<Vec<PoolClass>>,
    },
    /// A planet `rl_` list.
    PlanetList {
        list: String,
        members: Vec<ListMember>,
        /// Always `None`: whether the game holds a list's draw to the body's orbit, as it does
        /// a random draw, is unknown, so `members` lists every class the draw can give.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        at_orbit: Option<Vec<PoolClass>>,
    },
    /// A star whose system's class is drawn from the star list `list`.
    StarList { list: String },
}

/// A class a drawn body can be given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PoolClass {
    pub class: String,
    /// Its weight in the draw: its `spawn_odds` times the star class's factor for it. `None`
    /// for a planet list's member, the list being drawn evenly (assumed), and when the factor
    /// varies with the star the system draws.
    pub weight: Option<f64>,
}

/// Why a body's class cannot be told before the game starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum UnknownClass {
    /// `ideal_planet_class`, `ideal_design_class` or `random_non_ideal`: decided by the
    /// empire at the root of the initializer tree, which a placed system has none of.
    Ideal,
    /// A `change_pc` under a condition, a loop or a random choice.
    Script,
    /// No class or list of the install has the key, or the star's system names no star
    /// class the install defines.
    Undefined,
}

/// A deposit statement of a body's `init_effect`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DepositStep {
    Add {
        deposit: String,
    },
    /// `set_deposit`, with the deposit's own `category`.
    Set {
        deposit: String,
        category: Option<String>,
        replaces: DepositReplacement,
    },
    /// `clear_deposits`: every deposit, or those of one category.
    Clear {
        category: Option<String>,
    },
    AddBlocker {
        deposit: String,
    },
    ClearBlockers,
}

/// Which of a body's deposits a `set_deposit` replaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DepositReplacement {
    /// Every deposit.
    All,
    /// The deposits of its own category.
    Category,
    /// The install does not say: the game's effect list says only that it "replaces
    /// resource deposit on the scoped planet".
    Unknown,
}

/// The planet features an initializer states for a body.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatedFeatures {
    /// `modifier = pm_…`: the feature the block gives. That it is given beside the body's own
    /// roll, not in place of it, is assumed.
    pub modifier: Option<String>,
    /// `modifiers = none`: the body rolls no features.
    pub none: bool,
    /// An unconditional `clear_planet_modifiers`.
    pub cleared: bool,
    /// Each unconditional `add_modifier`, in order.
    pub added: Vec<AddedModifier>,
}

/// An `add_modifier`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AddedModifier {
    pub modifier: String,
    /// Its `days`, `-1` for one that never runs out; `None` when it states none.
    pub days: Option<f64>,
}

/// The anomalies an initializer states for a body.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatedAnomalies {
    /// The block's `anomaly`, then each unconditional `add_anomaly`'s category.
    pub categories: Vec<String>,
    /// What stops generic anomalies appearing on it when it is surveyed.
    pub prevented: Option<AnomalyPrevention>,
}

/// Where a body's generic anomalies are prevented.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AnomalyPrevention {
    /// An unconditional `prevent_anomaly` in its own `init_effect`.
    Body,
    /// The system's `prevent_anomalies`.
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceAmount {
    pub resource: String,
    pub amount: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetSummary {
    pub id: u32,
    pub class: String,
    pub name: NameTemplate,
    pub name_key: String,
    pub colonised: bool,
    pub capital: bool,
    pub habitable: Option<bool>,
    pub owner: Option<u32>,
    /// Orbits a planet: the role is [`BodyRole::Moon`].
    pub moon: bool,
    pub role: BodyRole,
    /// Owned by a `primitive` country.
    pub pre_ftl: bool,
    /// `planet_size`, the game's tile count. `None` for a scenario body whose size is a
    /// range, which its `layout` holds.
    pub size: Option<u32>,
    /// `orbit`: the radius around the star, or around the planet a moon orbits. `None`
    /// for a scenario's bodies, which the game places at generation.
    pub orbit: Option<f64>,
    /// The planet's own deposits summed per resource; the system's `resources` are the
    /// sum of these rows.
    pub deposits: Vec<ResourceAmount>,
    /// The same deposits as the save's own `deposit` keys with counts, beside the summed
    /// amounts: a feature or a blocker yields no resource but is still on the planet.
    pub deposit_keys: Vec<DepositCount>,
    pub pops: u32,
    /// The save's `moon_of`, kept even when that body is missing; in a scenario, the
    /// synthetic id of the body the moon was expanded under. A body with no parent orbits
    /// the system's centre.
    pub parent: Option<u32>,
    pub layout: Option<BodyLayout>,
    /// A save's ring bit in `binary_flags`; a scenario's `has_ring`, `None` when the
    /// initializer leaves it to the class's `chance_of_ring`.
    pub ring: Option<bool>,
    /// The star class a star body is drawn as: the one whose only star is its class, else
    /// its system's. `None` for any other body, and without game data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub star_class: Option<String>,
    /// The game draws the body's class: a random class, a planet list, or another key the
    /// install defines no planet class for, such as `ideal_planet_class`. `false` in a save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub drawn: Option<bool>,
    /// The modifier names of the planet's permanent `timed_modifier` items (`days = -1`):
    /// the shape a terraforming candidate modifier is written in, whatever the planet's
    /// class now says. `None` for a scenario's bodies, which carry no save-persisted
    /// modifiers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub permanent_modifiers: Option<Vec<String>>,
    /// The category of the anomaly the planet holds, its `anomaly`, which is also its
    /// localisation key. `None` for a planet with none, and for a scenario's bodies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub anomaly: Option<String>,
    /// A save's `entity_name`: the model the planet is drawn as, in place of its class's.
    /// `None` for a planet with none, and for a scenario's bodies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub entity_name: Option<String>,
    /// What only a scenario body's initializer says of it. `None` in a save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub spawn: Option<BodySpawn>,
}

/// A number an initializer may leave to a draw: `min == max` when it is fixed,
/// and always in a save.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bounds {
    pub min: f64,
    pub max: f64,
}

impl Bounds {
    /// A number with no range to draw from.
    pub fn fixed(value: f64) -> Self {
        Self {
            min: value,
            max: value,
        }
    }
}

/// Where the scene draws a body. Not `BodySpec`, which is what the add-system
/// writer emits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BodyLayout {
    /// The drawn radius about the parent, or about the system's centre without
    /// one. `None` for a save body with neither an orbit nor a point. A scenario
    /// body with no distance lies 10 to 20 past the running orbit.
    pub orbit: Option<Bounds>,
    /// A save's `coordinate` x/y, system-relative. `None` in a scenario.
    pub at: Option<(f64, f64)>,
    /// `planet_size`: fixed in a save, the initializer's `size` in a scenario.
    pub size: Option<Bounds>,
    /// How far out from the running orbit an initializer steps it: its `orbit_distance`, or
    /// 10 to 20 without one. `None` in a save.
    pub orbit_step: Option<Bounds>,
    /// Its `orbit_angle`, the turn on from the angle of `turns_from`. `None` in a save, and
    /// when an initializer names no angle.
    pub angle_step: Option<Bounds>,
    /// The body before it in its initializer's walk, whose angle it turns on from. `None`
    /// for the first of a walk, which turns from the walk's start of 180°, and in a save.
    pub turns_from: Option<u32>,
}

/// One `deposit` key and how many of it the planet holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositCount {
    pub key: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarbaseSummary {
    pub id: u32,
    pub level: String,
    /// The entry's `type` key: `starbase_outpost`, `swaystation_research` …; empty when
    /// the entry names none, as a scenario's synthesised starbase does.
    pub kind: String,
    pub name: NameTemplate,
    pub name_key: String,
    pub owner: Option<u32>,
    /// Module and building keys in save order.
    pub modules: Vec<String>,
    pub buildings: Vec<String>,
    /// A `shipyard` module: the starbase can build ships.
    pub shipyard: bool,
    /// The `station` ship's hull; both are zero when the entry names no station.
    pub hull: f64,
    pub max_hull: f64,
}

/// The ship sizes of the stations that gather what a planet's deposits produce.
const GATHERING_STATIONS: [&str; 2] = ["mining_station", "research_station"];

/// Whether `fleet` is a mining or research station. A planet's `shipclass_orbital_station`
/// can outlive its station and name a fleet that has since taken the id.
fn gathers(fleet: &FleetSummary) -> bool {
    fleet
        .ship_sizes
        .first()
        .is_some_and(|size| GATHERING_STATIONS.contains(&size.key.as_str()))
}

/// One system's raw details with each planet's deposits summed into resources by
/// `resolver`, the system's resources the sum of those rows, and each station fleet's
/// `works` the resources of the planet it works.
pub(super) fn resolve(
    id: u32,
    raw: &RawSystemDetails,
    resolver: &dyn DetailsResolver,
    with_game_data: bool,
) -> SystemDetails {
    let mut resources: Vec<ResourceAmount> = Vec::new();
    let mut planets = Vec::with_capacity(raw.planets.len());
    let mut works: HashMap<u32, Vec<String>> = HashMap::new();
    let points = points(&raw.planets);
    for p in &raw.planets {
        let mut deposits: Vec<ResourceAmount> = Vec::new();
        for (key, count) in &p.deposits {
            let Some(produces) = resolver.deposit_produces(key) else {
                continue;
            };
            for (resource, amount) in produces {
                add_amount(&mut deposits, resource, amount * f64::from(*count));
            }
        }
        for row in &deposits {
            add_amount(&mut resources, row.resource.clone(), row.amount);
        }
        if let Some(station) = p.station {
            works.insert(
                station,
                deposits.iter().map(|r| r.resource.clone()).collect(),
            );
        }
        planets.push(PlanetSummary {
            id: p.id,
            class: p.class.clone(),
            name: p.name.clone(),
            name_key: p.name_key.clone(),
            colonised: p.colonised,
            capital: p.capital,
            habitable: resolver.planet_habitable(&p.class),
            owner: p.owner,
            moon: p.moon,
            role: p.role,
            pre_ftl: p.pre_ftl,
            size: p.size,
            orbit: p.orbit,
            deposits,
            deposit_keys: p
                .deposits
                .iter()
                .map(|(key, count)| DepositCount {
                    key: key.clone(),
                    count: *count,
                })
                .collect(),
            pops: p.pops,
            parent: p.parent,
            layout: Some(layout(p, &points)),
            ring: Some(p.ring),
            star_class: None,
            drawn: Some(false),
            permanent_modifiers: Some(p.permanent_modifiers.clone()),
            anomaly: p.anomaly.clone(),
            entity_name: p.entity_name.clone(),
            spawn: None,
        });
    }
    let starbase = raw.starbases.first().map(|s| StarbaseSummary {
        id: s.id,
        level: s.level.clone(),
        kind: s.kind.clone(),
        name: s.name.clone(),
        name_key: s.name_key.clone(),
        owner: s.owner,
        shipyard: s.modules.iter().any(|m| m == "shipyard"),
        modules: s.modules.clone(),
        buildings: s.buildings.clone(),
        hull: s.hull,
        max_hull: s.max_hull,
    });
    SystemDetails {
        id,
        resources,
        planets,
        starbase,
        fleets: FleetPresence::of(&raw.fleets),
        fleets_present: raw
            .fleets
            .iter()
            .map(|f| FleetSummary {
                works: if gathers(f) {
                    works.remove(&f.id).unwrap_or_default()
                } else {
                    Vec::new()
                },
                ..f.clone()
            })
            .collect(),
        megastructures: raw.megastructures.clone(),
        sites: raw.sites.clone(),
        with_game_data,
        belts: raw.belts.clone(),
        inner_radius: raw.inner_radius,
        wormholes: raw.wormholes.clone(),
        spawn: None,
    }
}

/// Where each of a system's bodies stands, by id.
fn points(planets: &[RawPlanet]) -> HashMap<u32, (f64, f64)> {
    planets.iter().filter_map(|p| Some((p.id, p.at?))).collect()
}

/// A save body's exact point, its size and the radius it is drawn at.
fn layout(planet: &RawPlanet, points: &HashMap<u32, (f64, f64)>) -> BodyLayout {
    BodyLayout {
        orbit: drawn_radius(planet, points).map(Bounds::fixed),
        at: planet.at,
        size: planet.size.map(|size| Bounds::fixed(f64::from(size))),
        orbit_step: None,
        angle_step: None,
        turns_from: None,
    }
}

/// The radius the body is drawn at about its parent's point, or about the centre without
/// a parent (see [`geometry::drawn_radius`]). The stored `orbit` stands in when the body or
/// its parent has no point.
fn drawn_radius(planet: &RawPlanet, points: &HashMap<u32, (f64, f64)>) -> Option<f64> {
    let centre = match planet.parent {
        None => Some((0.0, 0.0)),
        Some(parent) => points.get(&parent).copied(),
    };
    let (Some(at), Some(centre)) = (planet.at, centre) else {
        return planet.orbit;
    };
    Some(geometry::drawn_radius(at, centre, planet.orbit))
}

/// Adds `amount` to the row for `resource`, appending one in first-seen order.
fn add_amount(rows: &mut Vec<ResourceAmount>, resource: String, amount: f64) {
    match rows.iter_mut().find(|r| r.resource == resource) {
        Some(row) => row.amount += amount,
        None => rows.push(ResourceAmount { resource, amount }),
    }
}
