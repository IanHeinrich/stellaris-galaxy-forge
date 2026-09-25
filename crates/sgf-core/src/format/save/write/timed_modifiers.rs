//! An entity's permanent modifiers: the items of its
//! `timed_modifier={ items={ { modifier="…" days=-1 } } }`, laid out like the `hyperlane`
//! entries. A system's nebula modifiers and a planet's terraforming candidate live there.

use crate::emit::inline;
use crate::emit::system::{timed_modifier_item, timed_modifiers};
use crate::keys;
use crate::ops::{Edit, OpError};
use crate::projections::read;
use crate::span::Span;

/// Where a modifier the entity lacks goes among the items it already has.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Place {
    First,
    Last,
}

/// Give the entity each modifier of `modifiers` placed `Some`, where it lacks one, and take
/// out every item of one placed `None`. The block goes after `after=` when it is new, else
/// last in the entity, and with the last item it held. Returns whether anything changed.
pub(crate) fn set(
    edit: &mut Edit,
    after: &str,
    modifiers: &[(&str, Option<Place>)],
) -> Result<bool, OpError> {
    let entity = edit.entity()?;
    let block = entity.find(keys::TIMED_MODIFIER, &edit.buf);
    let items = block.and_then(|b| b.find(keys::ITEMS, &edit.buf));
    let listed: Vec<(Span, String)> = items
        .map(|items| {
            items
                .children()
                .iter()
                .map(|item| (item.span(), read::text(item, keys::MODIFIER, &edit.buf)))
                .collect()
        })
        .unwrap_or_default();
    let has = |m: &str| listed.iter().any(|(_, name)| name == m);
    let removing: Vec<Span> = listed
        .iter()
        .filter(|(_, name)| modifiers.contains(&(name.as_str(), None)))
        .map(|&(span, _)| span)
        .collect();
    let adding: Vec<(&str, Place)> = modifiers
        .iter()
        .filter_map(|&(m, place)| Some((m, place?)))
        .filter(|&(m, _)| !has(m))
        .collect();
    if removing.is_empty() && adding.is_empty() {
        return Ok(false);
    }
    let (Some(block), Some(items)) = (block, items.filter(|i| !i.children().is_empty())) else {
        let names: Vec<&str> = adding.iter().map(|&(m, _)| m).collect();
        let text = |indent: &[u8]| timed_modifiers(indent, &names);
        match block {
            Some(block) => {
                let span = block.span();
                let indent = edit.indent(span.start);
                edit.replace_statement(span, &inline(&indent, &text(&indent)));
            }
            None => {
                let (at, indent) = match entity.find(after, &edit.buf) {
                    Some(anchor) => (
                        edit.line_end(anchor.span().end),
                        edit.indent(anchor.span().start),
                    ),
                    None => edit.before_close(entity),
                };
                edit.insert(at, text(&indent));
            }
        }
        return Ok(true);
    };
    edit.require_block_shape(block)?;
    edit.require_block_shape(items)?;
    if listed.len() - removing.len() + adding.len() == 0 {
        edit.remove_statement(block.span());
        return Ok(true);
    }
    let first = listed[0].0.start;
    let (at_close, indent) = edit.before_close(items);
    for span in removing {
        edit.remove_lines(span);
    }
    for (modifier, place) in adding {
        let at = match place {
            Place::First => edit.line_start(first),
            Place::Last => at_close,
        };
        edit.insert(at, timed_modifier_item(&indent, modifier));
    }
    Ok(true)
}
