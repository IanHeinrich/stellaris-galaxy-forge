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
use crate::document;
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
        }
    }
}

impl From<&GalaxyGraph> for GalaxyView {
    fn from(g: &GalaxyGraph) -> Self {
        Self::new(g, &g.countries, g.baseline_components)
    }
}

/// What the open document supports, so the app shows only the layers, tabs and ops it
/// can answer for. A `.sav` supports everything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
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
    /// Systems can be added and removed, named and given an initializer.
    pub create_systems: bool,
    /// Lanes carry a `bridge` flag.
    pub lane_bridges: bool,
    /// Waystations and the waylines the game derives between them.
    pub waylines: bool,
}

impl Capabilities {
    pub fn of(kind: DocumentKind) -> Self {
        format::of(kind).capabilities()
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
    /// The entity's id; for a nebula, its index in `GalaxyView::nebulae`.
    pub id: u32,
    /// The name as the save writes it; the UI resolves it with game data.
    pub name: NameTemplate,
    /// The no-game-data stand-in (`NameTemplate::stand_in`).
    pub name_key: String,
    /// The system to focus: the system itself, the country's capital system, the planet's
    /// or fleet's system; `None` for a nebula, which has its own `x`/`y`.
    pub system_id: Option<u32>,
    /// The owning country's name: the system's owner, the fleet's owner; `None` when
    /// nothing owns it. The palette phrases it.
    pub owner: Option<NameTemplate>,
    /// The country's `country_type` key; `Country` hits only.
    pub country_type: Option<String>,
    /// Systems the country owns, or the nebula lists; `Country` and `Nebula` hits.
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
}

/// The hits of one search, and every system a system, planet or fleet match locates.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SearchResult {
    /// At most `limit` of each kind; see [`SearchHit`].
    pub hits: Vec<SearchHit>,
    /// Ascending, without duplicates, and not capped by `limit`; countries and nebulae
    /// add none.
    pub systems: Vec<u32>,
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
    /// The whole header, present only when an op rewrote a header key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<Vec<HeaderField>>,
    /// The whole wayline list, present only when an op changed which waystations the
    /// galaxy connects; the map replaces the waylines it draws.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waylines: Option<Vec<Wayline>>,
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
        let kind = match e {
            OpError::UnknownSystem(_) => ErrorKind::NotFound,
            OpError::Parse { .. } | OpError::Projection(_) | OpError::Overlay(_) => {
                ErrorKind::Format
            }
            _ => ErrorKind::Op,
        };
        Self::new(kind, e.to_string())
    }
}
