//! `sgf special-layouts`: the special layouts a system can be generated from, as the
//! app's Special menu lists them, with what each one's card says of the save.

use std::path::Path;

use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::menu::special_layouts;
use sgf_gamedata::summary::layout_summary;

use super::{Outcome, Run, game_data};

pub fn run(sav: &Path, opts: &LoadOptions) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let layouts = special_layouts(&gd, &session);
    for layout in &layouts {
        let card = layout_summary(&gd, &layout.key, &session)?;
        let capped = if card.max_instances.is_some() {
            "capped"
        } else {
            ""
        };
        let dlc = match &card.dlc {
            Some(dlc) if dlc.met => format!("  needs {}", dlc.name),
            Some(dlc) => format!("  needs {} (not in this save)", dlc.name),
            None => String::new(),
        };
        println!(
            "{:<48} {:<34} {:<6} in galaxy {}{dlc}",
            layout.key,
            layout.label,
            capped,
            card.in_galaxy.unwrap_or_default()
        );
    }
    println!();
    println!("special layouts: {}", layouts.len());
    Ok(Outcome::Ok)
}
