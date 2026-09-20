//! One country of the graph: how it is named and flagged, and where its capital sits.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::name::NameTemplate;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CountryNode {
    pub id: u32,
    pub name: NameTemplate,
    /// The no-game-data stand-in (`NameTemplate::stand_in`).
    pub name_key: String,
    pub country_type: String,
    /// The system of the country's `capital` colony; `None` when it has none.
    pub capital_system: Option<u32>,
    /// Systems whose `owner` resolves to this country.
    pub system_count: u32,
    /// `flag.colors`, with the `"null"` placeholders removed.
    pub colors: Vec<String>,
    pub flag_icon: Option<FlagRef>,
    pub flag_background: Option<FlagRef>,
}

/// A flag layer as `flag.icon` or `flag.background` names it: a category folder and a
/// `.dds` file under the install's `flags/` directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlagRef {
    pub category: String,
    pub file: String,
}
