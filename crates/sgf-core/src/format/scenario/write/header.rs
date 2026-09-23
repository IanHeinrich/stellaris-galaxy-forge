//! The scenario's own keys: the scalars and blocks standing before the first system.
//!
//! A header statement is a slot like any other, named by its anchor, so a rewrite, an
//! insertion before the first system and a removal all go through the overlay and the
//! rebuild reads the result back.

use std::collections::BTreeSet;

use super::index;
use crate::cst;
use crate::document::Document;
use crate::format::scenario::header_counts::KEYS;
use crate::format::scenario::index::{ENTITY_KEYS, HeaderStmt};
use crate::ops::{Emitted, Op, OpError, Plan, Planned, Subject, blank_slot};
use crate::overlay::Anchor;
use crate::plural;
use crate::session::Session;

pub(super) fn set_field(
    plan: &mut Plan,
    s: &Session,
    key: &str,
    value: Option<&str>,
) -> Result<Planned, OpError> {
    let header = &index(&s.doc).header;
    let stmt = header.get(key).cloned();
    let lines: Vec<u32> = header.all(key).map(|held| held.field.line).collect();
    let insert_at = header.insert_at;
    let indent = header.indent.clone();
    let at = stmt.as_ref().map_or(insert_at, |held| held.anchor.start());
    match (value.map(str::trim), stmt) {
        (Some(raw), held) => {
            check_key(key, at)?;
            check_value(key, raw, at)?;
            match held {
                Some(held) => rewrite(plan, s, key, raw, &held),
                None => Ok(insert(plan, key, raw, insert_at, indent)),
            }
        }
        // Which of a repeated key's statements the inverse would put back is not the one
        // this removed: the survivor takes the first slot the moment it is gone.
        (None, Some(_)) if lines.len() > 1 => Err(refuse(
            at,
            format!(
                "the header holds {key} {} times, on lines {}",
                lines.len(),
                lines
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        )),
        (None, Some(held)) => remove(plan, s, key, &held),
        (None, None) => Err(refuse(at, format!("the header holds no {key} to remove"))),
    }
}

/// Every entry written as [`set_field`] writes one with `Some`, as one undo step: the
/// inverse carries the raw text each key displaced, and nothing for a key the header
/// lacked.
pub(super) fn set_fields(
    plan: &mut Plan,
    s: &Session,
    entries: &[(String, String)],
) -> Result<Planned, OpError> {
    if entries.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    for (key, _) in entries {
        if !seen.insert(key.as_str()) {
            return Err(refuse(
                index(&s.doc).header.insert_at,
                format!("{key} is listed more than once"),
            ));
        }
    }
    let mut previous = Vec::with_capacity(entries.len());
    for (key, value) in entries {
        let planned = set_field(plan, s, key, Some(value))?;
        if let Op::SetHeaderField {
            key,
            value: Some(value),
        } = planned.inverse
        {
            previous.push((key, value));
        }
    }
    let counts = seen.len() == KEYS.len() && KEYS.iter().all(|key| seen.contains(key));
    Ok(Planned {
        description: if counts {
            "Update empire counts".to_owned()
        } else {
            format!("Set {}", plural(entries.len(), "header key"))
        },
        inverse: Op::SetHeaderKeys { entries: previous },
    })
}

/// Every statement of `key` as one undo step: the statements standing are rewritten in
/// place, one value each, surplus statements removed and surplus values written after
/// the last statement standing, so the list keeps its place in the header.
pub(super) fn set_list(
    plan: &mut Plan,
    s: &Session,
    key: &str,
    values: &[String],
) -> Result<Planned, OpError> {
    let header = &index(&s.doc).header;
    let existing: Vec<HeaderStmt> = header.all(key).cloned().collect();
    let values: Vec<&str> = values.iter().map(|value| value.trim()).collect();
    let at = existing
        .first()
        .map_or(header.insert_at, |held| held.anchor.start());
    if existing.is_empty() && values.is_empty() {
        return Err(refuse(at, format!("the header holds no {key} to remove")));
    }
    check_key(key, at)?;
    for raw in &values {
        check_value(key, raw, at)?;
    }
    for (held, raw) in existing.iter().zip(&values) {
        rewrite(plan, s, key, raw, held)?;
    }
    for held in existing.iter().skip(values.len()) {
        remove(plan, s, key, held)?;
    }
    let (at, indent) = match existing.last() {
        Some(last) => (
            after(&s.doc, last.anchor),
            super::indent(&s.doc, last.anchor),
        ),
        None => (header.insert_at, header.indent.clone()),
    };
    for raw in values.iter().skip(existing.len()) {
        insert(plan, key, raw, at, indent.clone());
    }
    Ok(Planned {
        description: format!("Set {key} to {} values", values.len()),
        inverse: Op::SetHeaderList {
            key: key.to_owned(),
            values: existing.into_iter().map(|held| held.field.value).collect(),
        },
    })
}

/// Where a statement written after the one at `anchor` goes: the start of its next line,
/// past any line a removal has already emptied there, since the overlay refuses an
/// insert at the start of a slot. An inserted statement carries its own line end, so a
/// statement written at its offset lands after it.
fn after(doc: &Document, anchor: Anchor) -> usize {
    let Anchor::Original(span) = anchor else {
        return anchor.start();
    };
    let mut at = cst::line_end(doc.original(), span.end);
    for (slot, bytes) in doc.overlay().slots() {
        if let Anchor::Original(emptied) = slot
            && emptied.start == at
            && emptied.end > at
            && blank_slot(bytes)
        {
            at = emptied.end;
        }
    }
    at
}

/// The raw text goes where the value stands, block or scalar alike, so a key written as
/// `x = 12` and one written as `x = { min = 1 max = 2 }` are the same rewrite. A key the
/// header holds more than once is rewritten at its first statement, the one the game
/// reads; the rest are left exactly as they stand.
fn rewrite(
    plan: &mut Plan,
    s: &Session,
    key: &str,
    raw: &str,
    stmt: &HeaderStmt,
) -> Result<Planned, OpError> {
    let edit = plan.edit_header(&s.doc, stmt.anchor)?;
    let span = edit.entity()?.value_span();
    edit.splices.push((span.range(), raw.as_bytes().to_vec()));
    Ok(Planned {
        description: format!("Set header {key} to {raw}"),
        inverse: was(key, Some(stmt.field.value.clone())),
    })
}

fn insert(plan: &mut Plan, key: &str, raw: &str, at: usize, indent: Vec<u8>) -> Planned {
    let mut text = indent;
    text.extend_from_slice(format!("{key} = {raw}\n").as_bytes());
    plan.emit(Emitted::Header, at, text);
    Planned {
        description: format!("Added header {key} = {raw}"),
        inverse: was(key, None),
    }
}

fn remove(plan: &mut Plan, s: &Session, key: &str, stmt: &HeaderStmt) -> Result<Planned, OpError> {
    plan.erase(&s.doc, Subject::Header(stmt.anchor), stmt.anchor)?;
    Ok(Planned {
        description: format!("Removed header {key}"),
        inverse: was(key, Some(stmt.field.value.clone())),
    })
}

fn was(key: &str, value: Option<String>) -> Op {
    Op::SetHeaderField {
        key: key.to_owned(),
        value,
    }
}

/// A key is written as it stands, so it has to be one bare token, and never one of the
/// statements a scenario reads as an entity: `header set nebula 5` would otherwise leave
/// a cloud of radius 0 at the galaxy's centre.
fn check_key(key: &str, at: usize) -> Result<(), OpError> {
    let separator =
        |b: u8| b.is_ascii_whitespace() || matches!(b, b'{' | b'}' | b'=' | b'"' | b'#');
    if key.is_empty() || key.bytes().any(separator) {
        return Err(refuse(at, format!("{key:?} is not a header key")));
    }
    if ENTITY_KEYS.contains(&key) {
        return Err(refuse(
            at,
            format!("{key} is a scenario statement, not a header key"),
        ));
    }
    Ok(())
}

/// The text goes in as it stands, so `key = text` has to read back as the one statement
/// it claims to be: it parses, it is the only statement, and its value ends where the
/// text does, so nothing trails it and a `#` cannot comment out the statements sharing
/// its line. The lexer runs an unterminated quote to the end of its input, so a quoted
/// value is checked for its closing quote as well: the span alone cannot tell.
fn check_value(key: &str, raw: &str, at: usize) -> Result<(), OpError> {
    if raw.is_empty() {
        return Err(refuse(at, "a header value may not be empty"));
    }
    if raw.contains(['\n', '\r']) {
        return Err(refuse(at, "a header value may not hold a line break"));
    }
    let text = format!("{key} = {raw}");
    let bytes = text.as_bytes();
    let root = cst::parse_script(bytes, 0)
        .map_err(|e| refuse(at, format!("{text} does not parse: {}", e.reason)))?;
    let one = match root.children() {
        [node] if node.key_str(bytes) == Some(key) => node,
        _ => return Err(refuse(at, format!("{text} is not one statement"))),
    };
    if one.value_span().end != bytes.len() {
        return Err(refuse(
            at,
            format!("{raw} holds more than one header value"),
        ));
    }
    if let Some(span) = one.scalar_span() {
        let scalar = span.slice(bytes);
        if scalar.first() == Some(&b'"') && (scalar.len() < 2 || scalar.last() != Some(&b'"')) {
            return Err(refuse(at, format!("{raw} leaves a quote open")));
        }
    }
    Ok(())
}

fn refuse(at: usize, reason: impl Into<String>) -> OpError {
    OpError::HeaderParse {
        offset: at,
        reason: reason.into(),
    }
}
