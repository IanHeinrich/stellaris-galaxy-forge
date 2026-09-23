//! Which loaded mods could change the L-Cluster outcome: `distar.8000` rolls it
//! on day one into one global flag, and `distar.10950` reads that flag when a
//! gate opens. The base game's own references are not counted.

use crate::install::layers::VANILLA;
use crate::scripts::index::{RefSite, ScriptIndex};
use crate::scripts::view::{LGateModTouch, LGateTouchKind, ScriptRef};

const ROLL: &str = "distar.8000";
const GATE_OPENING: &str = "distar.10950";

const FLAGS: [&str; 5] = [
    "gray_goo_crisis_set",
    "active_gray_goo",
    "dragon_season",
    "gray_goo_empire_set",
    "l_cluster_opened",
];

/// Every file outside the base game that overrides the roll or the gate
/// opening, or sets, removes or reads an outcome flag, once per mod, file and kind.
pub fn lgate_outcome_mods(index: &ScriptIndex) -> Vec<LGateModTouch> {
    let events = [
        (ROLL, LGateTouchKind::OverridesRoll),
        (GATE_OPENING, LGateTouchKind::OverridesGateOpening),
    ];
    let overrides = events.into_iter().flat_map(|(id, what)| {
        index
            .mod_event_definitions(id)
            .iter()
            .map(move |at| (at, what.clone()))
    });
    let flags = FLAGS.into_iter().flat_map(|flag| {
        let writes = index.global_flag_writes(flag).iter();
        let reads = index
            .references(flag)
            .iter()
            .filter(|site| site.verb == "has_global_flag");
        writes
            .chain(reads)
            .filter_map(move |site| Some((&site.location, flag_touch(site, flag)?)))
    });
    let mut touches: Vec<LGateModTouch> = overrides
        .chain(flags)
        .filter(|(at, _)| at.layer != VANILLA)
        .map(|(at, what)| LGateModTouch {
            mod_name: at.layer.clone(),
            file: relative_file(at).to_owned(),
            what,
        })
        .collect();
    touches.sort();
    touches.dedup();
    touches
}

fn flag_touch(site: &RefSite, flag: &str) -> Option<LGateTouchKind> {
    let flag = flag.to_owned();
    match site.verb {
        "set_global_flag" => Some(LGateTouchKind::SetsFlag(flag)),
        "remove_global_flag" => Some(LGateTouchKind::RemovesFlag(flag)),
        "has_global_flag" => Some(LGateTouchKind::ReadsFlag(flag)),
        _ => None,
    }
}

/// The path in a [`ScriptRef::display`], without its `:line`.
fn relative_file(at: &ScriptRef) -> &str {
    at.display
        .rsplit_once(':')
        .map_or(at.display.as_str(), |(file, _)| file)
}
