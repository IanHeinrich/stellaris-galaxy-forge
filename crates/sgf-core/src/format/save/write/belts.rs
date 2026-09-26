//! `AddSaveBelt`, `RemoveSaveBelt`, `SetSaveBeltRadius`, `SetSaveBeltKind` and
//! `SetSaveInnerRadius`: a save system's `asteroid_belts` and its `inner_radius`.

use crate::ops::{OpError, Plan, Planned};
use crate::session::Session;
use crate::views::DocumentKind;

pub(crate) fn plan_add(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _kind: &str,
    _radius: f64,
) -> Result<Planned, OpError> {
    Err(unsupported("AddSaveBelt"))
}

pub(crate) fn plan_remove(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _index: usize,
) -> Result<Planned, OpError> {
    Err(unsupported("RemoveSaveBelt"))
}

pub(crate) fn plan_set_radius(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _index: usize,
    _radius: f64,
) -> Result<Planned, OpError> {
    Err(unsupported("SetSaveBeltRadius"))
}

pub(crate) fn plan_set_kind(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _index: usize,
    _kind: &str,
) -> Result<Planned, OpError> {
    Err(unsupported("SetSaveBeltKind"))
}

pub(crate) fn plan_inner_radius(
    _plan: &mut Plan,
    _s: &Session,
    _system: u32,
    _radius: f64,
) -> Result<Planned, OpError> {
    Err(unsupported("SetSaveInnerRadius"))
}

fn unsupported(op: &'static str) -> OpError {
    OpError::Unsupported {
        op,
        kind: DocumentKind::Save,
    }
}
