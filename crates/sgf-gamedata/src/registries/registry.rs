//! The shape every definition registry shares: entries keyed by their
//! definition key, last key wins.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script::{self, Def, Variables};

/// A definition read from one `common/` directory, one entry per key.
pub(crate) trait FromDef: Sized {
    const DIR: &'static str;

    /// True for a definition under `DIR` that this registry does not represent, left out
    /// before `read` is called. Most registries keep the default: every definition counts.
    fn skip(_def: &Def) -> bool {
        false
    }

    fn read(key: String, def: &Def) -> Self;
}

#[derive(Debug)]
pub struct Registry<T>(BTreeMap<String, T>);

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Self(BTreeMap::new())
    }
}

impl<T> Registry<T> {
    pub fn get(&self, key: &str) -> Option<&T> {
        self.0.get(key)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.0.values()
    }

    pub(crate) fn insert(&mut self, key: String, value: T) {
        self.0.insert(key, value);
    }
}

/// Every definition of `T::DIR` across the layout, keyed, last key wins.
pub(crate) fn load<T: FromDef>(
    layout: &Layout,
    globals: &Arc<Variables>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Registry<T> {
    script::parse_dir(layout, T::DIR, globals, diagnostics)
        .into_iter()
        .filter(|(_, def)| !T::skip(def))
        .map(|(key, def)| (key.clone(), T::read(key, &def)))
        .collect()
}

impl<T> FromIterator<(String, T)> for Registry<T> {
    fn from_iter<I: IntoIterator<Item = (String, T)>>(entries: I) -> Self {
        Self(entries.into_iter().collect())
    }
}
