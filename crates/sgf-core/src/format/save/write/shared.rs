//! The helpers several writers share: an entry written in its slot, a country's culture, a
//! body tied to its megastructure, and where a body stands about its centre.

use crate::Span;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::emit::inline;
use crate::format::save::alloc::{self, Slot, SlotTable};
use crate::format::save::lists_planet_megastructures;
use crate::format::save::read_spec::written_angle;
use crate::format::save::write::bodies::Stored;
use crate::format::save::write::flags::add_flags;
use crate::format::save::write::id_list::{Emptied, append, unlist};
use crate::format::save::write::place::{self, insert_key};
use crate::keys;
use crate::ops::{Edit, Emitted, OpError, Plan};
use crate::overlay::Anchor;
use crate::projections::geometry::{Body, drawn_radius};
use crate::projections::read;
use crate::views::OrbitPlacement;

/// Write an entry where `slot` stands: in place of its tombstone, indented as that was,
/// or at the end of `table`.
pub(crate) fn write_slot(
    plan: &mut Plan,
    doc: &Document,
    slot: Slot,
    table: &mut SlotTable,
    emitted: Emitted,
    entry: impl Fn(&[u8]) -> Vec<u8>,
) -> Result<(), OpError> {
    match slot {
        Slot::Reused {
            tombstone: tombstone @ Anchor::Original(_),
            ..
        } => {
            let indent = cst::indent_of(doc.original(), tombstone.start());
            let text = inline(indent, &entry(indent)).into_bytes();
            plan.replace(doc, emitted.subject(tombstone), tombstone, text)
        }
        // A tombstone a removal left in an appended slot carries its line with it.
        Slot::Reused { tombstone, .. } => {
            let subject = emitted.subject(tombstone);
            let current = doc.current(tombstone)?;
            let span = alloc::statement_span(current)
                .ok_or_else(|| subject.parse_error(0, "the tombstone holds no statement"))?;
            let indent = cst::indent_of(current, span.start);
            let text = inline(indent, &entry(indent));
            let bytes = [
                &current[..span.start],
                text.as_bytes(),
                &current[span.end..],
            ]
            .concat();
            plan.replace(doc, subject, tombstone, bytes)
        }
        Slot::Appended { .. } => {
            let text = table.end.shape(entry(table.end.indent()));
            plan.emit(emitted, table.end.at(), text);
            Ok(())
        }
    }
}

/// The `graphical_culture` the country `edit` holds names, when it names one.
pub(crate) fn culture_of(edit: &Edit) -> Result<Option<String>, OpError> {
    let country = edit.entity()?;
    Ok(read::scalar(country, keys::GRAPHICAL_CULTURE, &edit.buf).map(str::to_owned))
}

/// Tie the body `edit` holds to row `id`, with the planet flags `flags`, each with its date.
pub(crate) fn tie(
    doc: &Document,
    edit: &mut Edit,
    id: u32,
    flags: &[(&str, String)],
) -> Result<(), OpError> {
    name_row(doc, edit, id)?;
    add_flags(edit, flags, &place::planet::FLAGS)
}

/// Have the planet `edit` holds name row `id`, in the form it names one in or else its save
/// does. A list keeps its other ids, and one it has already; a `megastructure` key that names another row gives way,
/// as it can name one the table no longer holds.
pub(crate) fn name_row(doc: &Document, edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let planet = edit.entity()?;
    if read::ids(planet, keys::MEGASTRUCTURES, &edit.buf).contains(&id) {
        return Ok(());
    }
    let listed = planet.find(keys::MEGASTRUCTURES, &edit.buf).is_some();
    let named = planet.find(keys::MEGASTRUCTURE, &edit.buf).is_some();
    if named && !listed {
        edit.set_scalar(&[keys::MEGASTRUCTURE], id.to_string())
    } else if listed || lists_planet_megastructures(doc) {
        append(edit, &place::planet::MEGASTRUCTURES, &[id])
    } else {
        insert_key(edit, &[], &place::planet::MEGASTRUCTURE, |_| {
            format!("{}={id}", keys::MEGASTRUCTURE)
        })
    }
}

/// Have the planet `edit` holds name none of rows `ids`, its list going with its last id.
pub(crate) fn unname_rows(edit: &mut Edit, ids: &[u32]) -> Result<(), OpError> {
    let gone: Vec<Span> = edit
        .entity()?
        .find_all(keys::MEGASTRUCTURE, &edit.buf)
        .filter(|key| {
            key.scalar_str(&edit.buf)
                .and_then(|t| t.parse().ok())
                .is_some_and(|id| ids.contains(&id))
        })
        .map(Node::span)
        .collect();
    for span in gone {
        edit.bytes().remove_statement(span);
    }
    unlist(edit, keys::MEGASTRUCTURES, ids, Emptied::Drop)?;
    Ok(())
}

/// Where `body` stands about the point a spec with `moon_of` places it from.
pub(crate) fn placement(stored: &[Stored], body: &Body, moon_of: Option<u32>) -> OrbitPlacement {
    let centre = moon_of
        .and_then(|parent| stored.iter().find(|b| b.body.id == parent))
        .map_or((0.0, 0.0), |parent| parent.body.at);
    let radius = drawn_radius(body.at, centre, Some(body.orbit));
    OrbitPlacement {
        radius,
        angle: written_angle(centre, body.at, radius),
    }
}
