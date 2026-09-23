//! The L-Cluster outcome `distar.8000` rolls on day one, read off the save's top-level
//! `flags` block. The game sets at most one of three global flags, and none of them means an
//! empty cluster. `l_cluster_opened` means a gate has since been opened.

use crate::cst::Node;
use crate::keys;
use crate::projections::galaxy::{BypassLink, LGate, LGateOutcome, ProjectionError};
use crate::projections::read;
use crate::scan::Index;

const GRAY_TEMPEST: &str = "gray_goo_crisis_set";
/// Set beside [`GRAY_TEMPEST`]; only the Tempest's scripted text reads it.
const ACTIVE_GRAY_GOO: &str = "active_gray_goo";
const L_DRAKES: &str = "dragon_season";
const DESSANU_CONSONANCE: &str = "gray_goo_empire_set";

/// In the order `distar.8000`'s `random_list` checks them.
const OUTCOME_FLAGS: &[(&str, LGateOutcome)] = &[
    (GRAY_TEMPEST, LGateOutcome::GrayTempest),
    (L_DRAKES, LGateOutcome::LDrakes),
    (DESSANU_CONSONANCE, LGateOutcome::DessanuConsonance),
];
const OPENED_FLAG: &str = "l_cluster_opened";

/// Every flag some outcome sets.
pub(crate) const ALL_OUTCOME_FLAGS: [&str; 4] =
    [GRAY_TEMPEST, ACTIVE_GRAY_GOO, L_DRAKES, DESSANU_CONSONANCE];

/// The flag whose value dates day one, which the outcome flags carry too.
pub(crate) const GAME_STARTED: &str = "game_started";

/// The flags `distar.8000` sets for `outcome`, in the order it sets them.
pub(crate) fn flags_of(outcome: LGateOutcome) -> &'static [&'static str] {
    match outcome {
        LGateOutcome::GrayTempest => &[GRAY_TEMPEST, ACTIVE_GRAY_GOO],
        LGateOutcome::LDrakes => &[L_DRAKES],
        LGateOutcome::DessanuConsonance => &[DESSANU_CONSONANCE],
        LGateOutcome::Empty => &[],
    }
}

/// `None` when `bypasses` holds no `LGate` link: a galaxy with no L-Gate rolled no outcome.
pub(super) fn extract(
    index: &Index,
    src: &[u8],
    bypasses: &[BypassLink],
) -> Result<Option<LGate>, ProjectionError> {
    if !bypasses
        .iter()
        .any(|b| matches!(b, BypassLink::LGate { .. }))
    {
        return Ok(None);
    }
    let Some(section) = index.section(keys::FLAGS) else {
        return Ok(None);
    };
    let node = read::section_node(keys::FLAGS, section, src)?;
    Ok(Some(read_flags(&node, src)))
}

/// The outcome and the opened flag as `flags`, the `flags=` block, holds them.
pub(super) fn read_flags(flags: &Node, src: &[u8]) -> LGate {
    let outcome = OUTCOME_FLAGS
        .iter()
        .find(|(flag, _)| flags.find(flag, src).is_some())
        .map_or(LGateOutcome::Empty, |&(_, outcome)| outcome);
    let opened = flags.find(OPENED_FLAG, src).is_some();
    LGate { outcome, opened }
}
