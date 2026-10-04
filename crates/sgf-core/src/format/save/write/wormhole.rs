//! `MoveWormhole`: where a save's natural wormhole stands in its system.

use crate::emit::coord;
use crate::format::save::galaxy::bypasses::natural_wormholes;
use crate::format::save::read_spec::written_angle;
use crate::format::save::write::bodies::number;
use crate::format::save::write::move_system::splice_coordinate;
use crate::keys;
use crate::ops::rules::bodies::{check_radius, normalised, point};
use crate::ops::{Edit, Op, OpError, Plan, Planned, Subject};
use crate::projections::galaxy::SystemNode;
use crate::projections::read;
use crate::session::Session;

/// The bypass type of the one kind of natural wormhole that may be moved.
pub(super) const WORMHOLE: &str = "wormhole";

pub(crate) fn plan_move(
    plan: &mut Plan,
    s: &Session,
    wormhole: u32,
    radius: f64,
    angle: f64,
) -> Result<Planned, OpError> {
    check_radius(radius, "a wormhole's distance from the star")?;
    if !angle.is_finite() {
        return Err(OpError::NotFinite);
    }
    let found = natural_wormholes(&s.doc, &s.graph.systems)?
        .into_iter()
        .find(|w| w.id == wormhole)
        .ok_or(OpError::UnknownWormhole(wormhole))?;
    if found.kind != WORMHOLE {
        return Err(OpError::NotAWormhole {
            wormhole,
            kind: found.kind,
        });
    }
    let (x, y) = point((0.0, 0.0), radius, normalised(angle));
    let edit = plan.edit_record(&s.doc, found.anchor)?;
    if written(edit)? == (coord(x), coord(y)) {
        return Err(OpError::WormholeUnchanged(wormhole));
    }
    splice_coordinate(edit, x, y)?;
    plan.stale(Subject::System(found.system));

    let old_radius = found.at.0.hypot(found.at.1);
    let old_angle = written_angle((0.0, 0.0), found.at, old_radius);
    let linked = found
        .partner
        .map(|partner| format!(", linked to {}", named(s, partner)))
        .unwrap_or_default();
    let description = format!(
        "Moved the wormhole in {} from {} at {}° to {} at {}°{linked}",
        named(s, found.system),
        number(old_radius),
        number(old_angle),
        number(radius),
        number(normalised(angle)),
    );
    Ok(Planned {
        description,
        inverse: Op::MoveWormhole {
            wormhole,
            radius: old_radius,
            angle: old_angle,
        },
    })
}

/// The entry's `coordinate.x` and `.y` as written.
fn written(edit: &Edit) -> Result<(String, String), OpError> {
    let entity = edit.entity()?;
    let coordinate = entity
        .find(keys::COORDINATE, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "missing coordinate"))?;
    let axis = |key| read::text(coordinate, key, &edit.buf);
    Ok((axis(keys::X), axis(keys::Y)))
}

/// "Ferragon #489", or "#489" for a system with no name or one the galaxy lacks.
pub(super) fn named(s: &Session, system: u32) -> String {
    let name = s
        .graph
        .systems
        .get(&system)
        .map(SystemNode::display_name)
        .unwrap_or_default();
    if name.is_empty() {
        format!("#{system}")
    } else {
        format!("{name} #{system}")
    }
}
