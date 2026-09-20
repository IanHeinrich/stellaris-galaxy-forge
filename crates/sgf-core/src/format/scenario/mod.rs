//! The scenario-script side of the seam: reading a `static_galaxy_scenario` into the
//! same galaxy the map draws from a save.
//!
//! Positions are absolute and carry no length, so a lane's length is measured from the
//! two ends and nebula membership follows the radii rather than a member list.

pub(crate) mod emit;
pub mod index;
pub mod listings;
pub(crate) mod spawn;
pub(crate) mod write;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::archive;
use crate::cst::{self, CstError, Node};
use crate::document::{self, Document};
use crate::format::Format;
use crate::format::scenario::index::{LaneStmt, SCENARIO_X_SIGN, SCENARIO_Y_SIGN, index};
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
use crate::views::Capabilities;

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
            Subject::Statement { anchor, .. } | Subject::Header(anchor) => Ok(anchor),
        }
    }

    /// A scenario stores no member lists, so membership is re-derived from the radii by
    /// the rebuild; the systems it moves are the op's to report, exactly as the save side
    /// reports the ones its member-line edits reassigned.
    fn refresh(
        &self,
        doc: &mut Document,
        graph: &mut GalaxyGraph,
        _touched: &[Subject],
    ) -> Result<Vec<Subject>, OpError> {
        let before: HashMap<u32, Option<usize>> = graph
            .systems
            .values()
            .map(|system| (system.id, system.nebula))
            .collect();
        doc.refresh_scenario()?;
        **graph = galaxy(doc)?;
        let mut reassigned: Vec<u32> = graph
            .systems
            .values()
            .filter(|system| {
                before
                    .get(&system.id)
                    .is_some_and(|&was| was != system.nebula)
            })
            .map(|system| system.id)
            .collect();
        reassigned.sort_unstable();
        Ok(reassigned.into_iter().map(Subject::System).collect())
    }

    /// A scenario's lanes carry no length: the game measures them from the two ends.
    fn supports(&self, op: &Op) -> bool {
        match op {
            Op::MoveSystem { .. }
            | Op::AddLane { .. }
            | Op::AddLanes { .. }
            | Op::RemoveLane { .. }
            | Op::RemoveLanes { .. }
            | Op::IsolateSystem { .. }
            | Op::MoveSystems { .. }
            | Op::AddLanePairs { .. }
            | Op::RemoveLanePairs { .. }
            | Op::IsolateSystems { .. }
            | Op::MoveNebula { .. }
            | Op::AddNebula { .. }
            | Op::RemoveNebula { .. }
            | Op::SetNebulaRadius { .. }
            | Op::SetNebulaName { .. }
            | Op::AddSystem { .. }
            | Op::RemoveSystem { .. }
            | Op::SetSystemName { .. }
            | Op::SetInitializer { .. }
            | Op::SetInitializers { .. }
            | Op::SetHeaderField { .. }
            | Op::SetSpawnWeight { .. }
            | Op::SetSpawnWeights { .. }
            | Op::SetSpawnReservation { .. }
            | Op::PreventLane { .. }
            | Op::UnpreventLane { .. } => true,
            Op::SetLaneLength { .. }
            | Op::SetLaneLengths { .. }
            | Op::NormaliseLaneLength { .. }
            | Op::NormaliseLaneLengths { .. } => false,
        }
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
        Ok(archive::write_text_with(path, doc.pieces(), progress)?)
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
/// them.
fn galaxy(doc: &Document) -> Result<Galaxy, ProjectionError> {
    let scenario = index(doc);
    let mut systems = HashMap::new();
    let mut order = Vec::new();
    for (id, anchor) in scenario.systems() {
        let (src, node) = statement(doc, anchor)?;
        systems.insert(id, system(id, &node, src));
        order.push(id);
    }
    let statements = scenario.lane_statements(doc);
    add_lanes(&mut systems, &statements);
    add_prevented(&mut systems, &statements);

    let galaxy_radius = systems
        .values()
        .map(|s| s.x.hypot(s.y))
        .fold(0.0f64, f64::max)
        .ceil();
    let mut galaxy = Galaxy {
        systems,
        order,
        nebulae: Vec::new(),
        bypasses: Vec::new(),
        waystations: Vec::new(),
        waylines: Vec::new(),
        galaxy_radius,
        core_radius: scenario.header.core_radius.unwrap_or(0.0),
        header: scenario.header.fields(),
    };
    let mut nebulae = Vec::new();
    for &anchor in scenario.nebulae() {
        let (src, node) = statement(doc, anchor)?;
        nebulae.push(nebula(&node, src));
    }
    galaxy.set_nebulae_by_radius(nebulae);
    Ok(galaxy)
}

/// One lane per pair of ends, whichever way round and however many times the file lists
/// it; `prevent_hyperlane` statements are not lanes.
fn add_lanes(systems: &mut HashMap<u32, SystemNode>, statements: &[LaneStmt]) {
    let mut seen: HashSet<(u32, u32)> = HashSet::new();
    for stmt in statements.iter().filter(|s| !s.prevent) {
        let pair = (stmt.from.min(stmt.to), stmt.from.max(stmt.to));
        if !seen.insert(pair) {
            continue;
        }
        let length = match (systems.get(&pair.0), systems.get(&pair.1)) {
            (Some(a), Some(b)) => lane_length(a, b),
            _ => 0.0,
        };
        let ends = [(pair.0, pair.1), (pair.1, pair.0)];
        let ends = &ends[..if pair.0 == pair.1 { 1 } else { 2 }];
        for &(from, to) in ends {
            if let Some(system) = systems.get_mut(&from) {
                system.lanes.push(Lane {
                    to,
                    length,
                    bridge: false,
                    stale: false,
                });
            }
        }
    }
}

/// Both ends of every `prevent_hyperlane`, ascending and deduplicated. A prevented pair
/// is not a lane: it says the generator may not add one where it otherwise would.
fn add_prevented(systems: &mut HashMap<u32, SystemNode>, statements: &[LaneStmt]) {
    for stmt in statements.iter().filter(|s| s.prevent) {
        for (from, to) in [(stmt.from, stmt.to), (stmt.to, stmt.from)] {
            if let Some(system) = systems.get_mut(&from) {
                system.prevented.push(to);
            }
        }
    }
    for system in systems.values_mut() {
        system.prevented.sort_unstable();
        system.prevented.dedup();
    }
}

fn system(id: u32, node: &Node, src: &[u8]) -> SystemNode {
    let (x, y) = position(node, src);
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
        initializer: read::text(node, keys::INITIALIZER, src),
        spawn_weight: spawn_weight(node, src),
        spawn_modifiers: spawn_modifiers(node, src),
        spawn_design: read::scalar(node, keys::SPAWN_DESIGN, src).map(str::to_owned),
        prevented: Vec::new(),
        position_range: position_range(node, src),
        flags: Vec::new(),
        owner: None,
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
