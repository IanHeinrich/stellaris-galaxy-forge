//! IPC view types for one entity: what the inspector's Contents, Data and Source tabs read.
//!
//! Each type derives `TS`; `cargo test -p sgf-core` writes the TypeScript declarations to
//! `app/src/generated/`, exactly as `crate::views` does.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::name::NameTemplate;

/// An entity kind the address table knows how to reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    System,
    Planet,
    Colony,
    Fleet,
    Ship,
    Starbase,
    Megastructure,
    Country,
    PopGroup,
    Sector,
    Deposit,
}

impl EntityKind {
    /// Every kind, in address-table order.
    pub const ALL: [Self; 11] = [
        Self::System,
        Self::Planet,
        Self::Colony,
        Self::Fleet,
        Self::Ship,
        Self::Starbase,
        Self::Megastructure,
        Self::Country,
        Self::PopGroup,
        Self::Sector,
        Self::Deposit,
    ];

    /// The wire name, as `serde` writes it.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Planet => "planet",
            Self::Colony => "colony",
            Self::Fleet => "fleet",
            Self::Ship => "ship",
            Self::Starbase => "starbase",
            Self::Megastructure => "megastructure",
            Self::Country => "country",
            Self::PopGroup => "pop_group",
            Self::Sector => "sector",
            Self::Deposit => "deposit",
        }
    }
}

impl std::fmt::Display for EntityKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What a drill names: a kind and the entity's own id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EntityAddr {
    pub kind: EntityKind,
    pub id: u32,
}

impl EntityAddr {
    pub const fn new(kind: EntityKind, id: u32) -> Self {
        Self { kind, id }
    }
}

impl std::fmt::Display for EntityAddr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.kind, self.id)
    }
}

/// One level of one entity: the children at `path`, never the whole tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EntityView {
    pub addr: EntityAddr,
    /// Keys from the entity's root to what `nodes` holds; empty at the root.
    pub path: Vec<String>,
    /// The entity's `name=`, when it has one.
    pub name: Option<NameTemplate>,
    /// The no-game-data stand-in: the name's stand-in, or `planet #42`.
    pub label: String,
    /// The entity statement in the ORIGINAL bytes; both ends equal for inserted text.
    pub span: [usize; 2],
    /// The statement has an overlay slot: an op rewrote it.
    pub dirty: bool,
    /// Length of the entity's current bytes.
    pub bytes: u32,
    /// The children at `path`, in save order, duplicates kept. A child block of eight
    /// children or fewer also contributes its own scalars, so `coordinate` reads in place.
    pub nodes: Vec<EntityNode>,
    pub overview: Vec<Fact>,
    pub contents: Vec<ContentsRow>,
}

/// One statement inside an entity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EntityNode {
    /// `None` for a list item or an anonymous block.
    pub key: Option<String>,
    /// From the entity's root. A repeated key carries its 1-based ordinal
    /// (`["planet", "2"]`); a keyless child carries its index (`["ships", "#3"]`).
    pub path: Vec<String>,
    pub value: NodeValue,
    /// The statement's span in the entity's CURRENT bytes, from the statement start.
    pub span: [usize; 2],
    /// The bytes differ from the original entity's node at the same path; a node whose
    /// descendants changed is marked too. Always `false` while the entity is clean.
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum NodeValue {
    Scalar {
        text: String,
        form: ScalarForm,
    },
    /// A block whose every child is keyless: `{ 54 55 56 }`.
    List {
        count: u32,
    },
    Block {
        count: u32,
    },
}

/// How the save wrote a scalar, so the UI picks a control with no schema entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScalarForm {
    Int,
    Decimal,
    Bool,
    Date,
    Quoted,
    Ident,
    /// The game's null reference (`4294967295`) or `none`.
    Null,
    /// `key=` with no value before `}`.
    Empty,
}

/// One curated Overview row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Fact {
    pub label: String,
    pub value: String,
    /// A `GFX_` key for the texture cache.
    pub icon: Option<String>,
    /// The entity this fact drills to.
    pub link: Option<EntityAddr>,
    /// The node it was read from, so the row can carry that node's badge.
    pub path: Option<Vec<String>>,
}

/// One Contents row: a child entity, or a node list inside this entity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ContentsRow {
    pub label: String,
    pub count: u32,
    /// A single child entity.
    pub link: Option<EntityAddr>,
    /// A node list inside this entity.
    pub path: Option<Vec<String>>,
    /// What the rows behind this one drill to.
    pub of: Option<EntityKind>,
}

/// The entity's current bytes, for the read-only Source tab.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EntitySource {
    pub addr: EntityAddr,
    pub text: String,
    /// Ranges into `text` that differ from the original bytes, line-aligned and
    /// ascending; empty while the entity is clean.
    pub changed: Vec<[usize; 2]>,
    /// `text` is the first mebibyte only.
    pub truncated: bool,
}

/// A save body's own Overview: a planet, moon, star or asteroid and its resources, as the
/// save's keys and ids, which the app joins with game data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetPage {
    pub id: u32,
    pub name: NameTemplate,
    pub name_key: String,
    /// The no-game-data stand-in, as [`EntityView::label`].
    pub label: String,
    pub class: String,
    pub size: Option<u32>,
    /// `orbit`: the radius around the body it orbits.
    pub orbit: Option<f64>,
    /// `coordinate.origin`.
    pub system: Option<u32>,
    /// `moon_of`, or else the system's primary body when this body is not it.
    pub parent: Option<u32>,
    pub moons: Vec<PlanetPageMoon>,
    /// One entry per deposit, in save order.
    pub deposits: Vec<PlanetPageDeposit>,
    /// `planet_modifier`, in save order.
    pub planet_modifiers: Vec<String>,
    pub timed_modifiers: Vec<PlanetPageTimedModifier>,
    pub surveyed_by: Option<u32>,
    /// `shipclass_orbital_station`: the mining or research station's fleet.
    pub station: Option<u32>,
    pub owner: Option<u32>,
    pub controller: Option<u32>,
    pub colony: Option<PlanetPageColony>,
    /// Entries in `flags`.
    pub flags: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetPageMoon {
    pub id: u32,
    pub name: NameTemplate,
    pub name_key: String,
    pub class: String,
    pub size: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetPageDeposit {
    pub id: u32,
    /// The deposit's `type`.
    pub kind: String,
    /// The feature clearing this blocker reveals.
    pub swap_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetPageTimedModifier {
    pub modifier: String,
    /// Days left; `-1` is permanent.
    pub days: i32,
}

/// What the planet's `colony` entity says about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetPageColony {
    pub id: u32,
    /// The planet's `colonize_date`.
    pub colonised: Option<String>,
    pub final_designation: Option<String>,
    /// Set only when the player chose a designation by hand.
    pub designation: Option<String>,
    /// `num_sapient_pops`.
    pub pops: u32,
    /// `species_information`, in save order.
    pub species: Vec<PlanetPageSpecies>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetPageSpecies {
    pub id: u32,
    /// The `species_db` entry's `name`, empty when the save has no such species.
    pub name: NameTemplate,
    pub pops: u32,
}
