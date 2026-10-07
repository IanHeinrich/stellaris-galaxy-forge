//! Edit operations: every edit is an [`Op`] with an inverse and a description.
//!
//! One overlay slot per `galactic_object` entity, per `planets.planet` entity and per
//! top-level `nebula` section.
//! The commit is atomic: the document is unchanged on error.
//!
//! `op` holds the vocabulary and its errors, `plan` the planning and the commit; this
//! module applies an op, or a batch of them, and rolls a failed one back.

mod edit;
mod error;
pub(crate) mod history;
mod op;
mod plan;
pub mod rules;

use crate::document::Document;
use crate::format;
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, Lane};
use crate::session::Session;

pub use crate::format::save::system_spec::{BeltSpec, BodySpec, SystemSpec};
pub use crate::format::save::write::game_tables::SPAWN_BUFFER;
pub use crate::format::save::write::initializer_counter::initializer_counts;
pub use crate::format::save::write::name_pool::{free_nebula_names, free_star_names};
pub use crate::projections::geometry::{
    BELT_SCATTER, MOON_RING_FIRST, MOON_RING_STEP, OVERLAP_TOLERANCE, STORED_ORBIT_SLACK,
    SystemRadii,
};
pub use edit::Subject;
pub(crate) use edit::{BufEdit, Edit, blank_slot, replace_lengths};
pub use error::{OpError, ParseAt, StarEdit};
pub use op::{
    BodyName, ClassChange, DetailsReach, EmpireFlag, LaneLength, LanePair, MapColorPair,
    NebulaCloud, NebulaFootprint, NewBody, NewModifier, NewMoon, NewName, NewSystem, Op, OpReach,
    PairPoints, Parent, PlanetClassRule, PlanetLook, SavedEntity, SavedTable, StarBody,
    SystemHeight, SystemMove,
};
pub(crate) use plan::{Emitted, Plan, Planned, slots};

/// The record of one committed op: what changed, how to describe it, and the bytes
/// needed to undo and redo it without re-running the op.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Applied {
    pub op: Op,
    pub description: String,
    pub inverse: Op,
    /// Per replaced statement: the slot content it displaced (`None` = the original).
    pub before: Vec<(Anchor, Option<Vec<u8>>)>,
    /// Per replaced statement: the bytes now standing for it (`None` = no slot, the
    /// line an erasure took having swallowed it).
    pub after: Vec<(Anchor, Option<Vec<u8>>)>,
    /// The entities the op rewrote and the systems its nebula edits reassigned, sorted
    /// and deduplicated.
    pub touched: Vec<Subject>,
    /// The systems whose id the op changed, each as its id before and after, `None` after
    /// for one it removed; read together, not in turn. Only a save's removal of a system
    /// added in the session renumbers the systems added after it, so that ids stay dense.
    pub renumbered: Vec<(u32, Option<u32>)>,
    /// The save's `meta` before and after, when the op rewrote it.
    pub meta: Option<MetaEdit>,
}

/// The `meta` bytes an op displaced and wrote, each `None` for the bytes as loaded.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MetaEdit {
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}

impl MetaEdit {
    /// `first`'s edit followed by `second`'s, as one.
    fn then(first: Option<Self>, second: Option<Self>) -> Option<Self> {
        match (first, second) {
            (Some(first), Some(second)) => Some(Self {
                before: first.before,
                after: second.after,
            }),
            (first, second) => first.or(second),
        }
    }
}

/// Apply `op` to the session's document and projection.
pub(crate) fn apply(session: &mut Session, op: Op) -> Result<Applied, OpError> {
    match op {
        Op::Batch { description, ops } => apply_batch(session, description, ops),
        op => apply_one(session, op),
    }
}

fn apply_one(session: &mut Session, op: Op) -> Result<Applied, OpError> {
    op.check_kind(session.kind())?;
    let mut plan = Plan::new();
    let planned = session.format().write(&mut plan, session, &op)?;
    let first = plan.commit(session, op, planned)?;
    let mut plan = Plan::new();
    let second = match session.format().follow_up(&mut plan, session, &first.op) {
        Ok(None) => return Ok(first),
        Ok(Some(planned)) => {
            debug_assert!(first.op.reach().follow_up, "{}", first.op.name());
            plan.commit(session, first.op.clone(), planned)
        }
        Err(e) => Err(e),
    };
    match second {
        Ok(second) => Ok(joined(first, second)),
        Err(e) => {
            rollback(session, &first.before, &first.touched, first.meta.as_ref());
            Err(e)
        }
    }
}

/// The two committed steps of one op as the one edit history records, described and
/// inverted by the first.
fn joined(first: Applied, second: Applied) -> Applied {
    let mut touched = first.touched;
    touched.extend(second.touched);
    touched.sort_unstable();
    touched.dedup();
    Applied {
        renumbered: then(&first.renumbered, &second.renumbered),
        meta: MetaEdit::then(first.meta, second.meta),
        before: [first.before, second.before].concat(),
        after: [first.after, second.after].concat(),
        touched,
        ..first
    }
}

fn apply_batch(
    session: &mut Session,
    description: String,
    ops: Vec<Op>,
) -> Result<Applied, OpError> {
    if ops.is_empty() {
        return Err(OpError::EmptyBatch);
    }
    if ops.iter().any(|op| matches!(op, Op::Batch { .. })) {
        return Err(OpError::NestedBatch);
    }
    let op = Op::Batch {
        description: description.clone(),
        ops: ops.clone(),
    };
    let mut members: Vec<Applied> = Vec::with_capacity(ops.len());
    for member in ops {
        match apply_one(session, member) {
            Ok(applied) => members.push(applied),
            Err(e) => {
                let before: Vec<_> = members.iter().flat_map(|m| m.before.clone()).collect();
                let touched: Vec<_> = members.iter().flat_map(|m| m.touched.clone()).collect();
                let meta = members.iter().fold(None, |meta, member| {
                    MetaEdit::then(meta, member.meta.clone())
                });
                rollback(session, &before, &touched, meta.as_ref());
                return Err(e);
            }
        }
    }
    let mut inverses = Vec::with_capacity(members.len());
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut touched = Vec::new();
    let mut renumbered = Vec::new();
    let mut meta = None;
    for member in members {
        match member.inverse {
            Op::Batch { ops, .. } => inverses.extend(ops.into_iter().rev()),
            inverse => inverses.push(inverse),
        }
        before.extend(member.before);
        after.extend(member.after);
        touched.extend(member.touched);
        renumbered = then(&renumbered, &member.renumbered);
        meta = MetaEdit::then(meta, member.meta);
    }
    inverses.reverse();
    touched.sort_unstable();
    touched.dedup();
    Ok(Applied {
        op,
        description: description.clone(),
        inverse: Op::Batch {
            description,
            ops: inverses,
        },
        before,
        after,
        touched,
        renumbered,
        meta,
    })
}

/// `first`'s renumbering followed by `second`'s, as one: an id `second` names is the id
/// `first` left, so it is traced back to the id it had before `first`.
fn then(first: &[(u32, Option<u32>)], second: &[(u32, Option<u32>)]) -> Vec<(u32, Option<u32>)> {
    let lookup = |id: u32| {
        second
            .iter()
            .find(|&&(old, _)| old == id)
            .map(|&(_, new)| new)
    };
    let mut out: Vec<(u32, Option<u32>)> = first
        .iter()
        .map(|&(old, mid)| (old, mid.and_then(|mid| lookup(mid).unwrap_or(Some(mid)))))
        .collect();
    for &(mid, new) in second {
        let traced = first
            .iter()
            .any(|&(old, left)| old == mid || left == Some(mid));
        if !traced {
            out.push((mid, new));
        }
    }
    out.retain(|&(old, new)| new != Some(old));
    out
}

/// The lane `a`-`b` as the projection lists it on either end.
pub(crate) fn projected_lane(graph: &GalaxyGraph, a: u32, b: u32) -> Option<&Lane> {
    graph.lane(a, b).or_else(|| graph.lane(b, a))
}

/// Put back `before` (in reverse) and the `meta` the op rewrote, if any, and re-project what
/// they cover.
fn rollback(
    session: &mut Session,
    before: &[(Anchor, Option<Vec<u8>>)],
    touched: &[Subject],
    meta: Option<&MetaEdit>,
) {
    history::restore_before(&mut session.doc, before, meta);
    // The bytes being restored were projected successfully before the op began.
    let _ = refresh(
        &mut session.doc,
        &mut session.graph,
        touched,
        &slots(before),
    );
}

/// Re-extract each touched entity from its current bytes, as the document's format
/// reads them; `slots` are the overlay slots the edit wrote. Returns the systems a
/// nebula edit reassigned.
pub(crate) fn refresh(
    doc: &mut Document,
    graph: &mut GalaxyGraph,
    touched: &[Subject],
    slots: &[Anchor],
) -> Result<Vec<Subject>, OpError> {
    format::of(doc.kind()).refresh(doc, graph, touched, slots)
}
