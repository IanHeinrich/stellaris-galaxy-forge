//! What the graph says an op should do, before either format writes a byte.
//!
//! One module per subject: `lanes` for the links between systems, `systems` for where
//! they stand, `nebula` for the clouds over them, `fe_zone` for the empty space Paint a
//! Galaxy seats a fallen empire in. Nothing here reaches for a plan, an edit or a
//! document; both formats' writers start from these decisions and differ only in the
//! bytes they then splice.

pub mod fe_zone;
pub(crate) mod lanes;
pub(crate) mod nebula;
pub(crate) mod systems;

use std::collections::BTreeSet;

use crate::ops::OpError;
use crate::plural;

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

/// Whether `text` can be written between quotes, which the game reads with no escaping.
fn quotable(text: &str) -> bool {
    !text.contains(['"', '\\', '\n', '\r'])
}

pub(crate) use crate::emit::quoted;

/// A plural op's entries: at least one, and no system named twice.
pub(crate) fn each_once<T>(entries: &[T], id: impl Fn(&T) -> u32) -> Result<(), OpError> {
    if entries.is_empty() {
        return Err(OpError::Empty);
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
