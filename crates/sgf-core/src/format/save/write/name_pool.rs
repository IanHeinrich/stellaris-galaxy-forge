//! The save's pools of unused names: the `star_names`, `black_hole_names` and
//! `nebula_names` lists of `random_name_database`, which hold what the galaxy has not named
//! anything yet. An add takes the first entry left for its name out of its lists, and a
//! removal or a rename puts entries back as the bytes they were loaded as. A system's name
//! comes from [`SYSTEM_POOLS`], read as one list, star names first.

use crate::cst;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::keys;
use crate::ops::{OpError, Plan, Subject};
use crate::overlay::Anchor;
use crate::scan::{self, Value};
use crate::session::Session;
use crate::span::Span;

/// The pools a system's name is taken from.
pub(crate) const SYSTEM_POOLS: &[&str] = &[keys::STAR_NAMES, keys::BLACK_HOLE_NAMES];

/// The names left in the save's pool of unused star names, in file order; empty when the
/// save has no pool.
pub fn free_star_names(doc: &Document) -> Vec<String> {
    free(doc, keys::STAR_NAMES)
}

/// The names left in the save's pool of unused nebula names, in file order; empty when the
/// document has no pool, as a scenario has not.
pub fn free_nebula_names(doc: &Document) -> Vec<String> {
    free(doc, keys::NEBULA_NAMES)
}

/// Every entry of the `lists` pools, as loaded, that holds `name`, list by list in file
/// order, whether an add has since taken it or not.
fn entries(doc: &Document, lists: &[&str], name: &str) -> Vec<Anchor> {
    let src = doc.original();
    lists
        .iter()
        .flat_map(|list| pool(doc, list))
        .filter(|span| scan::unquote(span.slice(src)) == name.as_bytes())
        .map(Anchor::Original)
        .collect()
}

fn free(doc: &Document, list: &str) -> Vec<String> {
    let src = doc.original();
    pool(doc, list)
        .into_iter()
        .filter(|&span| !doc.overlay().removed(Anchor::Original(span), src))
        .map(|span| String::from_utf8_lossy(scan::unquote(span.slice(src))).into_owned())
        .collect()
}

/// Take `name` out of the first of the `lists` pools that has an entry for it left.
pub(crate) fn take(
    plan: &mut Plan,
    doc: &Document,
    lists: &[&str],
    name: &str,
) -> Result<(), OpError> {
    let src = doc.original();
    let unused = entries(doc, lists, name)
        .into_iter()
        .find(|&entry| !doc.overlay().removed(entry, src));
    match unused {
        Some(entry) => plan.erase(doc, Subject::Record(entry), entry),
        None => Ok(()),
    }
}

/// Put `name` back in the `lists` pools when adds took it from there. Adds take the
/// pools' entries for a name first to last, so of the entries taken, `staying` stay taken
/// for the holders of the name that remain, and the rest come back.
pub(crate) fn give_back(
    plan: &mut Plan,
    doc: &Document,
    lists: &[&str],
    name: &str,
    staying: usize,
) -> Result<(), OpError> {
    let src = doc.original();
    let taken: Vec<Anchor> = entries(doc, lists, name)
        .into_iter()
        .filter(|&entry| doc.overlay().removed(entry, src))
        .collect();
    put_back(plan, doc, taken.iter().skip(staying))
}

/// How many systems an add wrote, those in `leaving` aside, are named `name`: the entries
/// [`give_back`] leaves taken for it.
pub(crate) fn holders(s: &Session, name: &str, leaving: &[u32]) -> usize {
    s.doc
        .added()
        .entries(EntityKind::System)
        .filter(|(id, _)| !leaving.contains(id))
        .filter(|(id, _)| (s.graph.systems.get(id)).is_some_and(|system| system.name.key == name))
        .count()
}

/// A rename from `old` to `new` in the `lists` pools: `old` goes back, less the `staying`
/// entries other holders keep, and `new` is taken out.
pub(crate) fn swap(
    plan: &mut Plan,
    doc: &Document,
    lists: &[&str],
    (old, new): (&str, &str),
    staying: usize,
) -> Result<(), OpError> {
    if old == new {
        return Ok(());
    }
    give_back(plan, doc, lists, old, staying)?;
    take(plan, doc, lists, new)
}

/// Write each pool entry an add erased back as it was loaded.
pub(crate) fn put_back<'a>(
    plan: &mut Plan,
    doc: &Document,
    entries: impl Iterator<Item = &'a Anchor>,
) -> Result<(), OpError> {
    let src = doc.original();
    for &entry in entries {
        let Some(slot @ Anchor::Original(span)) = slot_holding(doc, entry) else {
            continue;
        };
        plan.replace(doc, Subject::Record(slot), slot, span.slice(src).to_vec())?;
    }
    Ok(())
}

/// The original slot an erasure left `entry` in: its own span, or its line.
fn slot_holding(doc: &Document, entry: Anchor) -> Option<Anchor> {
    doc.overlay().slots().map(|(slot, _)| slot).find(|slot| {
        matches!(slot, Anchor::Original(span)
            if span.start <= entry.start() && entry.end() <= span.end)
    })
}

/// Each entry of the `list` pool as loaded, as the span of its name.
fn pool(doc: &Document, list: &str) -> Vec<Span> {
    name_lists(doc, list).into_iter().next().unwrap_or_default()
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
