//! What other tables of a save say of a planet, read on first use and kept: the countries
//! that have found its anomaly, and what clearing each of its blockers costs.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::Span;
use crate::cst;
use crate::document::Document;
use crate::keys;
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::{self, Index, Value};

#[derive(Clone, Debug, Default)]
pub(crate) struct PlanetExtras {
    finders: OnceLock<Vec<AnomalyList>>,
    clearings: OnceLock<HashMap<u32, Vec<(String, f64)>>>,
}

impl PlanetExtras {
    /// The countries whose `events.anomalies` lists `planet`, in file order. Every country's
    /// list is read on the first call and kept; a country an op rewrote is read again from
    /// its current bytes.
    pub(crate) fn anomaly_finders(&self, doc: &Document, planet: u32) -> Vec<u32> {
        self.finders
            .get_or_init(|| anomaly_lists(doc.index(), doc.original()))
            .iter()
            .filter(
                |list| match doc.overlay().has_original_at(list.stmt.start) {
                    true => doc
                        .current(Anchor::Original(list.stmt))
                        .is_ok_and(|bytes| country_anomalies(bytes).contains(&planet)),
                    false => list.planets.contains(&planet),
                },
            )
            .map(|list| list.country)
            .collect()
    }

    /// What clearing blocker `deposit` costs, while a construction item clears it. Every item
    /// is read on the first call and kept, because no op writes one.
    pub(crate) fn clearing_cost<'a>(
        &'a self,
        doc: &Document,
        deposit: u32,
    ) -> Option<&'a [(String, f64)]> {
        self.clearings
            .get_or_init(|| clearing_costs(doc.index(), doc.original()))
            .get(&deposit)
            .map(Vec::as_slice)
    }
}

/// One country's `events.anomalies` as the file was opened: the country, its statement,
/// and the planets it lists.
#[derive(Clone, Debug)]
struct AnomalyList {
    country: u32,
    stmt: Span,
    planets: Vec<u32>,
}

/// Every country's `events.anomalies`, in file order, an empty one for a country without.
/// A country's own statements are scanned to find `events`, and only that block is parsed.
fn anomaly_lists(index: &Index, src: &[u8]) -> Vec<AnomalyList> {
    let mut lists = Vec::new();
    for country in index.entities(keys::COUNTRY) {
        let (Value::Block { open, close }, Ok(id)) = (country.value, u32::try_from(country.id))
        else {
            continue;
        };
        let planets = scan::scan_range(src, open + 1..close)
            .ok()
            .and_then(|inner| inner.section(keys::EVENTS).map(|section| section.stmt))
            .and_then(|events| {
                let bytes = events.slice(src);
                let root = cst::parse(bytes, 0).ok()?;
                Some(listed_anomalies(root.children().first()?, bytes))
            })
            .unwrap_or_default();
        lists.push(AnomalyList {
            country: id,
            stmt: country.stmt,
            planets,
        });
    }
    lists
}

/// The planets an `events` block's `anomalies` lists.
fn listed_anomalies(events: &cst::Node, src: &[u8]) -> Vec<u32> {
    events
        .find(keys::ANOMALIES, src)
        .map(|list| {
            list.children()
                .iter()
                .filter(|item| item.key.is_none())
                .filter_map(|item| item.scalar_str(src)?.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// The planets a whole country statement's `events.anomalies` lists.
fn country_anomalies(bytes: &[u8]) -> Vec<u32> {
    let Ok(root) = cst::parse(bytes, 0) else {
        return Vec::new();
    };
    root.children()
        .first()
        .and_then(|country| country.find(keys::EVENTS, bytes))
        .map(|events| listed_anomalies(events, bytes))
        .unwrap_or_default()
}

/// What each blocker being cleared costs, by deposit id: the `resources` of the
/// `construction.item_mgr.items` entry whose `buildable_clear_deposit_blocker` names it.
fn clearing_costs(index: &Index, src: &[u8]) -> HashMap<u32, Vec<(String, f64)>> {
    let mut costs = HashMap::new();
    let Some(items) = index
        .section(keys::CONSTRUCTION)
        .and_then(|section| inner_block(src, section.value, keys::ITEM_MGR))
        .and_then(|item_mgr| inner_block(src, item_mgr, keys::ITEMS))
    else {
        return costs;
    };
    let Value::Block { open, close } = items else {
        return costs;
    };
    let Ok(root) = cst::parse(&src[open + 1..close], open + 1) else {
        return costs;
    };
    for item in root.children() {
        let Some(deposit) = item
            .find(keys::BUILDABLE_CLEAR_DEPOSIT_BLOCKER, src)
            .and_then(|clearing| read::scalar_u32(clearing, keys::DEPOSIT, src))
        else {
            continue;
        };
        let resources = item
            .find(keys::RESOURCES, src)
            .map(|resources| {
                resources
                    .children()
                    .iter()
                    .filter_map(|r| {
                        Some((r.key_str(src)?.to_owned(), r.scalar_str(src)?.parse().ok()?))
                    })
                    .collect()
            })
            .unwrap_or_default();
        costs.insert(deposit, resources);
    }
    costs
}

/// The value of the statement `key` inside the block `value`, scanned rather than parsed.
fn inner_block(src: &[u8], value: Value, key: &str) -> Option<Value> {
    let Value::Block { open, close } = value else {
        return None;
    };
    let inner = scan::scan_range(src, open + 1..close).ok()?;
    Some(inner.section(key)?.value)
}
