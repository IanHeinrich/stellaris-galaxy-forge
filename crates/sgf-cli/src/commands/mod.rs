//! One module per `sgf` subcommand, and the little they share.

pub mod add_system;
pub mod details;
pub mod export;
pub mod gamedata;
pub mod inspect;
pub mod mutate;
pub mod roundtrip;
pub mod shape;
pub mod special;
pub mod special_layouts;
pub mod synth;
pub mod texture;
pub mod validate;

use std::path::Path;
use std::process::ExitCode;

use sgf_core::document;
use sgf_core::validate::{Issue, Severity};
use sgf_core::views::DocumentKind;
use sgf_gamedata::{GameData, LoadError, LoadOptions};

/// What every command returns; an error is printed by `main` and exits 1.
pub type Run = Result<Outcome, Box<dyn std::error::Error>>;

/// A command's verdict. `Failed` is an answer, not an error: an unknown system, a
/// validator error, a roundtrip that differs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    Failed,
}

impl From<Outcome> for ExitCode {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Ok => Self::SUCCESS,
            Outcome::Failed => Self::FAILURE,
        }
    }
}

/// The install's definitions and localisation, with no progress reporting.
pub fn game_data(opts: &LoadOptions) -> Result<GameData, LoadError> {
    sgf_gamedata::load(opts, &mut |_| {})
}

/// A save-only command's refusal, printed and returned when `path` holds a scenario.
pub fn saves_only(command: &str, path: &Path) -> Option<Outcome> {
    (path.is_file() && document::sniff(path) == DocumentKind::Scenario).then(|| {
        println!(
            "{command}: {} is a scenario; this command reads saves only",
            path.display()
        );
        Outcome::Failed
    })
}

/// Print every issue and the summary line; returns the number of errors.
pub fn print_issues(issues: &[Issue]) -> usize {
    let (mut errors, mut warnings, mut notes) = (0, 0, 0);
    for issue in issues {
        match issue.severity {
            Severity::Error => errors += 1,
            Severity::Warning => warnings += 1,
            Severity::Info => notes += 1,
        }
        println!("{} {}: {}", issue.severity, issue.code, issue.message);
    }
    println!("validate: {warnings} warning(s), {errors} error(s), {notes} note(s)");
    errors
}

pub fn join<T: ToString>(items: impl IntoIterator<Item = T>) -> String {
    items
        .into_iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}
