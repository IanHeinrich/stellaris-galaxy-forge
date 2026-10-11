//! IPC view types: everything that crosses the Tauri boundary.
//!
//! Each type derives `TS`; `cargo test -p sgf-core` writes the TypeScript
//! declarations to `app/src/generated/` (directory set in `.cargo/config.toml`).
//! The generated files are committed and never hand-edited.
//!
//! The document itself never crosses IPC. The map receives one [`GalaxyView`]
//! on open and, later, [`GalaxyDelta`]s naming the systems an op re-projected.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::archive;
use crate::document::{self, Document};
use crate::entity::views::EntityAddr;
use crate::export::ExportReport;
use crate::format;
use crate::ops::OpError;
use crate::projections::galaxy::{
    BypassLink, CountryNode, Galaxy, GalaxyGraph, HeaderField, LGate, Nebula, SystemNode, Wayline,
    Waystation,
};
use crate::projections::name::NameTemplate;
use crate::validate::Issue;

/// The save list's types live with the directory scan that finds the files.
pub use crate::archive::SaveMeta;
pub use crate::library::SaveFile;

/// The whole galaxy as the map draws it. Sent once on open.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxyView {
    /// In file order.
    pub systems: Vec<SystemNode>,
    pub nebulae: Vec<Nebula>,
    pub bypasses: Vec<BypassLink>,
    pub waystations: Vec<Waystation>,
    pub waylines: Vec<Wayline>,
    pub countries: Vec<CountryNode>,
    pub galaxy_radius: f64,
    pub core_radius: f64,
    /// Connected components over lanes at load.
    pub components: usize,
    /// A scenario's header keys in file order, duplicates kept; empty for a save.
    pub header: Vec<HeaderField>,
    /// What day-one's L-Cluster roll landed on; `None` when the galaxy has no L-Gate, or
    /// for a scenario.
    pub lgate: Option<LGate>,
    /// The setup-screen settings the save was started with; `None` for a scenario.
    pub settings: Option<archive::GalaxySettings>,
    /// Day one rolled for the Kaleidoscope to come; `false` for a scenario.
    pub kaleidoscope: bool,
}

impl GalaxyView {
    /// The galaxy plus the countries a document that has them owns.
    pub fn new(galaxy: &Galaxy, countries: &[CountryNode], components: usize) -> Self {
        Self {
            systems: galaxy
                .order
                .iter()
                .filter_map(|id| galaxy.systems.get(id).cloned())
                .collect(),
            nebulae: galaxy.nebulae.clone(),
            bypasses: galaxy.bypasses.clone(),
            waystations: galaxy.waystations.clone(),
            waylines: galaxy.waylines.clone(),
            countries: countries.to_vec(),
            galaxy_radius: galaxy.galaxy_radius,
            core_radius: galaxy.core_radius,
            components,
            header: galaxy.header.clone(),
            lgate: galaxy.lgate,
            settings: galaxy.settings.clone(),
            kaleidoscope: galaxy.kaleidoscope,
        }
    }
}

impl From<&GalaxyGraph> for GalaxyView {
    fn from(g: &GalaxyGraph) -> Self {
        Self::new(g, &g.countries, g.baseline_components)
    }
}

/// What the open document supports, so the app shows only the layers, tabs and ops it
/// can answer for. Each format fills it, and the app reads these flags, not the kind. The
/// default supports nothing, so a format names only what it has.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Capabilities {
    /// Countries: the owners layer, the empire colouring and the owner fields.
    pub empires: bool,
    /// Planets, stations and fleets: the details projection and the inspector's tabs.
    pub details: bool,
    /// Lanes carry a `length`, so the length ops and the stale-lane marks apply.
    pub lane_lengths: bool,
    pub nebulae: bool,
    pub bypasses: bool,
    /// Points of interest: initializers, flags and the countries standing in a system.
    pub special: bool,
    /// Systems carry the precursor flags galaxy generation sets: the precursors layer.
    pub precursors: bool,
    /// The scenario's system statements: any system added, removed, named and given an
    /// initializer, so the paint and erase brushes, spawn points, marauder clans and the
    /// day-one layers.
    pub create_systems: bool,
    /// Lanes carry a `bridge` flag.
    pub lane_bridges: bool,
    /// Waystations and the waylines the game derives between them.
    pub waylines: bool,
    /// Systems can be added to the save, and the ones added this session rerolled, renamed
    /// and deleted.
    pub added_systems: bool,
    /// A body's star class, planet size and name can be changed.
    pub bodies: bool,
    /// A planet's deposits can be added and removed.
    pub deposits: bool,
    /// A body's orbit, what it orbits and its ring, a system's belts and its inner radius can
    /// be changed.
    pub geometry: bool,
    /// An empire's map colours can be changed.
    pub map_colors: bool,
    /// The L-Gate's outcome can be read and set.
    pub lgate: bool,
    /// An edit can be mirrored across the galaxy's centre.
    pub symmetry: bool,
    /// A natural wormhole pair can be added between two systems and taken out.
    pub wormhole_pairs: bool,
    /// A system's height above or below the galactic plane can be changed.
    pub system_heights: bool,
    /// Planets can be selected in the system view and moved into another system.
    pub planet_moves: bool,
    /// A system's bodies are rolled from its initializer, not read from the document: the
    /// system view rolls them and a body opens the rolled body's page.
    pub rolled_layout: bool,
    /// Planets and moons can be added to a system.
    pub add_bodies: bool,
    /// A planet or moon can be deleted, and a colony removed from it.
    pub remove_bodies: bool,
    /// A planet's class and model can be changed.
    pub planet_classes: bool,
    /// A planet's timed modifiers and features can be added and removed.
    pub modifiers: bool,
    /// A body's anomaly can be added and removed.
    pub anomalies: bool,
    /// A planet's dig site can be added and removed.
    pub dig_sites: bool,
    /// Any system can be renamed from its header.
    pub rename_systems: bool,
    /// The document has a header of its own: the galaxy's name, sizes and core radius.
    pub header: bool,
    /// Empires are seated by the scripts the systems name: the territories, day-one claims
    /// and marauder clans the game data resolves.
    pub scripted_owners: bool,
    /// Systems name the initializers and scripts that generate them: the initializer
    /// labels, the scripts tab and the initializer a system opens.
    pub scripts: bool,
}

impl Capabilities {
    pub fn of(doc: &Document) -> Self {
        format::of(doc.kind()).capabilities(doc)
    }
}

/// The two file formats a session can hold: a `.sav` archive, or a static galaxy
/// scenario script (`map/setup_scenarios/*.txt`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    Save,
    Scenario,
}

impl std::fmt::Display for DocumentKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Save => "save",
            Self::Scenario => "scenario",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpenResult {
    /// `None` for a document that has never been saved.
    pub path: Option<String>,
    /// See [`SaveFile::cloud`].
    pub cloud: bool,
    pub kind: DocumentKind,
    /// The scenario carries Paint a Galaxy's scripts or flags, or Forge's header for
    /// that mod; false for a save.
    pub painted: bool,
    /// The document's own name: the empire's, or the scenario's `name`.
    pub title: String,
    /// The save header; `None` for a scenario.
    pub meta: Option<SaveMeta>,
    pub galaxy: GalaxyView,
    pub issues: Vec<Issue>,
    pub capabilities: Capabilities,
}

/// A lane as seen from one system, for the side panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeighbourView {
    pub id: u32,
    pub name_key: String,
    /// The saved travel-time length.
    pub length: f64,
    pub bridge: bool,
    /// Euclidean distance between the two systems now, for comparison with `length`;
    /// `None` when the endpoint does not exist.
    pub distance: Option<f64>,
}

/// One system with its neighbours resolved, for the side panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemDetail {
    pub system: SystemNode,
    /// In lane order.
    pub neighbours: Vec<NeighbourView>,
    pub nebula: Option<Nebula>,
}

impl SystemDetail {
    /// `None` when `id` is not a system.
    pub fn of(g: &GalaxyGraph, id: u32) -> Option<Self> {
        let system = g.systems.get(&id)?.clone();
        let neighbours = system
            .lanes
            .iter()
            .map(|lane| {
                let (name_key, distance) = match g.systems.get(&lane.to) {
                    Some(n) => (
                        n.name.stand_in(),
                        Some((n.x - system.x).hypot(n.y - system.y)),
                    ),
                    None => (String::new(), None),
                };
                NeighbourView {
                    id: lane.to,
                    name_key,
                    length: lane.length,
                    bridge: lane.bridge,
                    distance,
                }
            })
            .collect();
        let nebula = system.nebula.and_then(|i| g.nebulae.get(i).cloned());
        Some(Self {
            system,
            neighbours,
            nebula,
        })
    }
}

/// What a search hit names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SearchKind {
    StarType,
    System,
    Country,
    Planet,
    Fleet,
    Nebula,
}

/// Something matching a search query, best first within its kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SearchHit {
    pub kind: SearchKind,
    /// The entity's id; for a nebula, its index in `GalaxyView::nebulae`; for a star type,
    /// its place among the galaxy's star types by key.
    pub id: u32,
    /// The name as the save writes it; the UI resolves it with game data.
    pub name: NameTemplate,
    /// The no-game-data stand-in (`NameTemplate::stand_in`); for a star type, its key
    /// without the `sc_` prefix.
    pub name_key: String,
    /// The system to focus: the system itself, the country's capital system, the planet's
    /// or fleet's system; `None` for a nebula, which has its own `x`/`y`, and for a star
    /// type, which lists its systems.
    pub system_id: Option<u32>,
    /// The owning country's name: the system's owner, the fleet's owner; `None` when
    /// nothing owns it. The palette phrases it.
    pub owner: Option<NameTemplate>,
    /// The country's `country_type` key; `Country` hits only.
    pub country_type: Option<String>,
    /// Systems the country owns, the nebula lists, or of the star type; `Country`,
    /// `Nebula` and `StarType` hits.
    pub system_count: Option<u32>,
    /// The planet's class key (`pc_continental`); `Planet` hits only.
    pub planet_class: Option<String>,
    /// Where to pan: the focused system's position, or the nebula's centre. `None` when
    /// nothing locates the hit, such as a country with no capital.
    pub position: Option<[f64; 2]>,
    /// For a system found by what it holds rather than its name, the thing matched: an
    /// initializer or flag key, a special kind (`Enclave`), a bypass (`L-Gate`), or a
    /// planet class, localised when the resolver knows it. `None` for a name match.
    pub matched_on: Option<String>,
    /// When [`Self::matched_on`] is a bypass, its key (`wormhole`, `gateway`, `l_gate`, or
    /// the kind the save names), for the app to label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub matched_bypass: Option<String>,
    /// A star type's class key (`sc_pulsar`), the lowest when the localisation names
    /// several classes alike; `StarType` hits only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub star_class: Option<String>,
    /// Every system of a star type, ascending; `StarType` hits only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub systems: Option<Vec<u32>>,
}

impl SearchHit {
    /// A hit of `kind` named `name`, standing at `position`, with nothing else known.
    pub fn new(kind: SearchKind, id: u32, name: NameTemplate, position: Option<[f64; 2]>) -> Self {
        Self {
            kind,
            id,
            name_key: name.stand_in(),
            name,
            system_id: None,
            owner: None,
            country_type: None,
            system_count: None,
            planet_class: None,
            position,
            matched_on: None,
            matched_bypass: None,
            star_class: None,
            systems: None,
        }
    }
}

/// The hits of one search, and every system a system, planet or fleet match locates.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SearchResult {
    /// At most `limit` of each kind; see [`SearchHit`].
    pub hits: Vec<SearchHit>,
    /// Ascending, without duplicates, and not capped by `limit`; countries, nebulae and
    /// star types add none.
    pub systems: Vec<u32>,
}

/// Where a save planet goes in its new system: `radius` from the centre at `angle`
/// degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OrbitPlacement {
    pub radius: f64,
    pub angle: f64,
}

/// Where a set of save planets may move together.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetMoveTargets {
    /// The planets asked for, in order, without repeats and without a body whose parent is
    /// also among them, since it moves with its parent.
    pub planets: Vec<u32>,
    /// The planets that cannot move to any system, with why.
    pub refused: Vec<PlanetRefusal>,
    /// Every system all of `planets` may move to, by id: each system with bodies but the
    /// ones they stand in. Empty when one is refused.
    pub systems: Vec<PlanetMoveTarget>,
}

/// A system a set of planets may move to, and what the game changes when they arrive.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetMoveTarget {
    pub system: u32,
    pub warnings: Vec<PlanetMoveWarning>,
}

/// A colony or station that a move takes into a system another country owns, which the
/// game then hands to that country.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetMoveWarning {
    /// The moved body with the colony or station.
    pub planet: u32,
    pub kind: PlanetMoveWarningKind,
    /// The colony's owner, or the country that controls the body through its station.
    pub owner: u32,
    /// The owner of the system it moves to.
    pub new_owner: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PlanetMoveWarningKind {
    Colony,
    Station,
}

/// What a move of a set of planets to one system meets: its refusal, or else its
/// warnings.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetMoveCheck {
    pub refusal: Option<String>,
    pub warnings: Vec<PlanetMoveWarning>,
}

/// A planet that cannot move, and the refusal a move of it gets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetRefusal {
    pub planet: u32,
    pub reason: String,
}

/// Systems re-projected by an op; the map replaces its copy of each.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxyDelta {
    pub systems: Vec<SystemNode>,
    /// The whole nebula list, present only when an op changed a `nebula` section; the
    /// map replaces its nebulae and every system's membership. `Some([])` says the
    /// document now holds none, which a bare list could not tell from "unchanged".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nebulae: Option<Vec<Nebula>>,
    /// Systems the document no longer holds; the map drops each.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed: Vec<u32>,
    /// Systems whose id the edit changed, as `[before, after]`, read together rather than
    /// in turn; `after` is null for a system the edit removed, whose id another system
    /// may now hold. Removing a system added since the save was opened renumbers the ones
    /// added after it down, and an undo numbers them back.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub renumbered: Vec<(u32, Option<u32>)>,
    /// The whole header, present only when an op rewrote a header key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<Vec<HeaderField>>,
    /// The whole wayline list, present only when an op changed which waystations the
    /// galaxy connects; the map replaces the waylines it draws.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waylines: Option<Vec<Wayline>>,
    /// The whole bypass link list, present only when an op changed the galaxy's wormholes,
    /// gateways or other bypasses; the map replaces the links it draws.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypasses: Option<Vec<BypassLink>>,
    /// The L-Gate as it now reads, present only when an op rewrote the global flags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lgate: Option<LGate>,
    /// Countries re-projected by an op; the app replaces its copy of each.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub countries: Vec<CountryNode>,
}

/// One line of the change log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistoryEntry {
    /// Position in the order ops were applied, from 1.
    pub seq: usize,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistoryView {
    /// Applied ops, oldest first.
    pub undo: Vec<HistoryEntry>,
    /// Undone ops, next to redo first.
    pub redo: Vec<HistoryEntry>,
}

/// What `apply_op`, `undo` and `redo` return: the change log line, the systems the
/// map must replace, and the session state that depends on the edit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EditResult {
    pub entry: HistoryEntry,
    pub delta: GalaxyDelta,
    pub issues: Vec<Issue>,
    pub history: HistoryView,
    pub dirty: bool,
    /// Systems whose planets, stations or fleets changed, so their details are stale.
    pub details_stale: Vec<u32>,
    /// The entities the op rewrote, for the inspector's changed-row badges.
    pub touched_entities: Vec<EntityAddr>,
    /// Whether the classification of the systems the op touched, and the territory the
    /// scripts give them, may have moved with it.
    pub reclassifies: bool,
    /// The name the document is listed under, which renaming the player's empire changes.
    pub title: String,
}

/// What `save` and `save_as` return: where the file landed and the session state after.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveResult {
    pub path: String,
    /// See [`SaveFile::cloud`].
    pub cloud: bool,
    pub backup_path: Option<String>,
    pub dirty: bool,
}

/// What `export_scenario` returns: where the scenario landed, and what the export could
/// not carry over from the save.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExportResult {
    pub save: SaveResult,
    pub report: ExportReport,
}

/// Payload of the `sgf://progress` event emitted while a save opens or writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Progress {
    pub phase: ProgressPhase,
    /// 0..=1 within the whole operation.
    pub fraction: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ProgressPhase {
    Read,
    Project,
    Validate,
    Write,
    Discover,
    Definitions,
    Localisation,
    Done,
}

/// Every command failure crosses IPC as this.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SgfError {
    pub kind: ErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// No save is open.
    NoSession,
    /// The file or entity does not exist.
    NotFound,
    /// Reading or writing the file failed.
    Io,
    /// The save's text could not be parsed or projected.
    Format,
    /// An op was refused (precondition failed).
    Op,
    /// No Stellaris install was found; the message lists the searched paths.
    NoInstall,
    /// Something else wrote the file after it was opened or last saved; saving again with
    /// `force` writes over it, keeping that version as the backup.
    ChangedOnDisk,
}

impl SgfError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn no_session() -> Self {
        Self::new(ErrorKind::NoSession, "no save is open")
    }

    pub fn not_found(what: impl std::fmt::Display) -> Self {
        Self::new(ErrorKind::NotFound, format!("{what} not found"))
    }

    /// No game data is loaded, and `action` needs it.
    pub fn no_game_data(action: &str) -> Self {
        Self::new(ErrorKind::Op, format!("load game data to {action}"))
    }
}

impl From<archive::Error> for SgfError {
    fn from(e: archive::Error) -> Self {
        let kind = match &e {
            archive::Error::Meta(_) | archive::Error::MetaField(_) => ErrorKind::Format,
            archive::Error::Io { source, .. } => io_kind(source),
            _ => ErrorKind::Io,
        };
        Self::new(kind, e.to_string())
    }
}

impl From<document::Error> for SgfError {
    fn from(e: document::Error) -> Self {
        match e {
            document::Error::Archive(e) => e.into(),
            document::Error::Scan(_) | document::Error::Scenario(_) => {
                Self::new(ErrorKind::Format, e.to_string())
            }
            document::Error::Io { ref source, .. } => Self::new(io_kind(source), e.to_string()),
            document::Error::NoPath => Self::new(ErrorKind::Io, e.to_string()),
            document::Error::ChangedOnDisk { .. } => {
                Self::new(ErrorKind::ChangedOnDisk, e.to_string())
            }
        }
    }
}

/// A file the operating system says is not there crosses as [`ErrorKind::NotFound`], so
/// the app need not read the wording it said it in.
fn io_kind(e: &std::io::Error) -> ErrorKind {
    match e.kind() {
        std::io::ErrorKind::NotFound => ErrorKind::NotFound,
        _ => ErrorKind::Io,
    }
}

impl From<OpError> for SgfError {
    fn from(e: OpError) -> Self {
        Self::new(e.kind(), e.to_string())
    }
}
