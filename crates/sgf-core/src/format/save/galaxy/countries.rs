//! Reading a save's `country` entities, and the system each one's capital colony sits in.

use std::collections::{HashMap, HashSet};

use crate::document::Document;
use crate::keys;
use crate::projections::galaxy::{CountryNode, ProjectionError};
use crate::projections::read::{self, RawCountry};

/// The countries with a `name`, and the `capital` colony of each, for [`colony_systems`].
pub(super) fn extract(raw: Vec<RawCountry>) -> (Vec<CountryNode>, HashMap<u32, u32>) {
    let mut countries = Vec::new();
    let mut capitals = HashMap::new();
    for country in raw {
        let Some(name) = country.name else {
            continue;
        };
        if let Some(capital) = country.capital {
            capitals.insert(country.id, capital);
        }
        countries.push(CountryNode {
            id: country.id,
            name_key: name.stand_in(),
            name,
            country_type: country.country_type,
            capital_system: None,
            system_count: 0,
            colors: country.colors,
            flag_icon: country.flag_icon,
            flag_background: country.flag_background,
        });
    }
    (countries, capitals)
}

/// The system each wanted colony sits in, from `planets.planet`: a planet's `colony` and
/// its `coordinate.origin`.
pub(super) fn colony_systems(
    doc: &Document,
    wanted: &HashSet<u32>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let mut systems = HashMap::new();
    if wanted.is_empty() {
        return Ok(systems);
    }
    let src = doc.original();
    let Some(inner) = doc.inner_index(keys::PLANETS)? else {
        return Ok(systems);
    };
    let colony_key = format!("{}=", keys::COLONY);
    for entity in inner.entities(keys::PLANET) {
        let Some(colony) = colony_id(entity.stmt.slice(src), colony_key.as_bytes()) else {
            continue;
        };
        if !wanted.contains(&colony) {
            continue;
        }
        let Some(node) = read::entity_node(entity, src, keys::PLANETS)? else {
            continue;
        };
        if let Some(origin) = read::origin(&node, src) {
            systems.insert(colony, origin);
        }
    }
    Ok(systems)
}

/// A planet's own `colony=<id>` read from its bytes, so that the planets table (a quarter
/// of the file) is only parsed for the few planets that are a capital.
fn colony_id(bytes: &[u8], key: &[u8]) -> Option<u32> {
    let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut from = 0;
    while let Some(at) = memchr::memmem::find(&bytes[from..], key) {
        let start = from + at;
        from = start + key.len();
        if start > 0 && ident(bytes[start - 1]) {
            continue;
        }
        if depth_at(bytes, start) != 1 {
            continue;
        }
        let digits = &bytes[from..];
        let end = digits
            .iter()
            .position(|b| !b.is_ascii_digit())
            .unwrap_or(digits.len());
        let id = std::str::from_utf8(&digits[..end])
            .ok()
            .and_then(|s| s.parse().ok());
        if id.is_some() {
            return id;
        }
    }
    None
}

/// Brace depth at `at` counted from the start of an entity's statement, so the entity's own
/// fields sit at 1; text inside quotes is skipped.
fn depth_at(bytes: &[u8], at: usize) -> i32 {
    let mut depth = 0;
    let mut quoted = false;
    for &b in &bytes[..at] {
        match b {
            b'"' => quoted = !quoted,
            b'{' if !quoted => depth += 1,
            b'}' if !quoted => depth -= 1,
            _ => {}
        }
    }
    depth
}
