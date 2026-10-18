//! `sgf add-system`: a system rolled from the install's rules and added to a save; then, as
//! the app allows for a system added in the same session, rolled again or removed.

use std::path::Path;

use sgf_core::ops::{BodyKind, BodySpec, LaneEnd, Op, PrimaryName, SystemSpec};
use sgf_core::session::Session;
use sgf_core::views::Capabilities;
use sgf_gamedata::generate::{self, BuiltSystem, ForSaveError, GenerateError, Pick};
use sgf_gamedata::multi_star::{FiledReason, file_star_class};
use sgf_gamedata::{GameData, LoadOptions};

use super::{Outcome, Run, game_data, mutate};

const NONE_ADDED: &str = "none of the systems --then-remove names was added by this command";
const NO_NAMES: &str = "no star name is left that the save does not use; pass --name";
const NO_BUILT: &str = "this document takes no built binary or trinary systems";

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
    /// The binary or trinary to build star by star, in place of a drawn system.
    pub built: Option<BuiltSystem>,
    /// Roll a system of this many stars among the plain layouts that place them.
    pub star_count: Option<usize>,
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
    let pick = match (&generating.layout, &generating.built, generating.star_count) {
        (Some(layout), _, _) => Pick::Layout(layout.clone()),
        (None, Some(built), _) => Pick::Built(built.clone()),
        (None, None, Some(count)) => Pick::Stars(count),
        (None, None, None) => Pick::Random(generating.star_class.clone()),
    };
    if matches!(pick, Pick::Built(_) | Pick::Stars(_))
        && !Capabilities::of(session.doc()).added_systems
    {
        return Err(NO_BUILT.into());
    }
    if let Pick::Built(built) = &pick {
        eprintln!("{}", filed_line(&gd, built)?);
    }
    let (spec, op) = match (&pick, generating.print_spec) {
        (Pick::Layout(_) | Pick::Built(_), false) => {
            let lanes: Vec<(LaneEnd, LaneEnd)> = generating
                .lanes
                .iter()
                .map(|&system| (LaneEnd::Held { system }, LaneEnd::New { index: 0 }))
                .collect();
            let op = generate::pick_op(
                &gd,
                &session,
                seed,
                at,
                &pick,
                generating.extras,
                generating.name.as_deref(),
                &lanes,
            )
            .map_err(for_save_error)?;
            (added_spec(&op).cloned(), Some(op))
        }
        _ => {
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
        let pick = match (generating.built, generating.star_count) {
            (Some(built), _) => Pick::Built(built),
            (None, Some(count)) => Pick::Stars(count),
            (None, None) => Pick::of_added(
                &session,
                &gd,
                system,
                generating.keep_special,
                generating.star_class,
            )?,
        };
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

/// The class the builder's rule files `built`'s stars under and why, in the game's names:
/// "filed as Pulsar: no class with 3 stars has a Pulsar".
fn filed_line(gd: &GameData, built: &BuiltSystem) -> Result<String, GenerateError> {
    let filed = file_star_class(gd, &built.stars, built.star_class.as_deref())?;
    let name = |key: &str| gd.loc.name_or_readable(key);
    let count = built.stars.len();
    let first = built
        .stars
        .first()
        .map_or_else(String::new, |star| name(star));
    let why = match &filed.reason {
        FiledReason::Exact => "its stars are the class's own".to_owned(),
        FiledReason::EffectStar { star } => format!(
            "the {} has effects, and this class with {} has one",
            name(star),
            stars(count)
        ),
        FiledReason::EffectStarAlone { star } => {
            format!("no class with {} has a {}", stars(count), name(star))
        }
        FiledReason::MostShared { shared } => format!(
            "it shares {shared} of the {count} stars, the most of any class with {}",
            stars(count)
        ),
        FiledReason::FirstStar => format!(
            "no class with {} shares a star, so the {first}'s own class",
            stars(count)
        ),
        FiledReason::Commonest => format!(
            "no class with {} shares a star and the {first} has no class of its own, so the \
             commonest class with {}",
            stars(count),
            stars(count)
        ),
        FiledReason::Chosen => "chosen".to_owned(),
    };
    // The game names every binary "Binary Stars", so a class of several stars goes by them.
    let class = match gd.star_classes.get(&filed.class) {
        Some(class) if class.planets.len() > 1 => class
            .planet_keys()
            .map(name)
            .collect::<Vec<_>>()
            .join(" + "),
        _ => name(&filed.class),
    };
    Ok(format!("filed as {class}: {why}"))
}

/// `1 star`, `3 stars`.
fn stars(n: usize) -> String {
    match n {
        1 => "1 star".to_owned(),
        n => format!("{n} stars"),
    }
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
    let named = match &spec.star_name {
        PrimaryName::Lettered => String::new(),
        PrimaryName::System => " (named after the system)".to_owned(),
        PrimaryName::Fixed(name) => format!(" name {name}"),
    };
    println!("  star {}{named}", body(&spec.star));
    print_satellites(&spec.star);
    for (i, planet) in spec.planets.iter().enumerate() {
        println!("  {:<4} {}", i + 1, body(planet));
        match planet.kind {
            BodyKind::Star => print_satellites(planet),
            BodyKind::Planet | BodyKind::Asteroid => {
                for moon in &planet.moons {
                    println!("       moon {}", body(moon));
                }
            }
        }
    }
}

/// The planets of `star` and their moons.
fn print_satellites(star: &BodySpec) {
    for (i, planet) in star.moons.iter().enumerate() {
        println!("       {:<4} {}", i + 1, body(planet));
        for moon in &planet.moons {
            println!("            moon {}", body(moon));
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
    match body.kind {
        BodyKind::Asteroid => text.push_str(" (asteroid)"),
        BodyKind::Star => text.push_str(" (star)"),
        BodyKind::Planet => {}
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
