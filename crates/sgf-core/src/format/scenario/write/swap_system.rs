//! `SwapSystems`: two systems trade places. Each `position` value goes to the other's
//! statement as it was written, and every hyperlane statement naming one of them names
//! the other, so each spot keeps its lanes and its prevented lanes.

use super::lanes::rename_ends;
use super::matching;
use crate::keys::scenario as keys;
use crate::ops::rules::systems::decide_swap;
use crate::ops::{OpError, Plan, Planned};
use crate::session::Session;

pub(super) fn swap(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    with: u32,
) -> Result<Planned, OpError> {
    let swap = decide_swap(&s.graph, system, with)?;
    let mut position = |id: u32| -> Result<String, OpError> {
        let edit = plan.edit(&s.doc, id)?;
        Ok(edit.text(edit.value(&[keys::POSITION])?).to_owned())
    };
    let (at_system, at_with) = (position(system)?, position(with)?);
    plan.edit(&s.doc, system)?
        .set_value(&[keys::POSITION], at_with)?;
    plan.edit(&s.doc, with)?
        .set_value(&[keys::POSITION], at_system)?;
    let renamed = swap.renamed();
    for stmt in matching(&s.doc, [system, with], |_| true) {
        rename_ends(plan, s, &stmt, &renamed)?;
    }
    Ok(Planned {
        description: swap.describe(),
        inverse: swap.inverse(),
    })
}
