//! A bulk add of systems to a save: a `Batch` of `AddSystemFromSpec` and the lanes between
//! them, as one undo step.

use crate::format::save::alloc;
use crate::format::save::write::add_system::check_places;
use crate::ops::{LaneEnd, LanePair, Op, OpError, SystemSpec};
use crate::session::Session;

/// The most systems one bulk add writes into a save.
pub const BULK_ADD_CAP: usize = 200;

/// The op that adds `specs` to the save as one [`Op::Batch`] described as `description`:
/// an [`Op::AddSystemFromSpec`] per spec in order, each spec's own lanes dropped, then one
/// [`Op::AddLanePairs`] laying `lanes` when there are any. Refused with nothing applied
/// when there are no specs, more than [`BULK_ADD_CAP`], a system nearer than the game
/// spawns one to another or to a new one before it, or a lane end that names neither a
/// new system nor one the document holds.
pub(crate) fn add_op(
    s: &Session,
    mut specs: Vec<SystemSpec>,
    lanes: &[(LaneEnd, LaneEnd)],
    description: String,
) -> Result<Op, OpError> {
    if specs.is_empty() {
        return Err(OpError::EmptyBatch);
    }
    if specs.len() > BULK_ADD_CAP {
        return Err(OpError::TooManySystems {
            count: specs.len(),
            cap: BULK_ADD_CAP,
        });
    }
    let first = alloc::next_system(&s.doc, &s.graph)?;
    let points: Vec<(f64, f64)> = specs.iter().map(|spec| (spec.x, spec.y)).collect();
    check_places(&s.graph, first, &points)?;
    let id = |end: LaneEnd| match end {
        LaneEnd::New { index } => {
            let id = first.saturating_add(index);
            match usize::try_from(index) {
                Ok(index) if index < specs.len() => Ok(id),
                _ => Err(OpError::UnknownSystem(id)),
            }
        }
        LaneEnd::Held { system } if s.graph.systems.contains_key(&system) => Ok(system),
        LaneEnd::Held { system } => Err(OpError::UnknownSystem(system)),
    };
    let lanes = lanes
        .iter()
        .map(|&(a, b)| {
            Ok(LanePair {
                a: id(a)?,
                b: id(b)?,
                bridge: false,
            })
        })
        .collect::<Result<Vec<_>, OpError>>()?;

    for spec in &mut specs {
        spec.lanes.clear();
    }
    let mut ops: Vec<Op> = specs
        .into_iter()
        .map(|spec| Op::AddSystemFromSpec { spec })
        .collect();
    if !lanes.is_empty() {
        ops.push(Op::AddLanePairs { lanes });
    }
    Ok(Op::Batch { description, ops })
}
