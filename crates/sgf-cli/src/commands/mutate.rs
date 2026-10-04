//! What the commands that apply ops share, and the two edits that read the install
//! (`planet-class` and `nebula add`): the ops, then a save.

use std::path::Path;

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{ClassChange, Op, OpError, PlanetClassRule};
use sgf_core::session::Session;
use sgf_core::validate::Issue;

use sgf_gamedata::{GameData, LoadOptions, naming};

use super::{Outcome, Run, game_data, print_issues};

/// The draw an unnamed nebula takes its name from, so the same save names it the same way.
const NEBULA_SEED: u64 = 0;

/// Apply `ops` to a session already open, report them and save (to `out`, or in place with a
/// backup).
pub fn apply_all(mut session: Session, out: Option<&Path>, ops: Vec<Op>) -> Run {
    let issues = apply(&mut session, ops)?;
    save(session, out, &issues)
}

/// Apply `ops` in order, printing each one's description; the findings after the last.
pub fn apply(session: &mut Session, ops: Vec<Op>) -> Result<Vec<Issue>, OpError> {
    let mut issues = Vec::new();
    for op in ops {
        let result = session.apply(op)?;
        println!("{}", result.entry.description);
        issues = result.issues;
    }
    Ok(issues)
}

/// Print `issues` and save (to `out`, or in place with a backup).
pub fn save(mut session: Session, out: Option<&Path>, issues: &[Issue]) -> Run {
    print_issues(issues);
    let outcome = session.save_to(out)?;
    println!("wrote {}", outcome.path.display());
    if let Some(backup) = &outcome.backup {
        println!("backup {}", backup.display());
    }
    Ok(Outcome::Ok)
}

/// `planet-class`: planet `planet` made `class`, with what the install says of its class and
/// the new one.
pub fn planet_class(
    sav: &Path,
    out: Option<&Path>,
    planet: u32,
    class: &str,
    opts: &LoadOptions,
) -> Run {
    let session = Session::open(sav)?;
    let held = get_planet_page(session.doc(), planet)?.class;
    let gd = game_data(opts)?;
    let named = |class: &str| PlanetClassRule {
        class: class.to_owned(),
        change: ClassChange::Never,
        models: 0,
    };
    let op = Op::SetBodyClass {
        body: planet,
        from: named(&held),
        to: named(class),
        look: None,
    };
    let op = GameData::with_class_rules(Some(&gd), op)?;
    apply_all(session, out, vec![op])
}

/// `nebula add`: a nebula named `name`, else as the app names one, from the install when
/// one is found and from the save's pool otherwise. An install `--install` names that
/// cannot be read is an error.
pub fn add_nebula(
    sav: &Path,
    out: Option<&Path>,
    (x, y, radius): (f64, f64, f64),
    name: Option<String>,
    opts: &LoadOptions,
) -> Run {
    let session = Session::open(sav)?;
    let name = match name {
        Some(name) => name,
        None => {
            let gd = match &opts.install {
                Some(_) => Some(game_data(opts)?),
                None => game_data(opts).ok(),
            };
            naming::nebula_name(&session, gd.as_ref(), NEBULA_SEED)
        }
    };
    let op = Op::AddNebula {
        x,
        y,
        radius,
        name: Some(name),
    };
    apply_all(session, out, vec![op])
}
