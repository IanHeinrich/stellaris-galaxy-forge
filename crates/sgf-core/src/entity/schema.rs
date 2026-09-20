//! What the Data tab knows about a kind's keys: label, control and reference.
//!
//! The schema decides how a key is drawn, never which keys appear: a key with no entry
//! renders raw and read-only, so a modded save hides nothing. It lives in core because
//! Tier 1 validation and the paths a `SetScalar` may name come from the same table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::entity::views::EntityKind;
use crate::keys;

/// A kind's known keys, in the order the Data tab prefers when it sorts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EntitySchema {
    pub kind: EntityKind,
    pub fields: Vec<FieldSchema>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FieldSchema {
    pub key: String,
    pub label: String,
    pub ty: FieldType,
    /// No field is editable in v1; Tier 1 flips this per key.
    pub editable: bool,
    /// The game recomputes this: the UI shows a lock and says so.
    pub derived: bool,
    /// The kind this key's id drills to.
    pub reference: Option<EntityKind>,
    /// The game-data vocabulary an enum draws from: `planet_class`, `star_class`.
    pub enum_source: Option<String>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FieldType {
    Number,
    Text,
    Bool,
    Date,
    Enum,
    Reference,
    List,
    Block,
}

/// The schema for `kind`; kinds with no table yet come back empty, which the Data tab
/// renders raw.
pub(crate) fn of(kind: EntityKind) -> EntitySchema {
    let fields = match kind {
        EntityKind::System => SYSTEM,
        EntityKind::Planet => PLANET,
        EntityKind::Fleet => FLEET,
        EntityKind::Starbase => STARBASE,
        EntityKind::Megastructure => MEGASTRUCTURE,
        _ => &[],
    };
    EntitySchema {
        kind,
        fields: fields.iter().map(Field::schema).collect(),
    }
}

/// One row of a kind's table, written as a const so a typo is a compile error.
struct Field {
    key: &'static str,
    label: &'static str,
    ty: FieldType,
    derived: bool,
    reference: Option<EntityKind>,
    enum_source: Option<&'static str>,
    unit: Option<&'static str>,
}

impl Field {
    const fn new(key: &'static str, label: &'static str, ty: FieldType) -> Self {
        Self {
            key,
            label,
            ty,
            derived: false,
            reference: None,
            enum_source: None,
            unit: None,
        }
    }

    const fn refers(mut self, kind: EntityKind) -> Self {
        self.reference = Some(kind);
        self
    }

    const fn vocabulary(mut self, source: &'static str) -> Self {
        self.enum_source = Some(source);
        self
    }

    const fn units(mut self, unit: &'static str) -> Self {
        self.unit = Some(unit);
        self
    }

    /// The game recomputes this value; editing it would be overwritten.
    const fn computed(mut self) -> Self {
        self.derived = true;
        self
    }

    fn schema(&self) -> FieldSchema {
        FieldSchema {
            key: self.key.to_owned(),
            label: self.label.to_owned(),
            ty: self.ty,
            editable: false,
            derived: self.derived,
            reference: self.reference,
            enum_source: self.enum_source.map(str::to_owned),
            unit: self.unit.map(str::to_owned),
        }
    }
}

const fn number(key: &'static str, label: &'static str) -> Field {
    Field::new(key, label, FieldType::Number)
}

const fn text(key: &'static str, label: &'static str) -> Field {
    Field::new(key, label, FieldType::Text)
}

const fn date(key: &'static str, label: &'static str) -> Field {
    Field::new(key, label, FieldType::Date)
}

const fn enumeration(key: &'static str, label: &'static str, source: &'static str) -> Field {
    Field::new(key, label, FieldType::Enum).vocabulary(source)
}

const fn reference(key: &'static str, label: &'static str, kind: EntityKind) -> Field {
    Field::new(key, label, FieldType::Reference).refers(kind)
}

const fn list(key: &'static str, label: &'static str) -> Field {
    Field::new(key, label, FieldType::List)
}

const fn block(key: &'static str, label: &'static str) -> Field {
    Field::new(key, label, FieldType::Block)
}

const SYSTEM: &[Field] = &[
    block(keys::NAME, "Name"),
    block(keys::COORDINATE, "Position"),
    enumeration(keys::STAR_CLASS, "Star class", "star_class"),
    enumeration(keys::INITIALIZER, "Initializer", "initializer"),
    reference(keys::PLANET, "Primary body", EntityKind::Planet),
    reference(keys::INIT_PARENT, "Initialised from", EntityKind::System),
    reference(keys::SECTOR, "Sector", EntityKind::Sector),
    list(keys::HYPERLANE, "Hyperlanes"),
    list(keys::STARBASES, "Starbases").refers(EntityKind::Starbase),
    list(keys::MEGASTRUCTURES, "Megastructures").refers(EntityKind::Megastructure),
    list(keys::FLEET_PRESENCE, "Fleets present").refers(EntityKind::Fleet),
    list(keys::AMBIENT_OBJECT, "Ambient objects"),
    block(keys::FLAGS, "Flags"),
    number(keys::INNER_RADIUS, "Inner radius"),
    number(keys::OUTER_RADIUS, "Outer radius"),
    number(keys::INDEX, "Index").computed(),
    number(keys::STORM, "Storm").computed(),
];

const PLANET: &[Field] = &[
    block(keys::NAME, "Name"),
    enumeration(keys::PLANET_CLASS, "Class", "planet_class"),
    number(keys::PLANET_SIZE, "Size"),
    block(keys::COORDINATE, "Position"),
    number(keys::ORBIT, "Orbit"),
    reference(keys::OWNER, "Owner", EntityKind::Country),
    reference(keys::CONTROLLER, "Controller", EntityKind::Country),
    reference(keys::COLONY, "Colony", EntityKind::Colony),
    reference(keys::MOON_OF, "Moon of", EntityKind::Planet),
    reference(keys::SURVEYED_BY, "Surveyed by", EntityKind::Country),
    reference(
        keys::SHIPCLASS_ORBITAL_STATION,
        "Orbital station",
        EntityKind::Ship,
    ),
    date(keys::COLONIZE_DATE, "Colonised"),
    date(keys::LAST_BOMBARDMENT, "Last bombardment").computed(),
    list(keys::DEPOSITS, "Deposits").refers(EntityKind::Deposit),
    list(keys::PLANET_ORBITALS, "Orbitals"),
    block(keys::TIMED_MODIFIER, "Timed modifier"),
    block(keys::FLAGS, "Flags"),
    number(keys::BUILD_QUEUE, "Build queue").computed(),
    number(keys::ENTITY, "Entity").computed(),
];

const FLEET: &[Field] = &[
    block(keys::NAME, "Name"),
    list(keys::SHIPS, "Ships").refers(EntityKind::Ship),
    enumeration(keys::SHIP_CLASS, "Ship class", "ship_size"),
    number(keys::MILITARY_POWER, "Military power").computed(),
    number(keys::HIT_POINTS, "Hit points").computed(),
    text(keys::FLEET_STANCE, "Stance"),
    text(keys::GROUND_SUPPORT_STANCE, "Ground support"),
    block(keys::CURRENT_ORDER, "Order"),
    block(keys::MIA_FROM, "Missing in action from"),
    block(keys::COMBAT, "Combat"),
    block(keys::MOVEMENT_MANAGER, "Movement"),
    number(keys::CACHED_DISABLED_SHIPS, "Disabled ships").computed(),
    block(keys::FLAGS, "Flags"),
];

const STARBASE: &[Field] = &[
    enumeration(keys::LEVEL, "Level", "starbase_level"),
    enumeration(keys::TYPE, "Type", "starbase_type"),
    reference(keys::STATION, "Station", EntityKind::Ship),
    reference(keys::OWNER, "Owner", EntityKind::Country),
    block(keys::MODULES, "Modules"),
    block(keys::BUILDINGS, "Buildings"),
    block(keys::ORBITALS, "Orbitals"),
    block(keys::SHIP_DESIGN_IMPLEMENTATION, "Design"),
    text(keys::CONSTRUCTION_TYPE, "Construction"),
    number(keys::BUILD_QUEUE, "Build queue").computed(),
    number(keys::SHIPYARD_BUILD_QUEUE, "Shipyard queue").computed(),
];

const MEGASTRUCTURE: &[Field] = &[
    enumeration(keys::TYPE, "Type", "megastructure"),
    block(keys::COORDINATE, "Position"),
    reference(keys::OWNER, "Owner", EntityKind::Country),
    reference(keys::PLANET, "Orbits", EntityKind::Planet),
    number(keys::BYPASS, "Bypass"),
    block(keys::ORBITALS, "Orbitals"),
    number(keys::DISMANTLE_PROGRESS, "Dismantle progress")
        .computed()
        .units("%"),
    date(keys::DISMANTLE_FINISH_DATE, "Dismantled on").computed(),
    number(keys::BUILD_QUEUE, "Build queue").computed(),
];
