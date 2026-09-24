//! The sample save's scenario export as `sgf export-scenario` writes it, and the facts
//! about the sample the export tests read it against.
use std::collections::BTreeSet;

use sgf_core::export::{self, ExportReport, ScenarioProfile};
use sgf_core::projections::galaxy::Galaxy;
use sgf_core::session::Session;

/// The committed fixtures' name: the sample save's file stem, as the exporter defaults to.
pub const NAME: &str = "2206.11.16";
/// The save the fixtures say they were exported from.
pub const SAVE_FILE: &str = "2206.11.16.sav";

/// No game data, so every name is written as the save holds it.
pub fn no_names(_: &str) -> Option<String> {
    None
}

/// No game data, so every initializer counts as vanilla.
pub fn no_sources(_: &str) -> Option<String> {
    None
}

/// Every undirected lane once, ascending.
pub fn lanes(galaxy: &Galaxy) -> BTreeSet<(u32, u32)> {
    let mut pairs = BTreeSet::new();
    for system in galaxy.systems.values() {
        for lane in &system.lanes {
            pairs.insert((system.id.min(lane.to), system.id.max(lane.to)));
        }
    }
    pairs
}

/// The export as `sgf export-scenario` writes it from the sample save under `profile`.
pub fn exported_as(
    session: &Session,
    name: &str,
    profile: ScenarioProfile,
) -> (Vec<u8>, ExportReport) {
    let options = export::ScenarioOptions {
        exported_from: Some(SAVE_FILE.to_owned()),
        ..export::options_for(&session.graph, name)
    };
    export::scenario_text(&session.graph, &options, &no_names, &no_sources, profile)
}

/// `text` with this version of Forge in its first line written as `0.0.0`, the version
/// the committed fixtures and snapshots hold so a release does not change them.
pub fn at_fixture_version(text: &[u8]) -> Vec<u8> {
    let end = text
        .iter()
        .position(|&b| b == b'\n')
        .map_or(text.len(), |i| i + 1);
    let first = String::from_utf8(text[..end].to_vec()).expect("utf-8");
    let this = format!("Stellaris Galaxy Forge {}", sgf_core::VERSION);
    let mut out = first
        .replacen(&this, "Stellaris Galaxy Forge 0.0.0", 1)
        .into_bytes();
    out.extend_from_slice(&text[end..]);
    out
}

/// The ids of the `system` lines that carry a base spawn weight of 1.
pub fn seated(text: &str) -> BTreeSet<u32> {
    text.lines()
        .filter(|line| line.contains(" spawn_weight = { base = 1 }"))
        .map(|line| {
            let id = &line[line.find("id = \"").unwrap() + 6..];
            id[..id.find('"').unwrap()].parse().unwrap()
        })
        .collect()
}

/// Where `needle` first occurs in `bytes` at or after `from`.
pub fn find(bytes: &[u8], from: usize, needle: &str) -> usize {
    from + bytes[from..]
        .windows(needle.len())
        .position(|w| w == needle.as_bytes())
        .unwrap_or_else(|| panic!("{needle:?} not found"))
}

pub fn default_capitals(save: &Session) -> BTreeSet<u32> {
    save.graph
        .countries
        .iter()
        .filter(|c| c.country_type == "default")
        .filter_map(|c| c.capital_system)
        .collect()
}
