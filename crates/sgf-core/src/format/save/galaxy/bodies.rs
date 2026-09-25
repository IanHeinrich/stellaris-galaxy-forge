//! The planets a save system lists, each one's `planet_class` and `planet_size`, for the
//! map to draw a system's stars from.

use crate::cst::Node;
use crate::keys;
use crate::lexer::{self, TokenKind};
use crate::projections::galaxy::SystemBody;
use crate::scan::{self, Entity, Index, Value};

/// The planets a `galactic_object` entity lists, in file order.
pub(crate) fn planet_ids(system: &Node, src: &[u8]) -> Vec<u32> {
    system
        .find_all(keys::PLANET, src)
        .filter_map(|n| n.scalar_str(src)?.parse().ok())
        .collect()
}

/// Planet `id`'s entity in `planets`, the `planets` section's inner index; `None` for a
/// planet the save does not hold or holds as a tombstone.
pub(super) fn planet(planets: &Index, id: u32) -> Option<&Entity> {
    planets
        .entity(keys::PLANET, u64::from(id))
        .filter(|e| matches!(e.value, Value::Block { .. }))
}

/// A planet's class and size from its `<id>={…}` statement. The game writes both at the
/// head of the entity, so lexing stops at the second instead of reading the whole planet.
pub(super) fn body(bytes: &[u8]) -> SystemBody {
    let [class, size] = head_values(bytes, [keys::PLANET_CLASS, keys::PLANET_SIZE]);
    SystemBody {
        class: class
            .map(|class| String::from_utf8_lossy(class).into_owned())
            .unwrap_or_default(),
        size: size.and_then(|size| std::str::from_utf8(size).ok()?.parse().ok()),
    }
}

/// The first scalar value of each of `wanted` among an entity's own fields, unquoted,
/// lexing no further than it takes to find them all; `None` for a key it lacks.
pub(crate) fn head_values<'a, const N: usize>(
    bytes: &'a [u8],
    wanted: [&str; N],
) -> [Option<&'a [u8]>; N] {
    let mut found = [None; N];
    let mut depth = 0u32;
    let mut key: Option<&[u8]> = None;
    let mut assigned: Option<&[u8]> = None;
    for token in lexer::tokens(bytes, 0) {
        match token.kind {
            TokenKind::LBrace => {
                depth += 1;
                key = None;
                assigned = None;
            }
            TokenKind::RBrace => {
                depth = depth.saturating_sub(1);
                key = None;
                assigned = None;
            }
            TokenKind::Eq | TokenKind::Cmp(_) => assigned = key.take(),
            TokenKind::Scalar { .. } if depth == 1 => {
                let text = token.span.slice(bytes);
                let Some(name) = assigned.take() else {
                    key = Some(text);
                    continue;
                };
                if let Some(at) = wanted.iter().position(|w| w.as_bytes() == name)
                    && found[at].is_none()
                {
                    found[at] = Some(scan::unquote(text));
                }
                if found.iter().all(Option::is_some) {
                    break;
                }
            }
            TokenKind::Scalar { .. } => {}
        }
    }
    found
}
