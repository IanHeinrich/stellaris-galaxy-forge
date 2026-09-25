//! The readers every projection shares: one per shape the save writes.
//!
//! A reader takes a parsed [`Node`] and the source bytes it spans, never text of its own;
//! the entity readers ([`countries`], [`stations`]) walk a whole table so that the field
//! extraction for an entity kind exists once.

use std::collections::HashMap;
use std::str::FromStr;

use crate::cst::{self, Node};
use crate::document::Document;
use crate::keys;
use crate::projections::galaxy::{FlagRef, ProjectionError};
use crate::projections::name::NameTemplate;
use crate::scan::{Entity, Index, Section, Value};

/// The scalar value of `node.<key>`.
pub(crate) fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}

pub(crate) fn scalar_u32(node: &Node, key: &str, src: &[u8]) -> Option<u32> {
    scalar(node, key, src)?.parse().ok()
}

/// The scalar value of `node.<key>` as an owned string, empty when it is missing.
pub(crate) fn text(node: &Node, key: &str, src: &[u8]) -> String {
    scalar(node, key, src).unwrap_or_default().to_owned()
}

/// A number the caller cannot do without, with the reason it could not be read.
pub(crate) fn required<T: FromStr>(node: &Node, key: &str, src: &[u8]) -> Result<T, String> {
    let text = scalar(node, key, src).ok_or_else(|| format!("missing {key}"))?;
    text.parse().map_err(|_| format!("{key} is not a number"))
}

/// The scalar items of the list block `node.<key>`, skipping anything that is not a `u32`.
pub(crate) fn ids(node: &Node, key: &str, src: &[u8]) -> Vec<u32> {
    let Some(list) = node.find(key, src) else {
        return Vec::new();
    };
    list.children()
        .iter()
        .filter(|c| c.key.is_none())
        .filter_map(|c| c.scalar_str(src)?.parse().ok())
        .collect()
}

/// The `name=` block as a template, empty when the entity has none.
pub(crate) fn name(node: &Node, src: &[u8]) -> NameTemplate {
    node.find(keys::NAME, src)
        .map(|n| NameTemplate::parse(n, src))
        .unwrap_or_default()
}

/// `name.key`, or a scalar `name`, or empty.
pub(crate) fn name_key(node: &Node, src: &[u8]) -> String {
    node.find(keys::NAME, src)
        .and_then(|name| match name.find(keys::KEY, src) {
            Some(key) => key.scalar_str(src),
            None => name.scalar_str(src),
        })
        .unwrap_or_default()
        .to_owned()
}

/// `coordinate.x` and `coordinate.y`.
pub(crate) fn coordinate(node: &Node, src: &[u8]) -> Result<(f64, f64), String> {
    let coord = node
        .find(keys::COORDINATE, src)
        .ok_or_else(|| format!("missing {}", keys::COORDINATE))?;
    let axis = |key: &str| -> Result<f64, String> {
        scalar(coord, key, src)
            .ok_or_else(|| format!("missing {}.{key}", keys::COORDINATE))?
            .parse()
            .map_err(|_| format!("{}.{key} is not a number", keys::COORDINATE))
    };
    Ok((axis(keys::X)?, axis(keys::Y)?))
}

/// `coordinate.origin`: the system an entity sits in.
pub(crate) fn origin(node: &Node, src: &[u8]) -> Option<u32> {
    scalar_u32(node.find(keys::COORDINATE, src)?, keys::ORIGIN, src)
}

/// The values of a slot-keyed block (`modules={ 0=shipyard 1=anchorage }`), in save order.
pub(crate) fn slot_values(node: &Node, key: &str, src: &[u8]) -> Vec<String> {
    node.find(key, src)
        .map(|block| {
            block
                .children()
                .iter()
                .filter_map(|slot| Some(slot.scalar_str(src)?.to_owned()))
                .collect()
        })
        .unwrap_or_default()
}

/// The parsed `<id>=` node of an entity; `None` for tombstones (`<id>=none`).
pub(crate) fn entity_node(
    entity: &Entity,
    src: &[u8],
    section: &'static str,
) -> Result<Option<Node>, ProjectionError> {
    if !matches!(entity.value, Value::Block { .. }) {
        return Ok(None);
    }
    let root = cst::parse(entity.stmt.slice(src), entity.stmt.start).map_err(|source| {
        ProjectionError::Entity {
            section,
            id: entity.id,
            source,
        }
    })?;
    root.children()
        .first()
        .cloned()
        .map(Some)
        .ok_or_else(|| ProjectionError::EntityField {
            section,
            id: entity.id,
            reason: "empty entity".to_owned(),
        })
}

/// A top-level block section parsed so the root's children are its statements.
pub(crate) fn section_node(
    name: &'static str,
    section: &Section,
    src: &[u8],
) -> Result<Node, ProjectionError> {
    let Value::Block { open, close } = section.value else {
        return Err(ProjectionError::SectionField {
            section: name,
            reason: "expected a block".to_owned(),
        });
    };
    cst::parse(&src[open + 1..close], open + 1).map_err(|source| ProjectionError::Section {
        section: name,
        source,
    })
}

/// What the projections read off one `country` entity.
pub(crate) struct RawCountry {
    pub id: u32,
    /// `None` when the entity has no `name`.
    pub name: Option<NameTemplate>,
    pub country_type: String,
    /// The `capital` colony.
    pub capital: Option<u32>,
    /// `flag.colors`, with the `"null"` placeholders removed.
    pub colors: Vec<String>,
    /// `flag.colors[4]`, the map border colour, read only under `flag.use_map_color=yes`.
    pub border_color: Option<String>,
    /// `flag.colors[5]`, the map fill colour, read only under `flag.use_map_color=yes`.
    pub fill_color: Option<String>,
    /// Every `flag.colors` entry in order, the `"null"` placeholders kept.
    pub flag_colors: Vec<String>,
    /// Whether `flag.use_map_color=yes`.
    pub use_map_color: bool,
    /// The border and fill the game paints the territory in; see [`painted`].
    pub painted: (Option<String>, Option<String>),
    /// Whether `flag.colors` holds the map border and fill slots (4.5).
    pub has_map_colors: bool,
    pub flag_icon: Option<FlagRef>,
    pub flag_background: Option<FlagRef>,
    /// The keys of the `flags` map.
    pub flags: Vec<String>,
    /// The fleets of `fleets_manager.owned_fleets`.
    pub owned_fleets: Vec<u32>,
}

/// Every `country` entity, in file order.
pub(crate) fn countries(index: &Index, src: &[u8]) -> Result<Vec<RawCountry>, ProjectionError> {
    let mut countries = Vec::new();
    for entity in index.entities(keys::COUNTRY) {
        let Some(node) = entity_node(entity, src, keys::COUNTRY)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        countries.push(country(id, &node, src));
    }
    Ok(countries)
}

/// Where `flag.colors` keeps the map border and fill (4.5): after the four flag colours.
const MAP_BORDER_SLOT: usize = 4;
const MAP_FILL_SLOT: usize = 5;

/// The border and fill the map paints a territory in, from every `flag.colors` entry: the
/// map slots under `flag.use_map_color=yes`, and where one is `"null"` or not chosen, the
/// first two named flag colours, either standing in for the other when it is the only one.
fn painted(entries: &[&str], use_map_color: bool) -> (Option<String>, Option<String>) {
    let named: Vec<&str> = entries.iter().copied().filter(|&s| s != "null").collect();
    let map_slot = |slot: usize| {
        entries
            .get(slot)
            .copied()
            .filter(|&s| use_map_color && s != "null")
    };
    let (first, second) = (named.first().copied(), named.get(1).copied());
    let border = map_slot(MAP_BORDER_SLOT).or(first).or(second);
    let fill = map_slot(MAP_FILL_SLOT).or(second).or(first);
    (border.map(str::to_owned), fill.map(str::to_owned))
}

/// What the projections read off one `country` entity, `node` being its `<id>=` node.
pub(crate) fn country(id: u32, node: &Node, src: &[u8]) -> RawCountry {
    let flag = node.find(keys::FLAG, src);
    let entries: Vec<&str> = flag
        .and_then(|f| f.find(keys::COLORS, src))
        .map(|list| {
            list.children()
                .iter()
                .filter(|c| c.key.is_none())
                .filter_map(|c| c.scalar_str(src))
                .collect()
        })
        .unwrap_or_default();
    let named = |s: &str| s != "null";
    let colors = entries
        .iter()
        .copied()
        .filter(|&s| named(s))
        .map(str::to_owned)
        .collect();
    let use_map_color = flag.and_then(|f| scalar(f, keys::USE_MAP_COLOR, src)) == Some("yes");
    let map_color = |slot: usize| {
        if !use_map_color {
            return None;
        }
        entries
            .get(slot)
            .copied()
            .filter(|&s| named(s))
            .map(str::to_owned)
    };
    let layer = |key: &str| {
        let layer = flag?.find(key, src)?;
        Some(FlagRef {
            category: scalar(layer, keys::CATEGORY, src)?.to_owned(),
            file: scalar(layer, keys::FILE, src)?.to_owned(),
        })
    };
    let owned_fleets = node
        .find(keys::FLEETS_MANAGER, src)
        .and_then(|m| m.find(keys::OWNED_FLEETS, src))
        .map(|owned| {
            owned
                .children()
                .iter()
                .filter_map(|entry| scalar_u32(entry, keys::FLEET, src))
                .collect()
        })
        .unwrap_or_default();
    let flags = node
        .find(keys::FLAGS, src)
        .map(|flags| {
            flags
                .children()
                .iter()
                .filter_map(|c| c.key_str(src))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    RawCountry {
        id,
        name: node
            .find(keys::NAME, src)
            .map(|n| NameTemplate::parse(n, src)),
        country_type: text(node, keys::TYPE, src),
        capital: scalar_u32(node, keys::CAPITAL, src),
        colors,
        border_color: map_color(MAP_BORDER_SLOT),
        fill_color: map_color(MAP_FILL_SLOT),
        painted: painted(&entries, use_map_color),
        has_map_colors: entries.len() > MAP_FILL_SLOT,
        flag_colors: entries.iter().copied().map(str::to_owned).collect(),
        use_map_color,
        flag_icon: layer(keys::ICON),
        flag_background: layer(keys::BACKGROUND),
        flags,
        owned_fleets,
    }
}

/// What the projections read off one `starbase_mgr.starbases` entry.
pub(crate) struct RawStation {
    pub level: String,
    /// The `type` key: `starbase_outpost`, `swaystation_research` …; empty when absent.
    pub kind: String,
    /// The `station` ship.
    pub ship: Option<u32>,
    /// Module and building keys in save order.
    pub modules: Vec<String>,
    pub buildings: Vec<String>,
}

/// Starbase id → its entry, from `starbase_mgr.starbases`.
pub(crate) fn stations(doc: &Document) -> Result<HashMap<u32, RawStation>, ProjectionError> {
    let src = doc.original();
    let mut stations = HashMap::new();
    let Some(inner) = doc.inner_index(keys::STARBASE_MGR)? else {
        return Ok(stations);
    };
    for entity in inner.entities(keys::STARBASES) {
        let Some(node) = entity_node(entity, src, keys::STARBASE_MGR)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        stations.insert(
            id,
            RawStation {
                level: text(&node, keys::LEVEL, src),
                kind: text(&node, keys::TYPE, src),
                ship: scalar_u32(&node, keys::STATION, src),
                modules: slot_values(&node, keys::MODULES, src),
                buildings: slot_values(&node, keys::BUILDINGS, src),
            },
        );
    }
    Ok(stations)
}
