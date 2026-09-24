//! `sgf add-system --generate`: a system rolled from the install's rules, then added as
//! a spec would be.

use std::path::Path;

use sgf_core::ops::{BodySpec, Op, SystemSpec};
use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate::{generate, generate_layout_for, pick_system_name, settle_name};
use sgf_gamedata::layouts::SaveFacts;

use super::{Outcome, Run, game_data, mutate};

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
    /// A system to remove again once the generated one is added.
    pub then_remove: Option<u32>,
}

pub fn run(sav: &Path, out: Option<&Path>, generating: Generate, opts: &LoadOptions) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let pooled = || {
        pick_system_name(&session, &gd, generating.seed)
            .ok_or("no star name is left that the save does not use; pass --name")
    };
    let fallback = match &generating.name {
        Some(name) => name.clone(),
        None => pooled()?,
    };
    let abundance = gd.deposit_defines.abundance(session.resource_abundance());
    let mut spec = match &generating.layout {
        Some(layout) => generate_layout_for(
            &gd,
            &SaveFacts::read(&session),
            generating.seed,
            &fallback,
            generating.at,
            layout,
            abundance,
        )?,
        None => generate(
            &gd,
            generating.seed,
            &fallback,
            generating.at,
            generating.star_class.as_deref(),
            abundance,
        )?,
    };
    match generating.name {
        Some(name) => spec.name = name,
        None => settle_name(&session, &gd, &mut spec, &fallback, generating.seed),
    }
    spec.lanes = generating.lanes;
    if generating.print_spec {
        println!("{}", serde_json::to_string_pretty(&spec)?);
        return Ok(Outcome::Ok);
    }
    print_summary(&spec, generating.seed);
    let mut ops = vec![Op::AddSaveSystem { spec }];
    ops.extend(generating.then_remove.map(|id| Op::RemoveSystem { id }));
    mutate::apply_all(session, out, ops)
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
