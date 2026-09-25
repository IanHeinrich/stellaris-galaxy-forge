//! Reading the top-level `nebula` sections of a save, each with the systems it lists.
//!
//! Ops rewrite membership, so a refresh reads the bytes currently standing for the
//! section rather than the original ones.

use crate::cst::{self, Node};
use crate::document::Document;
use crate::keys;
use crate::projections::galaxy::{Nebula, ProjectionError};
use crate::projections::read;
use crate::scan::Index;

/// Every top-level `nebula` section, in file order.
pub(super) fn extract(index: &Index, src: &[u8]) -> Result<Vec<Nebula>, ProjectionError> {
    index
        .sections_named(keys::NEBULA)
        .map(|section| parse(section.stmt.slice(src)))
        .collect()
}

/// The same, from the bytes currently standing for each of the document's nebula
/// statements, which ops rewrite, erase and add to.
pub(super) fn extract_current(doc: &Document) -> Result<Vec<Nebula>, ProjectionError> {
    let mut nebulae = Vec::new();
    for &anchor in doc.nebulae() {
        let buf = doc
            .current(anchor)
            .map_err(|e| ProjectionError::SectionField {
                section: keys::NEBULA,
                reason: e.to_string(),
            })?;
        nebulae.push(parse(buf)?);
    }
    Ok(nebulae)
}

/// `buf` is the whole `nebula={…}` statement.
fn parse(buf: &[u8]) -> Result<Nebula, ProjectionError> {
    let root = cst::parse(buf, 0).map_err(|source| ProjectionError::Section {
        section: keys::NEBULA,
        source,
    })?;
    let node = root
        .children()
        .first()
        .ok_or_else(|| ProjectionError::SectionField {
            section: keys::NEBULA,
            reason: "empty section".to_owned(),
        })?;
    extract_nebula(node, buf)
}

/// `node` is the `nebula=` statement of one section.
fn extract_nebula(node: &Node, src: &[u8]) -> Result<Nebula, ProjectionError> {
    let field = |reason: String| ProjectionError::SectionField {
        section: keys::NEBULA,
        reason,
    };
    let (x, y) = read::coordinate(node, src).map_err(field)?;
    let radius = read::scalar(node, keys::RADIUS, src)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let systems = node
        .find_all(keys::GALACTIC_OBJECT, src)
        .filter_map(|n| n.scalar_str(src)?.parse().ok())
        .collect();
    Ok(Nebula {
        name: read::name(node, src),
        x,
        y,
        radius,
        systems,
        turbulence: None,
    })
}
