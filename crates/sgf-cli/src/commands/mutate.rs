//! The editing commands that apply ops as the arguments give them (`move`, `move-nebula`,
//! `nebula`, `header`, `lane`, `spawn`, `isolate`, `star`, `move-planet`, `planet-size`,
//! `planet-class`, `deposit`, `dig-site`): the ops, then a save.

use std::path::Path;

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{Op, OpError, SystemSpec};
use sgf_core::session::Session;
use sgf_core::validate::Issue;

use sgf_gamedata::{LoadOptions, naming};

use super::{Outcome, Run, game_data, print_issues};

/// The draw an unnamed nebula takes its name from, so the same save names it the same way.
const NEBULA_SEED: u64 = 0;

/// Open a session, apply one op, report it and save (to `out`, or in place with a backup).
pub fn run(sav: &Path, out: Option<&Path>, op: Op) -> Run {
    run_all(sav, out, vec![op])
}

/// [`run`] for several ops, applied in order in the one session, each reported, and the
/// findings once after the last.
pub fn run_all(sav: &Path, out: Option<&Path>, ops: Vec<Op>) -> Run {
    apply_all(Session::open(sav)?, out, ops)
}

/// [`run_all`] on a session already open.
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

/// `dig-site --remove`: the dig site planet `planet` has.
pub fn remove_dig_site(sav: &Path, out: Option<&Path>, planet: u32) -> Run {
    let session = Session::open(sav)?;
    let site = get_planet_page(&session.doc, planet)?
        .dig_site
        .ok_or_else(|| format!("planet {planet} has no dig site"))?;
    apply_all(session, out, vec![Op::RemoveDigSite { site: site.id }])
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
    let held = get_planet_page(&session.doc, planet)?.class;
    let gd = game_data(opts)?;
    let rule = |class: &str| {
        gd.planet_class_rule(class)
            .ok_or_else(|| format!("the install has no planet class {class}"))
    };
    let op = Op::SetPlanetClass {
        planet,
        from: rule(&held)?,
        to: rule(class)?,
        look: None,
    };
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

/// A spawn weight, or `none` to clear it.
pub fn spawn_base(text: &str) -> Result<Option<f64>, String> {
    if text.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    text.parse()
        .map(Some)
        .map_err(|_| format!("{text} is neither a number nor \"none\""))
}

/// The system `add-system` reads from a JSON file.
pub fn system_spec(path: &Path) -> Result<SystemSpec, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}
