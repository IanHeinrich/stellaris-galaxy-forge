//! `sgf special`: the leviathans, enclaves, landmarks and the rest, as the app sees them.

use std::path::Path;

use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::special::classify_session;

use super::{Outcome, Run, join};

pub fn run(sav: &Path, opts: &LoadOptions, with_gamedata: bool) -> Run {
    let session = Session::open(sav)?;
    let gd = with_gamedata
        .then(|| match super::game_data(opts) {
            Ok(gd) => Some(gd),
            Err(e) => {
                eprintln!("warning: {e}; classifying from save flags only");
                None
            }
        })
        .flatten();
    let result = classify_session(&session, gd.as_ref());
    for s in &result.systems {
        println!(
            "#{:<5} {:<14} [{}]  {}  {}",
            s.id,
            s.primary.as_str(),
            join(s.kinds.iter().map(|k| k.as_str())),
            s.label,
            s.initializer
        );
    }
    println!();
    println!(
        "special: {} system(s){}",
        result.systems.len(),
        if result.with_game_data {
            ""
        } else {
            " (save flags only)"
        }
    );
    println!("  {:<14} {:>5} {:>8}", "kind", "any", "primary");
    for c in &result.counts {
        println!(
            "  {:<14} {:>5} {:>8}",
            c.kind.as_str(),
            c.count,
            c.primary_count
        );
    }
    Ok(Outcome::Ok)
}
