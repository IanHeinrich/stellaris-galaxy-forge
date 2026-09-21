//! Reading the `modifier` blocks of a scenario system's `spawn_weight` as they stand.

use crate::cst::Node;
use crate::keys::scenario as keys;
use crate::projections::galaxy::SpawnModifier;

/// One `modifier` block, with the trigger text it is not this editor's to rewrite.
pub(super) fn modifier(node: &Node, src: &[u8]) -> SpawnModifier {
    let mut factor = None;
    let mut add = None;
    let mut triggers: Vec<&Node> = Vec::new();
    for child in node.children() {
        match (child.key_str(src), child.scalar_str(src)) {
            (Some(keys::FACTOR), Some(text)) if factor.is_none() => factor = number(text),
            (Some(keys::ADD), Some(text)) if add.is_none() => add = number(text),
            _ => triggers.push(child),
        }
    }
    let trigger = triggers
        .iter()
        .filter_map(|t| std::str::from_utf8(t.span().slice(src)).ok())
        .collect::<Vec<_>>()
        .join(" ");
    SpawnModifier {
        factor,
        add,
        trigger,
        country_flag: country_flag(&triggers, src),
    }
}

fn country_flag(triggers: &[&Node], src: &[u8]) -> Option<String> {
    let [only] = triggers else {
        return None;
    };
    if only.key_str(src)? != keys::HAS_COUNTRY_FLAG {
        return None;
    }
    only.scalar_str(src).map(str::to_owned)
}

fn number(text: &str) -> Option<f64> {
    text.parse().ok().filter(|n: &f64| n.is_finite())
}
