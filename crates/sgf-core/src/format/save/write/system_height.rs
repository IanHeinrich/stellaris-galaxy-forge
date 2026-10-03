//! `SetSystemHeights`: each system's `coordinate.visual_height`, how far above or below the
//! galactic plane the map draws its star. Lanes are drawn between the stars where they
//! stand, so nothing else is written.

use crate::cst::Node;
use crate::emit::coord;
use crate::keys;
use crate::ops::rules::bulk_description;
use crate::ops::rules::systems::decide_heights;
use crate::ops::{Edit, Op, OpError, Plan, Planned, SystemHeight};
use crate::session::Session;

/// The game reads `visual_height=0` as unset and puts a height of its own in its place,
/// so a height that would be written as 0 is written as the smallest one five decimals
/// hold.
const LEAST_HEIGHT: &str = "0.00001";

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    heights: &[SystemHeight],
) -> Result<Planned, OpError> {
    let restore = decide_heights(&s.graph, heights)?;
    let mut one = String::new();
    for (new, old) in heights.iter().zip(&restore) {
        let text = new.height.map(height_text);
        write_height(plan.edit(&s.doc, new.id)?, text.as_deref())?;
        let name = s.graph.systems[&new.id].display_name();
        one = match (old.height, &text) {
            (Some(old), Some(text)) => format!(
                "Set the height of {name} (#{}) from {} to {text}",
                new.id,
                coord(old)
            ),
            (None, Some(text)) => format!("Set the height of {name} (#{}) to {text}", new.id),
            (_, None) => format!("Cleared the height of {name} (#{})", new.id),
        };
    }
    Ok(Planned {
        description: bulk_description(heights.len(), one, "Set the height of"),
        inverse: Op::SetSystemHeights { heights: restore },
    })
}

fn height_text(height: f64) -> String {
    match coord(height) {
        text if text == "0" => LEAST_HEIGHT.to_owned(),
        text => text,
    }
}

/// Makes the system's `coordinate.visual_height` read `text`: rewritten where it is
/// written, put after the last key of `coordinate` where it is not, and taken out for
/// `None`.
fn write_height(edit: &mut Edit, text: Option<&str>) -> Result<(), OpError> {
    let coordinate = edit
        .entity()?
        .find(keys::COORDINATE, &edit.buf)
        .ok_or_else(|| edit.parse_error(0, format!("missing {}", keys::COORDINATE)))?;
    let written = coordinate
        .find(keys::VISUAL_HEIGHT, &edit.buf)
        .map(Node::span);
    let last = coordinate.children().last().map(Node::span);
    match (written, text) {
        (Some(span), None) => edit.remove_statement(span),
        (Some(_), Some(text)) => {
            edit.set_scalar(&[keys::COORDINATE, keys::VISUAL_HEIGHT], text)?;
        }
        (None, Some(text)) => {
            let last = last.ok_or_else(|| {
                edit.parse_error(0, format!("{} holds no keys", keys::COORDINATE))
            })?;
            edit.insert_after(last.end, &format!("{}={text}", keys::VISUAL_HEIGHT));
        }
        (None, None) => {}
    }
    Ok(())
}
