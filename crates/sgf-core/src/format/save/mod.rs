//! The `.sav` side of the seam: how a save is projected, written and saved.

mod abundance;
pub(crate) mod added;
pub(crate) mod alloc;
pub mod details;
pub(crate) mod galaxy;
pub(crate) mod read_spec;
pub mod system_spec;
pub(crate) mod write;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::archive;
use crate::cst::{self, CstError, Node};
use crate::document::{self, Document};
use crate::format::Format;
use crate::format::save::added::Table;
use crate::format::save::write::{
    add_system, bulk, deposits, lanes, lgate, map_colors, move_system, nebula, planet_size,
    remove_system, rename_system, replace_system, star_class,
};
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::projections::read;
use crate::scan::{self, Value};
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
            Subject::System(id) => system_statement(doc, id).ok_or(OpError::UnknownSystem(id)),
            Subject::Planet { id, .. } => {
                planet_statement(doc, id)?.ok_or(OpError::UnknownPlanet(id))
            }
            Subject::Nebula(index) => doc
                .nebulae()
                .get(index)
                .copied()
                .ok_or(OpError::UnknownNebula(index)),
            Subject::Statement { anchor, .. }
            | Subject::Header(anchor)
            | Subject::Record(anchor) => Ok(anchor),
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
        slots: &[Anchor],
    ) -> Result<Vec<Subject>, OpError> {
        let nebulae = touched.iter().any(|s| matches!(s, Subject::Nebula(_)));
        doc.refresh_save(slots, nebulae);
        let mut bodies = BTreeSet::new();
        for &subject in touched {
            match subject {
                Subject::System(id) => {
                    let Some(anchor) = system_statement(doc, id) else {
                        graph.drop_system(id);
                        continue;
                    };
                    let (root, buf) = parsed_statement(doc, subject, anchor)?;
                    // A system new to the graph has no bodies read yet: an undo of a
                    // removal brings back the system whose id it had renumbered.
                    if !graph.systems.contains_key(&id) {
                        bodies.insert(id);
                    }
                    graph.refresh_system(id, &root, buf)?;
                    let added = doc.added().get(Table::System, id).is_some();
                    if let Some(system) = graph.systems.get_mut(&id) {
                        system.added = added;
                    }
                }
                Subject::Planet { system, .. } => {
                    bodies.insert(system);
                }
                Subject::Nebula(_) => {}
                Subject::Flags => {
                    let (flags, buf) = entity(doc, subject, self.statement(doc, subject)?)?;
                    graph.refresh_lgate(&flags, buf);
                }
                Subject::Country(id) => {
                    let (country, buf) = entity(doc, subject, self.statement(doc, subject)?)?;
                    graph.refresh_country(id, &country, buf);
                }
                Subject::Statement { .. } | Subject::Header(_) | Subject::Record(_) => {}
            }
        }
        bodies.retain(|id| graph.systems.contains_key(id));
        for id in bodies {
            let subject = Subject::System(id);
            let (root, buf) = parsed_statement(doc, subject, self.statement(doc, subject)?)?;
            graph.refresh_bodies(id, &root, buf, doc)?;
        }
        let reassigned = if nebulae {
            graph.refresh_nebulae(doc)?
        } else {
            Vec::new()
        };
        // A member's modifiers alone can change how turbulent its nebula reads, and the
        // map only takes the nebulae again when a subject names one.
        let turbulence = graph.refresh_turbulence();
        let moved: Vec<u32> = touched.iter().filter_map(|s| s.system()).collect();
        graph.refresh_stale(&moved);
        let mut subjects: Vec<Subject> = reassigned.into_iter().map(Subject::System).collect();
        if !nebulae {
            subjects.extend(turbulence.into_iter().map(Subject::Nebula));
        }
        Ok(subjects)
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
            Op::AddSaveSystem { spec } => {
                check_adds_system(&s.doc)?;
                add_system::plan_add(plan, s, spec)
            }
            Op::AddSaveDeposit { planet, kind } => deposits::plan_add(plan, s, *planet, kind),
            Op::RemoveSaveDeposit { deposit } => deposits::plan_remove(plan, s, *deposit),
            Op::RemoveSystem { id } => remove_system::plan_remove(plan, s, &[*id]),
            Op::RemoveSystems { ids } => remove_system::plan_remove(plan, s, ids),
            Op::ReplaceSaveSystem { system, spec } => {
                replace_system::plan_strip(plan, s, *system, spec)
            }
            Op::RenameSaveSystem { system, name } => {
                rename_system::plan_rename(plan, s, *system, name)
            }
            Op::SetNebulaTurbulent { nebula, turbulent } => {
                nebula::plan_set_turbulent(plan, s, *nebula, *turbulent)
            }
            Op::SetNebulaFootprints { footprints } => {
                nebula::plan_set_footprints(plan, s, footprints)
            }
            // A save adds, renames and rerolls a system through the save ops, which write the
            // bodies and names a scenario statement leaves out. Its initializers, spawns,
            // fallen empire zones and wormholes are the game's to set, and it has neither a
            // scenario header nor a generator to prevent a lane from.
            Op::AddSystem { .. }
            | Op::AddSystems { .. }
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

    fn follow_up(&self, plan: &mut Plan, s: &Session, op: &Op) -> Result<Option<Planned>, OpError> {
        match op {
            Op::AddSaveSystem { spec } => add_system::plan_join(plan, s, spec),
            Op::ReplaceSaveSystem { system, spec } => {
                replace_system::plan_fill(plan, s, *system, spec).map(Some)
            }
            _ => Ok(None),
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

    fn capabilities(&self, doc: &Document) -> Capabilities {
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
            added_systems: check_adds_system(doc).is_ok(),
            bodies: true,
            deposits: check_version(doc).is_ok(),
            map_colors: true,
            lgate: true,
            symmetry: false,
        }
    }
}

/// The bytes standing at `anchor`, `subject`'s statement, parsed whole.
fn parsed_statement(
    doc: &Document,
    subject: Subject,
    anchor: Anchor,
) -> Result<(Node, &[u8]), OpError> {
    let buf = doc.current(anchor)?;
    let root = cst::parse(buf, 0).map_err(|e| subject.parse_error(e.offset, e.reason))?;
    Ok((root, buf))
}

/// Only a 4.x save takes the ops that write whole entries: a 3.x system carries an `arm`
/// and more that nothing here writes. The version is `Cygnus v4.5.0` or a bare `4.5.0`;
/// one whose major number cannot be read is refused too.
pub(crate) fn check_version(doc: &Document) -> Result<(), OpError> {
    let version = archive::parse_meta(doc.meta())
        .map(|meta| meta.version)
        .unwrap_or_default();
    let major = version
        .split_whitespace()
        .next_back()
        .map(|number| number.trim_start_matches(['v', 'V']))
        .and_then(|number| number.split('.').next()?.parse::<u32>().ok());
    match major {
        Some(major) if major >= 4 => Ok(()),
        Some(_) => Err(OpError::SaveTooOld(version)),
        None => Err(OpError::UnknownSaveVersion(version)),
    }
}

/// Whether the save takes a new system: [`check_version`], and not an Ironman save.
pub(crate) fn check_adds_system(doc: &Document) -> Result<(), OpError> {
    check_version(doc)?;
    let ironman = archive::parse_meta(doc.meta()).is_ok_and(|meta| meta.ironman);
    if ironman {
        return Err(OpError::Ironman);
    }
    Ok(())
}

/// The statement standing for system `id`: one an op added, or the one loaded.
pub(crate) fn system_statement(doc: &Document, id: u32) -> Option<Anchor> {
    doc.added().get(Table::System, id).or_else(|| {
        doc.index()
            .entity(keys::GALACTIC_OBJECT, u64::from(id))
            .filter(|e| matches!(e.value, Value::Block { .. }))
            .map(|e| Anchor::Original(e.stmt))
    })
}

/// The statement standing for planet `id`: one an op added, or the one loaded; `None` for
/// a planet the save does not hold or holds as a tombstone.
pub(crate) fn planet_statement(doc: &Document, id: u32) -> Result<Option<Anchor>, ProjectionError> {
    if let Some(anchor) = doc.added().get(Table::Planet, id) {
        return Ok(Some(anchor));
    }
    Ok(doc
        .inner_index(keys::PLANETS)?
        .and_then(|index| index.entity(keys::PLANET, u64::from(id)))
        .filter(|e| matches!(e.value, Value::Block { .. }))
        .map(|e| Anchor::Original(e.stmt)))
}

/// The `<id>={ … }` entity `bytes` hold; `None` for a tombstone, `<id>=none`, or no
/// statement at all.
pub(crate) fn entity_in(bytes: &[u8]) -> Result<Option<Node>, CstError> {
    let root = cst::parse(bytes, 0)?;
    let node = root.children().first();
    Ok(node.filter(|node| node.scalar_span().is_none()).cloned())
}

/// The entity the bytes standing at `anchor` hold, with those bytes: see [`entity_in`].
pub(crate) fn entity_at(doc: &Document, anchor: Anchor) -> Result<Option<(Node, &[u8])>, CstError> {
    let bytes = doc.current(anchor).map_err(|_| CstError {
        offset: 0,
        reason: "no statement stands there",
    })?;
    Ok(entity_in(bytes)?.map(|node| (node, bytes)))
}

/// [`entity_at`] for an op, which refuses a slot holding no entity as its subject's.
pub(crate) fn entity(
    doc: &Document,
    subject: Subject,
    anchor: Anchor,
) -> Result<(Node, &[u8]), OpError> {
    entity_at(doc, anchor)
        .map_err(|e| subject.parse_error(e.offset, e.reason))?
        .ok_or_else(|| subject.parse_error(0, "no entity stands there"))
}

/// Planet `id`'s entity as it stands now.
pub(crate) fn planet_entity(doc: &Document, id: u32) -> Result<(Node, &[u8]), OpError> {
    let anchor = planet_statement(doc, id)?.ok_or(OpError::UnknownPlanet(id))?;
    let parse_error = |offset, reason: &str| OpError::PlanetParse {
        planet: id,
        offset,
        reason: reason.to_owned(),
    };
    entity_at(doc, anchor)
        .map_err(|e| parse_error(e.offset, e.reason))?
        .ok_or(OpError::UnknownPlanet(id))
}

/// The system planet `id`, whose entity is `node`, is a body of: its `coordinate.origin`.
pub(crate) fn planet_system(node: &Node, src: &[u8], id: u32) -> Result<u32, OpError> {
    read::origin(node, src).ok_or_else(|| OpError::PlanetParse {
        planet: id,
        offset: node.span().start,
        reason: format!("missing {}.{}", keys::COORDINATE, keys::ORIGIN),
    })
}

/// Every planet the save now holds, loaded or added, with its statement, in file order;
/// a tombstone is left out.
pub(crate) fn planet_statements(doc: &Document) -> Result<Vec<(u32, Anchor)>, ProjectionError> {
    let mut planets: Vec<(u32, Anchor)> = doc.added().entries(Table::Planet).collect();
    if let Some(index) = doc.inner_index(keys::PLANETS)? {
        planets.extend(
            index
                .entities(keys::PLANET)
                .iter()
                .filter(|e| matches!(e.value, Value::Block { .. }))
                .filter_map(|e| Some((u32::try_from(e.id).ok()?, Anchor::Original(e.stmt)))),
        );
    }
    planets.sort_by_key(|&(_, anchor)| anchor);
    Ok(planets)
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
