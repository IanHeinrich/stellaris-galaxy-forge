//! `sgf add-system`: a system rolled from the install's rules and added to a save; then, as
//! the app allows for a system added in the same session, rolled again or removed.

use std::path::Path;

use sgf_core::ops::{BodySpec, LaneEnd, Op, SystemSpec};
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
    /// The Special menu cluster to add, its home at `at`, in place of one system.
    pub cluster: Option<String>,
    /// Write the layout's anomalies and dig sites too, as the app does.
    pub extras: bool,
    pub print_spec: bool,
    /// A seed to roll the added system again from, keeping its name and position.
    pub then_reroll: Option<u64>,
    /// On the roll again, build a Special menu layout's system from that layout again.
    pub keep_special: bool,
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
    let (seed, at) = (generating.seed, generating.at);
    if let Some(cluster) = &generating.cluster {
        let joins: Vec<(usize, u32)> = generating.lanes.iter().map(|&system| (0, system)).collect();
        let op = generate::cluster_op(&gd, &session, seed, at, cluster, generating.extras, &joins)
            .map_err(for_save_error)?;
        let Op::Batch { description, ops } = &op else {
            return Err("the cluster's add is no batch".into());
        };
        println!("{description}");
        for added in ops.iter().filter_map(added_spec) {
            print_summary(added, seed);
        }
        let mut issues = mutate::apply(&mut session, vec![op])?;
        remove_added(&mut session, then_remove, &mut issues)?;
        return mutate::save(session, out, &issues);
    }
    let (spec, op) = match (&generating.layout, generating.print_spec) {
        (Some(layout), false) => {
            let lanes: Vec<(LaneEnd, LaneEnd)> = generating
                .lanes
                .iter()
                .map(|&system| (LaneEnd::Held { system }, LaneEnd::New { index: 0 }))
                .collect();
            let op = generate::special_op_with(
                &gd,
                &session,
                seed,
                at,
                layout,
                generating.extras,
                generating.name.as_deref(),
                &lanes,
            )
            .map_err(for_save_error)?;
            (added_spec(&op).cloned(), Some(op))
        }
        (layout, _) => {
            let pick = match layout {
                Some(layout) => Pick::Layout(layout.clone()),
                None => Pick::Random(generating.star_class.clone()),
            };
            let mut spec = match &generating.name {
                Some(name) => pick.spec(&gd, &session, seed, name, at)?,
                None => {
                    generate::for_save(&gd, &session, seed, at, &pick).map_err(for_save_error)?
                }
            };
            spec.lanes = generating.lanes;
            (Some(spec), None)
        }
    };
    let spec = spec.ok_or("the add holds no system")?;
    if generating.print_spec {
        println!("{}", serde_json::to_string_pretty(&spec)?);
        return Ok(Outcome::Ok);
    }
    print_summary(&spec, seed);
    let op = op.unwrap_or(Op::AddSystemFromSpec { spec });
    let mut issues = mutate::apply(&mut session, vec![op])?;
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
        issues = mutate::apply(
            &mut session,
            vec![Op::ReplaceSystemFromSpec { system, spec }],
        )?;
    }
    remove_added(&mut session, then_remove, &mut issues)?;
    mutate::save(session, out, &issues)
}

/// The error `--generate` reports for a refused roll.
fn for_save_error(error: ForSaveError) -> String {
    match error {
        ForSaveError::NoNames => NO_NAMES.to_owned(),
        error => error.to_string(),
    }
}

/// The spec of the first system `op` adds: the op itself, or the first of its batch.
fn added_spec(op: &Op) -> Option<&SystemSpec> {
    match op {
        Op::AddSystemFromSpec { spec } => Some(spec),
        Op::Batch { ops, .. } => ops.iter().find_map(added_spec),
        _ => None,
    }
}

/// The system added last, which takes the highest id of those added.
fn last_added(session: &Session) -> u32 {
    session
        .graph()
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
    *issues = mutate::apply(session, vec![Op::RemoveSystems { systems: added }])?;
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
