//! What day-one's `distar.8000` rolled for the L-Cluster, read back from the save's global
//! flags: `sgf_core::format::save::galaxy::lgate` names the flags and picks the outcome.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LGateOutcome {
    GrayTempest,
    LDrakes,
    DessanuConsonance,
    Empty,
}

/// `None` when the galaxy has no L-Gate, or for a document that carries no global flags
/// (a scenario).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LGate {
    pub outcome: LGateOutcome,
    /// A gate has been opened (`l_cluster_opened`).
    pub opened: bool,
}
