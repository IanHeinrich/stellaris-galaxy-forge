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
    /// `flag.colors[4]`, the map border colour; set only under `flag.use_map_color=yes`.
    pub border_color: Option<String>,
    /// `flag.colors[5]`, the map fill colour; set only under `flag.use_map_color=yes`.
    pub fill_color: Option<String>,
    /// Every `flag.colors` entry in order, the `"null"` placeholders kept; empty for a
    /// scenario's territories.
    pub flag_colors: Vec<String>,
    /// Whether `flag.use_map_color=yes`: the game paints the map in `flag_colors[4]` and
    /// `[5]` rather than the first two.
    pub use_map_color: bool,
    /// The colour the map paints the territory's border in: `flag.colors[4]` under
    /// `flag.use_map_color=yes`, else the first named flag colour, else the second. `None`
    /// only for a country with no named colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub painted_border: Option<String>,
    /// The colour the map paints the territory's fill in: `flag.colors[5]` under
    /// `flag.use_map_color=yes`, else the second named flag colour, else the first. `None`
    /// only for a country with no named colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub painted_fill: Option<String>,
    /// Whether `flag.colors` holds the six entries Stellaris 4.5 writes, the last two the
    /// map border and fill, so the map colours can be set. Always set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub has_map_colors: Option<bool>,
    pub flag_icon: Option<FlagRef>,
    pub flag_background: Option<FlagRef>,
    /// The keys of the save's `flags` map: the country flags scripts test.
    #[serde(skip)]
    #[ts(skip)]
    pub flags: Vec<String>,
}

/// A flag layer as `flag.icon` or `flag.background` names it: a category folder and a
/// `.dds` file under the install's `flags/` directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlagRef {
    pub category: String,
    pub file: String,
}
