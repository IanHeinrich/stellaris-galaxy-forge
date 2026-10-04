//! An entity's timed modifiers: the items of its
//! `timed_modifier={ items={ { modifier="…" days=N } } }`, laid out like the `hyperlane`
//! entries, `days=-1` for one that never expires. A system's nebula modifiers and a
//! planet's modifiers live there.

use crate::emit::inline;
use crate::emit::system::{timed_modifier_item, timed_modifiers};
use crate::format::save::write::place::{Place, insert_key};
use crate::keys;
use crate::ops::{Edit, OpError};
use crate::projections::read;
use crate::span::Span;

/// Where a modifier the entity lacks goes among the items it already has.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum End {
    First,
    Last,
}

/// What [`set_items`] does with one modifier.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ItemEdit {
    /// Add it at that end, lasting `days` (`-1` for ever), where the entity lacks it.
    Add { at: End, days: i32 },
    /// Take out every item of it.
    Remove,
}

impl ItemEdit {
    /// A modifier that never expires, added at `at` when `on` and taken out otherwise.
    pub(crate) fn permanent(on: bool, at: End) -> Self {
        if on {
            Self::Add { at, days: -1 }
        } else {
            Self::Remove
        }
    }
}

/// Apply each of `modifiers` to the entity's timed modifiers. The block goes where `place`
/// says when it is new, and with the last item it held. Returns whether anything changed.
pub(crate) fn set_items(
    edit: &mut Edit,
    place: &Place,
    modifiers: &[(&str, ItemEdit)],
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
        .filter(|(_, name)| modifiers.contains(&(name.as_str(), ItemEdit::Remove)))
        .map(|&(span, _)| span)
        .collect();
    let adding: Vec<(&str, End, i32)> = modifiers
        .iter()
        .filter_map(|&(m, item)| match item {
            ItemEdit::Add { at, days } => Some((m, at, days)),
            ItemEdit::Remove => None,
        })
        .filter(|&(m, _, _)| !has(m))
        .collect();
    if removing.is_empty() && adding.is_empty() {
        return Ok(false);
    }
    let (Some(block), Some(items)) = (block, items.filter(|i| !i.children().is_empty())) else {
        let items: Vec<(&str, i32)> = adding.iter().map(|&(m, _, days)| (m, days)).collect();
        let text = |indent: &[u8]| timed_modifiers(indent, &items);
        match block {
            Some(block) => {
                let span = block.span();
                let indent = edit.indent(span.start);
                edit.replace_statement(span, &inline(&indent, &text(&indent)));
            }
            None => insert_key(edit, &[], place, |indent| inline(indent, &text(indent)))?,
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
    for (modifier, end, days) in adding {
        let at = match end {
            End::First => edit.line_start(first),
            End::Last => at_close,
        };
        edit.insert(at, timed_modifier_item(&indent, modifier, days));
    }
    Ok(true)
}
