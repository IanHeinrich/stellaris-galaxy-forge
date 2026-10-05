//! `sgf prepare`: a scenario's systems sorted into the rows of "Prepare for a new game",
//! and a preset's choices written as one edit.

use std::path::Path;

use sgf_core::prepare::{
    self, PrepareChoice, PrepareOptions, PreparePreset, PrepareRow, RowChoice,
};
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::prepare::{classify, plain_draw};

use super::{Outcome, Run, game_data, mutate};
use crate::cli::Preset;

/// Print each row's count, then apply `preset` with `rows` over it and save (to `out`, or
/// in place with a backup), saying how many systems were kept clear around the seats, which
/// systems the edit cuts off, and the seats and zones it drew. Nothing is written when the
/// choices change nothing.
pub fn run(
    scenario: &Path,
    out: Option<&Path>,
    preset: PreparePreset,
    rows: &[RowChoice],
    options: &PrepareOptions,
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
        .choices(prepare::profile(&session))
        .into_iter()
        .filter(|choice| !rows.iter().any(|given| given.row == choice.row))
        .collect();
    choices.extend_from_slice(rows);
    let draw = plain_draw(&gd, options.seed);
    let Some(op) = prepare::build(&session, &classified, &choices, &draw, options)? else {
        println!("nothing to change");
        return Ok(Outcome::Ok);
    };
    if options.clear_around_seats {
        let clear = prepare::kept_clear(&session, &classified, &choices, &draw, options)?;
        println!("kept clear around seats: {}", clear.len());
    }
    let cut_off = prepare::cut_off(&session, &op);
    if !cut_off.is_empty() {
        println!("cut off: {}", ids(&cut_off));
    }
    let drawn = prepare::drawn(&session, &classified, &choices, options)?;
    if !drawn.seats.is_empty() {
        println!("new seats: {}", ids(&drawn.seats));
    }
    if let Some(floor) = drawn.seat_floor {
        println!("seat spacing: {floor}");
    }
    let zones = RowChoice {
        row: PrepareRow::FallenEmpires,
        choice: PrepareChoice::RandomZones,
    };
    if choices.contains(&zones) {
        println!("new zones: {}", drawn.zones.len());
    }
    mutate::apply_all(session, out, vec![op])
}

fn ids(systems: &[u32]) -> String {
    let ids: Vec<String> = systems.iter().map(u32::to_string).collect();
    ids.join(", ")
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
