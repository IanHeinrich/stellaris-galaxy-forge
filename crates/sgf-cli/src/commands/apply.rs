//! `sgf apply`: the ops that edit files hold, applied in order, then a save.

use std::path::{Path, PathBuf};

use sgf_core::ops::Op;
use sgf_core::session::Session;

use super::{Run, mutate};

/// Apply the op each of `edits` holds to the document at `sav`, then save it (to `out`, or in
/// place with a backup). Nothing is written or reported when a file does not parse or an op is refused.
pub fn run(sav: &Path, out: Option<&Path>, edits: &[PathBuf]) -> Run {
    let ops = edits
        .iter()
        .map(|path| read(path).map(|op| (path, op)))
        .collect::<Result<Vec<_>, _>>()?;
    let mut session = Session::open(sav)?;
    let mut descriptions = Vec::new();
    let mut issues = Vec::new();
    for (path, op) in ops {
        let name = op.name();
        let result = session
            .apply(op)
            .map_err(|e| format!("{}: {name}: {e}", path.display()))?;
        descriptions.push(result.entry.description);
        issues = result.issues;
    }
    for description in descriptions {
        println!("{description}");
    }
    mutate::save(session, out, &issues)
}

fn read(path: &Path) -> Result<Op, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}
