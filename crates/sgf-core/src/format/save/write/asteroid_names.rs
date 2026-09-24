//! The save's pool of asteroid names: the `asteroid_prefix` list and, for each prefix in
//! the same order, an `asteroid_postfix` block of the suffixes still free for it. An
//! asteroid an add writes takes a suffix out of its prefix's block, as the game does, and
//! a removal puts it back.

use std::collections::HashSet;

use crate::cst;
use crate::document::Document;
use crate::format::scenario::index::removed;
use crate::keys;
use crate::ops::OpError;
use crate::overlay::Anchor;
use crate::projections::name::{NameTemplate, NameVariable};
use crate::scan::{self, Value};
use crate::span::Span;

pub(crate) const FORMAT: &str = "ASTEROID_NAME_FORMAT";
const PREFIX_VAR: &str = "prefix";
const SUFFIX_VAR: &str = "suffix";

/// One asteroid's name, and the pool entry it took when a free one was left.
pub(crate) struct Pick {
    pub name: NameTemplate,
    pub entry: Option<Anchor>,
}

/// Each prefix of the pool as loaded, with the spans of its block's suffixes.
pub(crate) struct Pool {
    prefixes: Vec<(String, Vec<Span>)>,
}

impl Pool {
    pub fn read(doc: &Document) -> Self {
        let src = doc.original();
        let prefixes = name_lists(doc, keys::ASTEROID_PREFIX)
            .into_iter()
            .next()
            .unwrap_or_default();
        let blocks = name_lists(doc, keys::ASTEROID_POSTFIX);
        Self {
            prefixes: prefixes
                .into_iter()
                .zip(blocks)
                .map(|(prefix, block)| (text(src, prefix), block))
                .collect(),
        }
    }

    /// Names for `count` asteroids of the system named `system`. Each is looked for from
    /// a prefix and a suffix the system's name and the asteroid's place choose, so the
    /// same pool gives the same system the same names. When no block has a free suffix
    /// left, a name is used again and takes no entry.
    pub fn pick(&self, doc: &Document, system: &str, count: usize) -> Result<Vec<Pick>, OpError> {
        if count == 0 {
            return Ok(Vec::new());
        }
        if self.prefixes.is_empty() {
            return Err(OpError::MissingSaveKey(keys::ASTEROID_PREFIX));
        }
        let src = doc.original();
        let mut taken: HashSet<Span> = HashSet::new();
        let mut picks = Vec::with_capacity(count);
        for index in 0..count {
            let seed = spread(system, index);
            let free = |span: &Span| {
                !taken.contains(span) && !removed(doc.overlay(), Anchor::Original(*span), src)
            };
            let found = self.walk(seed).find_map(|(prefix, block)| {
                block.into_iter().find(|s| free(s)).map(|s| (prefix, s))
            });
            let (prefix, suffix, entry) = match found {
                Some((prefix, suffix)) => (prefix, suffix, Some(Anchor::Original(suffix))),
                None => {
                    let (prefix, suffix) = self
                        .walk(seed)
                        .find_map(|(prefix, block)| Some((prefix, *block.first()?)))
                        .ok_or(OpError::MissingSaveKey(keys::ASTEROID_POSTFIX))?;
                    (prefix, suffix, None)
                }
            };
            taken.insert(suffix);
            picks.push(Pick {
                name: name(prefix, &text(src, suffix)),
                entry,
            });
        }
        Ok(picks)
    }

    /// Every prefix from the one `seed` chooses on, each with its block's suffixes from
    /// the one `seed` chooses on.
    fn walk(&self, seed: u64) -> impl Iterator<Item = (&str, Vec<Span>)> {
        let count = self.prefixes.len();
        let first = (seed % count as u64) as usize;
        (0..count).map(move |i| {
            let (prefix, block) = &self.prefixes[(first + i) % count];
            let start = match block.len() {
                0 => 0,
                len => ((seed >> 32) % len as u64) as usize,
            };
            let suffixes = block[start..].iter().chain(&block[..start]).copied();
            (prefix.as_str(), suffixes.collect())
        })
    }

    /// The pool's entries, as loaded, that hold `suffix` for `prefix`, in file order.
    pub fn entries(&self, prefix: &str, suffix: &str, src: &[u8]) -> Vec<Anchor> {
        self.prefixes
            .iter()
            .filter(|(held, _)| held == prefix)
            .flat_map(|(_, block)| block)
            .filter(|span| scan::unquote(span.slice(src)) == suffix.as_bytes())
            .map(|&span| Anchor::Original(span))
            .collect()
    }
}

/// The prefix and suffix an asteroid's name holds; `None` for any other name.
pub(crate) fn parts(name: &NameTemplate) -> Option<(&str, &str)> {
    if name.key != FORMAT {
        return None;
    }
    let variable = |wanted: &str| {
        name.variables
            .iter()
            .find(|v| v.name == wanted)
            .map(|v| v.value.key.as_str())
    };
    Some((variable(PREFIX_VAR)?, variable(SUFFIX_VAR)?))
}

fn name(prefix: &str, suffix: &str) -> NameTemplate {
    let variable = |name: &str, value: &str| NameVariable {
        name: name.to_owned(),
        value: NameTemplate::plain(value),
    };
    NameTemplate {
        key: FORMAT.to_owned(),
        literal: false,
        variables: vec![variable(PREFIX_VAR, prefix), variable(SUFFIX_VAR, suffix)],
    }
}

/// Every `key` list of the save's `random_name_database`, as loaded, as the spans of its
/// names; empty when the save has none.
pub(crate) fn name_lists(doc: &Document, key: &str) -> Vec<Vec<Span>> {
    let src = doc.original();
    let Some(Value::Block { open, close }) = doc
        .index()
        .section(keys::RANDOM_NAME_DATABASE)
        .map(|section| section.value)
    else {
        return Vec::new();
    };
    let Ok(database) = scan::scan_range(src, open + 1..close) else {
        return Vec::new();
    };
    database
        .sections_named(key)
        .map(|list| {
            let Value::Block { open, close } = list.value else {
                return Vec::new();
            };
            let Ok(names) = cst::parse(&src[open + 1..close], open + 1) else {
                return Vec::new();
            };
            names
                .children()
                .iter()
                .filter(|entry| entry.key.is_none())
                .filter_map(cst::Node::scalar_span)
                .collect()
        })
        .collect()
}

fn text(src: &[u8], span: Span) -> String {
    String::from_utf8_lossy(scan::unquote(span.slice(src))).into_owned()
}

/// A well-mixed number from a system's name and an asteroid's place in it.
fn spread(system: &str, index: usize) -> u64 {
    let hash = system.bytes().fold(0xCBF2_9CE4_8422_2325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01B3)
    });
    let mut z = hash.wrapping_add((index as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}
