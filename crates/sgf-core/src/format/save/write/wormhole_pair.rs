//! `AddSaveWormholePair` and `RemoveSaveWormholePair`: a natural wormhole pair written
//! with only what the game does not fill in on load, and taken out whole.
//!
//! An add writes one `natural_wormholes` entry and one `bypasses` entry per end, each at
//! one past the highest id its table has held this session, and lists each end in its system's
//! `natural_wormholes`. The game fills in the bypasses' connections and lock fields, the
//! systems' `bypasses` lists and each country's `usable_bypasses`. A removal erases all four
//! entries and takes their ids out of both systems' lists: a tombstone or any id left
//! behind shows a broken wormhole on the galaxy map.

use crate::emit::system::{WormholeEnd, natural_wormhole_entry, wormhole_bypass_entry};
use crate::format::save::added::Table;
use crate::format::save::alloc::{TableEnd, next_id};
use crate::format::save::galaxy::bypasses::{NATURAL, NaturalWormhole, natural_wormholes, row};
use crate::format::save::write::id_list::{Emptied, Place, append, unlist};
use crate::format::save::write::wormhole::{WORMHOLE, named};
use crate::keys;
use crate::ops::rules::bodies::point;
use crate::ops::{Emitted, Op, OpError, Plan, Planned, Subject};
use crate::session::Session;

/// How far past its system's `inner_radius` the game puts a wormhole it spawns without a
/// random position: 0.9 to 1.9 in the samples.
const PAST_INNER_RADIUS: f64 = 1.0;
/// The angles the game puts such a pair's first and second end at.
const FIRST_ANGLE: f64 = 180.0;
const SECOND_ANGLE: f64 = 90.0;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
    at: Option<((f64, f64), (f64, f64))>,
) -> Result<Planned, OpError> {
    if a == b {
        return Err(OpError::WormholeSelf(a));
    }
    for system in [a, b] {
        if !s.graph.systems.contains_key(&system) {
            return Err(OpError::UnknownSystem(system));
        }
    }
    if let Some(((xa, ya), (xb, yb))) = at
        && ![xa, ya, xb, yb].iter().all(|v| v.is_finite())
    {
        return Err(OpError::NotFinite);
    }
    let standing = natural_wormholes(&s.doc, &s.graph.systems)?;
    for system in [a, b] {
        if let Some(found) = standing.iter().find(|w| w.system == system) {
            return Err(OpError::HasNaturalWormhole {
                system,
                kind: found.kind.clone(),
            });
        }
    }

    let (first, second) = match at {
        Some(points) => points,
        None => (
            outside(plan, s, a, FIRST_ANGLE)?,
            outside(plan, s, b, SECOND_ANGLE)?,
        ),
    };
    let natural = next_id(&s.doc, NATURAL)?;
    let bypass = next_id(&s.doc, Table::Bypass)?;
    let ends = [
        WormholeEnd {
            id: natural,
            bypass,
            linked_to: bypass + 1,
            system: a,
            at: first,
        },
        WormholeEnd {
            id: natural + 1,
            bypass: bypass + 1,
            linked_to: bypass,
            system: b,
            at: second,
        },
    ];
    let mut naturals = TableEnd::of(&s.doc, NATURAL)?;
    let mut bypasses = TableEnd::of(&s.doc, Table::Bypass)?;
    for end in &ends {
        let text = natural_wormhole_entry(naturals.indent(), end);
        plan.emit(Emitted::Record, naturals.at(), naturals.shape(text));
        let text = wormhole_bypass_entry(bypasses.indent(), end);
        plan.emit(Emitted::Record, bypasses.at(), bypasses.shape(text));
        append(
            plan.edit(&s.doc, end.system)?,
            &NATURAL_WORMHOLES_AT,
            &[end.id],
        )?;
    }
    Ok(Planned {
        description: format!(
            "Added a wormhole pair between {} and {}",
            named(s, a),
            named(s, b)
        ),
        inverse: Op::RemoveSaveWormholePair { a, b },
    })
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
) -> Result<Planned, OpError> {
    for system in [a, b] {
        if !s.graph.systems.contains_key(&system) {
            return Err(OpError::UnknownSystem(system));
        }
    }
    let standing = natural_wormholes(&s.doc, &s.graph.systems)?;
    let end_in = |system: u32, partner: u32| {
        standing
            .iter()
            .find(|w| w.system == system && w.kind == WORMHOLE && w.partner == Some(partner))
    };
    let (first, (a, b)) = match (end_in(a, b), end_in(b, a)) {
        (Some(end), _) => (end, (a, b)),
        (None, Some(end)) => (end, (b, a)),
        (None, None) => return Err(OpError::NotAWormholePair(a, b)),
    };
    let second = standing
        .iter()
        .find(|w| w.system == b && Some(w.bypass) == first.linked_to)
        .ok_or(OpError::WormholeEndMissing {
            system: a,
            partner: b,
        })?;

    for end in [first, second] {
        take_out(plan, s, end)?;
    }
    Ok(Planned {
        description: format!(
            "Removed the wormhole pair between {} and {}",
            named(s, a),
            named(s, b)
        ),
        inverse: Op::AddSaveWormholePair {
            a,
            b,
            at: Some((first.at, second.at)),
        },
    })
}

/// The point just outside system `id`'s `inner_radius` at `angle` about its star.
fn outside(plan: &mut Plan, s: &Session, id: u32, angle: f64) -> Result<(f64, f64), OpError> {
    let edit = plan.edit(&s.doc, id)?;
    let span = edit.scalar(&[keys::INNER_RADIUS])?;
    let radius: f64 = edit
        .text(span)
        .parse()
        .map_err(|_| edit.parse_error(span.start, "inner_radius is not a number"))?;
    Ok(point((0.0, 0.0), radius + PAST_INNER_RADIUS, angle))
}

/// Where a system's `natural_wormholes` goes when it has none: after its `hyperlane` block,
/// or after `star_class` when it has none.
const NATURAL_WORMHOLES_AT: Place = Place {
    key: keys::NATURAL_WORMHOLES,
    after: &[keys::HYPERLANE, keys::STAR_CLASS],
    before: None,
};

/// Erase one end's `natural_wormholes` and `bypasses` entries, and take their ids out of
/// its system's lists.
fn take_out(plan: &mut Plan, s: &Session, end: &NaturalWormhole) -> Result<(), OpError> {
    plan.erase(&s.doc, Subject::Record(end.anchor), end.anchor)?;
    if let Some(bypass) = row(&s.doc, Table::Bypass, end.bypass)? {
        plan.erase(&s.doc, Subject::Record(bypass.anchor), bypass.anchor)?;
    }
    let edit = plan.edit(&s.doc, end.system)?;
    unlist(edit, keys::NATURAL_WORMHOLES, &[end.id], Emptied::Drop)?;
    // A list that does not name the bypass is left alone: the game writes a bypass into
    // its system's `bypasses` only when it loads the save.
    unlist(edit, keys::BYPASSES, &[end.bypass], Emptied::Drop)?;
    Ok(())
}
