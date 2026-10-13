//! Stellaris save document model.
//!
//! The original `gamestate` bytes are held once; edits are byte-range patches
//! keyed to original offsets (see `docs/adr/0001-document-model.md`).

pub mod archive;
mod backup;
pub mod cst;
pub mod document;
pub mod emit;
pub mod entity;
pub mod export;
pub mod format;
pub mod guides;
pub(crate) mod keys;
pub mod lexer;
pub mod library;
pub mod ops;
pub mod overlay;
pub mod prepare;
pub mod projections;
pub mod scan;
pub mod search;
pub mod session;
pub mod shape;
pub mod span;
pub mod synth;
pub mod validate;
pub mod views;

pub use span::Span;

/// Crate version, for `sgf --version` and the app's about box.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The game's null reference.
pub const NULL_ID: u32 = u32::MAX;

/// A count as a `u32`, saturating at [`NULL_ID`]: no save holds that many of anything.
pub(crate) fn as_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(NULL_ID)
}

/// `1 system`, `3 systems`: a count with its noun, for descriptions and sublines.
pub(crate) fn plural(n: usize, noun: &str) -> String {
    plural_of(n, noun, &format!("{noun}s"))
}

/// [`plural`] for a noun whose plural is not its singular and an `s`: `3 armies`.
pub(crate) fn plural_of(n: usize, noun: &str, nouns: &str) -> String {
    if n == 1 {
        format!("1 {noun}")
    } else {
        format!("{n} {nouns}")
    }
}

/// `a, b and c`: `parts` as a description lists them, empty for none.
pub(crate) fn and_list(parts: &[String]) -> String {
    match parts.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// A radius or an angle as a description names it: up to two decimals.
pub(crate) fn number(v: f64) -> String {
    let text = format!("{v:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" { "0" } else { text }.to_owned()
}
