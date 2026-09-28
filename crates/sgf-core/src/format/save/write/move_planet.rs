//! `MoveSavePlanet`: a save planet and its moons taken from one system into another. The
//! `planet=` lines move between the two `galactic_object` entities, and each body's
//! `coordinate` takes the new `origin`. The colony of each colonised body moves between
//! the two systems' `colonies`, and the station fleet of each body with one moves between
//! their `fleet_presence`, its ships with it. The game re-anchors no fleet on load. No
//! other fleet is touched.

use crate::cst::Node;
use crate::emit::system::{MOON_FLAG, planet_lines};
use crate::emit::{Lines, coord, inline};
use crate::format::save::read_spec::bodies as listed;
use crate::format::save::write::belts;
use crate::format::save::write::bodies::{frame, grow};
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::{check_version, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::{
    Body, angle_about, descendants, drawn_radius, point, system_reach,
};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::Value;
use crate::session::Session;
use crate::{NULL_ID, Span};

/// Whether a planet class is a star's: every vanilla star body's class ends in `_star`,
/// and the black hole and pulsar classes are stars without it. `star` is the class an
/// initializer writes for a system's own star.
pub(crate) fn is_star_class(class: &str) -> bool {
    class.ends_with("_star") || matches!(class, "star" | "pc_black_hole" | "pc_pulsar")
}

pub(crate) fn plan_move(
    plan: &mut Plan,
    s: &Session,
    planet: u32,
    to: u32,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let (node, src) = planet_entity(&s.doc, planet)?;
    let from = planet_system(&node, src, planet)?;
    if !s.graph.systems.contains_key(&to) {
        return Err(OpError::UnknownSystem(to));
    }
    if from == to {
        return Err(OpError::AlreadyInSystem { planet, system: to });
    }
    let source: Vec<Body> = frame(s, from)?.into_iter().map(|b| b.body).collect();
    let body = *source
        .iter()
        .find(|b| b.id == planet)
        .ok_or(OpError::NotABody {
            planet,
            system: from,
        })?;
    let moons = descendants(&source, planet);
    check_movable(s, &source, &body, &moons)?;
    if listed(&s.doc, to)?.is_empty() {
        return Err(OpError::NoBodies(to));
    }
    let moved: Vec<u32> = std::iter::once(planet)
        .chain(moons.iter().copied())
        .collect();
    let mut colonies = Vec::new();
    let mut stations = Vec::new();
    for &id in &moved {
        let (node, src) = planet_entity(&s.doc, id)?;
        if node.find(keys::MEGASTRUCTURE, src).is_some() {
            return Err(OpError::MegastructurePlanet(id));
        }
        check_owner(s, &node, src, id, [from, to])?;
        colonies.extend(read::scalar_u32(&node, keys::COLONY, src));
        stations.extend(
            read::scalar_u32(&node, keys::SHIPCLASS_ORBITAL_STATION, src)
                .filter(|&fleet| fleet != NULL_ID),
        );
    }

    let before: Vec<Body> = frame(s, to)?.into_iter().map(|b| b.body).collect();
    let edit = plan.edit(&s.doc, to)?;
    let belt_radii = belts::belt_radii(edit, edit.entity()?);
    let extent = moons
        .iter()
        .filter_map(|&m| source.iter().find(|b| b.id == m))
        .map(|m| drawn_radius(m.at, body.at, Some(m.orbit)))
        .fold(0.0, f64::max);
    let orbit = (system_reach(&before, &belt_radii) + s.radii().inner_offset + extent).ceil();
    let at = point((0.0, 0.0), orbit, angle_about((0.0, 0.0), body.at));
    let step = (at.0 - body.at.0, at.1 - body.at.1);

    unlist_planets(plan.edit(&s.doc, from)?, &moved)?;
    list_planets(plan.edit(&s.doc, to)?, &moved)?;
    unlist(plan.edit(&s.doc, from)?, keys::COLONIES, &colonies);
    list(plan.edit(&s.doc, to)?, &COLONIES_AT, &colonies)?;
    unlist(plan.edit(&s.doc, from)?, keys::FLEET_PRESENCE, &stations);
    list(plan.edit(&s.doc, to)?, &FLEETS_AT, &stations)?;
    for &station in &stations {
        move_station(plan, s, station, [from, to], step)?;
    }

    let edit = plan.edit_planet(&s.doc, planet, to)?;
    edit.set_scalar(&[keys::ORBIT], coord(orbit))?;
    splice_coordinate(edit, at.0, at.1)?;
    edit.set_scalar(&[keys::COORDINATE, keys::ORIGIN], to.to_string())?;
    let mut after = before.clone();
    after.push(Body {
        at,
        parent: None,
        ..body
    });
    for &id in &moons {
        let moon = source
            .iter()
            .find(|b| b.id == id)
            .expect("a moon of the frame");
        let moon_at = (moon.at.0 + step.0, moon.at.1 + step.1);
        let edit = plan.edit_planet(&s.doc, id, to)?;
        splice_coordinate(edit, moon_at.0, moon_at.1)?;
        edit.set_scalar(&[keys::COORDINATE, keys::ORIGIN], to.to_string())?;
        after.push(Body {
            at: moon_at,
            ..*moon
        });
    }
    let reach = moved
        .iter()
        .filter_map(|&id| after.iter().find(|b| b.id == id))
        .map(|b| crate::ops::rules::bodies::reach(&after, b))
        .fold(0.0, f64::max);

    let carrying = match moons.len() {
        0 => String::new(),
        1 => " and its moon".to_owned(),
        n => format!(" and its {n} moons"),
    };
    let stationed = match (stations.len(), moons.is_empty()) {
        (0, _) => String::new(),
        (1, true) => " and its station".to_owned(),
        (1, false) => ", with a station,".to_owned(),
        (n, _) => format!(", with {n} stations,"),
    };
    let description = format!(
        "Moved planet #{planet}{carrying}{stationed} from system #{from} to system #{to}, at orbit {}",
        coord(orbit)
    );
    // Undo replays bytes: this inverse puts the planet back in its old system, not on its old
    // orbit or at its old place in the lists.
    let inverse = Op::MoveSavePlanet { planet, to: from };
    grow(plan, s, to, &before, reach, description, inverse)
}

/// Refuse a star: the system's primary, a body of a star's class, or a body others orbit
/// without the moon bit. Refuse a body that orbits another too, or whose parent is gone.
fn check_movable(s: &Session, frame: &[Body], body: &Body, moons: &[u32]) -> Result<(), OpError> {
    let (node, src) = planet_entity(&s.doc, body.id)?;
    let primary = frame.first().is_some_and(|primary| primary.id == body.id);
    if primary || is_star_class(&read::text(&node, keys::PLANET_CLASS, src)) {
        return Err(OpError::StarNotMovable(body.id));
    }
    if let Some(parent) = body.parent {
        return Err(match planet_entity(&s.doc, parent) {
            Err(OpError::UnknownPlanet(_)) => OpError::ParentMissing {
                body: body.id,
                parent,
            },
            _ => OpError::OrbitsBody {
                planet: body.id,
                parent,
            },
        });
    }
    for &id in moons {
        let (node, src) = planet_entity(&s.doc, id)?;
        let flags = read::scalar_u32(&node, keys::BINARY_FLAGS, src).unwrap_or(0);
        if flags & MOON_FLAG == 0 {
            return Err(OpError::StarNotMovable(body.id));
        }
    }
    Ok(())
}

/// Refuse an owned planet its owner does not control, or one leaving or entering a system
/// its owner does not own. A planet without an owner goes anywhere.
fn check_owner(
    s: &Session,
    node: &Node,
    src: &[u8],
    planet: u32,
    systems: [u32; 2],
) -> Result<(), OpError> {
    let Some(owner) = read::scalar_u32(node, keys::OWNER, src) else {
        return Ok(());
    };
    if let Some(controller) = read::scalar_u32(node, keys::CONTROLLER, src)
        && controller != owner
    {
        return Err(OpError::PlanetOccupied {
            planet,
            owner,
            controller,
        });
    }
    for system in systems {
        if s.graph.systems.get(&system).and_then(|n| n.owner) != Some(owner) {
            return Err(OpError::OutsideOwner {
                planet,
                owner,
                system,
            });
        }
    }
    Ok(())
}

/// The system's `planet=` statements naming one of `ids`.
fn planet_statements(edit: &Edit, ids: &[u32]) -> Result<Vec<Span>, OpError> {
    let entity = edit.entity()?;
    Ok(entity
        .find_all(keys::PLANET, &edit.buf)
        .filter(|n| {
            n.scalar_str(&edit.buf)
                .and_then(|t| t.parse().ok())
                .is_some_and(|id: u32| ids.contains(&id))
        })
        .map(Node::span)
        .collect())
}

fn unlist_planets(edit: &mut Edit, ids: &[u32]) -> Result<(), OpError> {
    for span in planet_statements(edit, ids)? {
        edit.require_alone_on_line(span, "a planet statement")?;
        edit.remove_lines(span);
    }
    Ok(())
}

/// Write a `planet=` line per id after the system's last, in its indentation.
fn list_planets(edit: &mut Edit, ids: &[u32]) -> Result<(), OpError> {
    let last = edit
        .entity()?
        .find_all(keys::PLANET, &edit.buf)
        .last()
        .map(Node::span)
        .ok_or_else(|| edit.parse_error(0, "the system lists no bodies"))?;
    edit.require_alone_on_line(last, "a planet statement")?;
    let indent = edit.indent(last.start);
    edit.insert(edit.line_end(last.end), planet_lines(&indent, ids));
    Ok(())
}

/// Where a system's `colonies` goes when it has none: after `index`, else before `storm`.
const COLONIES_AT: Place = Place {
    key: keys::COLONIES,
    after: &[keys::INDEX],
    before: keys::STORM,
};

/// Where a system's `fleet_presence` goes when it has none: after `init_parent` or
/// `initializer`, else before `inner_radius`.
const FLEETS_AT: Place = Place {
    key: keys::FLEET_PRESENCE,
    after: &[keys::INIT_PARENT, keys::INITIALIZER],
    before: keys::INNER_RADIUS,
};

/// An id list of a system's entry, and where the game writes it: after the first of
/// `after` the entry holds, else before `before`.
struct Place {
    key: &'static str,
    after: &'static [&'static str],
    before: &'static str,
}

/// The ids of the list block, with their spans.
fn list_items(edit: &Edit, block: &Node) -> Vec<(u32, Span)> {
    block
        .children()
        .iter()
        .filter(|item| item.key.is_none())
        .filter_map(|item| Some((item.scalar_str(&edit.buf)?.parse().ok()?, item.span())))
        .collect()
}

/// Take `ids` out of the system's list `key`, and the list with it when nothing else is
/// left: the game writes no empty one.
fn unlist(edit: &mut Edit, key: &str, ids: &[u32]) {
    let Ok(entity) = edit.entity() else {
        return;
    };
    let Some(block) = entity.find(key, &edit.buf).cloned() else {
        return;
    };
    let items = list_items(edit, &block);
    let listed: Vec<Span> = items
        .iter()
        .filter(|(id, _)| ids.contains(id))
        .map(|(_, span)| *span)
        .collect();
    if !listed.is_empty() && listed.len() == block.children().len() {
        edit.remove_statement(block.span());
        return;
    }
    for item in listed {
        let end = item.end
            + edit.buf[item.end..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
        edit.replace_span(Span::new(item.start, end), Vec::new());
    }
}

/// Put `ids` last in the system's list `place.key`, writing the list where the game does
/// when the system has none.
fn list(edit: &mut Edit, place: &Place, ids: &[u32]) -> Result<(), OpError> {
    if ids.is_empty() {
        return Ok(());
    }
    let entity = edit.entity()?;
    if let Some(block) = entity.find(place.key, &edit.buf).cloned() {
        match list_items(edit, &block).last() {
            Some((_, last)) => {
                let items: String = ids.iter().map(|id| format!(" {id}")).collect();
                edit.insert(last.end, items.into_bytes());
            }
            None => {
                let span = block.span();
                let text = id_list(&edit.indent(span.start), place.key, ids);
                edit.replace_statement(span, &text);
            }
        }
        return Ok(());
    }
    let after = place
        .after
        .iter()
        .find_map(|key| entity.find(key, &edit.buf).map(Node::span));
    if let Some(after) = after {
        let text = id_list(&edit.indent(after.start), place.key, ids);
        edit.insert_after(after.end, &text);
        return Ok(());
    }
    let before = entity
        .find(place.before, &edit.buf)
        .map(Node::span)
        .ok_or_else(|| {
            let reason = format!("nowhere to write {}: missing {}", place.key, place.before);
            edit.parse_error(0, reason)
        })?;
    let text = id_list(&edit.indent(before.start), place.key, ids);
    edit.insert_before(before, &text);
    Ok(())
}

/// A list `key` of `ids`, as a statement whose first line takes `indent` from the line it
/// is written on.
fn id_list(indent: &[u8], key: &str, ids: &[u32]) -> String {
    let mut w = Lines::new(indent);
    w.list(0, key, ids);
    inline(indent, &w.into_bytes())
}

/// Move station fleet `fleet` and its ships from system `from` to `to` by `step`: the
/// fleet's `movement_manager.coordinate` and each ship's `coordinate` and
/// `target_coordinate` shift with the body, and the fleet's `combat.coordinate`, which
/// stands at the system's centre, only takes the new `origin`. A coordinate with any
/// other origin, the null one included, is left as it stands.
fn move_station(
    plan: &mut Plan,
    s: &Session,
    fleet: u32,
    [from, to]: [u32; 2],
    step: (f64, f64),
) -> Result<(), OpError> {
    let Some(anchor) = record(s, keys::FLEET, fleet) else {
        return Ok(());
    };
    let edit = plan.edit_record(&s.doc, anchor)?;
    let systems = [from, to];
    shift(
        edit,
        &[keys::MOVEMENT_MANAGER, keys::COORDINATE],
        systems,
        Some(step),
    )?;
    shift(edit, &[keys::COMBAT, keys::COORDINATE], systems, None)?;
    let ships = read::ids(edit.entity()?, keys::SHIPS, &edit.buf);
    for ship in ships {
        let Some(anchor) = record(s, keys::SHIPS, ship) else {
            continue;
        };
        let edit = plan.edit_record(&s.doc, anchor)?;
        shift(edit, &[keys::COORDINATE], systems, Some(step))?;
        shift(edit, &[keys::TARGET_COORDINATE], systems, Some(step))?;
    }
    Ok(())
}

/// The statement of entity `id` of the top-level table `section`; `None` for one the save
/// does not hold or holds as a tombstone.
fn record(s: &Session, section: &str, id: u32) -> Option<Anchor> {
    s.doc
        .index()
        .entity(section, u64::from(id))
        .filter(|e| matches!(e.value, Value::Block { .. }))
        .map(|e| Anchor::Original(e.stmt))
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
    edit.set_scalar(&axis(keys::ORIGIN), to.to_string())
}
