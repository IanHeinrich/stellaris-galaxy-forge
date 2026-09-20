//! Stellaris save document model.
//!
//! The original `gamestate` bytes are held once; edits are byte-range patches
//! keyed to original offsets (see `docs/adr/0001-document-model.md`).

pub mod archive;
pub mod cst;
pub mod document;
pub mod emit;
pub mod entity;
pub mod export;
pub mod format;
pub(crate) mod keys;
pub mod lexer;
pub mod library;
pub mod ops;
pub mod overlay;
pub mod projections;
pub mod scan;
pub mod search;
pub mod session;
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
    if n == 1 {
        format!("1 {noun}")
    } else {
        format!("{n} {noun}s")
    }
}
