//! `AddSaveBelt`, `RemoveSaveBelt`, `SetSaveBeltRadius`, `SetSaveBeltKind` and
//! `SetSaveInnerRadius`: a save system's `asteroid_belts` and its `inner_radius`. A belt
//! reaches its radius, so one added or moved past the system's reach grows the inner radius
//! as a body does.

use crate::Span;
use crate::cst::Node;
use crate::emit::system::{belt_entry, belts_block};
use crate::emit::{coord, quoted};
use crate::format::save::check_version;
use crate::format::save::write::bodies;
use crate::keys;
use crate::ops::rules::bodies::Body;
use crate::ops::rules::bodies::{check_radius, system_reach};
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    kind: &str,
    radius: f64,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_radius(radius, "a belt's inner radius")?;
    check_text("a belt type", kind, Form::Bare)?;
    let before = body_frame(s, system)?;
    let edit = plan.edit(&s.doc, system)?;
    let entity = edit.entity()?;
    let block = entity.find(keys::ASTEROID_BELTS, &edit.buf);
    let index = block.map_or(0, |block| entries(block).len());
    match block {
        Some(block) => {
            let entries = entries(block);
            let sibling = entries.first().ok_or_else(|| {
                edit.parse_error(block.span().start, "asteroid_belts has no belts")
            })?;
            let indent = edit.indent(sibling.span().start);
            let at = edit.line_start(block.value_span().end - 1);
            edit.insert(at, belt_entry(&indent, kind, radius));
        }
        None => {
            let before = belts_before(edit, entity)?;
            let at = edit.line_start(before.start);
            let indent = edit.indent(at);
            edit.insert(at, belts_block(&indent, &[(kind, radius)]));
        }
    }
    let description = format!(
        "Added a {kind} belt at radius {} to system #{system}",
        number(radius)
    );
    let inverse = Op::RemoveSaveBelt { system, index };
    bodies::grow(plan, s, system, &before, radius, description, inverse)
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    index: usize,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let edit = plan.edit(&s.doc, system)?;
    let entity = edit.entity()?;
    let block = entity
        .find(keys::ASTEROID_BELTS, &edit.buf)
        .ok_or(OpError::UnknownBelt { system, index })?;
    let list = entries(block);
    let entry = *list
        .get(index)
        .ok_or(OpError::UnknownBelt { system, index })?;
    let kind = read::text(entry, keys::TYPE, &edit.buf);
    let radius: f64 = read::required(entry, keys::INNER_RADIUS, &edit.buf)
        .map_err(|reason| edit.parse_error(entry.span().start, reason))?;
    let alone = list.len() == 1;
    let block_span = block.span();
    let entry_span = entry.span();
    if alone {
        edit.remove_lines(block_span);
    } else {
        edit.remove_lines(entry_span);
    }
    Ok(Planned {
        description: format!(
            "Removed the belt at radius {} from system #{system}",
            number(radius)
        ),
        inverse: Op::AddSaveBelt {
            system,
            kind,
            radius,
        },
    })
}

pub(crate) fn plan_set_radius(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    index: usize,
    radius: f64,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_radius(radius, "a belt's inner radius")?;
    let before = body_frame(s, system)?;
    let edit = plan.edit(&s.doc, system)?;
    let entity = edit.entity()?;
    let block = entity
        .find(keys::ASTEROID_BELTS, &edit.buf)
        .ok_or(OpError::UnknownBelt { system, index })?;
    let entry = *entries(block)
        .get(index)
        .ok_or(OpError::UnknownBelt { system, index })?;
    let span = entry
        .find(keys::INNER_RADIUS, &edit.buf)
        .and_then(Node::scalar_span)
        .ok_or_else(|| edit.parse_error(entry.span().start, "belt has no inner_radius"))?;
    let old_text = edit.text(span).to_owned();
    let old: f64 = old_text
        .parse()
        .map_err(|_| edit.parse_error(span.start, "inner_radius is not a number"))?;
    let new_text = coord(radius);
    if new_text == old_text {
        return Err(OpError::BeltUnchanged { system, index });
    }
    edit.replace_span(span, new_text);
    let description = format!(
        "Moved the belt at radius {} in system #{system} to {}",
        number(old),
        number(radius)
    );
    let inverse = Op::SetSaveBeltRadius {
        system,
        index,
        radius: old,
    };
    bodies::grow(plan, s, system, &before, radius, description, inverse)
}

pub(crate) fn plan_set_kind(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    index: usize,
    kind: &str,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_text("a belt type", kind, Form::Bare)?;
    let edit = plan.edit(&s.doc, system)?;
    let entity = edit.entity()?;
    let block = entity
        .find(keys::ASTEROID_BELTS, &edit.buf)
        .ok_or(OpError::UnknownBelt { system, index })?;
    let entry = *entries(block)
        .get(index)
        .ok_or(OpError::UnknownBelt { system, index })?;
    let span = entry
        .find(keys::TYPE, &edit.buf)
        .and_then(Node::scalar_span)
        .ok_or_else(|| edit.parse_error(entry.span().start, "belt has no type"))?;
    let old_text = edit.text(span).to_owned();
    let new_text = quoted(kind);
    if new_text == old_text {
        return Err(OpError::BeltUnchanged { system, index });
    }
    let radius: f64 = read::required(entry, keys::INNER_RADIUS, &edit.buf)
        .map_err(|reason| edit.parse_error(entry.span().start, reason))?;
    let old_kind = read::text(entry, keys::TYPE, &edit.buf);
    edit.replace_span(span, new_text);
    Ok(Planned {
        description: format!(
            "Set the belt at radius {} in system #{system} from {old_kind} to {kind}",
            number(radius)
        ),
        inverse: Op::SetSaveBeltKind {
            system,
            index,
            kind: old_kind,
        },
    })
}

pub(crate) fn plan_inner_radius(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    radius: f64,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_radius(radius, "a system's inner radius")?;
    let radii = s.radii();
    let frame = body_frame(s, system)?;
    let edit = plan.edit(&s.doc, system)?;
    let entity = edit.entity()?;
    let span = entity
        .find(keys::INNER_RADIUS, &edit.buf)
        .and_then(Node::scalar_span)
        .ok_or_else(|| edit.parse_error(entity.span().start, "the system has no inner_radius"))?;
    let old_text = edit.text(span).to_owned();
    let current: f64 = old_text
        .parse()
        .map_err(|_| edit.parse_error(span.start, "inner_radius is not a number"))?;
    let new_text = coord(radius);
    if new_text == old_text {
        return Err(OpError::InnerRadiusUnchanged(system));
    }
    let least = current.min(
        radii
            .min_inner
            .max(system_reach(&frame, &belt_radii(edit, entity))),
    );
    if radius < least {
        return Err(OpError::InnerRadiusTooSmall { least });
    }
    let outer = entity.find(keys::OUTER_RADIUS, &edit.buf).is_some();
    edit.replace_span(span, new_text);
    if outer {
        edit.set_scalar(&[keys::OUTER_RADIUS], coord(radii.outer(radius)))?;
    }
    Ok(Planned {
        description: format!(
            "Set the inner radius of system #{system} from {} to {}",
            number(current),
            number(radius)
        ),
        inverse: Op::SetSaveInnerRadius {
            system,
            radius: current,
        },
    })
}

/// The system's bodies as their entries stand.
fn body_frame(s: &Session, system: u32) -> Result<Vec<Body>, OpError> {
    Ok(bodies::frame(s, system)?
        .into_iter()
        .map(|b| b.body)
        .collect())
}

/// The radius of each of the system's belts that has one, in order.
pub(crate) fn belt_radii(edit: &Edit, entity: &Node) -> Vec<f64> {
    entity
        .find(keys::ASTEROID_BELTS, &edit.buf)
        .map(entries)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| read::scalar_f64(entry, keys::INNER_RADIUS, &edit.buf))
        .collect()
}

/// The belt entries of the system's `asteroid_belts` block, in order.
fn entries(block: &Node) -> Vec<&Node> {
    block
        .children()
        .iter()
        .filter(|c| c.key.is_none())
        .collect()
}

/// Where a new `asteroid_belts` block goes when the system has none: right before
/// `discovery`, else `arm`, else `flags`, or `initializer` when it has none of those, as the
/// game writes hyperlane, then asteroid_belts, then discovery, arm, flags, initializer.
fn belts_before(edit: &Edit, entity: &Node) -> Result<Span, OpError> {
    let discovery = entity.find(keys::DISCOVERY, &edit.buf).map(Node::span);
    let arm = entity.find(keys::ARM, &edit.buf).map(Node::span);
    let flags = entity.find(keys::FLAGS, &edit.buf).map(Node::span);
    let initializer = entity
        .find(keys::INITIALIZER, &edit.buf)
        .map(Node::span)
        .ok_or_else(|| edit.parse_error(0, "the system has no initializer"))?;
    Ok(discovery.or(arm).or(flags).unwrap_or(initializer))
}

/// A radius as a description names it: up to two decimals.
fn number(v: f64) -> String {
    let text = format!("{v:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" { "0" } else { text }.to_owned()
}
