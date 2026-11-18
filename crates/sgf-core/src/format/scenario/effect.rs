//! A scenario system's own `effect = { … }` block, which the app shows with the line it
//! starts on and game data reads for the scripts it runs.

use crate::cst::{self, Node};
use crate::document::Document;
use crate::format::scenario::index::ScenarioIndex;
use crate::keys::scenario as keys;
use crate::overlay::Anchor;

/// System `id`'s `effect` block and the line it starts on; `None` for a save, or a system
/// with no such block.
pub(crate) fn system_effect(doc: &Document, id: u32) -> Option<(String, u32)> {
    let scenario = doc.scenario()?;
    effect_at(doc, scenario, scenario.system(id)?)
}

/// Every system carrying an `effect` block, in file order: its id, the block's text and
/// the line it starts on. A save has none.
pub(crate) fn system_effects(doc: &Document) -> Vec<(u32, String, u32)> {
    let Some(scenario) = doc.scenario() else {
        return Vec::new();
    };
    scenario
        .systems()
        .filter_map(|(id, anchor)| {
            let (text, line) = effect_at(doc, scenario, anchor)?;
            Some((id, text, line))
        })
        .collect()
}

fn effect_at(doc: &Document, scenario: &ScenarioIndex, anchor: Anchor) -> Option<(String, u32)> {
    let bytes = doc.current(anchor).ok()?;
    let root = cst::parse_script(bytes, 0).ok()?;
    let effect = block(root.children().first()?, bytes)?;
    let span = effect.span();
    let text = String::from_utf8_lossy(span.slice(bytes)).into_owned();
    let within = bytes[..span.start].iter().filter(|&&b| b == b'\n').count();
    Some((
        text,
        scenario.line_at(anchor.start()) + crate::as_u32(within),
    ))
}

/// The system's `effect` block the game runs. Of two or more it logs "Duplicate effect"
/// and runs only the last.
pub(crate) fn block<'n>(system: &'n Node, src: &'n [u8]) -> Option<&'n Node> {
    system.find_all(keys::EFFECT, src).last()
}

/// How many `effect` blocks the system holds.
pub(crate) fn blocks(system: &Node, src: &[u8]) -> u32 {
    crate::as_u32(system.find_all(keys::EFFECT, src).count())
}
