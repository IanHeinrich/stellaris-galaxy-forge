//! `sgf roundtrip`: load a save and write it out unchanged, optionally proving the
//! bytes are identical.

use std::path::Path;

use sgf_core::archive;
use sgf_core::document::Document;

use super::{Outcome, Run, saves_only};

pub fn run(input: &Path, output: &Path, check: bool) -> Run {
    if let Some(outcome) = saves_only("roundtrip", input) {
        return Ok(outcome);
    }
    let doc = Document::load(input)?;
    let outcome = doc.save_as(output)?;
    println!("wrote {}", outcome.path.display());
    if let Some(backup) = &outcome.backup {
        println!("backup {}", backup.display());
    }
    if !check {
        return Ok(Outcome::Ok);
    }
    let written = archive::read_sav(output)?;
    for (member, expected, actual) in [
        ("gamestate", doc.original(), written.gamestate.as_slice()),
        ("meta", doc.meta(), written.meta.as_slice()),
    ] {
        if let Some(offset) = first_difference(expected, actual) {
            println!(
                "roundtrip: {member} differs at byte {offset} (input {} bytes, output {} bytes)",
                expected.len(),
                actual.len()
            );
            return Ok(Outcome::Failed);
        }
    }
    println!("roundtrip: byte-identical");
    Ok(Outcome::Ok)
}

fn first_difference(a: &[u8], b: &[u8]) -> Option<usize> {
    let common = a.iter().zip(b).position(|(x, y)| x != y);
    common.or((a.len() != b.len()).then_some(a.len().min(b.len())))
}
