//! Where the game writes a key an entity lacks, as one table per entity kind, and the one
//! helper that writes it there.

use crate::Span;
use crate::cst::Node;
use crate::keys;
use crate::ops::{Edit, OpError};

/// Where the game writes `key` in a block that lacks it: after the first of `after` the
/// block holds, else before the first of `before` it holds, each list in order of
/// preference, else after its last statement when `last`.
pub(crate) struct Place {
    pub key: &'static str,
    pub after: &'static [&'static str],
    pub before: &'static [&'static str],
    pub last: bool,
}

/// The keys of a `galactic_object` entity.
pub(crate) mod system {
    use super::{Place, keys};

    pub(crate) const COLONIES: Place = Place {
        key: keys::COLONIES,
        after: &[keys::INDEX],
        before: &[keys::STORM],
        last: false,
    };
    pub(crate) const FLEET_PRESENCE: Place = Place {
        key: keys::FLEET_PRESENCE,
        after: &[keys::INIT_PARENT, keys::INITIALIZER],
        before: &[keys::INNER_RADIUS],
        last: false,
    };
    pub(crate) const NATURAL_WORMHOLES: Place = Place {
        key: keys::NATURAL_WORMHOLES,
        after: &[keys::HYPERLANE, keys::STAR_CLASS],
        before: &[],
        last: false,
    };
    /// The game writes hyperlane, then asteroid_belts, then discovery, arm, flags and
    /// initializer.
    pub(crate) const ASTEROID_BELTS: Place = Place {
        key: keys::ASTEROID_BELTS,
        after: &[],
        before: &[keys::DISCOVERY, keys::ARM, keys::FLAGS, keys::INITIALIZER],
        last: false,
    };
    pub(crate) const TIMED_MODIFIER: Place = Place {
        key: keys::TIMED_MODIFIER,
        after: &[keys::INDEX],
        before: &[],
        last: true,
    };
    /// Inside the system's `coordinate`.
    pub(crate) const VISUAL_HEIGHT: Place = Place {
        key: keys::VISUAL_HEIGHT,
        after: &[],
        before: &[],
        last: true,
    };
}

/// The keys of a `planets.planet` entity.
pub(crate) mod planet {
    use super::{Place, keys};

    pub(crate) const BINARY_FLAGS: Place = Place {
        key: keys::BINARY_FLAGS,
        after: &[],
        before: &[keys::ENTITY_PLANET_CLASS, keys::COORDINATE],
        last: false,
    };
    pub(crate) const MOON_OF: Place = Place {
        key: keys::MOON_OF,
        after: &[],
        before: &[keys::MOONS, keys::PLANET_ORBITALS],
        last: false,
    };
    pub(crate) const MOONS: Place = Place {
        key: keys::MOONS,
        after: &[],
        before: &[keys::PLANET_ORBITALS],
        last: false,
    };
    pub(crate) const ANOMALY: Place = Place {
        key: keys::ANOMALY,
        after: &[keys::PLANET_ORBITALS],
        before: &[keys::BOMBARDMENT_DAMAGE],
        last: true,
    };
    pub(crate) const PLANET_MODIFIER: Place = Place {
        key: keys::PLANET_MODIFIER,
        after: &[],
        before: &[keys::ENTITY],
        last: true,
    };
    pub(crate) const ENTITY_NAME: Place = Place {
        key: keys::ENTITY_NAME,
        after: &[keys::ENTITY],
        before: &[],
        last: false,
    };
    pub(crate) const TIMED_MODIFIER: Place = Place {
        key: keys::TIMED_MODIFIER,
        after: &[keys::BOMBARDMENT_DAMAGE],
        before: &[],
        last: true,
    };
    pub(crate) const DEPOSITS: Place = Place {
        key: keys::DEPOSITS,
        after: &[],
        before: &[],
        last: true,
    };
}

/// The keys of a `country` entity.
pub(crate) mod country {
    use super::{Place, keys};

    /// Inside the country's `events`.
    pub(crate) const ANOMALIES: Place = Place {
        key: keys::ANOMALIES,
        after: &[],
        before: &[keys::SITUATIONS],
        last: true,
    };
}

/// Write `place.key` where `place` puts it in the block at `path` below the entity (the
/// entity itself for none), as the statement `text` returns for the indentation of the
/// line it lands beside, without that indentation or a closing newline.
pub(crate) fn insert_key(
    edit: &mut Edit,
    path: &[&str],
    place: &Place,
    text: impl FnOnce(&[u8]) -> String,
) -> Result<(), OpError> {
    let (after, before, last, value) = {
        let mut block = edit.entity()?;
        for (i, key) in path.iter().enumerate() {
            block = block
                .find(key, &edit.buf)
                .ok_or_else(|| edit.parse_error(0, format!("missing {}", path[..=i].join("."))))?;
        }
        let first_of = |keys: &[&str]| {
            keys.iter()
                .find_map(|key| block.find(key, &edit.buf).map(Node::span))
        };
        let (after, before) = (first_of(place.after), first_of(place.before));
        let last = block.children().last().map(Node::span);
        (after, before, last, block.value_span())
    };
    match (after, before, last) {
        (Some(after), _, _) => insert_after(edit, after, text),
        (None, Some(before), _) => {
            let text = text(&edit.indent(before.start));
            edit.insert_before(before, &text);
        }
        (None, None, Some(last)) if place.last => insert_after(edit, last, text),
        (None, None, None) if place.last => {
            let close = value.end - 1;
            let mut indent = edit.indent(close);
            indent.push(b'\t');
            let line = [&indent[..], text(&indent).as_bytes(), b"\n"].concat();
            edit.insert(edit.line_start(close), line);
        }
        _ => {
            let reason = match place.before {
                [] => format!("nowhere to write {}", place.key),
                before => format!(
                    "nowhere to write {}: missing {}",
                    place.key,
                    before.join(" or ")
                ),
            };
            return Err(edit.parse_error(0, reason));
        }
    }
    Ok(())
}

fn insert_after(edit: &mut Edit, after: Span, text: impl FnOnce(&[u8]) -> String) {
    let text = text(&edit.indent(after.start));
    edit.insert_after(after.end, &text);
}
