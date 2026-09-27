//! `MoveSaveBody` and `SetSaveBodyParent`: where a save planet or moon stands in its
//! system, and what it orbits.

use crate::Span;
use crate::cst::Node;
use crate::emit::system::{ANY_FLAG, MOON_FLAG};
use crate::emit::{Lines, coord, inline};
use crate::format::save::read_spec::{bodies as listed, written_angle};
use crate::format::save::write::belts;
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::{check_version, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::{
    Body, centre, check_parent, check_placement, descendants, drawn_radius, movable, moved_reach,
    normalised, placed, system_reach,
};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::projections::read;
use crate::session::Session;
/// A body of the system as its entry stands, with the text a move would rewrite.
pub(crate) struct Stored {
    pub(crate) body: Body,
    /// It holds the moon bit of `binary_flags`: a planet orbiting a star names it as
    /// `moon_of` without the bit.
    moon: bool,
    orbit: String,
    x: String,
    y: String,
}

impl Stored {
    /// Whether writing `body` would leave this entry's text as it is.
    fn holds(&self, body: &Body) -> bool {
        coord(body.orbit) == self.orbit && coord(body.at.0) == self.x && coord(body.at.1) == self.y
    }
}

pub(crate) fn plan_move(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    body: u32,
    radius: f64,
    angle: f64,
) -> Result<Planned, OpError> {
    let stored = frame_of(s, system, body, radius, angle)?;
    let before: Vec<Body> = stored.iter().map(|b| b.body).collect();
    let old = *movable(&before, system, body)?;
    let after = placed(&before, body, old.parent, radius, angle)?;
    let moved = find(&after, body);
    if stored.iter().any(|b| b.body.id == body && b.holds(moved)) {
        return Err(OpError::BodyUnchanged(body));
    }
    write_points(plan, s, system, &stored, &after, body)?;
    let (from, inverse) = where_it_was(&before, &old);
    let kind = kind_of(&stored, body);
    let description = format!(
        "Moved {kind} #{body} from {from} to orbit {} at {}°{}",
        number(radius),
        number(normalised(angle)),
        with_moons(&before, body),
    );
    let inverse = Op::MoveSaveBody {
        system,
        body,
        radius: inverse.0,
        angle: inverse.1,
    };
    let reach = moved_reach(&after, body);
    grow(plan, s, system, &before, reach, description, inverse)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn plan_parent(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    body: u32,
    parent: Option<u32>,
    star: bool,
    radius: f64,
    angle: f64,
) -> Result<Planned, OpError> {
    let stored = frame_of(s, system, body, radius, angle)?;
    let before: Vec<Body> = stored.iter().map(|b| b.body).collect();
    let is_moon = |id| stored.iter().any(|b| b.body.id == id && b.moon);
    check_parent(&before, system, body, parent, star, is_moon)?;
    let old = *find(&before, body);
    let after = placed(&before, body, parent, radius, angle)?;

    let edit = plan.edit_planet(&s.doc, body, system)?;
    set_moon_of(edit, parent)?;
    set_flag(edit, MOON_FLAG, parent.is_some() && !star)?;
    if let Some(old_parent) = old.parent.filter(|&p| before.iter().any(|b| b.id == p)) {
        unlist_moon(plan.edit_planet(&s.doc, old_parent, system)?, body)?;
    }
    if let Some(parent) = parent {
        list_moon(plan.edit_planet(&s.doc, parent, system)?, body)?;
    }
    write_points(plan, s, system, &stored, &after, body)?;

    let kind = kind_of(&stored, body);
    let becomes = match parent {
        Some(parent) if star => format!("a planet of star #{parent}"),
        Some(parent) => format!("a moon of planet #{parent}"),
        None if kind == "moon" => "a planet".to_owned(),
        None => "a planet of the system's centre".to_owned(),
    };
    let description = format!("Made {kind} #{body} {becomes}{}", with_moons(&before, body));
    let (_, (radius, angle)) = where_it_was(&before, &old);
    // A moon of a missing planet, or a planet of the star at the centre, gets that body back
    // as its parent: undo replays bytes, and this inverse is not one to apply.
    let inverse = Op::SetSaveBodyParent {
        system,
        body,
        parent: old.parent,
        star: old.parent.is_some() && kind == "planet",
        radius,
        angle,
    };
    let reach = moved_reach(&after, body);
    grow(plan, s, system, &before, reach, description, inverse)
}

/// The system's bodies, once the version, the placement and the body's own system are
/// checked.
fn frame_of(
    s: &Session,
    system: u32,
    body: u32,
    radius: f64,
    angle: f64,
) -> Result<Vec<Stored>, OpError> {
    check_version(&s.doc)?;
    check_placement(radius, angle)?;
    let (node, src) = planet_entity(&s.doc, body)?;
    if planet_system(&node, src, body)? != system {
        return Err(OpError::NotABody {
            planet: body,
            system,
        });
    }
    frame(s, system)
}

/// The system's bodies as their entries stand, for a caller with no one body of its own to
/// check, such as [`crate::format::save::write::belts::plan_inner_radius`].
pub(crate) fn frame(s: &Session, system: u32) -> Result<Vec<Stored>, OpError> {
    let mut frame = Vec::new();
    for id in listed(&s.doc, system)? {
        match planet_entity(&s.doc, id) {
            Ok((node, src)) => frame.push(stored(&node, src, id)?),
            Err(OpError::UnknownPlanet(_)) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(frame)
}

fn stored(node: &Node, src: &[u8], id: u32) -> Result<Stored, OpError> {
    let parse_error = |reason: String| OpError::PlanetParse {
        planet: id,
        offset: node.span().start,
        reason,
    };
    let at = read::coordinate(node, src).map_err(parse_error)?;
    let orbit = read::required(node, keys::ORBIT, src).map_err(parse_error)?;
    let axis = |key| {
        node.find(keys::COORDINATE, src)
            .and_then(|c| read::scalar(c, key, src))
            .unwrap_or_default()
            .to_owned()
    };
    Ok(Stored {
        body: Body {
            id,
            parent: read::scalar_u32(node, keys::MOON_OF, src),
            at,
            orbit,
        },
        moon: read::scalar_u32(node, keys::BINARY_FLAGS, src).is_some_and(|f| f & MOON_FLAG != 0),
        orbit: read::text(node, keys::ORBIT, src),
        x: axis(keys::X),
        y: axis(keys::Y),
    })
}

/// "moon" for a body holding the moon bit, else "planet".
fn kind_of(stored: &[Stored], id: u32) -> &'static str {
    if stored.iter().any(|b| b.body.id == id && b.moon) {
        "moon"
    } else {
        "planet"
    }
}

fn find(bodies: &[Body], id: u32) -> &Body {
    bodies
        .iter()
        .find(|b| b.id == id)
        .expect("a body the frame was checked to hold")
}

/// Write the point of every body `after` moves, and the orbit of body `id`, the one moved.
fn write_points(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    stored: &[Stored],
    after: &[Body],
    id: u32,
) -> Result<(), OpError> {
    for (old, new) in stored.iter().zip(after) {
        if old.body == *new {
            continue;
        }
        let edit = plan.edit_planet(&s.doc, new.id, system)?;
        if new.id == id && new.orbit != old.body.orbit {
            edit.set_scalar(&[keys::ORBIT], coord(new.orbit))?;
        }
        splice_coordinate(edit, new.at.0, new.at.1)?;
    }
    Ok(())
}

/// The body's orbit and angle about the point it orbits, as the description names them
/// and as a move back takes them. A moon whose parent the save lacks is measured from the
/// system's centre.
fn where_it_was(bodies: &[Body], body: &Body) -> (String, (f64, f64)) {
    let (radius, angle) = match centre(bodies, body) {
        Some(c) => {
            let radius = drawn_radius(body.at, c, Some(body.orbit));
            (radius, written_angle(c, body.at, radius))
        }
        None => {
            let radius = drawn_radius(body.at, (0.0, 0.0), None);
            (radius, written_angle((0.0, 0.0), body.at, radius))
        }
    };
    let text = format!("orbit {} at {}°", number(radius), number(angle));
    (text, (radius, angle))
}

/// ", with its moon #586", naming every body under `id`, or nothing when there is none.
fn with_moons(bodies: &[Body], id: u32) -> String {
    let under: Vec<String> = descendants(bodies, id)
        .into_iter()
        .map(|m| format!("#{m}"))
        .collect();
    match under.as_slice() {
        [] => String::new(),
        [one] => format!(", with its moon {one}"),
        [rest @ .., last] => format!(", with its moons {} and {last}", rest.join(", ")),
    }
}

/// Grow the system's `inner_radius` when something the op puts `reach` from the centre lies
/// further out than any of the system's bodies, `before` as the op found them, or belts, and
/// return the description and inverse the op ends with.
pub(crate) fn grow(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    before: &[Body],
    reach: f64,
    description: String,
    inverse: Op,
) -> Result<Planned, OpError> {
    let radii = s.radii();
    let edit = plan.edit(&s.doc, system)?;
    let entity = edit.entity()?;
    let Some(current) = read::scalar_f64(entity, keys::INNER_RADIUS, &edit.buf) else {
        return Ok(Planned {
            description,
            inverse,
        });
    };
    let reached = system_reach(before, &belts::belt_radii(edit, entity));
    let Some(grown) = radii.grown(reach, reached, current) else {
        return Ok(Planned {
            description,
            inverse,
        });
    };
    let outer = entity.find(keys::OUTER_RADIUS, &edit.buf).is_some();
    edit.set_scalar(&[keys::INNER_RADIUS], coord(grown))?;
    if outer {
        edit.set_scalar(&[keys::OUTER_RADIUS], coord(radii.outer(grown)))?;
    }
    let description = format!(
        "{description}; set the inner radius of system #{system} from {} to {}",
        number(current),
        number(grown)
    );
    Ok(Planned {
        inverse: Op::Batch {
            description: format!("Undo of \"{description}\""),
            ops: vec![
                inverse,
                Op::SetSaveInnerRadius {
                    system,
                    radius: current,
                },
            ],
        },
        description,
    })
}

/// Write `moon_of`, before `moons` or `planet_orbitals` when the body has none, or take it
/// out for a planet.
fn set_moon_of(edit: &mut Edit, parent: Option<u32>) -> Result<(), OpError> {
    let existing = child(edit, &[keys::MOON_OF])?;
    match (parent, existing) {
        (Some(parent), Some(_)) => edit.set_scalar(&[keys::MOON_OF], parent.to_string())?,
        (Some(parent), None) => {
            let next = successor(edit, &[keys::MOONS, keys::PLANET_ORBITALS])?;
            edit.insert_before(next, &format!("{}={parent}", keys::MOON_OF));
        }
        (None, Some(span)) => edit.remove_statement(span),
        (None, None) => {}
    }
    Ok(())
}

/// Set or clear `flag` in the body's `binary_flags`, writing the statement before
/// `coordinate` when the body has none and taking it out when only the bit set beside any
/// other is left.
pub(crate) fn set_flag(edit: &mut Edit, flag: u32, on: bool) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let old = read::scalar_u32(entity, keys::BINARY_FLAGS, &edit.buf);
    let new = if on {
        old.unwrap_or(0) | flag | ANY_FLAG
    } else {
        old.unwrap_or(0) & !flag
    };
    if old == Some(new) || (old.is_none() && !on) {
        return Ok(());
    }
    match child(edit, &[keys::BINARY_FLAGS])? {
        Some(span) if new & !ANY_FLAG == 0 => edit.remove_statement(span),
        Some(_) => edit.set_scalar(&[keys::BINARY_FLAGS], new.to_string())?,
        None => {
            let next = successor(edit, &[keys::ENTITY_PLANET_CLASS, keys::COORDINATE])?;
            edit.insert_before(next, &format!("{}={new}", keys::BINARY_FLAGS));
        }
    }
    Ok(())
}

/// Put `id` in the planet's `moons` in ascending order, writing the list before
/// `planet_orbitals` when the planet has none.
fn list_moon(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let Some(block) = entity.find(keys::MOONS, &edit.buf) else {
        let next = successor(edit, &[keys::PLANET_ORBITALS])?;
        let text = moons_list(&edit.indent(next.start), id);
        edit.insert_before(next, &text);
        return Ok(());
    };
    if block.scalar_span().is_some() {
        return Err(edit.parse_error(block.span().start, "moons is not a block"));
    }
    let items = listed_ids(edit, block);
    match (items.iter().find(|(moon, _)| *moon > id), items.last()) {
        (Some((_, next)), _) => edit.insert(next.start, format!("{id} ").into_bytes()),
        (None, Some((_, last))) => edit.insert(last.end, format!(" {id}").into_bytes()),
        (None, None) => {
            let span = block.span();
            let text = moons_list(&edit.indent(span.start), id);
            edit.replace_statement(span, &text);
        }
    }
    Ok(())
}

/// Take `id` out of the planet's `moons`, and the list with it when nothing else is left.
fn unlist_moon(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let Some(block) = entity.find(keys::MOONS, &edit.buf) else {
        return Ok(());
    };
    let items = listed_ids(edit, block);
    let listed: Vec<Span> = items
        .iter()
        .filter(|(moon, _)| *moon == id)
        .map(|(_, span)| *span)
        .collect();
    if !listed.is_empty() && listed.len() == block.children().len() {
        let span = block.span();
        edit.remove_statement(span);
        return Ok(());
    }
    for item in listed {
        let end = item.end
            + edit.buf[item.end..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
        edit.replace_span(Span::new(item.start, end), Vec::new());
    }
    Ok(())
}

fn listed_ids(edit: &Edit, block: &Node) -> Vec<(u32, Span)> {
    block
        .children()
        .iter()
        .filter(|item| item.key.is_none())
        .filter_map(|item| Some((item.scalar_str(&edit.buf)?.parse().ok()?, item.span())))
        .collect()
}

/// A `moons` list of `id` alone, as a statement whose first line takes `indent` from the
/// line it is written on.
fn moons_list(indent: &[u8], id: u32) -> String {
    let mut w = Lines::new(indent);
    w.list(0, keys::MOONS, &[id]);
    inline(indent, &w.into_bytes())
}

/// The span of the entity's first child keyed by one of `keys`.
fn child(edit: &Edit, keys: &[&str]) -> Result<Option<Span>, OpError> {
    let entity = edit.entity()?;
    Ok(entity
        .children()
        .iter()
        .find(|c| c.key.is_some_and(|k| keys.contains(&edit.text(k))))
        .map(Node::span))
}

/// The statement a new key goes in front of: the first of `keys` the entity holds.
fn successor(edit: &Edit, keys: &[&str]) -> Result<Span, OpError> {
    child(edit, keys)?.ok_or_else(|| edit.parse_error(0, format!("missing {}", keys.join(" or "))))
}

/// A radius or an angle as a description names it: up to two decimals.
fn number(v: f64) -> String {
    let text = format!("{v:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" { "0" } else { text }.to_owned()
}
