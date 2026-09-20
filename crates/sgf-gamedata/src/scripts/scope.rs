//! The scope rules every walk over Paradox effect script obeys: which blocks
//! are branches of the scope they are written in and which open one of their
//! own, what `prev` names, which scopes stand for a country, and how a
//! scripted effect is called.

use sgf_core::cst::Node;

/// Scopes whose `limit = { has_country_flag = … }` identifies an empire.
pub(crate) const COUNTRY_SCOPES: [&str; 4] = [
    "random_country",
    "any_country",
    "every_country",
    "random_playable_country",
];

pub(crate) fn is_country_scope(key: &str) -> bool {
    COUNTRY_SCOPES.contains(&key)
}

/// Blocks whose body still runs where the block itself does; every other
/// block opens a scope of its own. A `random_list` weight is its own key,
/// so a numeric key is a branch.
pub(crate) fn keeps_scope(key: &str) -> bool {
    matches!(
        key,
        "immediate"
            | "after"
            | "init_effect"
            | "hidden_effect"
            | "if"
            | "else"
            | "else_if"
            | "while"
            | "random_list"
    ) || key.parse::<f64>().is_ok()
}

/// A scripted effect is called as `key = yes` or `key = { … }`.
pub(crate) fn is_call(node: &Node, src: &[u8]) -> bool {
    match node.scalar_str(src) {
        Some(value) => value == "yes",
        None => true,
    }
}

/// The scope a statement runs in and the one that scope was entered from,
/// which is what `prev` names. Entering `prev` names the scope it was
/// entered from in turn, so stepping back twice arrives where it started.
#[derive(Debug, Clone, Default)]
pub(crate) struct Scopes<T> {
    here: T,
    outer: T,
}

impl<T: Clone + Default> Scopes<T> {
    /// The outermost scope, entered from nothing this walk can name.
    pub(crate) fn new(here: T) -> Self {
        Self {
            here,
            outer: T::default(),
        }
    }
}

impl<T: Clone> Scopes<T> {
    pub(crate) fn here(&self) -> &T {
        &self.here
    }

    pub(crate) fn outer(&self) -> &T {
        &self.outer
    }

    /// The scopes `key`'s body runs in: these, where the block is a branch
    /// of this one; the scope this was entered from, where it is `prev`;
    /// and otherwise the one `opens` names.
    pub(crate) fn descend(&self, key: &str, opens: impl FnOnce() -> T) -> Self {
        if keeps_scope(key) {
            return self.clone();
        }
        match key {
            "prev" => self.entered(self.outer.clone()),
            _ => self.entered(opens()),
        }
    }

    /// One scope further in.
    pub(crate) fn entered(&self, here: T) -> Self {
        Self {
            here,
            outer: self.here.clone(),
        }
    }

    /// The same scope, said more precisely.
    pub(crate) fn refined(&self, here: T) -> Self {
        Self {
            here,
            outer: self.outer.clone(),
        }
    }
}
