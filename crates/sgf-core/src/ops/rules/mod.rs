//! What the graph says an op should do, before either format writes a byte.
//!
//! One module per subject: `lanes` for the links between systems, `systems` for where
//! they stand, `bodies` for where the planets and moons in one stand, `nebula` for the
//! clouds over them, `fe_zone` for the empty space Paint a Galaxy seats a fallen empire
//! in. Nothing here reaches for a plan, an edit or a document; both formats' writers
//! start from these decisions and differ only in the bytes they then splice.

pub(crate) mod bodies;
pub mod fe_zone;
pub(crate) mod lanes;
pub(crate) mod nebula;
pub(crate) mod systems;

use std::collections::BTreeSet;

use crate::cst::{self, Node};
use crate::keys;
use crate::ops::OpError;
use crate::plural;
use crate::projections::galaxy::{Galaxy, display_name};
use crate::projections::name::{NameTemplate, looks_like_key};

/// How a text stands in the file: between quotes, which the game reads with no escaping,
/// or as a key the game looks up, one token of printable ASCII whether quoted or not.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Form {
    Quoted,
    Bare,
}

/// Refuse `text`, named `what` in the error, when it is empty or cannot stand in `form`.
pub(crate) fn check_text(what: &'static str, text: &str, form: Form) -> Result<(), OpError> {
    if text.is_empty() {
        return Err(OpError::EmptyText { what });
    }
    let fits = match form {
        Form::Quoted => quotable(text),
        Form::Bare => text.bytes().all(|b| {
            b.is_ascii_graphic() && !matches!(b, b'{' | b'}' | b'=' | b'"' | b'#' | b'\\')
        }),
    };
    if !fits {
        return Err(OpError::InvalidText {
            what,
            text: text.to_owned(),
        });
    }
    Ok(())
}

/// A save's `key="…"` and a scenario's `name = "…"` are written the same way and share
/// the rule.
pub(crate) fn check_name(name: &str) -> Result<(), OpError> {
    check_text("a name", name, Form::Quoted)
}

/// Refuse a name's value given whole unless `name=<value>` reads as one statement to its
/// end. The lexer runs an unterminated quote to the end of its input, so a quoted value is
/// checked for its closing quote too. A `block` must also be a `{ … }` naming a key.
pub(crate) fn check_name_value(value: &str, block: bool) -> Result<(), OpError> {
    let what = if block {
        "a name block"
    } else {
        "a name value"
    };
    if value.trim().is_empty() {
        return Err(OpError::EmptyText { what });
    }
    let text = format!("{}={value}", keys::NAME);
    let src = text.as_bytes();
    let whole = cst::parse(src, 0).is_ok_and(|root| match root.children() {
        [named] => {
            named.span().end == src.len()
                && !open_quote(named, src)
                && (!block
                    || named.scalar_span().is_none()
                        && !NameTemplate::parse(named, src).key.is_empty()
                        && value.ends_with('}'))
        }
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

/// Whether `text` can be written between quotes, which the game reads with no escaping.
fn quotable(text: &str) -> bool {
    !text.contains(['"', '\\', '\n', '\r'])
}

/// What a description calls system `system`: its name as shown and its id ("Ferragon
/// #489"), or "system #489" when it has no name, the galaxy lacks it, or a word of its
/// name still reads as a localisation key once [`display_name`] has shortened it.
pub(crate) fn named(galaxy: &Galaxy, system: u32) -> String {
    match galaxy.systems.get(&system) {
        Some(node) => labelled(&node.name.key, node.name.literal, system),
        None => format!("system #{system}"),
    }
}

/// [`named`] for system `system` named `key`, which is written `literal=yes` when
/// `literal`: one the galaxy does not hold yet.
pub(crate) fn labelled(key: &str, literal: bool, system: u32) -> String {
    let shown = match literal {
        true => key.to_owned(),
        false => Some(display_name(key))
            .filter(|shown| !shown.split(' ').any(looks_like_key))
            .unwrap_or_default(),
    };
    if shown.is_empty() {
        format!("system #{system}")
    } else {
        format!("{shown} #{system}")
    }
}

/// A plural op's entries: at least one, and no system named twice.
pub(crate) fn each_once<T>(entries: &[T], id: impl Fn(&T) -> u32) -> Result<(), OpError> {
    if entries.is_empty() {
        return Err(OpError::NoEntries);
    }
    let mut seen = BTreeSet::new();
    for entry in entries {
        let id = id(entry);
        if !seen.insert(id) {
            return Err(OpError::DuplicateSystem(id));
        }
    }
    Ok(())
}

/// What a plural op over `n` systems is called: its one entry's own description, else
/// `many` followed by the count.
pub(crate) fn bulk_description(n: usize, one: String, many: &str) -> String {
    match n {
        1 => one,
        n => format!("{many} {}", plural(n, "system")),
    }
}
