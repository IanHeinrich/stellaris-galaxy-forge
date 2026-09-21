//! `sgf export-scenario` and `sgf new-scenario`: a static galaxy scenario written from
//! a save's galaxy, or an empty one to start from. Neither touches the save.

use std::path::Path;

use sgf_core::export::{self, ExportReport, ScenarioProfile};
use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;

use super::{Outcome, Run, join};
use crate::cli::Profile;

/// Export the save's galaxy as a scenario file, then say what it could not carry over.
/// Names are the save's own keys unless `opts` names an install to localise them from,
/// which also tells which DLC or mod each initializer needs.
pub fn run(
    sav: &Path,
    out: &Path,
    name: Option<&str>,
    opts: Option<&LoadOptions>,
    profile: Profile,
) -> Run {
    let session = Session::open(sav)?;
    let gd = opts.and_then(|opts| match super::game_data(opts) {
        Ok(gd) => Some(gd),
        Err(e) => {
            eprintln!("warning: {e}; writing name keys as the save holds them");
            None
        }
    });
    let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
    let sources = |initializer: &str| {
        let gd = gd.as_ref()?;
        gd.initializers
            .get(initializer)?
            .source_label(&gd.layout.install)
    };
    let name = name.map_or_else(|| stem(sav), str::to_owned);
    let options = export::ScenarioOptions {
        exported_from: sav.file_name().map(|f| f.to_string_lossy().into_owned()),
        ..export::options_for(&session.graph, &name)
    };
    let (text, report) =
        export::scenario_text(&session.graph, &options, &resolve, &sources, profile.core());
    let outcome = export::write_scenario(out, &text)?;
    println!(
        "{} system(s), {} hyperlane(s), {} nebula(e) as \"{name}\"",
        statements(&text, "system"),
        statements(&text, "add_hyperlane"),
        statements(&text, "nebula")
    );
    println!("wrote {}", outcome.path.display());
    if let Some(backup) = &outcome.backup {
        println!("backup {}", backup.display());
    }
    if matches!(profile, Profile::Plain) {
        print_report(&report);
    } else {
        print_paint_report(&report);
    }
    if let Some(omitted) = report.omitted_summary() {
        println!("left out: {omitted} (the game adds its own)");
    }
    if report.fallen_empire_zones > 0 {
        println!(
            "fallen empire zones: {} automatic",
            report.fallen_empire_zones
        );
    }
    Ok(Outcome::Ok)
}

/// What the Paint a Galaxy profile seated and rebuilt: the player's seat, each fallen
/// empire's zone, and where the header's counts come from.
fn print_paint_report(report: &ExportReport) {
    if let Some(seat) = report.player_seat {
        println!("player seat: system {seat} (preferred)");
    }
    for fallen in &report.fallen_empires {
        let anchor = match (fallen.anchor, fallen.exact) {
            (Some(anchor), true) => format!("anchor {anchor} at the old capital"),
            (Some(anchor), false) => format!("anchor {anchor} nearby, the old spot was not clear"),
            (None, _) => "nowhere to go".to_owned(),
        };
        let linked = if fallen.links > 0 {
            format!(", linked to {} system(s)", fallen.links)
        } else {
            String::new()
        };
        println!(
            "fallen empire {}: {}, {} system(s) left out, {anchor}{linked}",
            fallen.name,
            fallen.kind.as_str(),
            fallen.systems_left_out
        );
    }
    let replaced = report.home_initializers.iter().filter(|h| h.replaced);
    let replaced: Vec<String> = replaced
        .map(|h| format!("{} (system {})", h.initializer, h.system))
        .collect();
    if !replaced.is_empty() {
        println!(
            "home initializers replaced by a generic start: {}",
            replaced.join(", ")
        );
    }
    if report.setup_from_save {
        println!("header counts: from the save's setup");
    }
}

/// The seats written, what to look at, what was left out and what the map needs, then
/// one line per category of system. Paint a Galaxy seats and flags its own, so the
/// plain report does not describe its file.
fn print_report(report: &ExportReport) {
    println!("empire seats: {}", report.seats);
    if !report.home_initializers.is_empty() {
        println!(
            "home initializers to review: {}",
            join(
                report
                    .home_initializers
                    .iter()
                    .map(|h| format!("{} (system {})", h.initializer, h.system))
            )
        );
    }
    if let Some(dropped) = report.dropped.summary() {
        println!("not carried over: {dropped}");
    }
    if let Some(needs) = report.needs() {
        println!("needs: {needs}");
    }
    for count in &report.by_category {
        println!("{}: {}", count.category, count.systems);
    }
}

/// Write an empty scenario: the header and nothing else.
pub fn create(name: &str, core_radius: f64, out: &Path, profile: Profile) -> Run {
    let mut session = export::new_scenario(name, core_radius, profile.core())?;
    let outcome = session.save_as(out)?;
    println!("new scenario \"{}\"", session.title());
    println!("wrote {}", outcome.path.display());
    if let Some(backup) = &outcome.backup {
        println!("backup {}", backup.display());
    }
    Ok(Outcome::Ok)
}

impl Profile {
    pub fn core(self) -> ScenarioProfile {
        match self {
            Self::Plain => ScenarioProfile::Plain,
            Self::PaintAGalaxy => ScenarioProfile::PaintAGalaxy,
        }
    }
}

/// Generated statements are one per line, so counting them is counting lines.
fn statements(text: &[u8], key: &str) -> usize {
    let prefix = format!("\t{key} = ").into_bytes();
    text.split(|&b| b == b'\n')
        .filter(|line| line.starts_with(&prefix))
        .count()
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
