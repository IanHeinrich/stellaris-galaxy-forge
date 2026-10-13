//! `sgf add-megastructure`: a finished megastructure of a type the install defines, added to a
//! system of a save as the app adds one.

use std::path::Path;

use sgf_core::ops::MegastructurePlace;
use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate::{self, HostMoons};

use super::{Run, game_data, mutate};

/// Add a megastructure of type `kind` to system `system` at `place`, changing its planet as
/// its build does unless `keep_planet` and removing the planet's moons when its build does,
/// and print each effect of its construction left out.
pub fn run(
    sav: &Path,
    out: Option<&Path>,
    system: u32,
    kind: &str,
    place: MegastructurePlace,
    keep_planet: bool,
    opts: &LoadOptions,
) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let planned = generate::megastructure_op(
        &gd,
        &session,
        system,
        kind,
        place,
        keep_planet,
        HostMoons::Remove,
    )?;
    let outcome = mutate::apply_all(session, out, vec![planned.op])?;
    for effect in &planned.unsure {
        println!("left out, unsure: {effect}");
    }
    for effect in &planned.unwritten {
        println!("left out, not written: {effect}");
    }
    Ok(outcome)
}
