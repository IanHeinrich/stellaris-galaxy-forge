//! `sgf add-system`: systems from JSON specs, or one rolled from the install's rules, added
//! to a save; then, as the app allows for a system added in the same session, rolled again
//! or removed.

use std::path::{Path, PathBuf};

use sgf_core::ops::{BodySpec, Op, SystemSpec};
use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate::{self, ForSaveError, Pick};

use super::{Outcome, Run, game_data, mutate};

const NONE_ADDED: &str = "none of the systems --then-remove names was added by this command";
const NO_NAMES: &str = "no star name is left that the save does not use; pass --name";

/// What `--generate` rolls and where it puts it.
pub struct Generate {
    pub seed: u64,
    pub at: (f64, f64),
    pub lanes: Vec<u32>,
    pub name: Option<String>,
    /// The star class to roll the system around; any the plain layouts draw otherwise.
    pub star_class: Option<String>,
    /// The layout to build the system from, in place of a drawn one.
    pub layout: Option<String>,
    pub print_spec: bool,
    /// A seed to roll the added system again from, keeping its name and position.
    pub then_reroll: Option<u64>,
    /// On the roll again, build a Special menu layout's system from that layout again.
    pub keep_special: bool,
}

/// Add the system each spec file holds, in order, then remove those of `then_remove` it added.
pub fn from_specs(sav: &Path, out: Option<&Path>, specs: &[PathBuf], then_remove: &[u32]) -> Run {
    let mut session = Session::open(sav)?;
    let ops = specs
        .iter()
        .map(|path| {
            Ok(Op::AddSaveSystem {
                spec: mutate::system_spec(path)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut issues = mutate::apply(&mut session, ops)?;
    remove_added(&mut session, then_remove, &mut issues)?;
    mutate::save(session, out, &issues)
}

/// Add the system `generating` rolls, then roll it again and remove those of `then_remove`
/// it added, as asked.
pub fn generated(
    sav: &Path,
    out: Option<&Path>,
    generating: Generate,
    then_remove: &[u32],
    opts: &LoadOptions,
) -> Run {
    let gd = game_data(opts)?;
    let mut session = Session::open(sav)?;
    let pick = match generating.layout {
        Some(layout) => Pick::Layout(layout),
        None => Pick::Random(generating.star_class.clone()),
    };
    let (seed, at) = (generating.seed, generating.at);
    let mut spec = match generating.name {
        Some(name) => SystemSpec {
            name: name.clone(),
            ..pick.spec(&gd, &session, seed, &name, at)?
        },
        None => generate::for_save(&gd, &session, seed, at, &pick).map_err(|e| match e {
            ForSaveError::NoNames => NO_NAMES.to_owned(),
            e => e.to_string(),
        })?,
    };
    spec.lanes = generating.lanes;
    if generating.print_spec {
        println!("{}", serde_json::to_string_pretty(&spec)?);
        return Ok(Outcome::Ok);
    }
    print_summary(&spec, seed);
    let mut issues = mutate::apply(&mut session, vec![Op::AddSaveSystem { spec }])?;
    if let Some(seed) = generating.then_reroll {
        let system = last_added(&session);
        let pick = Pick::of_added(
            &session,
            &gd,
            system,
            generating.keep_special,
            generating.star_class,
        )?;
        let spec = generate::reroll(&gd, &session, seed, system, &pick)?;
        print_summary(&spec, seed);
        issues = mutate::apply(&mut session, vec![Op::ReplaceSaveSystem { system, spec }])?;
    }
    remove_added(&mut session, then_remove, &mut issues)?;
    mutate::save(session, out, &issues)
}

/// The system added last, which takes the highest id of those added.
fn last_added(session: &Session) -> u32 {
    session
        .graph
        .systems
        .values()
        .filter(|s| s.added)
        .map(|s| s.id)
        .max()
        .unwrap_or_default()
}

/// Remove the systems among `ids` this command added, as one step; none of them is refused.
fn remove_added(
    session: &mut Session,
    ids: &[u32],
    issues: &mut Vec<sgf_core::validate::Issue>,
) -> Result<(), Box<dyn std::error::Error>> {
    if ids.is_empty() {
        return Ok(());
    }
    let added = generate::added_among(session, ids.iter().copied());
    if added.is_empty() {
        return Err(NONE_ADDED.into());
    }
    *issues = mutate::apply(session, vec![Op::RemoveSystems { ids: added }])?;
    Ok(())
}

fn print_summary(spec: &SystemSpec, seed: u64) {
    let capped = if spec.capped { ", capped" } else { "" };
    println!(
        "seed {seed}: {} {} ({}{capped})",
        spec.name, spec.star_class, spec.initializer
    );
    for belt in &spec.belts {
        println!("  belt {} at {}", belt.kind, belt.inner_radius);
    }
    let named = if spec.star_named_by_class {
        " (named after the system)"
    } else {
        ""
    };
    println!("  star {}{named}", body(&spec.star));
    for (i, planet) in spec.planets.iter().enumerate() {
        println!("  {:<4} {}", i + 1, body(planet));
        for moon in &planet.moons {
            println!("       moon {}", body(moon));
        }
    }
}

fn body(body: &BodySpec) -> String {
    let mut text = format!(
        "{} size {} orbit {} angle {}",
        body.class, body.size, body.orbit, body.angle
    );
    if let Some(name) = &body.name {
        text.push_str(&format!(" name {name}"));
    }
    if body.asteroid {
        text.push_str(" (asteroid)");
    }
    if body.ring {
        text.push_str(" ring");
    }
    if let Some(entity) = &body.entity_name {
        text.push_str(&format!(" entity {entity}"));
    }
    if !body.modifiers.is_empty() {
        text.push_str(&format!(" modifiers {}", body.modifiers.join(" ")));
    }
    if !body.deposits.is_empty() {
        text.push_str(&format!(" deposits {}", body.deposits.join(" ")));
    }
    text
}
