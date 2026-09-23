//! The `.sav` side of the seam: how a save is projected, written and saved.

pub mod details;
pub(crate) mod galaxy;
pub(crate) mod write;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::archive;
use crate::cst::{self, CstError, Node};
use crate::document::{self, Document};
use crate::format::Format;
use crate::format::save::write::{
    bulk, lanes, lgate, map_colors, move_system, nebula, planet_size, star_class,
};
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::scan::{self, Entity, Value};
use crate::session::Session;
use crate::validate::Issue;
use crate::views::{Capabilities, DocumentKind};

pub(crate) struct Save;

impl Format for Save {
    fn build_graph(&self, doc: &Document) -> Result<GalaxyGraph, ProjectionError> {
        GalaxyGraph::build(doc)
    }

    fn parse(&self, bytes: &[u8], base: usize) -> Result<Node, CstError> {
        cst::parse(bytes, base)
    }

    fn statement(&self, doc: &Document, subject: Subject) -> Result<Anchor, OpError> {
        match subject {
            Subject::System(id) => Ok(Anchor::Original(find_entity(doc, id)?.stmt)),
            Subject::Planet { id, .. } => Ok(Anchor::Original(find_planet(doc, id)?.stmt)),
            Subject::Nebula(index) => doc
                .nebulae()
                .get(index)
                .copied()
                .ok_or(OpError::UnknownNebula(index)),
            // A save keeps its lanes inside the two systems, so no statement stands alone.
            Subject::Statement { anchor, .. } | Subject::Header(anchor) => Ok(anchor),
            Subject::Flags => doc
                .index()
                .section(keys::FLAGS)
                .map(|section| Anchor::Original(section.stmt))
                .ok_or(OpError::NoFlags),
            Subject::Country(id) => match doc.index().entity(keys::COUNTRY, u64::from(id)) {
                Some(e) if matches!(e.value, Value::Block { .. }) => Ok(Anchor::Original(e.stmt)),
                _ => Err(OpError::UnknownCountry(id)),
            },
        }
    }

    fn refresh(
        &self,
        doc: &mut Document,
        graph: &mut GalaxyGraph,
        touched: &[Subject],
        _slots: &[Anchor],
    ) -> Result<Vec<Subject>, OpError> {
        let mut nebulae = false;
        let mut bodies = BTreeSet::new();
        for &subject in touched {
            match subject {
                Subject::System(id) => {
                    let anchor = self.statement(doc, subject)?;
                    let buf = doc.current(anchor)?;
                    let root = self
                        .parse(buf, 0)
                        .map_err(|e| subject.parse_error(e.offset, e.reason))?;
                    graph.refresh_system(id, &root, buf)?;
                }
                Subject::Planet { system, .. } => {
                    bodies.insert(system);
                }
                Subject::Nebula(_) => nebulae = true,
                Subject::Flags => {
                    let buf = doc.current(self.statement(doc, subject)?)?;
                    let root = self
                        .parse(buf, 0)
                        .map_err(|e| subject.parse_error(e.offset, e.reason))?;
                    let flags = root
                        .children()
                        .first()
                        .ok_or_else(|| subject.parse_error(0, "empty statement"))?;
                    graph.refresh_lgate(flags, buf);
                }
                Subject::Country(id) => {
                    let buf = doc.current(self.statement(doc, subject)?)?;
                    let root = self
                        .parse(buf, 0)
                        .map_err(|e| subject.parse_error(e.offset, e.reason))?;
                    let country = root
                        .children()
                        .first()
                        .ok_or_else(|| subject.parse_error(0, "empty statement"))?;
                    graph.refresh_country(id, country, buf);
                }
                Subject::Statement { .. } | Subject::Header(_) => {}
            }
        }
        for id in bodies {
            let subject = Subject::System(id);
            let buf = doc.current(self.statement(doc, subject)?)?;
            let root = self
                .parse(buf, 0)
                .map_err(|e| subject.parse_error(e.offset, e.reason))?;
            graph.refresh_bodies(id, &root, buf, doc)?;
        }
        let reassigned = if nebulae {
            doc.rebuild_nebulae();
            graph.refresh_nebulae(doc)?
        } else {
            Vec::new()
        };
        let moved: Vec<u32> = touched.iter().filter_map(|s| s.system()).collect();
        graph.refresh_stale(&moved);
        Ok(reassigned.into_iter().map(Subject::System).collect())
    }

    fn write(&self, plan: &mut Plan, s: &Session, op: &Op) -> Result<Planned, OpError> {
        match op {
            Op::MoveSystem { id, x, y } => move_system::plan(plan, s, *id, *x, *y),
            Op::AddLane { a, b, bridge } => lanes::plan_add(plan, s, *a, *b, *bridge),
            Op::AddLanes { from, to } => lanes::plan_add_many(plan, s, *from, to),
            Op::RemoveLane { a, b } => lanes::plan_remove(plan, s, *a, *b),
            Op::RemoveLanes { from, to } => lanes::plan_remove_many(plan, s, *from, to),
            Op::SetLaneLength { a, b, length } => lanes::plan_set_length(plan, s, *a, *b, *length),
            Op::IsolateSystem { id } => lanes::plan_isolate(plan, s, *id),
            Op::MoveSystems { moves } => bulk::plan_move_many(plan, s, moves),
            Op::AddLanePairs { lanes } => bulk::plan_add_pairs(plan, s, lanes),
            Op::RemoveLanePairs { lanes } => bulk::plan_remove_pairs(plan, s, lanes),
            Op::IsolateSystems { ids } => bulk::plan_isolate_many(plan, s, ids),
            Op::SetLaneLengths { lanes } => bulk::plan_set_lengths(plan, s, lanes),
            Op::NormaliseLaneLength { a, b } => lanes::plan_normalise_length(plan, s, *a, *b),
            Op::NormaliseLaneLengths { systems } => bulk::plan_normalise_lengths(plan, s, systems),
            Op::MoveNebula { index, x, y } => nebula::plan_move(plan, s, *index, *x, *y),
            Op::AddNebula { x, y, radius, name } => {
                nebula::plan_add(plan, s, *x, *y, *radius, name.as_deref())
            }
            Op::RemoveNebula { index } => nebula::plan_remove(plan, s, *index),
            Op::SetNebulaRadius { index, radius } => {
                nebula::plan_set_radius(plan, s, *index, *radius)
            }
            Op::SetNebulaName { index, name } => nebula::plan_set_name(plan, s, *index, name),
            Op::SetLGateOutcome { outcome } => lgate::plan_set_outcome(plan, s, *outcome),
            Op::SetStarClass { id, class, bodies } => {
                star_class::plan_set(plan, s, *id, class, bodies)
            }
            Op::SetPlanetSize { id, size } => planet_size::plan_set(plan, s, *id, *size),
            Op::SetEmpireMapColors { country, colors } => {
                map_colors::plan_set(plan, s, *country, colors.as_ref())
            }
            // A save's systems come with planets, a starbase and an owner, its names and
            // initializers are the game's to set, and it has neither a scenario header nor
            // a generator to prevent a lane from.
            Op::AddSystem { .. }
            | Op::RemoveSystem { .. }
            | Op::AddSystems { .. }
            | Op::RemoveSystems { .. }
            | Op::SetSystemName { .. }
            | Op::SetInitializer { .. }
            | Op::SetInitializers { .. }
            | Op::SetHeaderField { .. }
            | Op::SetHeaderKeys { .. }
            | Op::SetHeaderList { .. }
            | Op::SetSpawnWeight { .. }
            | Op::SetSpawnWeights { .. }
            | Op::SetSpawnScript { .. }
            | Op::SetSpawnScripts { .. }
            | Op::SetFeZone { .. }
            | Op::SetFeZones { .. }
            | Op::SetWormholePair { .. }
            | Op::SetWormholeEnds { .. }
            | Op::SetFeLinks { .. }
            | Op::SetFeLinkFlags { .. }
            | Op::PreventLane { .. }
            | Op::UnpreventLane { .. } => Err(OpError::Unsupported {
                op: op.name(),
                kind: DocumentKind::Save,
            }),
            Op::Batch { .. } => Err(OpError::NestedBatch),
        }
    }

    fn save(
        &self,
        doc: &Document,
        path: &Path,
        progress: &mut dyn FnMut(f64),
    ) -> Result<Option<PathBuf>, document::Error> {
        Ok(archive::write_sav_with(
            path,
            doc.pieces(),
            doc.meta(),
            progress,
        )?)
    }

    fn title(&self, doc: &Document) -> String {
        archive::parse_meta(doc.meta())
            .map(|meta| meta.name)
            .unwrap_or_default()
    }

    fn issues(&self, _doc: &Document) -> Vec<Issue> {
        Vec::new()
    }

    fn curates_entities(&self) -> bool {
        true
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            empires: true,
            details: true,
            lane_lengths: true,
            nebulae: true,
            bypasses: true,
            special: true,
            create_systems: false,
            lane_bridges: true,
            waylines: true,
        }
    }
}

fn find_entity(doc: &Document, id: u32) -> Result<Entity, OpError> {
    match doc.index().entity(keys::GALACTIC_OBJECT, u64::from(id)) {
        Some(e) if matches!(e.value, Value::Block { .. }) => Ok(*e),
        _ => Err(OpError::UnknownSystem(id)),
    }
}

fn find_planet(doc: &Document, id: u32) -> Result<Entity, OpError> {
    let found = doc
        .inner_index(keys::PLANETS)?
        .and_then(|index| index.entity(keys::PLANET, u64::from(id)));
    match found {
        Some(e) if matches!(e.value, Value::Block { .. }) => Ok(*e),
        _ => Err(OpError::UnknownPlanet(id)),
    }
}

/// Where a new `nebula` section's bytes go: past the last one the file holds, else at
/// the top-level section that follows the systems, else at the end.
pub(crate) fn nebula_insert_at(doc: &Document) -> usize {
    let src = doc.original();
    if let Some(last) = doc.index().sections_named(keys::NEBULA).last() {
        return cst::line_end(src, last.stmt.end);
    }
    let sections = doc.index().sections();
    sections
        .iter()
        .position(|s| scan::key_name(src, s) == keys::GALACTIC_OBJECT)
        .and_then(|i| sections.get(i + 1))
        .map_or(src.len(), |next| cst::line_start(src, next.stmt.start))
}
