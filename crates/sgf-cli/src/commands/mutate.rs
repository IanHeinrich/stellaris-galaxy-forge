//! The editing commands (`move`, `move-nebula`, `lane`, `isolate`, `star`, `add-system`):
//! one op, then a save.

use std::path::Path;

use sgf_core::ops::{Op, SystemSpec};
use sgf_core::session::Session;

use super::{Outcome, Run, print_issues};

/// Open a session, apply one op, report it and save (to `out`, or in place with a backup).
pub fn run(sav: &Path, out: Option<&Path>, op: Op) -> Run {
    run_all(sav, out, vec![op])
}

/// [`run`] for several ops, applied in order in the one session, each reported, and the
/// findings once after the last.
pub fn run_all(sav: &Path, out: Option<&Path>, ops: Vec<Op>) -> Run {
    apply_all(Session::open(sav)?, out, ops)
}

/// [`run_all`] on a session already open.
pub fn apply_all(mut session: Session, out: Option<&Path>, ops: Vec<Op>) -> Run {
    let mut issues = Vec::new();
    for op in ops {
        let result = session.apply(op)?;
        println!("{}", result.entry.description);
        issues = result.issues;
    }
    print_issues(&issues);
    let outcome = session.save_to(out)?;
    println!("wrote {}", outcome.path.display());
    if let Some(backup) = &outcome.backup {
        println!("backup {}", backup.display());
    }
    Ok(Outcome::Ok)
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

/// The system `add-system` reads from a JSON file.
pub fn system_spec(path: &Path) -> Result<SystemSpec, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}
