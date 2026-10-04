//! Several systems' initializers, spawns or fallen empire zones as one undo step: a
//! `Batch` of the singular op per entry, named as the app names it.

use sgf_core::format::scenario::FeZone;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::SpawnScript;

fn batch<T>(entries: Vec<(u32, T)>, what: &str, op: impl Fn(u32, T) -> Op) -> Op {
    let count = entries.len();
    let systems = if count == 1 { "system" } else { "systems" };
    Op::Batch {
        description: format!("{what} {count} {systems}"),
        ops: entries
            .into_iter()
            .map(|(id, value)| op(id, value))
            .collect(),
    }
}

pub fn initializers(entries: Vec<(u32, Option<String>)>) -> Op {
    batch(entries, "Set initializer of", |system, initializer| {
        Op::SetInitializer {
            system,
            initializer,
        }
    })
}

pub fn spawn_weights(entries: Vec<(u32, Option<f64>)>) -> Op {
    batch(entries, "Set the spawn weight of", |system, base| {
        Op::SetSpawnWeight { system, base }
    })
}

pub fn spawn_scripts(entries: Vec<(u32, Option<SpawnScript>)>) -> Op {
    batch(entries, "Set the scripted spawn of", |system, script| {
        Op::SetSpawnScript { system, script }
    })
}

pub fn fe_zones(entries: Vec<(u32, Option<FeZone>)>) -> Op {
    batch(entries, "Set the fallen empire zone of", |system, zone| {
        Op::SetFeZone { system, zone }
    })
}
