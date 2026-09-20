//! `sgf gamedata`: what was read from the install and the enabled mods.

use sgf_gamedata::LoadOptions;
use sgf_gamedata::views::GameDataSummary;

use super::{Outcome, Run};

/// Diagnostics listed; a heavily modded playset produces hundreds.
const DIAGNOSTIC_ROWS: usize = 20;

pub fn run(opts: &LoadOptions) -> Run {
    let summary = GameDataSummary::from(&super::game_data(opts)?);
    println!("install:      {}", summary.install);
    println!(
        "version:      {}",
        summary.version.as_deref().unwrap_or("unknown")
    );
    println!(
        "language:     {}{}",
        summary.language,
        if summary.language_fell_back {
            " (fell back)"
        } else {
            ""
        }
    );
    println!("mods:         {}", summary.mods.len());
    for m in &summary.mods {
        println!(
            "  {:<8} {}  {}",
            m.status,
            m.name,
            m.dir.as_deref().unwrap_or("-")
        );
    }
    println!("initializers: {}", summary.initializers);
    println!("country types: {}", summary.country_types);
    println!("star classes: {}", summary.star_classes);
    println!("sprites: {}", summary.sprites);
    println!("colors: {}", summary.colors);
    println!("deposits: {}", summary.deposits);
    println!("planet classes: {}", summary.planet_classes);
    println!("starbase levels: {}", summary.starbase_levels);
    println!(
        "border: system radius {}, hyperlane thickness {}",
        summary.border.system_radius, summary.border.hyperlane_thickness
    );
    println!("localisation: {} keys", summary.localisation_keys);
    println!("diagnostics:  {}", summary.diagnostics.len());
    for d in summary.diagnostics.iter().take(DIAGNOSTIC_ROWS) {
        println!("  {:<12} {}", d.kind, d.message);
    }
    Ok(Outcome::Ok)
}
