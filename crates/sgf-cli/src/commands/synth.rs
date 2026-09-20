//! `sgf synth`: write the synthetic save `sgf_core::synth` generates.

use std::path::PathBuf;

use sgf_core::archive;
use sgf_core::synth::{self, SynthOptions};

use super::{Outcome, Run};

pub fn run(systems: u32, seed: u64, waystations: &[Vec<u32>], out: PathBuf) -> Run {
    let generated = synth::galaxy(&SynthOptions {
        systems,
        seed,
        waystation_networks: waystations.to_vec(),
    })?;
    archive::write_sav(
        &out,
        std::iter::once(generated.gamestate.as_slice()),
        &generated.meta,
    )?;
    println!(
        "wrote {} ({systems} systems, {} lanes, {} waystation network(s))",
        out.display(),
        generated.lanes,
        waystations.len()
    );
    Ok(Outcome::Ok)
}
