//! `sgf prepare`: a scenario's systems sorted into the rows of "Prepare for a new game",
//! and a preset's choices written as one edit.

use std::path::Path;

use sgf_core::prepare::{self, PreparePreset, RowChoice};
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::prepare::{classify, plain_draw};

use super::{Outcome, Run, game_data, mutate};
use crate::cli::Preset;

/// Print each row's count, then apply `preset` with `rows` over it and save (to `out`, or
/// in place with a backup). Nothing is written when the choices change nothing.
pub fn run(
    scenario: &Path,
    out: Option<&Path>,
    preset: PreparePreset,
    rows: &[RowChoice],
    seed: u64,
    opts: &LoadOptions,
) -> Run {
    let session = Session::open(scenario)?;
    if session.kind() != DocumentKind::Scenario {
        println!(
            "prepare: {} is a save; this command reads scenarios only",
            scenario.display()
        );
        return Ok(Outcome::Failed);
    }
    let gd = game_data(opts)?;
    let classified = classify(&session, &gd);
    for row in &classified {
        println!("{}: {}", row.row.as_str(), row.systems.len());
    }
    let mut choices: Vec<RowChoice> = preset
        .choices()
        .into_iter()
        .filter(|choice| !rows.iter().any(|given| given.row == choice.row))
        .collect();
    choices.extend_from_slice(rows);
    let draw = plain_draw(&gd, seed);
    match prepare::build(&session, &classified, &choices, &draw)? {
        Some(op) => mutate::apply_all(session, out, vec![op]),
        None => {
            println!("nothing to change");
            Ok(Outcome::Ok)
        }
    }
}

impl Preset {
    pub fn core(self) -> PreparePreset {
        match self {
            Self::Faithful => PreparePreset::Faithful,
            Self::Fresh => PreparePreset::FreshStart,
            Self::Shell => PreparePreset::BareShell,
        }
    }
}
