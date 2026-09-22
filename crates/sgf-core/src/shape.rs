//! The key shape of a `gamestate`: every key path with how often it occurs, and the
//! difference between two, so a game update shows which keys the core reads moved.
//!
//! Values are not shape. An entity id collapses to `#`, an anonymous block to `[]`, and
//! the children of `flags`, `variables` and `ship_names`, which hold free-form data, to
//! one `*`.

use std::collections::BTreeMap;

use crate::cst::{self, CstError, Node};
use crate::keys;
use crate::scan::{self, ScanError};

/// Path components past this many are not recorded.
pub const MAX_DEPTH: usize = 5;

const ID: &str = "#";
const ANONYMOUS: &str = "[]";
const FREE_FORM: &str = "*";
/// Blocks whose keys are data, not shape.
const FREE_FORM_BLOCKS: &[&str] = &[keys::FLAGS, keys::VARIABLES, keys::SHIP_NAMES];
const SEPARATOR: char = '/';

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("gamestate: {0}")]
    Scan(#[from] ScanError),
    #[error("{section}: {source}")]
    Section {
        section: String,
        #[source]
        source: CstError,
    },
}

/// The paths of one shape that the other lacks, in path order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShapeDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

/// Every key path in `bytes` with its count, parsed one top-level section at a time.
pub fn key_paths(bytes: &[u8]) -> Result<BTreeMap<String, usize>, Error> {
    let index = scan::scan(bytes)?;
    let mut paths = BTreeMap::new();
    let mut path = String::new();
    for section in index.sections() {
        let root = cst::parse(section.stmt.slice(bytes), section.stmt.start).map_err(|source| {
            Error::Section {
                section: scan::key_name(bytes, section).into_owned(),
                source,
            }
        })?;
        walk(&root, bytes, &mut path, 0, &mut paths);
    }
    Ok(paths)
}

/// The paths in `new` that `old` lacks and the other way round; counts are not compared.
pub fn diff(old: &BTreeMap<String, usize>, new: &BTreeMap<String, usize>) -> ShapeDiff {
    ShapeDiff {
        added: new
            .keys()
            .filter(|p| !old.contains_key(*p))
            .cloned()
            .collect(),
        removed: old
            .keys()
            .filter(|p| !new.contains_key(*p))
            .cloned()
            .collect(),
    }
}

/// The top-level section a path belongs to: its first component.
pub fn section_of(path: &str) -> &str {
    path.split(SEPARATOR).next().unwrap_or(path)
}

fn walk(
    node: &Node,
    src: &[u8],
    path: &mut String,
    depth: usize,
    paths: &mut BTreeMap<String, usize>,
) {
    for child in node.children() {
        let component = match child.key {
            Some(key) => {
                let key = scan::unquote(key.slice(src));
                if is_id(key) {
                    ID.into()
                } else {
                    String::from_utf8_lossy(key)
                }
            }
            None if child.children().is_empty() && child.scalar_span().is_some() => continue,
            None => ANONYMOUS.into(),
        };
        let len = path.len();
        push(path, &component);
        count(paths, path);
        if depth + 1 < MAX_DEPTH {
            if FREE_FORM_BLOCKS.contains(&component.as_ref()) {
                let len = path.len();
                push(path, FREE_FORM);
                for _ in child.children() {
                    count(paths, path);
                }
                path.truncate(len);
            } else {
                walk(child, src, path, depth + 1, paths);
            }
        }
        path.truncate(len);
    }
}

fn push(path: &mut String, component: &str) {
    if !path.is_empty() {
        path.push(SEPARATOR);
    }
    path.push_str(component);
}

fn count(paths: &mut BTreeMap<String, usize>, path: &str) {
    match paths.get_mut(path) {
        Some(n) => *n += 1,
        None => {
            paths.insert(path.to_owned(), 1);
        }
    }
}

fn is_id(key: &[u8]) -> bool {
    !key.is_empty() && key.iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] = b"galaxy={ shape=elliptical design=x }\ncountry={ 0={ flags={ a=1 b={ days=2 } } flag={ colors={ \"red\" \"blue\" } } } 1=none }\nnebula={ galactic_object={ 3 4 } }\nnebula={ galactic_object={ 5 } }\nlist={ { x=1 } { x=2 } }\ndeep={ a={ b={ c={ d={ e={ f=1 } } } } } }\n";

    #[test]
    fn paths_collapse_ids_lists_and_free_form_blocks() {
        let paths = key_paths(FIXTURE).unwrap();
        let listed: Vec<(&str, usize)> = paths.iter().map(|(p, n)| (p.as_str(), *n)).collect();
        assert_eq!(
            listed,
            [
                ("country", 1),
                ("country/#", 2),
                ("country/#/flag", 1),
                ("country/#/flag/colors", 1),
                ("country/#/flags", 1),
                ("country/#/flags/*", 2),
                ("deep", 1),
                ("deep/a", 1),
                ("deep/a/b", 1),
                ("deep/a/b/c", 1),
                ("deep/a/b/c/d", 1),
                ("galaxy", 1),
                ("galaxy/design", 1),
                ("galaxy/shape", 1),
                ("list", 1),
                ("list/[]", 2),
                ("list/[]/x", 2),
                ("nebula", 2),
                ("nebula/galactic_object", 2),
            ]
        );
    }

    #[test]
    fn diff_lists_what_each_side_lacks_and_ignores_counts() {
        let old = key_paths(FIXTURE).unwrap();
        let mut new = old.clone();
        new.remove("galaxy/design");
        new.insert("galaxy/arm".to_owned(), 1);
        *new.get_mut("nebula").unwrap() = 9;
        let d = diff(&old, &new);
        assert_eq!(d.added, ["galaxy/arm"]);
        assert_eq!(d.removed, ["galaxy/design"]);
        assert_eq!(section_of("galaxy/design"), "galaxy");
        assert_eq!(section_of("galaxy"), "galaxy");
    }
}
