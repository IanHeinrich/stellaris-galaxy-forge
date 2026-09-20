//! The shell's own IPC view types: what the updater commands answer with.
//!
//! Each type derives `TS`; `cargo test -p sgf-app` writes the TypeScript
//! declarations to `app/src/generated/` (directory set in `.cargo/config.toml`).
//! The generated files are committed and never hand-edited.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
