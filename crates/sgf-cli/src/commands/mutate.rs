//! The editing commands (`move`, `move-nebula`, `lane`, `isolate`): one op, then a save.

use std::path::Path;

use sgf_core::ops::Op;
use sgf_core::projections::galaxy::SpawnReservationPreset;
use sgf_core::session::Session;

use crate::cli::Reservation;

use super::{Outcome, Run, print_issues};

/// Open a session, apply one op, report it and save (to `out`, or in place with a backup).
pub fn run(sav: &Path, out: Option<&Path>, op: Op) -> Run {
    let mut session = Session::open(sav)?;
    let result = session.apply(op)?;
    println!("{}", result.entry.description);
    print_issues(&result.issues);
    let outcome = session.save_to(out)?;
    println!("wrote {}", outcome.path.display());
    if let Some(backup) = &outcome.backup {
        println!("backup {}", backup.display());
    }
    Ok(Outcome::Ok)
}

impl Reservation {
    pub fn preset(self) -> Option<SpawnReservationPreset> {
        match self {
            Self::Human => Some(SpawnReservationPreset::Human),
            Self::Ai => Some(SpawnReservationPreset::Ai),
            Self::None => None,
        }
    }
}

/// A spawn weight, or `none` to clear it.
pub fn spawn_base(text: &str) -> Result<Option<f64>, String> {
    if text.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    text.parse()
        .map(Some)
        .map_err(|_| format!("{text} is neither a number nor \"none\""))
}
