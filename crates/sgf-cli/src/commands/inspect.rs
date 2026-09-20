//! `sgf inspect`: the save header, the biggest sections and, with `--galaxy`, the graph.

use std::collections::HashSet;
use std::path::Path;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::projections::galaxy::{BypassLink, GalaxyGraph};

use super::{Outcome, Run, join, saves_only};

/// Sections listed, largest first; the tail is a long tail.
const SECTION_ROWS: usize = 15;

pub fn run(sav: &Path, galaxy: bool) -> Run {
    if let Some(outcome) = saves_only("inspect", sav) {
        return Ok(outcome);
    }
    let doc = Document::load(sav)?;
    let meta = archive::parse_meta(doc.meta())?;
    let total = doc.original().len();
    println!("version:   {}", meta.version);
    println!("name:      {}", meta.name);
    println!("date:      {}", meta.date);
    println!(
        "gamestate: {total} bytes, {} top-level statements",
        doc.index().sections().len()
    );
    println!();
    println!(
        "{:<28} {:>12} {:>6} {:>9}",
        "section", "bytes", "%", "entities"
    );
    for (key, bytes) in doc.section_sizes().iter().take(SECTION_ROWS) {
        let pct = bytes * 1000 / total.max(1);
        let entities = match doc.index().entities(key).len() {
            0 => "-".to_owned(),
            n => n.to_string(),
        };
        println!(
            "{key:<28} {bytes:>12} {:>5}.{} {entities:>9}",
            pct / 10,
            pct % 10
        );
    }
    if galaxy {
        println!();
        inspect_galaxy(&GalaxyGraph::build(&doc)?);
    }
    Ok(Outcome::Ok)
}

fn inspect_galaxy(g: &GalaxyGraph) {
    let mut undirected = HashSet::new();
    let mut bridges = HashSet::new();
    for system in g.systems.values() {
        for lane in &system.lanes {
            let pair = (system.id.min(lane.to), system.id.max(lane.to));
            undirected.insert(pair);
            if lane.bridge {
                bridges.insert(pair);
            }
        }
    }
    let components = g.components();
    let mut lane_less: Vec<u32> = g
        .systems
        .values()
        .filter(|s| s.lanes.is_empty())
        .map(|s| s.id)
        .collect();
    lane_less.sort_unstable();
    let (mut wormholes, mut gateways, mut lgates, mut other) = (0, 0, 0, 0);
    for link in &g.bypasses {
        match link {
            BypassLink::Wormhole { .. } => wormholes += 1,
            BypassLink::Gateway { .. } => gateways += 1,
            BypassLink::LGate { .. } => lgates += 1,
            BypassLink::Other { .. } => other += 1,
        }
    }
    println!("systems:    {}", g.systems.len());
    println!(
        "lanes:      {} undirected ({} directed), {} bridge",
        undirected.len(),
        g.systems.values().map(|s| s.lanes.len()).sum::<usize>(),
        bridges.len()
    );
    println!(
        "components: {} (sizes {})",
        components.len(),
        join(components.iter().map(Vec::len))
    );
    println!("lane-less:  {} ({})", lane_less.len(), join(lane_less));
    println!("nebulae:    {}", g.nebulae.len());
    println!(
        "bypasses:   {wormholes} wormhole, {gateways} gateway, {lgates} l-gate, {other} other"
    );
    println!("radius:     {} (core {})", g.galaxy_radius, g.core_radius);
}
