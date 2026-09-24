//! `sgf add-system --generate`: a system rolled from the install's rules, then added as
//! a spec would be.

use std::path::Path;

use sgf_core::ops::{BodySpec, Op, SystemSpec, free_star_names};
use sgf_core::session::Session;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate::{generate, pick_name};

use super::{Outcome, Run, game_data, mutate};

/// What `--generate` rolls and where it puts it.
pub struct Generate {
    pub seed: u64,
    pub at: (f64, f64),
    pub lanes: Vec<u32>,
    pub name: Option<String>,
    pub print_spec: bool,
    /// A system to remove again once the generated one is added.
    pub then_remove: Option<u32>,
}

pub fn run(sav: &Path, out: Option<&Path>, generating: Generate, opts: &LoadOptions) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let name = match generating.name {
        Some(name) => name,
        None => pick_name(&free_star_names(&session.doc), generating.seed)
            .ok_or("the save has no star names left in its pool; pass --name")?
            .to_owned(),
    };
    let (x, y) = generating.at;
    let mut spec = generate(&gd, generating.seed, &name, x, y)?;
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
    println!(
        "seed {seed}: {} {} ({})",
        spec.name, spec.star_class, spec.initializer
    );
    println!("  star {}", body(&spec.star));
    for (i, planet) in spec.planets.iter().enumerate() {
        println!("  {:<4} {}", i + 1, body(planet));
        for moon in &planet.moons {
            println!("       moon {}", body(moon));
        }
    }
}

fn body(body: &BodySpec) -> String {
    format!(
        "{} size {} orbit {} angle {}",
        body.class, body.size, body.orbit, body.angle
    )
}
