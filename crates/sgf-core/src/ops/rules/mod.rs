//! What the graph says an op should do, before either format writes a byte.
//!
//! One module per subject: `lanes` for the links between systems, `systems` for where
//! they stand, `nebula` for the clouds over them, `fe_zone` for the empty space Paint a
//! Galaxy seats a fallen empire in. Nothing here reaches for a plan, an edit or a
//! document; both formats' writers start from these decisions and differ only in the
//! bytes they then splice.

pub mod fe_zone;
pub(crate) mod lanes;
pub(crate) mod nebula;
pub(crate) mod systems;

use crate::ops::OpError;

/// A name is written between quotes with no escaping, so these bytes cannot be in it,
/// and nothing at all is not a name. A save's `key="…"` and a scenario's `name = "…"`
/// are written the same way and share the rule.
pub(crate) fn check_name(name: &str) -> Result<(), OpError> {
    if name.is_empty() {
        return Err(OpError::EmptyName);
    }
    if name.contains(['"', '\\', '\n', '\r']) {
        return Err(OpError::InvalidName(name.to_owned()));
    }
    Ok(())
}

pub(crate) fn quoted(text: &str) -> String {
    format!("\"{text}\"")
}
