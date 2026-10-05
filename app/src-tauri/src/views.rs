//! The shell's own IPC view types: what the updater, add-body and prepare commands answer with.
//!
//! Each type derives `TS`; `cargo test -p sgf-app` writes the TypeScript
//! declarations to `app/src/generated/` (directory set in `.cargo/config.toml`).
//! The generated files are committed and never hand-edited.

use serde::{Deserialize, Serialize};
use sgf_core::export::ScenarioProfile;
use sgf_core::format::scenario::FeZone;
use sgf_core::prepare::RowSystems;
use sgf_core::views::EditResult;
use ts_rs::TS;

/// What adding a body answers with: the edit, and the id the new body took.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AddedBody {
    pub edit: EditResult,
    pub planet: u32,
}

/// What a set of Prepare choices would do to the open scenario: the dialect it is written in,
/// the systems standing in each row, how many systems the choices change, and what the options
/// and a pair taken out do beside them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PreparePreview {
    pub profile: ScenarioProfile,
    /// Every row, in the panel's order, each row's systems in file order.
    pub rows: Vec<RowSystems>,
    pub changes: usize,
    /// The systems the game would roll near a seat that keeping the space around seats clear
    /// gives a plain system; empty with the option off. Sorted.
    pub kept_clear: Vec<u32>,
    /// The systems the edit would cut off from the rest of the map. Sorted.
    pub cut_off: Vec<u32>,
    /// The systems New random seats would seat, in seat order; empty unless chosen.
    pub new_seats: Vec<u32>,
    /// The fallen empire zones New random zones would fit; empty unless chosen.
    pub new_zones: Vec<NewZone>,
}

/// A fallen empire zone New random zones would fit: the system anchoring it, and the zone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewZone {
    pub system: u32,
    pub zone: FeZone,
}

/// What preparing a scenario answers with: the edit, and how many systems it changed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PreparedEdit {
    pub edit: EditResult,
    pub changes: usize,
}

/// What the running copy can do about an update: replace itself, or send the user
/// to the releases page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum InstallKind {
    App,
    Manual,
}

/// The update the endpoint offers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateView {
    pub version: String,
    /// Empty when the manifest carries none.
    pub notes: String,
    /// The manifest's `pub_date`, null when it has none.
    pub date: Option<String>,
    pub install: InstallKind,
}

/// The answer to a check: what is running, what is on offer, and where the releases are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCheck {
    pub current: String,
    pub update: Option<UpdateView>,
    pub releases_url: String,
}

/// How far the download an install drives has got.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateProgress {
    #[ts(type = "number")]
    pub downloaded: u64,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
    pub done: bool,
}
