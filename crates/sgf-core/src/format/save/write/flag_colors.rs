//! The slots of a flag's `colors` list that the flag and map colour ops share, and the rule
//! that ties them together.

use crate::cst::Node;
use crate::keys;

pub(crate) const PRIMARY: usize = 0;
pub(crate) const SECONDARY: usize = 1;
/// The map border and fill 4.5 keeps after the four flag colours.
pub(crate) const MAP_BORDER: usize = 4;
pub(crate) const MAP_FILL: usize = 5;

/// Each map colour slot and the flag colour slot the game copies into it when map colours
/// are off.
pub(crate) const FOLLOWS: [(usize, usize); 2] = [(MAP_BORDER, PRIMARY), (MAP_FILL, SECONDARY)];

/// A place in the bytes the flag cannot be read at, and why.
pub(crate) type Unreadable = (usize, String);

/// Whether the `flag` block `node` of `buf` turns map colours on.
pub(crate) fn map_colors_on(node: &Node, buf: &[u8]) -> bool {
    node.find(keys::USE_MAP_COLOR, buf)
        .and_then(|n| n.scalar_str(buf))
        == Some("yes")
}
