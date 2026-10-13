//! The payloads ops take: the specs of what an add writes, the entries of the plural ops and
//! what an inverse carries back.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[cfg(doc)]
use crate::ops::Op;
use crate::projections::galaxy::SpawnScript;
use crate::projections::name::NameTemplate;
use crate::views::OrbitPlacement;

/// One star body's new planet class in [`Op::SetStarClass`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarBody {
    pub body: u32,
    pub class: String,
}

/// What the install says about one planet class, for [`Op::SetBodyClass`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetClassRule {
    pub class: String,
    pub change: ClassChange,
    /// How many models the install numbers for the class, `<model>_01_entity` on; 0 when
    /// it names none.
    pub models: u32,
}

/// Which planets a class may be given to, or taken from, in [`Op::SetBodyClass`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ClassChange {
    /// None: a star, a habitat, a ring world, an ark and the other classes the game builds
    /// or scripts its own way.
    Never,
    /// Any planet, a colony included: a class colonised with the standard district set.
    Any,
    /// A planet with no colony only.
    Uncolonised,
}

/// A save planet's model in [`Op::SetBodyClass`]: its `entity` index and the
/// `entity_name` it has in place of its class's own, each `None` where the planet has none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetLook {
    pub entity: Option<u32>,
    pub entity_name: Option<String>,
}

/// The body [`Op::AddBody`] writes, every value chosen by the caller.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewBody {
    /// `pc_desert`, `pc_gas_giant`, …
    pub class: String,
    pub size: u32,
    /// The planet a moon orbits; `None` for a planet of the system's centre.
    #[serde(default)]
    pub moon_of: Option<u32>,
    #[serde(default)]
    pub naming: BodyNaming,
    /// Deposit keys, `d_minerals_2`, …
    #[serde(default)]
    pub deposits: Vec<String>,
    /// Drawn with a ring around it. A moon is refused one.
    #[serde(default)]
    pub ring: bool,
    /// Which of the class's models the game draws; the first when `None`.
    #[serde(default)]
    pub entity: Option<u32>,
    /// The model the game draws in place of the class's own.
    #[serde(default)]
    pub entity_name: Option<String>,
    #[serde(default)]
    pub modifiers: Vec<NewModifier>,
    /// Only a planet of the system's centre has them.
    #[serde(default)]
    pub moons: Vec<NewMoon>,
}

/// The habitat [`Op::AddHabitat`] writes, as the install's habitat effect makes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewHabitat {
    /// `pc_habitat`, `HABITAT_PLANET_NAME`, orbiting the body it is added round.
    #[serde(flatten)]
    pub planet: NewPlanet,
    /// The variable of the name that the system's name fills in,
    /// `prev.solar_system.GetName`; `None` for a name with none.
    #[serde(default)]
    pub system_name: Option<String>,
    /// The orbital a restored Habitat Central Complex leaves round the same body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub orbital: Option<HabitatOrbital>,
    /// How the habitat's angle round the body is taken.
    pub placed: HabitatPlacement,
}

/// How [`Op::AddHabitat`] takes the angle of `NewHabitat::planet.at`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum HabitatPlacement {
    /// At the angle, as a habitat read back from the save stood.
    AtAngle,
    /// At the angle while no habitat orbits the body, as the install's habitat effect places
    /// one; else halfway across the widest gap between the habitats that do.
    AwayFromHabitats,
}

/// The finished `megastructures` row [`Op::AddHabitat`] writes round the habitat's body, as
/// the game's `spawn_orbital_effect` leaves one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitatOrbital {
    /// `habitat_major_orbital`.
    pub kind: String,
    /// The country that owns it, whose graphical culture it takes; `None` for none.
    #[serde(default)]
    pub owner: Option<u32>,
    /// The localisation key of its name, `TARGET_ORBITAL_NAME`; `None` for no name.
    #[serde(default)]
    pub name: Option<String>,
    /// The variable of the name that the system's name fills in, `prevprev.GetName`;
    /// `None` for a name with none.
    #[serde(default)]
    pub system_name: Option<String>,
}

/// The ring world [`Op::AddRingWorld`] writes, as the install's build chain lays one out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewRingWorld {
    /// Each quadrant in the order its row was spawned: A to D for the game's ring world.
    pub quadrants: Vec<RingQuadrant>,
    /// The system flags the chain leaves, in the order it sets them: `ring_world_built`, and
    /// `ring_section_1` to `ring_section_3` while some sections stand unfinished.
    pub system_flags: Vec<String>,
    /// The system variables the chain leaves: Gigastructural Engineering's count of finished
    /// sections, `ring_segments`.
    #[serde(default)]
    pub system_variables: Vec<RingVariable>,
    /// The planet flags the chain leaves on the star: `has_megastructure` under
    /// Gigastructural Engineering, none in the base game.
    #[serde(default)]
    pub star_flags: Vec<String>,
}

/// A system variable a [`NewRingWorld`] leaves, and its value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RingVariable {
    pub name: String,
    pub value: f64,
}

/// One section of a [`NewRingWorld`] at its stage, with what the install leaves there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "stage", rename_all = "snake_case")]
pub enum RingQuadrant {
    /// Built: its planets, tech, seam and habitable section.
    Finished { segments: Vec<RingSegment> },
    /// A ruin built again: its planets, laid out mirrored.
    Restored { segments: Vec<RingSegment> },
    /// Ruined as the game's `set_ruined_megastructure` ruins a section: its damaged planets.
    Damaged { segments: Vec<RingSegment> },
    /// A frame section waiting to be built: its row.
    Frame { row: RingRow },
    /// A ruined section: its row.
    Ruined { row: RingRow },
}

/// A planet of a [`RingQuadrant`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RingSegment {
    /// `pc_ringworld_habitable`, `NAME_Habitable_Section_A`, about the system's centre.
    #[serde(flatten)]
    pub planet: NewPlanet,
    /// It shows the ring's megastructure icon: `trigger_megastructure_icon = yes`.
    #[serde(default)]
    pub megastructure_icon: bool,
}

/// A planet a build effect spawns finished, as [`Op::AddHabitat`], [`Op::AddRingWorld`] and
/// [`Op::AddMegastructure`] write one: its class, size and place, its name key, and the
/// model, planet flags and timed modifiers the effect gives it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewPlanet {
    pub class: String,
    pub size: u32,
    /// Its distance from what it orbits, and its save angle about it.
    pub at: OrbitPlacement,
    /// The localisation key of its name.
    pub name: String,
    /// The model drawn in place of the class's own,
    /// `mammalian_01_habitat_phase_03_entity`.
    #[serde(default)]
    pub model: Option<String>,
    /// Its planet flags, in the order they are set: `megastructure`, `habitat`.
    pub flags: Vec<String>,
    /// Its timed modifiers, in the order they are added.
    #[serde(default)]
    pub modifiers: Vec<TimedModifier>,
}

/// A timed modifier, as the game's `add_modifier` gives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TimedModifier {
    pub modifier: String,
    /// How many days it lasts; `None` for no end.
    #[serde(default)]
    pub days: Option<u32>,
}

impl TimedModifier {
    /// The `days` a save holds for it: `-1` for no end.
    pub(crate) fn written_days(&self) -> i32 {
        self.days
            .map_or(-1, |days| i32::try_from(days).unwrap_or(i32::MAX))
    }
}

/// The `megastructures` row of a [`RingQuadrant`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RingRow {
    /// `ring_world_2`.
    pub kind: String,
    /// Its distance from the system's centre and its save angle.
    pub at: OrbitPlacement,
    /// The name key, `NAME_Ring_Section_A`; a ruin has none.
    #[serde(default)]
    pub name: Option<String>,
    /// The row takes the ring's owner.
    pub owned: bool,
    /// The graphical culture it is drawn in, written when it has an owner.
    #[serde(default)]
    pub culture: Option<String>,
}

/// What [`Op::AddRingWorld`] wrote, which its inverse takes out again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RingWorldWritten {
    pub owner: Option<u32>,
    pub ring: NewRingWorld,
    /// The planets written, in the sections' order.
    pub planets: Vec<u32>,
    /// The rows written, in the sections' order.
    pub rows: Vec<u32>,
    /// The flags of `ring.system_flags` the system lacked.
    pub system_flags: Vec<String>,
    /// The star, and the flags of `ring.star_flags` it lacked.
    pub star: u32,
    pub star_flags: Vec<String>,
    /// Each variable of `ring.system_variables` with the value the system held, as written;
    /// `None` where it held none.
    pub variables: Vec<(String, Option<String>)>,
    /// The system had no `variables` block.
    pub variables_block: bool,
}

/// How a [`NewBody`] is named.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum BodyNaming {
    /// After its siblings: a planet takes the numeral after the system's highest, a moon the
    /// letter after its planet's highest.
    #[default]
    Numbered,
    /// From the save's pool of asteroid names, and left out of the numbering. An asteroid has
    /// no moons and is no moon.
    Asteroid,
    Named(GivenName),
}

/// A name a body is written with as it is given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GivenName {
    pub name: BodyName,
    /// The name is written with the fixed-name bit of `binary_flags`, which the game sets on
    /// a name some layouts fix and not on others.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(optional, as = "Option<bool>")]
    pub fixed: bool,
}

/// The name a [`GivenName`] holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum BodyName {
    /// A name as typed, written `{ key="<name>" literal=yes }`.
    Typed(String),
    /// A localisation key written as it stands, `NAME_Vermilion`.
    Fixed(String),
}

/// One modifier of a [`NewBody`], as [`Op::AddBodyModifier`] takes it: a `timed_modifier`
/// item per entry of `days`, and with `feature` a `planet_modifier` line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewModifier {
    pub modifier: String,
    pub days: Vec<i32>,
    #[serde(default)]
    pub feature: Option<String>,
}

/// A moon of a [`NewBody`], placed about it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewMoon {
    pub spec: MoonSpec,
    pub at: OrbitPlacement,
}

/// The body a [`NewMoon`] writes: a [`NewBody`] without what a moon may not have, a ring,
/// moons or a place in the asteroid pool.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MoonSpec {
    pub class: String,
    pub size: u32,
    /// `None` letters it after its planet's moons.
    #[serde(default)]
    pub name: Option<GivenName>,
    #[serde(default)]
    pub deposits: Vec<String>,
    #[serde(default)]
    pub entity: Option<u32>,
    #[serde(default)]
    pub entity_name: Option<String>,
    #[serde(default)]
    pub modifiers: Vec<NewModifier>,
}

/// One system to add in [`Op::AddSystems`]: an [`Op::AddSystem`] with its id given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewSystem {
    pub system: u32,
    pub x: f64,
    pub y: f64,
    pub name: Option<String>,
    pub initializer: Option<String>,
    pub spawn_weight: Option<f64>,
    #[serde(default)]
    pub spawn_script: Option<SpawnScript>,
    /// The whole `system` statement, written as it stands instead of one built from the
    /// fields, which then only describe it: what a removal's inverse carries. It must
    /// read as one `system` statement with this id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statement: Option<String>,
}

/// The body [`Op::SetBodyParent`] makes a body orbit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Parent {
    /// The system's centre: the body becomes a planet of it.
    Centre,
    /// Another body of the system: a planet of it when it is a star, a moon otherwise.
    Body(u32),
}

impl Parent {
    pub fn body(self) -> Option<u32> {
        match self {
            Self::Centre => None,
            Self::Body(id) => Some(id),
        }
    }
}

impl From<Option<u32>> for Parent {
    fn from(parent: Option<u32>) -> Self {
        parent.map_or(Self::Centre, Self::Body)
    }
}

/// The name [`Op::RenameBody`] writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum NewName {
    /// A name as typed, written `{ key="<name>" literal=yes }`.
    Literal(String),
    /// A whole `{ … }` name value written as it stands, which `name` only describes.
    Block { value: String, name: String },
}

impl NewName {
    /// The name as the player reads it.
    pub fn shown(&self) -> &str {
        match self {
            Self::Literal(name) | Self::Block { name, .. } => name,
        }
    }
}

/// The two ends of a pair in [`Op::AddWormholePair`], each as x/y about its star.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PairPoints {
    pub a: (f64, f64),
    pub b: (f64, f64),
}

/// Where a `megastructures` row stands: what [`Op::MoveMegastructure`] moves it to, and the
/// place a [`NewMegastructurePlace`] adds it at.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "place", rename_all = "snake_case")]
pub enum MegastructurePlace {
    /// On or around a body of the system, at the body's point.
    Body { body: u32 },
    /// Tied to a body of the system, standing at a point of its own about the star, as the
    /// row stores it.
    Beside { body: u32, x: f64, y: f64 },
    /// The row's own point about the star, as the row stores it.
    Free { x: f64, y: f64 },
}

/// The row [`Op::AddMegastructure`] writes, finished.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewMegastructure {
    /// Its type, `think_tank_3`.
    pub kind: String,
    /// The row's name, written first as the game writes one; filled only by the inverse
    /// of [`Op::RemoveMegastructure`] for a row that had one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<NameTemplate>,
    pub at: NewMegastructurePlace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bypass: Option<NewBypass>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub construction: Option<MegastructureConstruction>,
    /// The planet its completion spawns round the body it stands at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub planet: Option<NewPlanet>,
    /// How many effects of the type's construction the caller could not tell apply and
    /// left out of `construction`; the description says so.
    #[serde(default, skip_serializing_if = "is_zero")]
    #[ts(optional, as = "Option<u32>")]
    pub left_out: u32,
}

/// Where [`Op::AddMegastructure`] puts its row: a [`MegastructurePlace`], and on or beside a
/// body, what the type leaves on that body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "place", rename_all = "snake_case")]
pub enum NewMegastructurePlace {
    /// On or around a body of the system, at the body's point.
    Body {
        body: u32,
        /// The planet flags the body gets, in order, each one a megastructure leaves, and
        /// each dated the save's date but `ruined_orbital_ring_planet`, which is dated day one.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        body_flags: Vec<String>,
        /// The type is built only around a star: a body that is not one is refused.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        star_only: bool,
    },
    /// Tied to a body of the system, standing at a point of its own about the star.
    Beside {
        body: u32,
        x: f64,
        y: f64,
        /// As [`Self::Body`]'s.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        body_flags: Vec<String>,
        /// As [`Self::Body`]'s.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        star_only: bool,
    },
    /// The row's own point about the star.
    Free { x: f64, y: f64 },
}

impl NewMegastructurePlace {
    /// Where the row stands, without what it leaves on its body.
    pub fn place(&self) -> MegastructurePlace {
        match *self {
            Self::Body { body, .. } => MegastructurePlace::Body { body },
            Self::Beside { body, x, y, .. } => MegastructurePlace::Beside { body, x, y },
            Self::Free { x, y } => MegastructurePlace::Free { x, y },
        }
    }
}

impl Default for NewMegastructurePlace {
    fn default() -> Self {
        Self::Free { x: 0.0, y: 0.0 }
    }
}

/// A place with nothing left on its body.
impl From<MegastructurePlace> for NewMegastructurePlace {
    fn from(place: MegastructurePlace) -> Self {
        match place {
            MegastructurePlace::Body { body } => Self::Body {
                body,
                body_flags: Vec::new(),
                star_only: false,
            },
            MegastructurePlace::Beside { body, x, y } => Self::Beside {
                body,
                x,
                y,
                body_flags: Vec::new(),
                star_only: false,
            },
            MegastructurePlace::Free { x, y } => Self::Free { x, y },
        }
    }
}

/// The `bypasses` row [`Op::AddMegastructure`] writes for its row: its `common/bypass`
/// type, `gateway` or `relay_bypass`, and whether it is open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewBypass {
    pub kind: String,
    pub active: bool,
}

/// The map border and fill in [`Op::SetEmpireMapColors`], each a colour name from
/// `flags/colors.txt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MapColorPair {
    pub border: String,
    pub fill: String,
}

/// An empire's flag in [`Op::SetEmpireFlag`]: the emblem's category and file under the
/// install's `flags/`, the background file under `flags/backgrounds`, and the primary and
/// secondary colours, each a colour name from `flags/colors.txt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EmpireFlag {
    pub icon_category: String,
    pub icon_file: String,
    pub background: String,
    pub primary: String,
    pub secondary: String,
}

/// What a nebula leaves on one member system besides its member line, in
/// [`Op::SetNebulaFootprints`]: the cloud that draws it in the system view, and the two
/// permanent modifiers, which give only its numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NebulaFootprint {
    pub system: u32,
    pub cloud: Option<NebulaCloud>,
    /// `nebula_cloaking`, which a save carries only with First Contact.
    pub cloaking: bool,
    /// `turbulent_nebula`.
    pub turbulent: bool,
}

/// One entry of the save's `ambient_object` table that draws a nebula cloud: its id and
/// its type, such as `nebula_3`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NebulaCloud {
    pub id: u32,
    pub kind: String,
}

/// What a megastructure's construction adds to its system and owner, as
/// [`Op::AddMegastructure`] writes it: the build chain of its type, up to its stage,
/// replayed against the system it is added to.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureConstruction {
    pub modifiers: Vec<ConstructionModifier>,
    pub deposits: Vec<ConstructionDeposit>,
    pub variables: Vec<VariableStep>,
}

impl MegastructureConstruction {
    pub fn is_empty(&self) -> bool {
        self.modifiers.is_empty() && self.deposits.is_empty() && self.variables.is_empty()
    }
}

/// A timed modifier a construction gives its system or one of the system's bodies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConstructionModifier {
    pub on: ModifierHost,
    #[serde(flatten)]
    pub timed: TimedModifier,
}

/// The entity a [`ConstructionModifier`] is written on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "host", rename_all = "snake_case")]
pub enum ModifierHost {
    System,
    Body { body: u32 },
}

/// A deposit a construction adds to a body of its system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConstructionDeposit {
    pub body: u32,
    pub kind: String,
}

/// One owner variable a construction raises or a dismantle lowers, and by how much.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VariableStep {
    pub variable: String,
    pub by: u32,
}

/// What a megastructure type's dismantle takes back, read from the install's
/// `on_dismantle_complete` and the scripted effects it calls: what [`Op::DeleteMegastructure`]
/// takes back with a row.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureDismantle {
    /// The modifiers it removes, `orbital_arc_furnace_4_mod`.
    pub modifiers: Vec<String>,
    /// The deposit types it removes, `d_arc_furnace_4`.
    pub deposits: Vec<String>,
    /// The variables it lowers on the owner, `arc_furnace_counter`.
    pub variables: Vec<VariableStep>,
}

impl MegastructureDismantle {
    pub fn is_empty(&self) -> bool {
        self.modifiers.is_empty() && self.deposits.is_empty() && self.variables.is_empty()
    }
}

/// The system flags a ring world of one size leaves, and the radius its build chain lays its
/// sections out at, read from the install: what [`Op::DeleteRingWorld`] clears for a ring
/// standing there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RingFlags {
    pub radius: f64,
    pub flags: Vec<String>,
    /// What the flags naming the ring's sections start with, the rest of each digits, as
    /// `ring_` names `ring_05`: the flags a ring takes in turn, which the delete of a
    /// system's last ring clears whichever ring set them.
    #[serde(default)]
    pub sections: Vec<String>,
}

/// One save entity in [`Op::RestoreEntities`]: the table it stands in, its id, and its
/// whole `<id>={ … }` statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SavedEntity {
    pub table: SavedTable,
    pub id: u32,
    pub text: String,
}

/// The id-keyed save tables [`SavedEntity`] names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SavedTable {
    System,
    Planet,
    Country,
    Colony,
    PopGroup,
    PopJob,
    District,
    Zone,
    Building,
    Army,
    Starbase,
    Fleet,
    Ship,
    /// `construction.queue_mgr.queues`.
    ConstructionQueue,
    /// `construction.item_mgr.items`.
    ConstructionItem,
    Megastructure,
    /// `bypasses`.
    Bypass,
    /// The whole top-level `dead_mega_structure` statement, with id 0.
    DeadMegastructures,
    Deposit,
}

/// One system's destination in [`Op::MoveSystems`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemMove {
    pub system: u32,
    pub x: f64,
    pub y: f64,
}

/// One system's height in [`Op::SetSystemHeights`]: its `coordinate.visual_height`, or
/// `None` for none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemHeight {
    pub system: u32,
    pub height: Option<f64>,
}

/// One lane to add in [`Op::AddLanePairs`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LanePair {
    pub a: u32,
    pub b: u32,
    pub bridge: bool,
}

/// One lane's new length in [`Op::SetLaneLengths`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LaneLength {
    pub a: u32,
    pub b: u32,
    pub length: f64,
}

pub(super) fn is_zero(n: &u32) -> bool {
    *n == 0
}
