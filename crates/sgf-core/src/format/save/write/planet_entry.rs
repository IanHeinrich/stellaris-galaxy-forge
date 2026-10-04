//! A save planet's entity as a planet op opens it, and the parts of it several ops write:
//! the flag bits of `binary_flags`, `moon_of` and the `moons` list.

use crate::Span;
use crate::cst::Node;
use crate::emit::system::ANY_FLAG;
use crate::format::save::write::id_list::{Emptied, items, statement, unlist};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::{Edit, OpError};
use crate::projections::read;
use crate::session::Session;

/// A planet's entity as it stands now, and the system it stands in.
pub(crate) struct PlanetEntry<'s> {
    pub node: Node,
    pub src: &'s [u8],
    pub system: u32,
}

impl<'s> PlanetEntry<'s> {
    /// Planet `id`'s entity, refused when the save has no such planet or it names no system.
    pub fn open(s: &'s Session, id: u32) -> Result<Self, OpError> {
        let (node, src) = planet_entity(&s.doc, id)?;
        let system = planet_system(&node, src, id)?;
        Ok(Self { node, src, system })
    }
}

/// Write `moon_of`, before `moons` or `planet_orbitals` when the body has none, or take it
/// out for a planet.
pub(crate) fn set_moon_of(edit: &mut Edit, parent: Option<u32>) -> Result<(), OpError> {
    let existing = child(edit, &[keys::MOON_OF])?;
    match (parent, existing) {
        (Some(parent), Some(_)) => edit.set_scalar(&[keys::MOON_OF], parent.to_string())?,
        (Some(parent), None) => {
            let next = successor(edit, &[keys::MOONS, keys::PLANET_ORBITALS])?;
            edit.insert_before(next, &format!("{}={parent}", keys::MOON_OF));
        }
        (None, Some(span)) => edit.remove_statement(span),
        (None, None) => {}
    }
    Ok(())
}

/// Set or clear `flag` in the body's `binary_flags`, writing the statement before
/// `entity_planet_class`, else `coordinate`, when the body has none and taking it out when
/// only the bit set beside any other is left.
pub(crate) fn set_flag(edit: &mut Edit, flag: u32, on: bool) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let old = read::scalar_u32(entity, keys::BINARY_FLAGS, &edit.buf);
    let new = if on {
        old.unwrap_or(0) | flag | ANY_FLAG
    } else {
        old.unwrap_or(0) & !flag
    };
    if old == Some(new) || (old.is_none() && !on) {
        return Ok(());
    }
    match child(edit, &[keys::BINARY_FLAGS])? {
        Some(span) if new & !ANY_FLAG == 0 => edit.remove_statement(span),
        Some(_) => edit.set_scalar(&[keys::BINARY_FLAGS], new.to_string())?,
        None => {
            let next = successor(edit, &[keys::ENTITY_PLANET_CLASS, keys::COORDINATE])?;
            edit.insert_before(next, &format!("{}={new}", keys::BINARY_FLAGS));
        }
    }
    Ok(())
}

/// Put `id` in the planet's `moons` in ascending order, writing the list before
/// `planet_orbitals` when the planet has none.
pub(crate) fn list_moon(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let Some(block) = entity.find(keys::MOONS, &edit.buf) else {
        let next = successor(edit, &[keys::PLANET_ORBITALS])?;
        let text = statement(&edit.indent(next.start), keys::MOONS, &[id]);
        edit.insert_before(next, &text);
        return Ok(());
    };
    if block.scalar_span().is_some() {
        return Err(edit.parse_error(block.span().start, "moons is not a block"));
    }
    let listed = items(edit, block);
    match (listed.iter().find(|(moon, _)| *moon > id), listed.last()) {
        (Some((_, next)), _) => edit.insert(next.start, format!("{id} ").into_bytes()),
        (None, Some((_, last))) => edit.insert(last.end, format!(" {id}").into_bytes()),
        (None, None) => {
            let span = block.span();
            let text = statement(&edit.indent(span.start), keys::MOONS, &[id]);
            edit.replace_statement(span, &text);
        }
    }
    Ok(())
}

/// Take `id` out of the planet's `moons`, and the list with it when nothing else is left.
pub(crate) fn unlist_moon(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    unlist(edit, keys::MOONS, &[id], Emptied::Drop).map(drop)
}

/// The span of the entity's first child keyed by one of `keys`.
fn child(edit: &Edit, keys: &[&str]) -> Result<Option<Span>, OpError> {
    let entity = edit.entity()?;
    Ok(entity
        .children()
        .iter()
        .find(|c| c.key.is_some_and(|k| keys.contains(&edit.text(k))))
        .map(Node::span))
}

/// The statement a new key goes in front of: the first of `keys` the entity holds.
fn successor(edit: &Edit, keys: &[&str]) -> Result<Span, OpError> {
    child(edit, keys)?.ok_or_else(|| edit.parse_error(0, format!("missing {}", keys.join(" or "))))
}

/// " and its moon", " and its 3 moons", or nothing, after the planet an op takes.
pub(crate) fn and_its_moons(moons: usize) -> String {
    match moons {
        0 => String::new(),
        1 => " and its moon".to_owned(),
        n => format!(" and its {n} moons"),
    }
}
