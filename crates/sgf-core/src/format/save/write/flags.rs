//! The flags an entity's `flags` block holds, written and taken out, and the dates the game
//! gives a flag it sets.

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::{Lines, inline};
use crate::format::save::entity_at;
use crate::format::save::write::place::{Place, insert_key};
use crate::keys::{self, GAME_STARTED};
use crate::ops::{Edit, OpError};
use crate::overlay::Anchor;

/// The save's day one as its global `game_started` flag dates it.
pub(crate) fn day_one(doc: &Document) -> Result<String, OpError> {
    let missing = OpError::MissingKey(GAME_STARTED);
    let section = doc.index().section(keys::FLAGS).ok_or(missing)?;
    entity_at(doc, Anchor::Original(section.stmt))
        .ok()
        .flatten()
        .and_then(|(flags, bytes)| {
            let date = flags.find(GAME_STARTED, bytes)?.scalar_str(bytes)?;
            Some(date.to_owned())
        })
        .ok_or(OpError::MissingKey(GAME_STARTED))
}

/// The flags of entity `node` that `gone` picks, or its whole `flags` block when they are
/// all it holds.
pub(crate) fn flag_spans(node: &Node, src: &[u8], gone: impl Fn(&str) -> bool) -> Vec<Span> {
    let Some(flags) = node.find(keys::FLAGS, src) else {
        return Vec::new();
    };
    let picked: Vec<Span> = flags
        .children()
        .iter()
        .filter(|flag| flag.key_str(src).is_some_and(&gone))
        .map(Node::span)
        .collect();
    if !picked.is_empty() && picked.len() == flags.children().len() {
        return vec![flags.span()];
    }
    picked
}

/// Take the flags `gone` picks off the entity `edit` holds, as [`flag_spans`] finds them.
/// Whether any went.
pub(crate) fn drop_flags(edit: &mut Edit, gone: impl Fn(&str) -> bool) -> Result<bool, OpError> {
    let spans = flag_spans(edit.entity()?, &edit.buf, gone);
    for &span in &spans {
        edit.bytes().remove_statement(span);
    }
    Ok(!spans.is_empty())
}

/// Give the entity `edit` holds the flags `flags`, each with its date, after its last flag,
/// writing its `flags` block where `place` says when it has none.
pub(crate) fn add_flags(
    edit: &mut Edit,
    flags: &[(&str, String)],
    place: &Place,
) -> Result<(), OpError> {
    if flags.is_empty() {
        return Ok(());
    }
    let lines: Vec<String> = flags
        .iter()
        .map(|(flag, date)| format!("{flag}={date}"))
        .collect();
    let block = edit.entity()?.find(keys::FLAGS, &edit.buf).cloned();
    match block.as_ref().and_then(|block| block.children().last()) {
        Some(last) => {
            let end = last.span().end;
            for line in &lines {
                edit.bytes().insert_after(end, line);
            }
        }
        None => {
            let write = |indent: &[u8]| {
                let mut w = Lines::new(indent);
                w.open(0, keys::FLAGS);
                for line in &lines {
                    w.line(1, line);
                }
                w.close(0);
                inline(indent, &w.into_bytes())
            };
            match block {
                Some(block) => {
                    let text = write(&edit.indent(block.span().start));
                    edit.bytes().replace_statement(block.span(), &text);
                }
                None => insert_key(edit, &[], place, write)?,
            }
        }
    }
    Ok(())
}
