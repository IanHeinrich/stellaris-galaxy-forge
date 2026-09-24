//! The scenario-script side of the seam: reading a `static_galaxy_scenario` into the
//! same galaxy the map draws from a save.
//!
//! Positions are absolute and carry no length, so a lane's length is measured from the
//! two ends and nebula membership follows the radii rather than a member list.

pub(crate) mod emit;
pub mod fe_link;
pub mod fe_zone;
pub mod header_counts;
pub mod index;
pub mod listings;
pub mod marauder;
pub mod paint;
pub(crate) mod provenance;
pub(crate) mod spawn;
pub mod summary;
pub(crate) mod write;

pub use fe_link::FeLinkFlags;
pub use fe_zone::{FeDirection, FeKind, FeZone};
pub use marauder::MarauderRole;
pub use paint::is_painted;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::archive;
use crate::cst::{self, CstError, Node};
use crate::document::{self, Document};
use crate::format::Format;
use crate::format::scenario::index::{
    Changes, SCENARIO_X_SIGN, SCENARIO_Y_SIGN, ScenarioIndex, index,
};
use crate::keys::scenario as keys;
use crate::ops::{Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::projections::galaxy::{
    Galaxy, GalaxyGraph, Lane, Nebula, ProjectionError, SpawnModifier, SystemNode, lane_length,
};
use crate::projections::name::{NameTemplate, looks_like_key};
use crate::projections::read;
use crate::session::Session;
use crate::validate::{Issue, IssueCode};
use crate::views::{Capabilities, DocumentKind};

pub(crate) struct Scenario;

impl Format for Scenario {
    fn build_graph(&self, doc: &Document) -> Result<GalaxyGraph, ProjectionError> {
        Ok(GalaxyGraph::from_galaxy(galaxy(doc)?))
    }

    fn parse(&self, bytes: &[u8], base: usize) -> Result<Node, CstError> {
        cst::parse_script(bytes, base)
    }

    fn statement(&self, doc: &Document, subject: Subject) -> Result<Anchor, OpError> {
        let scenario = index(doc);
        match subject {
            Subject::System(id) => scenario.system(id).ok_or(OpError::UnknownSystem(id)),
            Subject::Nebula(i) => scenario.nebula(i).ok_or(OpError::UnknownNebula(i)),
            Subject::Statement { anchor, .. }
            | Subject::Header(anchor)
            | Subject::Record(anchor) => Ok(anchor),
            Subject::Planet { id, .. } => Err(OpError::UnknownPlanet(id)),
            Subject::Flags => Err(OpError::NoFlags),
            Subject::Country(id) => Err(OpError::UnknownCountry(id)),
        }
    }

    /// A scenario stores no member lists, so membership is re-derived from the radii; the
    /// systems it moves are the op's to report, exactly as the save side reports the ones
    /// its member-line edits reassigned.
    fn refresh(
        &self,
        doc: &mut Document,
        graph: &mut GalaxyGraph,
        _touched: &[Subject],
        slots: &[Anchor],
    ) -> Result<Vec<Subject>, OpError> {
        let changes = doc.refresh_scenario(slots)?;
        let reassigned = follow(doc, graph, &changes)?;
        Ok(reassigned.into_iter().map(Subject::System).collect())
    }

    fn write(&self, plan: &mut Plan, session: &Session, op: &Op) -> Result<Planned, OpError> {
        write::write(plan, session, op)
    }

    fn save(
        &self,
        doc: &Document,
        path: &Path,
        progress: &mut dyn FnMut(f64),
    ) -> Result<Option<PathBuf>, document::Error> {
        let (dropped, head) = provenance::stamp(doc);
        let pieces =
            std::iter::once(head.as_slice()).chain(provenance::skip(doc.pieces(), dropped));
        Ok(archive::write_text_with(path, pieces, progress)?)
    }

    fn title(&self, doc: &Document) -> String {
        index(doc).header.name.clone()
    }

    fn issues(&self, doc: &Document) -> Vec<Issue> {
        if !index(doc).header.has_coordinate_transform {
            return Vec::new();
        }
        vec![Issue::new(
            IssueCode::CoordinateTransform,
            "the scenario has a coordinate_transform; positions are shown untransformed".to_owned(),
            Vec::new(),
        )]
    }

    /// A scenario's systems carry none of the keys the curated rows read.
    fn curates_entities(&self) -> bool {
        false
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            empires: true,
            details: false,
            lane_lengths: false,
            nebulae: true,
            bypasses: false,
            special: true,
            create_systems: true,
            lane_bridges: false,
            waylines: false,
        }
    }
}

/// Project the whole scenario: systems, the lanes between them, and the nebulae covering
/// them, as [`follow`] brings an empty galaxy in step with every statement.
fn galaxy(doc: &Document) -> Result<Galaxy, ProjectionError> {
    let mut galaxy = Galaxy {
        systems: HashMap::new(),
        order: Vec::new(),
        nebulae: Vec::new(),
        bypasses: Vec::new(),
        waystations: Vec::new(),
        waylines: Vec::new(),
        galaxy_radius: 0.0,
        core_radius: 0.0,
        header: Vec::new(),
        kind: DocumentKind::Scenario,
        setup: None,
        player_country: None,
        lgate: None,
    };
    let everything = Changes {
        systems: index(doc).order().iter().copied().collect(),
        nebulae: true,
        ..Changes::default()
    };
    follow(doc, &mut galaxy, &everything)?;
    Ok(galaxy)
}

/// Bring the projection in step with what a refresh of the index found changed, reading
/// only the statements it names: the systems whose statements changed, the lanes of every
/// system a changed statement names or neighbours, and the nebula membership of the
/// systems that changed, all of it when a nebula did. Returns the systems held before and
/// after whose nebula changed, ascending.
fn follow(
    doc: &Document,
    graph: &mut Galaxy,
    changes: &Changes,
) -> Result<Vec<u32>, ProjectionError> {
    let scenario = index(doc);
    let before: HashMap<u32, Option<usize>> = if changes.nebulae {
        graph.systems.values().map(|s| (s.id, s.nebula)).collect()
    } else {
        changes
            .systems
            .iter()
            .filter_map(|id| Some((*id, graph.systems.get(id)?.nebula)))
            .collect()
    };
    let mut relay = changes.lanes.clone();
    for &id in &changes.systems {
        match scenario.system(id) {
            Some(anchor) => {
                let (src, node) = statement(doc, anchor)?;
                graph.systems.insert(id, system(id, &node, src));
            }
            None => {
                graph.systems.remove(&id);
            }
        }
        relay.insert(id);
        relay.extend(scenario.lanes_naming(id).flat_map(|l| [l.from, l.to]));
    }
    for id in relay {
        lay_lanes(&mut graph.systems, scenario, id);
    }

    graph.order = scenario.order().to_vec();
    graph.galaxy_radius = galaxy_radius(&graph.systems);
    graph.core_radius = scenario.header.core_radius.unwrap_or(0.0);
    graph.header = scenario.header.fields();
    graph.bypasses = paint::wormhole_pairs(graph);
    if changes.nebulae {
        let mut nebulae = Vec::new();
        for &anchor in scenario.nebulae() {
            let (src, node) = statement(doc, anchor)?;
            nebulae.push(nebula(&node, src));
        }
        graph.set_nebulae_by_radius(nebulae);
    } else {
        graph.place_by_radius(changes.systems.iter().copied());
    }
    let mut reassigned: Vec<u32> = before
        .into_iter()
        .filter(|(id, was)| graph.systems.get(id).is_some_and(|s| s.nebula != *was))
        .map(|(id, _)| id)
        .collect();
    reassigned.sort_unstable();
    Ok(reassigned)
}

/// System `id`'s lanes and prevented pairs, from the statements naming it: one lane per
/// other end, whichever way round and however many times the file lists it, and every
/// other end a `prevent_hyperlane` names, ascending. A prevented pair is not a lane: it
/// says the generator may not add one where it otherwise would.
fn lay_lanes(systems: &mut HashMap<u32, SystemNode>, scenario: &ScenarioIndex, id: u32) {
    if !systems.contains_key(&id) {
        return;
    }
    let mut lanes = Vec::new();
    let mut prevented = Vec::new();
    let mut seen: HashSet<(u32, u32)> = HashSet::new();
    for stmt in scenario.lanes_naming(id) {
        if stmt.prevent {
            prevented.extend((stmt.from == id).then_some(stmt.to));
            prevented.extend((stmt.to == id).then_some(stmt.from));
            continue;
        }
        let pair = (stmt.from.min(stmt.to), stmt.from.max(stmt.to));
        if !seen.insert(pair) {
            continue;
        }
        let length = match (systems.get(&pair.0), systems.get(&pair.1)) {
            (Some(a), Some(b)) => lane_length(a, b),
            _ => 0.0,
        };
        lanes.push(Lane {
            to: if stmt.from == id { stmt.to } else { stmt.from },
            length,
            bridge: false,
            stale: false,
        });
    }
    prevented.sort_unstable();
    prevented.dedup();
    if let Some(system) = systems.get_mut(&id) {
        system.lanes = lanes;
        system.prevented = prevented;
    }
}

/// The map's extent: the distance of the farthest system from the centre, rounded up.
fn galaxy_radius(systems: &HashMap<u32, SystemNode>) -> f64 {
    systems
        .values()
        .map(|s| s.x.hypot(s.y))
        .fold(0.0f64, f64::max)
        .ceil()
}

fn system(id: u32, node: &Node, src: &[u8]) -> SystemNode {
    let (x, y) = position(node, src);
    let initializer = read::text(node, keys::INITIALIZER, src);
    SystemNode {
        id,
        name: name(node, src),
        x,
        y,
        star_class: String::new(),
        lanes: Vec::new(),
        nebula: None,
        bypass_ids: Vec::new(),
        planet_count: 0,
        bodies: None,
        marauder: marauder::role(&initializer),
        initializer,
        spawn_weight: spawn_weight(node, src),
        spawn_modifiers: spawn_modifiers(node, src),
        spawn_script: node
            .find(keys::SPAWN_WEIGHT, src)
            .and_then(|weight| paint::recognise(weight, src)),
        spawn_design: read::scalar(node, keys::SPAWN_DESIGN, src).map(str::to_owned),
        fe_zone: node
            .find(keys::EFFECT, src)
            .and_then(|effect| fe_zone::parse(fe_zone::star_flags(effect, src))),
        wormhole_pair: node
            .find(keys::EFFECT, src)
            .and_then(|effect| paint::wormhole_pair(fe_zone::star_flags(effect, src))),
        fe_link: node
            .find(keys::EFFECT, src)
            .map(|effect| fe_link::parse(fe_zone::star_flags(effect, src)))
            .unwrap_or_default(),
        prevented: Vec::new(),
        position_range: position_range(node, src),
        flags: Vec::new(),
        owner: None,
        added: false,
    }
}

/// `spawn_weight = { base = N }`, the weight the generator places an empire by. A block
/// stating no `base` (the mods' `modifier`-only idiom) reads as `None` rather than 0,
/// because the modifiers that would decide such a weight are script this editor does not
/// read, and 0 would report the system unspawnable.
fn spawn_weight(node: &Node, src: &[u8]) -> Option<f64> {
    let weight = node.find(keys::SPAWN_WEIGHT, src)?;
    read::scalar(weight, keys::BASE, src)?
        .parse()
        .ok()
        .filter(|w: &f64| w.is_finite())
}

/// The `modifier` blocks of the `spawn_weight`, in file order: what each adds to the
/// weight and the trigger it adds it under, read as text and written back byte for byte.
fn spawn_modifiers(node: &Node, src: &[u8]) -> Vec<SpawnModifier> {
    let Some(weight) = node.find(keys::SPAWN_WEIGHT, src) else {
        return Vec::new();
    };
    weight
        .find_all(keys::MODIFIER, src)
        .map(|m| spawn::modifier(m, src))
        .collect()
}

/// Whether either axis is written as `{ min = a max = b }`.
fn position_range(node: &Node, src: &[u8]) -> bool {
    let Some(position) = node.find(keys::POSITION, src) else {
        return false;
    };
    [keys::X, keys::Y]
        .iter()
        .filter_map(|key| position.find(key, src))
        .any(|axis| axis.scalar_str(src).is_none())
}

fn nebula(node: &Node, src: &[u8]) -> Nebula {
    let (x, y) = position(node, src);
    Nebula {
        name: name(node, src),
        x,
        y,
        radius: read::scalar(node, keys::RADIUS, src)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0),
        systems: Vec::new(),
    }
}

/// `position={ x=… y=… }`, with the signs the map plots in; `z` is not a map coordinate.
fn position(node: &Node, src: &[u8]) -> (f64, f64) {
    let Some(position) = node.find(keys::POSITION, src) else {
        return (0.0, 0.0);
    };
    (
        axis(position, keys::X, src) * SCENARIO_X_SIGN,
        axis(position, keys::Y, src) * SCENARIO_Y_SIGN,
    )
}

/// One axis: a number, or a `{ min=… max=… }` range the generator picks from, read as
/// its midpoint.
fn axis(position: &Node, key: &str, src: &[u8]) -> f64 {
    let Some(node) = position.find(key, src) else {
        return 0.0;
    };
    if let Some(text) = node.scalar_str(src) {
        return text.parse().unwrap_or(0.0);
    }
    let bound = |key: &str| -> Option<f64> { read::scalar(node, key, src)?.parse().ok() };
    match (bound(keys::MIN), bound(keys::MAX)) {
        (Some(min), Some(max)) => (min + max) / 2.0,
        (Some(one), None) | (None, Some(one)) => one,
        (None, None) => 0.0,
    }
}

fn name(node: &Node, src: &[u8]) -> NameTemplate {
    let text = read::scalar(node, keys::NAME, src).unwrap_or_default();
    if text.is_empty() {
        return NameTemplate::default();
    }
    if looks_like_key(text) {
        NameTemplate::plain(text)
    } else {
        NameTemplate {
            key: text.to_owned(),
            literal: true,
            variables: Vec::new(),
        }
    }
}

/// The current bytes of one statement and its parsed `key=` node.
fn statement(doc: &Document, anchor: Anchor) -> Result<(&[u8], Node), ProjectionError> {
    let src = doc
        .current(anchor)
        .map_err(|e| ProjectionError::SectionField {
            section: keys::STATIC_GALAXY_SCENARIO,
            reason: e.to_string(),
        })?;
    let root = cst::parse_script(src, 0).map_err(|source| ProjectionError::Section {
        section: keys::STATIC_GALAXY_SCENARIO,
        source,
    })?;
    let node = root
        .children()
        .first()
        .cloned()
        .ok_or_else(|| empty(anchor))?;
    Ok((src, node))
}

fn empty(anchor: Anchor) -> ProjectionError {
    ProjectionError::Section {
        section: keys::STATIC_GALAXY_SCENARIO,
        source: CstError {
            offset: anchor.start(),
            reason: "empty statement",
        },
    }
}
