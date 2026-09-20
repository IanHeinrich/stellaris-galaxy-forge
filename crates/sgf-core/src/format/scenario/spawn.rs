//! Reading the `modifier` blocks of a scenario system's `spawn_weight` as they stand.

use crate::cst::Node;
use crate::keys::scenario as keys;
use crate::projections::galaxy::{SpawnModifier, SpawnReservation, SpawnReservationPreset};

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
        reservation: reservation(factor, add, &triggers, src),
    }
}

/// Whether the modifier tests `is_ai` at all, whatever else it tests beside it: a
/// reservation may not be written beside one this editor does not recognise.
pub(super) fn tests_ai(node: &Node, src: &[u8]) -> bool {
    node.find(keys::IS_AI, src).is_some()
}

/// Which preset this modifier is, if it is one: the exact shapes
/// [`Op::SetSpawnReservation`] writes and takes back, and nothing else.
///
/// [`Op::SetSpawnReservation`]: crate::ops::Op::SetSpawnReservation
pub(super) fn preset(node: &Node, src: &[u8]) -> Option<SpawnReservationPreset> {
    let modifier = modifier(node, src);
    if modifier.factor != Some(0.0) || modifier.add.is_some() {
        return None;
    }
    match modifier.reservation? {
        SpawnReservation::Human => Some(SpawnReservationPreset::Human),
        SpawnReservation::Ai => Some(SpawnReservationPreset::Ai),
        SpawnReservation::CountryFlag(_) => None,
    }
}

fn reservation(
    factor: Option<f64>,
    add: Option<f64>,
    triggers: &[&Node],
    src: &[u8],
) -> Option<SpawnReservation> {
    let [only] = triggers else {
        return None;
    };
    let value = only.scalar_str(src)?;
    match only.key_str(src)? {
        keys::HAS_COUNTRY_FLAG => Some(SpawnReservation::CountryFlag(value.to_owned())),
        keys::IS_AI => {
            let ai = match value {
                "yes" => true,
                "no" => false,
                _ => return None,
            };
            // A modifier favours whoever it tests when it states a positive number, and
            // bars them when every number it states is zero or less.
            let favoured = factor.is_some_and(|f| f > 0.0) || add.is_some_and(|a| a > 0.0);
            let barred = !favoured && (factor.is_some() || add.is_some());
            match (ai, barred, favoured) {
                (true, true, _) | (false, _, true) => Some(SpawnReservation::Human),
                (false, true, _) | (true, _, true) => Some(SpawnReservation::Ai),
                _ => None,
            }
        }
        _ => None,
    }
}

fn number(text: &str) -> Option<f64> {
    text.parse().ok().filter(|n: &f64| n.is_finite())
}
