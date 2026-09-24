//! `system_initializer_counter`: how often the game has placed each layout that has
//! `max_instances`, as a `count` list and an `initializer` list side by side. An add of
//! such a layout counts one more, and a removal of it one fewer. An entry an add appended
//! goes again when its count comes back to nothing.

use std::collections::BTreeMap;

use crate::cst::{self, Node};
use crate::document::Document;
use crate::emit::quoted;
use crate::keys;
use crate::ops::{Edit, OpError, Plan};
use crate::overlay::Anchor;

/// Each layout the save's counter lists, with its count. Empty when the save has none.
pub fn initializer_counts(doc: &Document) -> BTreeMap<String, u32> {
    let Some(anchor) = anchor(doc) else {
        return BTreeMap::new();
    };
    doc.current(anchor)
        .map(|bytes| entries(bytes).into_iter().collect())
        .unwrap_or_default()
}

/// Whether the adds of `initializer` since the file was opened were counted: its count
/// has gone up since.
pub(crate) fn counted(doc: &Document, initializer: &str) -> bool {
    let loaded = loaded(doc)
        .into_iter()
        .find(|(name, _)| name == initializer)
        .map_or(0, |(_, count)| count);
    initializer_counts(doc)
        .get(initializer)
        .is_some_and(|&count| count > loaded)
}

/// Add each change to its layout's count: an entry at the end for a layout the counter
/// does not list, and none left for one an add appended once its count is back to 0.
pub(crate) fn count(
    plan: &mut Plan,
    doc: &Document,
    changes: &BTreeMap<&str, i64>,
) -> Result<(), OpError> {
    if changes.values().all(|&change| change == 0) {
        return Ok(());
    }
    let anchor = anchor(doc).ok_or(OpError::MissingSaveKey(keys::SYSTEM_INITIALIZER_COUNTER))?;
    let loaded = loaded(doc);
    let edit = plan.edit_record(doc, anchor)?;
    let counter = edit.entity()?.clone();
    let list = |key: &str| {
        counter
            .find(key, &edit.buf)
            .map(|block| block.children().to_vec())
            .ok_or_else(|| edit.parse_error(0, format!("the counter has no {key} list")))
    };
    let (counts, names) = (list(keys::COUNT)?, list(keys::INITIALIZER)?);
    if counts.len() != names.len() {
        return Err(edit.parse_error(0, "the counter lists more counts than initializers"));
    }
    for (&initializer, &change) in changes.iter().filter(|(_, change)| **change != 0) {
        let at = names
            .iter()
            .position(|name| name.scalar_str(&edit.buf) == Some(initializer));
        let Some(at) = at else {
            if change > 0 {
                append(edit, &counter, &counts, &names, initializer, change)?;
            }
            continue;
        };
        let span = counts[at]
            .scalar_span()
            .ok_or_else(|| edit.parse_error(0, "a count is not a number"))?;
        let now: i64 = edit
            .text(span)
            .parse()
            .map_err(|_| edit.parse_error(span.start, "a count is not a number"))?;
        let after = (now + change).max(0);
        if after == 0 && !loaded.iter().any(|(name, _)| name == initializer) {
            edit.remove_statement(counts[at].span());
            edit.remove_statement(names[at].span());
        } else {
            edit.splices
                .push((span.range(), after.to_string().into_bytes()));
        }
    }
    Ok(())
}

fn append(
    edit: &mut Edit,
    counter: &Node,
    counts: &[Node],
    names: &[Node],
    initializer: &str,
    count: i64,
) -> Result<(), OpError> {
    let block = |key: &str| {
        counter
            .find(key, &edit.buf)
            .map(Node::value_span)
            .ok_or_else(|| edit.parse_error(0, format!("the counter has no {key} list")))
    };
    let (count_block, name_block) = (block(keys::COUNT)?, block(keys::INITIALIZER)?);
    match counts.last() {
        Some(last) => edit.insert(last.span().end, format!(" {count}").into_bytes()),
        None => edit.insert_first(count_block, None, &count.to_string()),
    }
    match names.last() {
        Some(last) => edit.insert_after(last.span().end, &quoted(initializer)),
        None => edit.insert_first(name_block, None, &quoted(initializer)),
    }
    Ok(())
}

fn anchor(doc: &Document) -> Option<Anchor> {
    let section = doc.index().section(keys::SYSTEM_INITIALIZER_COUNTER)?;
    Some(Anchor::Original(section.stmt))
}

/// The counter's entries as the file was opened.
fn loaded(doc: &Document) -> Vec<(String, u32)> {
    doc.index()
        .section(keys::SYSTEM_INITIALIZER_COUNTER)
        .map(|section| entries(section.stmt.slice(doc.original())))
        .unwrap_or_default()
}

/// The counter statement's entries, as (initializer, count) in file order.
fn entries(bytes: &[u8]) -> Vec<(String, u32)> {
    let Some(counter) = cst::parse(bytes, 0)
        .ok()
        .and_then(|root| root.children().first().cloned())
    else {
        return Vec::new();
    };
    let list = |key: &str| -> Vec<&Node> {
        counter
            .find(key, bytes)
            .map(|block| block.children().iter().collect())
            .unwrap_or_default()
    };
    list(keys::INITIALIZER)
        .into_iter()
        .zip(list(keys::COUNT))
        .filter_map(|(name, count)| {
            Some((
                name.scalar_str(bytes)?.to_owned(),
                count.scalar_str(bytes)?.parse().ok()?,
            ))
        })
        .collect()
}
