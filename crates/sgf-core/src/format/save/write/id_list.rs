//! The id lists a save entity holds, such as a planet's `moons = { 3 7 }`, and a system's
//! `planet=` lines: taking ids out, and putting them in where the game writes them.

use crate::Span;
use crate::cst::Node;
use crate::emit::system::planet_lines;
use crate::emit::{Lines, inline};
use crate::format::save::write::place::{Place, insert_key};
use crate::keys;
use crate::ops::{Edit, OpError};

/// What a list left with none of its ids becomes.
#[derive(Clone, Copy)]
pub(crate) enum Emptied {
    /// It goes, as the game writes no empty one.
    Drop,
    /// It stays, empty.
    Keep,
    /// It holds the null id, as a system with no starbase does.
    Null,
}

/// The ids the list block holds, with their spans.
pub(crate) fn items(edit: &Edit, block: &Node) -> Vec<(u32, Span)> {
    block
        .children()
        .iter()
        .filter(|item| item.key.is_none())
        .filter_map(|item| Some((item.scalar_str(&edit.buf)?.parse().ok()?, item.span())))
        .collect()
}

/// Take `ids` out of the entity's list `key`, which may be missing. Returns how many items
/// went.
pub(crate) fn unlist(
    edit: &mut Edit,
    key: &str,
    ids: &[u32],
    emptied: Emptied,
) -> Result<usize, OpError> {
    match edit.entity()?.find(key, &edit.buf).cloned() {
        Some(block) => Ok(unlist_in(edit, &block, ids, emptied)),
        None => Ok(0),
    }
}

/// Take `ids` out of the list `block`, eating the blanks after each. Returns how many items
/// went.
pub(crate) fn unlist_in(edit: &mut Edit, block: &Node, ids: &[u32], emptied: Emptied) -> usize {
    let listed: Vec<Span> = items(edit, block)
        .into_iter()
        .filter(|(id, _)| ids.contains(id))
        .map(|(_, span)| span)
        .collect();
    let Some(&first) = listed.first() else {
        return 0;
    };
    let all = listed.len() == block.children().len();
    let mut gone = listed.as_slice();
    match emptied {
        Emptied::Drop if all => {
            edit.bytes().remove_statement(block.span());
            return listed.len();
        }
        Emptied::Null if all => {
            edit.replace_span(first, crate::NULL_ID.to_string());
            gone = &listed[1..];
        }
        _ => {}
    }
    for &item in gone {
        let end = item.end
            + edit.buf[item.end..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
        edit.replace_span(Span::new(item.start, end), Vec::new());
    }
    listed.len()
}

/// Put `ids` last in the entity's list `place.key`, writing the list where the game does
/// when the entity has none.
pub(crate) fn append(edit: &mut Edit, place: &Place, ids: &[u32]) -> Result<(), OpError> {
    if ids.is_empty() {
        return Ok(());
    }
    if let Some(block) = edit.entity()?.find(place.key, &edit.buf).cloned() {
        return append_in(edit, &block, place.key, ids);
    }
    insert_key(edit, &[], place, |indent| statement(indent, place.key, ids))
}

/// Put `ids` last in `block`, the list `key`.
pub(crate) fn append_in(
    edit: &mut Edit,
    block: &Node,
    key: &str,
    ids: &[u32],
) -> Result<(), OpError> {
    if block.scalar_span().is_some() {
        return Err(edit.parse_error(block.span().start, format!("{key} is not a block")));
    }
    match block.children().last() {
        Some(item) => {
            let items: String = ids.iter().map(|id| format!(" {id}")).collect();
            edit.insert(item.span().end, items.into_bytes());
        }
        None => {
            let span = block.span();
            let text = statement(&edit.indent(span.start), key, ids);
            edit.bytes().replace_statement(span, &text);
        }
    }
    Ok(())
}

/// A list `key` of `ids`, as a statement whose first line takes `indent` from the line it
/// is written on.
pub(crate) fn statement(indent: &[u8], key: &str, ids: &[u32]) -> String {
    let mut w = Lines::new(indent);
    w.list(0, key, ids);
    inline(indent, &w.into_bytes())
}

/// The system's `planet=` statements naming one of `ids`.
fn planet_statements(edit: &Edit, ids: &[u32]) -> Result<Vec<Span>, OpError> {
    let entity = edit.entity()?;
    Ok(entity
        .find_all(keys::PLANET, &edit.buf)
        .filter(|n| {
            n.scalar_str(&edit.buf)
                .and_then(|t| t.parse().ok())
                .is_some_and(|id: u32| ids.contains(&id))
        })
        .map(Node::span)
        .collect())
}

pub(crate) fn unlist_planets(edit: &mut Edit, ids: &[u32]) -> Result<(), OpError> {
    for span in planet_statements(edit, ids)? {
        edit.require_alone_on_line(span, "a planet statement")?;
        edit.bytes().remove_lines(span);
    }
    Ok(())
}

/// Write a `planet=` line per id after the system's last, in its indentation.
pub(crate) fn list_planets(edit: &mut Edit, ids: &[u32]) -> Result<(), OpError> {
    let last = edit
        .entity()?
        .find_all(keys::PLANET, &edit.buf)
        .last()
        .map(Node::span)
        .ok_or_else(|| edit.parse_error(0, "the system lists no bodies"))?;
    edit.require_alone_on_line(last, "a planet statement")?;
    let indent = edit.indent(last.start);
    edit.insert(edit.line_end(last.end), planet_lines(&indent, ids));
    Ok(())
}
