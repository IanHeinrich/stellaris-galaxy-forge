//! `sgf add-body`: a planet or moon rolled from the install's rules and added to a system of
//! a save.

use std::path::Path;

use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate::{self, BodyAsk};

use super::{Run, game_data, mutate};

/// Add the body `ask` describes, rolled from `seed`: its deposits, and any class or size not
/// given, drawn as the game's roll draws them.
pub fn run(sav: &Path, out: Option<&Path>, ask: BodyAsk, seed: u64, opts: &LoadOptions) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let op = generate::body_for_save(&gd, &session, seed, ask)?;
    mutate::apply_all(session, out, vec![op])
}
