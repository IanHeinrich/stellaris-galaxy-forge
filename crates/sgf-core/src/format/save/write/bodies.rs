//! `MoveSaveBody` and `SetSaveBodyParent`: where a save planet or moon stands in its
//! system, and what it orbits.

use crate::ops::{OpError, Plan, Planned};
use crate::session::Session;
use crate::views::DocumentKind;

pub(crate) fn plan_move(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _body: u32,
    _radius: f64,
    _angle: f64,
) -> Result<Planned, OpError> {
    Err(OpError::Unsupported {
        op: "MoveSaveBody",
        kind: DocumentKind::Save,
    })
}

pub(crate) fn plan_parent(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _body: u32,
    _parent: Option<u32>,
    _radius: f64,
    _angle: f64,
) -> Result<Planned, OpError> {
    Err(OpError::Unsupported {
        op: "SetSaveBodyParent",
        kind: DocumentKind::Save,
    })
}
