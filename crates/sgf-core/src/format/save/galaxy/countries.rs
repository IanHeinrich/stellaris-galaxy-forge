//! Reading a save's `country` entities, and the system each one's capital colony sits in.

use std::collections::{HashMap, HashSet};

use crate::document::Document;
use crate::format::save::galaxy::bodies::head_values;
use crate::keys;
use crate::projections::galaxy::{CountryNode, ProjectionError};
use crate::projections::read::{self, RawCountry};

/// The countries with a `name`, and the `capital` colony of each, for [`colony_systems`].
pub(super) fn extract(raw: Vec<RawCountry>) -> (Vec<CountryNode>, HashMap<u32, u32>) {
    let mut countries = Vec::new();
    let mut capitals = HashMap::new();
    for country in raw {
        if let (Some(_), Some(capital)) = (&country.name, country.capital) {
            capitals.insert(country.id, capital);
        }
        countries.extend(node(country));
    }
    (countries, capitals)
}

/// Replace the country `raw` was read from with what it now reads, keeping the capital's
/// system and the system count, which other sections give it.
pub(super) fn refresh(countries: &mut [CountryNode], raw: RawCountry) {
    let Some(country) = countries.iter_mut().find(|c| c.id == raw.id) else {
        return;
    };
    let Some(refreshed) = node(raw) else {
        return;
    };
    *country = CountryNode {
        capital_system: country.capital_system,
        system_count: country.system_count,
        ..refreshed
    };
}

/// The country `raw` projects to; `None` when it has no `name`.
fn node(raw: RawCountry) -> Option<CountryNode> {
    let name = raw.name?;
    Some(CountryNode {
        id: raw.id,
        name_key: name.stand_in(),
        name,
        country_type: raw.country_type,
        capital_system: None,
        system_count: 0,
        colors: raw.colors,
        border_color: raw.border_color,
        fill_color: raw.fill_color,
        flag_colors: raw.flag_colors,
        use_map_color: raw.use_map_color,
        flag_icon: raw.flag_icon,
        flag_background: raw.flag_background,
        flags: raw.flags,
    })
}

/// The system each wanted capital sits in, from `planets.planet` and its
/// `coordinate.origin`. A country's `capital` names a planet's `colony` id in a save that
/// writes `colony` on its planets, and the planet's own id in one that writes none, so
/// the planets are read both ways and the `colony` reading is used whenever any planet
/// carries the key.
pub(super) fn colony_systems(
    doc: &Document,
    wanted: &HashSet<u32>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let mut by_colony = HashMap::new();
    let mut by_planet = HashMap::new();
    if wanted.is_empty() {
        return Ok(by_colony);
    }
    let src = doc.original();
    let Some(inner) = doc.inner_index(keys::PLANETS)? else {
        return Ok(by_colony);
    };
    let mut colonies_written = false;
    for entity in inner.entities(keys::PLANET) {
        let colony = colony_id(entity.stmt.slice(src));
        colonies_written |= colony.is_some();
        let colony = colony.filter(|colony| wanted.contains(colony));
        let planet = u32::try_from(entity.id)
            .ok()
            .filter(|id| wanted.contains(id));
        if colony.is_none() && planet.is_none() {
            continue;
        }
        let Some(node) = read::entity_node(entity, src, keys::PLANETS)? else {
            continue;
        };
        let Some(origin) = read::origin(&node, src) else {
            continue;
        };
        if let Some(colony) = colony {
            by_colony.insert(colony, origin);
        }
        if let Some(planet) = planet {
            by_planet.insert(planet, origin);
        }
    }
    Ok(if colonies_written {
        by_colony
    } else {
        by_planet
    })
}

/// A planet's own `colony` id read from its bytes, so that the planets table (a quarter
/// of the file) is only parsed for the few planets that are a capital. Only a planet
/// whose bytes hold `colony=` as a key of its own is lexed, which the game writes with no
/// spaces; a colonised one writes it first, so lexing stops there.
fn colony_id(bytes: &[u8]) -> Option<u32> {
    let key = format!("{}=", keys::COLONY);
    let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    memchr::memmem::find_iter(bytes, key.as_bytes())
        .find(|&at| at == 0 || !ident(bytes[at - 1]))?;
    let [colony] = head_values(bytes, [keys::COLONY]);
    std::str::from_utf8(colony?).ok()?.parse().ok()
}
