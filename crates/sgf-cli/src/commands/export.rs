//! `sgf export-scenario` and `sgf new-scenario`: a static galaxy scenario written from
//! a save's galaxy, or an empty one to start from. Neither touches the save.

use std::path::Path;

use sgf_core::export::{self, ScenarioProfile};
use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;

use super::{Outcome, Run};
use crate::cli::Profile;

/// Export the save's galaxy as a scenario file. Names are the save's own keys unless
/// `opts` names an install to localise them from.
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
    let name = name.map_or_else(|| stem(sav), str::to_owned);
    let options = export::options_for(&session.graph, &name);
    let text = export::scenario_text(&session.graph, &options, &resolve, profile.core());
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
    Ok(Outcome::Ok)
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
