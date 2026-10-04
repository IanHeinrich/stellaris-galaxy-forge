//! An empire's name: `country.<id>.name` with the `custom_name=yes` mark that keeps the
//! game from generating a new one, and for the player's empire the gamestate header's
//! `name` and the `name` in the save's `meta`, which the load screen lists the save under.
//!
//! Undo is byte-exact through history, which restores the bytes each write displaced. The
//! inverse op is exact too: it carries a generated name's whole old value.

use crate::Span;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::emit;
use crate::format::save::check_version;
use crate::keys;
use crate::ops::rules::{check_name, quoted};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::overlay::Anchor;
use crate::session::Session;

pub(crate) fn plan_rename(
    plan: &mut Plan,
    s: &Session,
    country: u32,
    name: &str,
    value: Option<&str>,
    custom_name: bool,
) -> Result<Planned, OpError> {
    check_name(name)?;
    if let Some(value) = value {
        check_value(value)?;
    }
    let written = plan_country(plan, s, country, (name, value), custom_name)?;
    let mut changed = written.changed;
    let mut old_name = match &written.old_literal {
        Some(key) => key.clone(),
        None => stand_in(s, country),
    };
    if s.graph.player_country == Some(country) {
        if let Some(header) = plan_header(plan, &s.doc, name)? {
            changed |= header != name;
            old_name = header;
        }
        changed |= plan_meta(plan, &s.doc, name)?;
    }
    if !changed {
        return Err(OpError::EmpireNameUnchanged(country));
    }
    let value =
        (written.old_literal.as_deref() != Some(old_name.as_str())).then_some(written.old_value);
    Ok(Planned {
        description: format!("Renamed empire {country} to {name}"),
        inverse: Op::RenameEmpire {
            country,
            name: old_name,
            value,
            custom_name: !written.marked,
        },
    })
}

/// What [`plan_country`] found and wrote.
struct Written {
    /// The old `name` value whole.
    old_value: String,
    /// The key the old name held, when it was a literal.
    old_literal: Option<String>,
    /// Whether this rename added `custom_name=yes`.
    marked: bool,
    changed: bool,
}

/// Write the country's new name, and add or take away its `custom_name=yes` mark.
fn plan_country(
    plan: &mut Plan,
    s: &Session,
    country: u32,
    (name, value): (&str, Option<&str>),
    custom_name: bool,
) -> Result<Written, OpError> {
    let four = check_version(&s.doc).is_ok();
    let edit = plan.edit_country(&s.doc, country)?;
    let entity = edit.entity()?.clone();
    let node = entity
        .find(keys::NAME, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "no name"))?;
    let old_value = edit.text(node.value_span()).to_owned();
    let literal = literal_key(node, &edit.buf);
    let write = match (value, &literal) {
        (Some(value), _) => (value != old_value).then(|| (node.value_span(), value.into())),
        (None, Some((span, key))) => (key != name).then(|| (*span, quoted(name).into_bytes())),
        (None, None) => {
            let indent = edit.indent(node.span().start);
            Some((node.value_span(), emit::literal_name_value(&indent, name)))
        }
    };
    let mut changed = write.is_some();
    if let Some((span, text)) = write {
        edit.replace_span(span, text);
    }
    let mark = entity.find(keys::CUSTOM_NAME, &edit.buf).map(Node::span);
    let marked = custom_name && mark.is_none();
    match (custom_name, mark) {
        (true, None) => mark_custom(edit, &entity, four)?,
        (false, Some(span)) => edit.remove_lines(span),
        _ => {}
    }
    changed |= marked || (!custom_name && mark.is_some());
    Ok(Written {
        old_value,
        old_literal: literal.map(|(_, key)| key),
        marked,
        changed,
    })
}

/// Add `custom_name=yes` where the game writes it: first in the country, after any
/// `save_on_death`, in a 4.x save, and after the adjective, else the name, in a 3.x one.
fn mark_custom(edit: &mut Edit, entity: &Node, four: bool) -> Result<(), OpError> {
    let src = &edit.buf;
    let at = if four {
        let first = entity
            .children()
            .iter()
            .find(|c| c.key_str(src) != Some(keys::SAVE_ON_DEATH))
            .ok_or_else(|| edit.parse_error(entity.span().start, "the country is empty"))?;
        if !edit.starts_line(first.span().start) {
            return Err(edit.parse_error(first.span().start, "a key shares its line"));
        }
        (edit.line_start(first.span().start), first.span().start)
    } else {
        let after = entity
            .find(keys::ADJECTIVE, src)
            .or_else(|| entity.find(keys::NAME, src))
            .ok_or_else(|| edit.parse_error(entity.span().start, "no name"))?;
        (edit.line_end(after.span().end), after.span().start)
    };
    let indent = edit.indent(at.1);
    edit.insert(at.0, emit::custom_name_line(&indent));
    Ok(())
}

/// The `key` of a `{ key="…" literal=yes }` name with no variables, and its span: the one
/// scalar a rename of such a name rewrites.
fn literal_key(name: &Node, src: &[u8]) -> Option<(Span, String)> {
    let literal = name.find(keys::LITERAL, src)?.scalar_str(src) == Some("yes");
    if !literal || name.find(keys::VARIABLES, src).is_some() {
        return None;
    }
    let key = name.find(keys::KEY, src)?;
    Some((key.scalar_span()?, key.scalar_str(src)?.to_owned()))
}

/// What the inverse names a country whose name the game generated: the stand-in the
/// projection reads, or its id when that cannot be written as a name.
fn stand_in(s: &Session, country: u32) -> String {
    s.graph
        .countries
        .iter()
        .find(|c| c.id == country)
        .map(|c| c.name_key.clone())
        .filter(|name| check_name(name).is_ok())
        .unwrap_or_else(|| format!("Empire {country}"))
}

/// Refuse a `name` value that does not read as one value. The lexer runs an unterminated
/// quote to the end of its input, so a quoted value is checked for its closing quote too.
fn check_value(value: &str) -> Result<(), OpError> {
    let what = "a name value";
    if value.trim().is_empty() {
        return Err(OpError::EmptyText { what });
    }
    let text = format!("{}={value}", keys::NAME);
    let bytes = text.as_bytes();
    let whole = cst::parse(bytes, 0).is_ok_and(|root| match root.children() {
        [only] => only.span().end == bytes.len() && !open_quote(only, bytes),
        _ => false,
    });
    if !whole {
        return Err(OpError::InvalidText {
            what,
            text: value.to_owned(),
        });
    }
    Ok(())
}

/// Whether `node` is a quoted scalar that never closes its quote.
fn open_quote(node: &Node, src: &[u8]) -> bool {
    node.scalar_span().is_some_and(|span| {
        let scalar = span.slice(src);
        scalar.first() == Some(&b'"') && (scalar.len() < 2 || scalar.last() != Some(&b'"'))
    })
}

/// Write `name` as the gamestate header's `name`, returning the name it held; `None` when
/// the header has none.
fn plan_header(plan: &mut Plan, doc: &Document, name: &str) -> Result<Option<String>, OpError> {
    let Some(section) = doc.index().section(keys::NAME) else {
        return Ok(None);
    };
    let edit = plan.edit_record(doc, Anchor::Original(section.stmt))?;
    let node = edit.entity()?;
    let span = node
        .scalar_span()
        .ok_or_else(|| edit.parse_error(node.span().start, "the header's name is a block"))?;
    let old = node.scalar_str(&edit.buf).unwrap_or_default().to_owned();
    if old != name {
        edit.replace_span(span, quoted(name));
    }
    Ok(Some(old))
}

/// Write `name` as the `name` in the save's `meta`, returning whether it changed. A `meta`
/// with no name is left as it is.
fn plan_meta(plan: &mut Plan, doc: &Document, name: &str) -> Result<bool, OpError> {
    let meta = doc.meta();
    let parse_error = |offset, reason: &str| OpError::MetaParse {
        offset,
        reason: reason.to_owned(),
    };
    let root = cst::parse(meta, 0).map_err(|e| parse_error(e.offset, e.reason))?;
    let Some(node) = root.find(keys::NAME, meta) else {
        return Ok(false);
    };
    let span = node
        .scalar_span()
        .ok_or_else(|| parse_error(node.span().start, "the name is a block"))?;
    if node.scalar_str(meta) == Some(name) {
        return Ok(false);
    }
    let mut bytes = meta.to_vec();
    bytes.splice(span.range(), quoted(name).into_bytes());
    plan.replace_meta(bytes);
    Ok(true)
}
