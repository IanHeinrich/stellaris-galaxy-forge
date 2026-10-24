//! The fleets standing in a system, and moving one with its ships from one system to
//! another.

use crate::emit::coord;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, rows_containing};
use crate::format::save::galaxy::fleets::{position, record};
use crate::format::save::{entity, entity_at, system_statement};
use crate::keys;
use crate::ops::{Edit, OpError, Plan, Subject};
use crate::projections::read;
use crate::session::Session;

/// The `movement_manager.state` of a fleet that stands still.
const IDLE: &str = "move_idle";

/// Whether fleet `fleet` is a fleet of the save standing in system `from`: its
/// `movement_manager.coordinate` names `from`. A station fleet that is gone, or stands
/// elsewhere, stays out of both systems' `fleet_presence`.
pub(crate) fn stationed(s: &Session, fleet: u32, from: u32) -> bool {
    position(&s.doc, fleet).is_some_and(|(origin, _)| origin == from)
}

/// The fleets of system `system`'s `fleet_presence` parked in orbit of a body of `bodies`,
/// each with the body: its `movement_manager` stands in the system, is `move_idle`, and
/// names the body in `orbit.orbitable.planet`. A fleet on its way, to the body or from
/// it, is left out.
pub(crate) fn parked(s: &Session, system: u32, bodies: &[u32]) -> Result<Vec<(u32, u32)>, OpError> {
    let mut parked = Vec::new();
    for fleet in present_fleets(s, system)? {
        let Some(anchor) = record(&s.doc, keys::FLEET, fleet) else {
            continue;
        };
        let Ok(Some((node, src))) = entity_at(&s.doc, anchor) else {
            continue;
        };
        let Some(movement) = node.find(keys::MOVEMENT_MANAGER, src) else {
            continue;
        };
        let body = movement
            .find(keys::ORBIT, src)
            .and_then(|orbit| orbit.find(keys::ORBITABLE, src))
            .and_then(|orbitable| read::scalar_u32(orbitable, keys::PLANET, src));
        let idle = read::scalar(movement, keys::STATE, src) == Some(IDLE);
        let here = read::origin(movement, src) == Some(system);
        if let Some(body) = body.filter(|b| idle && here && bodies.contains(b)) {
            parked.push((fleet, body));
        }
    }
    Ok(parked)
}

/// The fleets system `id`'s `fleet_presence` lists.
pub(crate) fn present_fleets(s: &Session, id: u32) -> Result<Vec<u32>, OpError> {
    let anchor = system_statement(&s.doc, id).ok_or(OpError::UnknownSystem(id))?;
    let (node, src) = entity(&s.doc, Subject::System(id), anchor)?;
    Ok(read::ids(&node, keys::FLEET_PRESENCE, src))
}

/// Move fleet `fleet` and its ships from system `from` to `to`, by `step` when given: the
/// fleet's `movement_manager.coordinate` and each ship's `coordinate` and
/// `target_coordinate` shift, and the fleet's `combat.coordinate`, which stands at the
/// system's centre, only takes the new `origin`. A coordinate with any other origin, the
/// null one included, is left as it stands, and so is every `origin` when `from` is `to`.
pub(crate) fn move_fleet(
    plan: &mut Plan,
    s: &Session,
    fleet: u32,
    [from, to]: [u32; 2],
    step: Option<(f64, f64)>,
) -> Result<(), OpError> {
    let Some(anchor) = record(&s.doc, keys::FLEET, fleet) else {
        return Ok(());
    };
    let edit = plan.edit_record(&s.doc, anchor)?;
    let systems = [from, to];
    shift(
        edit,
        &[keys::MOVEMENT_MANAGER, keys::COORDINATE],
        systems,
        step,
    )?;
    shift(edit, &[keys::COMBAT, keys::COORDINATE], systems, None)?;
    let ships = read::ids(edit.entity()?, keys::SHIPS, &edit.buf);
    for ship in ships {
        let Some(anchor) = record(&s.doc, keys::SHIPS, ship) else {
            continue;
        };
        let edit = plan.edit_record(&s.doc, anchor)?;
        shift(edit, &[keys::COORDINATE], systems, step)?;
        shift(edit, &[keys::TARGET_COORDINATE], systems, step)?;
    }
    Ok(())
}

/// Shift by its body's step the `coordinate` of every fleet's
/// `current_order.build_megastructure_fleet_order` at a body of `steps` in system `system`.
/// Until the construction ship lays the site the build has no `megastructures` row, and the
/// game writes the row at that coordinate.
pub(crate) fn carry_build_orders(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    steps: &[(u32, (f64, f64))],
) -> Result<(), OpError> {
    if steps.is_empty() {
        return Ok(());
    }
    let path = [
        keys::CURRENT_ORDER,
        keys::BUILD_MEGASTRUCTURE_FLEET_ORDER,
        keys::COORDINATE,
    ];
    let fleets = rows_containing(
        &s.doc,
        Table::Entity(EntityKind::Fleet),
        keys::BUILD_MEGASTRUCTURE_FLEET_ORDER.as_bytes(),
    )?;
    for fleet in fleets {
        let body = fleet
            .node
            .find(keys::CURRENT_ORDER, fleet.src)
            .and_then(|order| order.find(keys::BUILD_MEGASTRUCTURE_FLEET_ORDER, fleet.src))
            .and_then(|build| read::scalar_u32(build, keys::PLANET, fleet.src));
        let Some(&(_, step)) = body.and_then(|body| steps.iter().find(|(b, _)| *b == body)) else {
            continue;
        };
        shift(
            plan.edit_record(&s.doc, fleet.anchor)?,
            &path,
            [system, system],
            Some(step),
        )?;
    }
    Ok(())
}

/// Give the coordinate at `path` origin `to` when its origin is `from`, and shift its point
/// by `step` when there is one.
fn shift(
    edit: &mut Edit,
    path: &[&str],
    [from, to]: [u32; 2],
    step: Option<(f64, f64)>,
) -> Result<(), OpError> {
    let mut node = edit.entity()?;
    for key in path {
        match node.find(key, &edit.buf) {
            Some(child) => node = child,
            None => return Ok(()),
        }
    }
    if read::scalar_u32(node, keys::ORIGIN, &edit.buf) != Some(from) {
        return Ok(());
    }
    let point = (
        read::scalar_f64(node, keys::X, &edit.buf),
        read::scalar_f64(node, keys::Y, &edit.buf),
    );
    let axis = |key| [path, &[key]].concat();
    if let (Some(step), (Some(x), Some(y))) = (step, point) {
        edit.set_scalar(&axis(keys::X), coord(x + step.0))?;
        edit.set_scalar(&axis(keys::Y), coord(y + step.1))?;
    }
    if from == to {
        return Ok(());
    }
    edit.set_scalar(&axis(keys::ORIGIN), to.to_string())
}
