//! `sgf special-layouts`: the special layouts a system can be generated from, as the
//! app's Special menu lists them.

use std::path::Path;

use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::layouts::special_layouts;

use super::{Outcome, Run, game_data};

pub fn run(sav: &Path, opts: &LoadOptions) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let layouts = special_layouts(&gd, &session);
    for layout in &layouts {
        let capped = if layout.capped { "capped" } else { "" };
        let dlc = match &layout.dlc {
            Some(dlc) if dlc.met => format!("  needs {}", dlc.name),
            Some(dlc) => format!("  needs {} (not in this save)", dlc.name),
            None => String::new(),
        };
        println!(
            "{:<48} {:<34} {:<6} in galaxy {}{dlc}",
            layout.key, layout.label, capped, layout.in_galaxy
        );
    }
    println!();
    println!("special layouts: {}", layouts.len());
    Ok(Outcome::Ok)
}
