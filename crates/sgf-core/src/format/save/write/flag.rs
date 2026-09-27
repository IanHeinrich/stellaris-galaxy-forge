//! An empire's flag: the emblem, the background file and the first two entries of
//! `country.<id>.flag.colors`, and the same values in the save's `meta`, which holds a
//! copy of the player's flag for the load screen.
//!
//! Only the quoted values are rewritten, so the inverse puts the bytes back exactly.

use crate::Span;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::keys;
use crate::ops::rules::{Form, check_text, quoted};
use crate::ops::{EmpireFlag, Op, OpError, Plan, Planned};
use crate::session::Session;

const PRIMARY: usize = 0;
const SECONDARY: usize = 1;
/// The map border and fill 4.5 keeps after the four flag colours. With map colours off
/// the game copies the first two into them.
const MAP_BORDER: usize = 4;
const MAP_FILL: usize = 5;

/// A place in the bytes the flag cannot be read at, and why.
type Unreadable = (usize, String);

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    country: u32,
    flag: &EmpireFlag,
) -> Result<Planned, OpError> {
    for (what, text) in [
        ("a flag category", &flag.icon_category),
        ("a flag file", &flag.icon_file),
        ("a flag file", &flag.background),
        ("a colour name", &flag.primary),
        ("a colour name", &flag.secondary),
    ] {
        check_text(what, text, Form::Bare)?;
    }
    let edit = plan.edit_country(&s.doc, country)?;
    let entity = edit.entity()?;
    let node = entity
        .find(keys::FLAG, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "no flag"))?;
    let (old, values) = rewrite(node, &edit.buf, flag)
        .map_err(|(offset, reason)| edit.parse_error(offset, reason))?;
    if values.is_empty() {
        return Err(OpError::FlagUnchanged(country));
    }
    for (span, text) in values {
        edit.replace_span(span, text);
    }
    if s.graph.player_country == Some(country) {
        plan_meta(plan, &s.doc, flag)?;
    }
    Ok(Planned {
        description: format!("Set empire {country}'s flag"),
        inverse: Op::SetEmpireFlag { country, flag: old },
    })
}

/// Rewrite the player's flag in `meta` as [`plan_set`] rewrites the country's. A `meta`
/// with no flag is left as it is.
fn plan_meta(plan: &mut Plan, doc: &Document, flag: &EmpireFlag) -> Result<(), OpError> {
    let meta = doc.meta();
    let parse_error = |(offset, reason): Unreadable| OpError::MetaParse { offset, reason };
    let root = cst::parse(meta, 0).map_err(|e| parse_error((e.offset, e.reason.to_owned())))?;
    let Some(node) = root.find(keys::FLAG, meta) else {
        return Ok(());
    };
    let (_, mut values) = rewrite(node, meta, flag).map_err(parse_error)?;
    if values.is_empty() {
        return Ok(());
    }
    values.sort_by_key(|(span, _)| span.start);
    let mut bytes = meta.to_vec();
    for (span, text) in values.into_iter().rev() {
        bytes.splice(span.range(), text.into_bytes());
    }
    plan.replace_meta(bytes);
    Ok(())
}

/// The flag the `flag` block `node` of `buf` holds, and the quoted values to write for
/// `new`, each only where it changes.
fn rewrite(
    node: &Node,
    buf: &[u8],
    new: &EmpireFlag,
) -> Result<(EmpireFlag, Vec<(Span, String)>), Unreadable> {
    let value = |node: &Node| {
        let span = node
            .scalar_span()
            .ok_or_else(|| (node.span().start, "flag value is a block".to_owned()))?;
        Ok::<_, Unreadable>((span, node.scalar_str(buf).unwrap_or_default().to_owned()))
    };
    let icon = child(node, buf, keys::ICON, "flag.icon")?;
    let icon_category = value(child(icon, buf, keys::CATEGORY, "flag.icon.category")?)?;
    let icon_file = value(child(icon, buf, keys::FILE, "flag.icon.file")?)?;
    let background = child(node, buf, keys::BACKGROUND, "flag.background")?;
    let background = value(child(background, buf, keys::FILE, "flag.background.file")?)?;
    let list = child(node, buf, keys::COLORS, "flag.colors")?;
    let entries: Vec<(Span, String)> = list
        .children()
        .iter()
        .filter(|c| c.key.is_none())
        .map(value)
        .collect::<Result<_, _>>()?;
    if entries.len() <= SECONDARY {
        return Err((
            list.span().start,
            "flag.colors has fewer than two entries".to_owned(),
        ));
    }
    let map_colors_on = node
        .find(keys::USE_MAP_COLOR, buf)
        .and_then(|n| n.scalar_str(buf))
        == Some("yes");
    let old = EmpireFlag {
        icon_category: icon_category.1.clone(),
        icon_file: icon_file.1.clone(),
        background: background.1.clone(),
        primary: entries[PRIMARY].1.clone(),
        secondary: entries[SECONDARY].1.clone(),
    };

    let mut writes = vec![
        (icon_category, &new.icon_category),
        (icon_file, &new.icon_file),
        (background, &new.background),
        (entries[PRIMARY].clone(), &new.primary),
        (entries[SECONDARY].clone(), &new.secondary),
    ];
    if !map_colors_on {
        for (slot, follows, colour) in [
            (MAP_BORDER, PRIMARY, &new.primary),
            (MAP_FILL, SECONDARY, &new.secondary),
        ] {
            if let Some(entry) = entries.get(slot).filter(|e| e.1 == entries[follows].1) {
                writes.push((entry.clone(), colour));
            }
        }
    }
    let values = writes
        .into_iter()
        .filter(|((_, old), new)| old != *new)
        .map(|((span, _), new)| (span, quoted(new)))
        .collect();
    Ok((old, values))
}

/// The child `key` of `parent`, `path` naming it in the error when it is missing.
fn child<'n>(parent: &'n Node, buf: &[u8], key: &str, path: &str) -> Result<&'n Node, Unreadable> {
    parent
        .find(key, buf)
        .ok_or_else(|| (parent.span().start, format!("no {path}")))
}
