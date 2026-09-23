//! Edit operations: every edit is an [`Op`] with an inverse and a description.
//!
//! One overlay slot per `galactic_object` entity, per `planets.planet` entity and per
//! top-level `nebula` section.
//! The commit is atomic: the document is unchanged on error.
//!
//! `op` holds the vocabulary and its errors, `plan` the planning and the commit; this
//! module applies an op, or a batch of them, and rolls a failed one back.

mod edit;
pub mod history;
mod op;
mod plan;
pub mod rules;

use crate::document::Document;
use crate::format;
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, Lane};
use crate::session::Session;

pub use edit::Subject;
pub(crate) use edit::{Edit, blank_slot, replace_lengths};
pub use op::{InitializerSet, LaneLength, LanePair, NewSystem, Op, OpError, StarBody, SystemMove};
pub(crate) use plan::{Emitted, Plan, Planned, slots};

/// The record of one committed op: what changed, how to describe it, and the bytes
/// needed to undo and redo it without re-running the op.
#[derive(Debug, Clone, PartialEq)]
pub struct Applied {
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
}

/// Apply `op` to the session's document and projection.
pub fn apply(session: &mut Session, op: Op) -> Result<Applied, OpError> {
    match op {
        Op::Batch { description, ops } => apply_batch(session, description, ops),
        op => apply_one(session, op),
    }
}

fn apply_one(session: &mut Session, op: Op) -> Result<Applied, OpError> {
    let mut plan = Plan::new();
    let planned = session.format().write(&mut plan, session, &op)?;
    plan.commit(session, op, planned)
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
                rollback(session, &before, &touched);
                return Err(e);
            }
        }
    }
    let mut inverses = Vec::with_capacity(members.len());
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut touched = Vec::new();
    for member in members {
        match member.inverse {
            Op::Batch { ops, .. } => inverses.extend(ops.into_iter().rev()),
            inverse => inverses.push(inverse),
        }
        before.extend(member.before);
        after.extend(member.after);
        touched.extend(member.touched);
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
    })
}

/// The lane `a`-`b` as the projection lists it on either end.
pub(crate) fn projected_lane(graph: &GalaxyGraph, a: u32, b: u32) -> Option<&Lane> {
    graph.lane(a, b).or_else(|| graph.lane(b, a))
}

/// Put back `before` (in reverse) and re-project what it covers.
fn rollback(session: &mut Session, before: &[(Anchor, Option<Vec<u8>>)], touched: &[Subject]) {
    for (anchor, prev) in before.iter().rev() {
        session.doc.restore(*anchor, prev.clone());
    }
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
