//! The L-Cluster outcome `distar.8000` rolls on day one, read off the save's top-level
//! `flags` block. The game sets at most one of three global flags, and none of them means an
//! empty cluster. `l_cluster_opened` means a gate has since been opened.

use crate::keys;
use crate::projections::galaxy::{BypassLink, LGate, LGateOutcome, ProjectionError};
use crate::projections::read;
use crate::scan::Index;

/// In the order `distar.8000`'s `random_list` checks them.
const OUTCOME_FLAGS: &[(&str, LGateOutcome)] = &[
    ("gray_goo_crisis_set", LGateOutcome::GrayTempest),
    ("dragon_season", LGateOutcome::LDrakes),
    ("gray_goo_empire_set", LGateOutcome::DessanuConsonance),
];
const OPENED_FLAG: &str = "l_cluster_opened";

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
    let outcome = OUTCOME_FLAGS
        .iter()
        .find(|(flag, _)| node.find(flag, src).is_some())
        .map_or(LGateOutcome::Empty, |&(_, outcome)| outcome);
    let opened = node.find(OPENED_FLAG, src).is_some();
    Ok(Some(LGate { outcome, opened }))
}
