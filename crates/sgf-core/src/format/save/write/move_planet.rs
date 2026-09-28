//! `MoveSavePlanet`: a save planet and its moons taken from one system into another. The
//! `planet=` lines move between the two `galactic_object` entities, and each body's
//! `coordinate` takes the new `origin`. A moon moved on its own leaves its parent's `moons`
//! and becomes a planet. The colony of each colonised body moves between
//! the two systems' `colonies`, and the station fleet of each body with one moves between
//! their `fleet_presence`, its ships with it. The game re-anchors no fleet on load. No
//! other fleet is touched.

use crate::Span;
use crate::cst::Node;
use crate::emit::system::{MOON_FLAG, planet_lines};
use crate::emit::{Lines, coord, inline};
use crate::format::save::read_spec::{bodies as listed, written_angle};
use crate::format::save::write::belts;
use crate::format::save::write::bodies::{frame, grow, set_flag, set_moon_of, unlist_moon};
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::{
    check_version, entity, entity_at, planet_entity, planet_system, system_statement,
};
use crate::keys;
use crate::ops::rules::bodies::{
    Body, angle_about, check_placement, descendants, drawn_radius, normalised, point, system_reach,
};
use crate::ops::{Edit, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::Value;
use crate::session::Session;
use crate::views::{
    DocumentKind, OrbitPlacement, PlanetMoveCheck, PlanetMoveTarget, PlanetMoveTargets,
    PlanetMoveWarning, PlanetMoveWarningKind, PlanetRefusal,
};

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
    at: Option<OrbitPlacement>,
) -> Result<Planned, OpError> {
    let from = origin(s, planet)?;
    if !s.graph.systems.contains_key(&to) {
        return Err(OpError::UnknownSystem(to));
    }
    if from == to {
        return Err(OpError::AlreadyInSystem { planet, system: to });
    }
    if let Some(at) = at {
        check_placement(at.radius, at.angle)?;
    }
    let Leaving {
        body,
        moon,
        source,
        moons,
        moved,
        colonies,
        stations,
        ..
    } = leaving(s, planet, from)?;
    if listed(&s.doc, to)?.is_empty() {
        return Err(OpError::NoBodies(to));
    }

    let before: Vec<Body> = frame(s, to)?.into_iter().map(|b| b.body).collect();
    let (orbit, angle) = match at {
        Some(at) => (at.radius, normalised(at.angle)),
        None => {
            let edit = plan.edit(&s.doc, to)?;
            let belt_radii = belts::belt_radii(edit, edit.entity()?);
            let extent = moons
                .iter()
                .filter_map(|&m| source.iter().find(|b| b.id == m))
                .map(|m| drawn_radius(m.at, body.at, Some(m.orbit)))
                .fold(0.0, f64::max);
            let reach = system_reach(&before, &belt_radii);
            let orbit = (reach + s.radii().inner_offset + extent).ceil();
            (orbit, angle_about((0.0, 0.0), body.at))
        }
    };
    let at = point((0.0, 0.0), orbit, angle);
    let step = (at.0 - body.at.0, at.1 - body.at.1);

    unlist_planets(plan.edit(&s.doc, from)?, &moved)?;
    list_planets(plan.edit(&s.doc, to)?, &moved)?;
    unlist(plan.edit(&s.doc, from)?, keys::COLONIES, &colonies);
    list(plan.edit(&s.doc, to)?, &COLONIES_AT, &colonies)?;
    unlist(plan.edit(&s.doc, from)?, keys::FLEET_PRESENCE, &stations);
    list(plan.edit(&s.doc, to)?, &FLEETS_AT, &stations)?;
    for &station in &stations {
        move_fleet(plan, s, station, [from, to], Some(step))?;
    }
    if let Some(parent) = body.parent.filter(|&p| source.iter().any(|b| b.id == p)) {
        unlist_moon(plan.edit_planet(&s.doc, parent, from)?, planet)?;
    }

    let edit = plan.edit_planet(&s.doc, planet, to)?;
    if body.parent.is_some() {
        set_moon_of(edit, None)?;
        set_flag(edit, MOON_FLAG, false)?;
    }
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
    let (label, becomes) = if moon {
        ("moon", " as a planet")
    } else {
        ("planet", "")
    };
    let description = format!(
        "Moved {label} #{planet}{carrying}{stationed} from system #{from} to system #{to}{becomes}, at orbit {}",
        coord(orbit)
    );
    let radius = drawn_radius(body.at, (0.0, 0.0), Some(body.orbit));
    let was = OrbitPlacement {
        radius,
        angle: written_angle((0.0, 0.0), body.at, radius),
    };
    // Undo replays bytes: this inverse puts the planet back at its old point in its old
    // system, not at its old place in the lists nor under the body it orbited.
    let inverse = Op::MoveSavePlanet {
        planet,
        to: from,
        at: Some(was),
    };
    grow(plan, s, to, &before, reach, description, inverse)
}

/// Where the planets of `planets` may move together: see [`PlanetMoveTargets`].
pub(crate) fn targets(s: &Session, planets: &[u32]) -> PlanetMoveTargets {
    let planets = normalised_set(s, planets);
    let mut refused = Vec::new();
    let mut sources = Vec::new();
    let mut claims = Vec::new();
    for &planet in &planets {
        let checked = supported(s)
            .and_then(|()| origin(s, planet))
            .and_then(|from| Ok((from, leaving(s, planet, from)?)));
        match checked {
            Ok((from, leaving)) => {
                sources.push(from);
                claims.extend(leaving.claims);
            }
            Err(error) => refused.push(PlanetRefusal {
                planet,
                reason: error.to_string(),
            }),
        }
    }
    if !refused.is_empty() || planets.is_empty() {
        return PlanetMoveTargets {
            planets,
            refused,
            ..PlanetMoveTargets::default()
        };
    }
    let mut systems: Vec<PlanetMoveTarget> = s
        .graph
        .systems
        .values()
        .filter(|system| !sources.contains(&system.id))
        .filter(|system| listed(&s.doc, system.id).is_ok_and(|bodies| !bodies.is_empty()))
        .map(|system| PlanetMoveTarget {
            system: system.id,
            warnings: handed_over(&claims, system.owner),
        })
        .collect();
    systems.sort_unstable_by_key(|target| target.system);
    PlanetMoveTargets {
        planets,
        systems,
        ..PlanetMoveTargets::default()
    }
}

/// What moving `planets` to system `to` hands to the country that owns it; nothing for a
/// planet that cannot move.
pub(crate) fn warnings(s: &Session, planets: &[u32], to: u32) -> Vec<PlanetMoveWarning> {
    let claims: Vec<Claim> = normalised_set(s, planets)
        .into_iter()
        .filter_map(|planet| leaving(s, planet, origin(s, planet).ok()?).ok())
        .flat_map(|leaving| leaving.claims)
        .collect();
    handed_over(&claims, s.graph.systems.get(&to).and_then(|n| n.owner))
}

/// The claims of `claims` a system owned by `holder` takes over: none when nobody owns
/// it, since a colony in unowned space stays its owner's.
fn handed_over(claims: &[Claim], holder: Option<u32>) -> Vec<PlanetMoveWarning> {
    let Some(holder) = holder else {
        return Vec::new();
    };
    claims
        .iter()
        .filter(|claim| claim.owner != holder)
        .map(|claim| PlanetMoveWarning {
            planet: claim.planet,
            kind: claim.kind,
            owner: claim.owner,
            new_owner: holder,
        })
        .collect()
}

/// A moved body's colony, or the station through which a country controls it.
struct Claim {
    planet: u32,
    kind: PlanetMoveWarningKind,
    owner: u32,
}

/// The op that moves `planets` to system `to`, as [`targets`] lists them: the first at
/// `at` when given, the rest each on the next free outer orbit.
pub(crate) fn move_op(
    s: &Session,
    planets: &[u32],
    to: u32,
    at: Option<OrbitPlacement>,
) -> Result<Op, OpError> {
    let mut ops = member_ops(s, planets, to, at)?;
    if ops.len() == 1 {
        return Ok(ops.remove(0));
    }
    Ok(Op::Batch {
        description: format!("Moved {} planets to system #{to}", ops.len()),
        ops,
    })
}

/// Why [`move_op`] would be refused, or else what it hands to the country owning `to`.
/// Each member is planned against the session as it stands and the plan dropped: once
/// the set is normalised, no member's refusal depends on the members before it.
pub(crate) fn check(
    s: &Session,
    planets: &[u32],
    to: u32,
    at: Option<OrbitPlacement>,
) -> PlanetMoveCheck {
    let refusal = member_ops(s, planets, to, at).and_then(|ops| {
        ops.iter()
            .try_for_each(|op| s.format().write(&mut Plan::new(), s, op).map(drop))
    });
    match refusal {
        Ok(()) => PlanetMoveCheck {
            refusal: None,
            warnings: warnings(s, planets, to),
        },
        Err(e) => PlanetMoveCheck {
            refusal: Some(e.to_string()),
            warnings: Vec::new(),
        },
    }
}

/// One [`Op::MoveSavePlanet`] per planet of the normalised set, the first at `at`.
fn member_ops(
    s: &Session,
    planets: &[u32],
    to: u32,
    at: Option<OrbitPlacement>,
) -> Result<Vec<Op>, OpError> {
    let planets = normalised_set(s, planets);
    if planets.is_empty() {
        return Err(OpError::NoPlanets);
    }
    Ok(planets
        .iter()
        .enumerate()
        .map(|(i, &planet)| Op::MoveSavePlanet {
            planet,
            to,
            at: if i == 0 { at } else { None },
        })
        .collect())
}

/// `planets` without repeats, and without a body whose parent, at any depth, is also
/// among them.
fn normalised_set(s: &Session, planets: &[u32]) -> Vec<u32> {
    let mut kept = Vec::new();
    for &planet in planets {
        if !kept.contains(&planet) && !parents(s, planet).iter().any(|p| planets.contains(p)) {
            kept.push(planet);
        }
    }
    kept
}

/// The chain of `moon_of` bodies above `planet`, nearest first.
fn parents(s: &Session, planet: u32) -> Vec<u32> {
    let mut chain = Vec::new();
    let mut at = planet;
    while let Ok((node, src)) = planet_entity(&s.doc, at)
        && let Some(parent) = read::scalar_u32(&node, keys::MOON_OF, src)
        && parent != planet
        && !chain.contains(&parent)
    {
        chain.push(parent);
        at = parent;
    }
    chain
}

/// Refuse a document other than a save, as the scenario format refuses the op.
fn supported(s: &Session) -> Result<(), OpError> {
    match s.kind() {
        DocumentKind::Save => Ok(()),
        kind => Err(OpError::Unsupported {
            op: "MoveSavePlanet",
            kind,
        }),
    }
}

/// The system planet `planet` stands in, once the save's version is checked.
fn origin(s: &Session, planet: u32) -> Result<u32, OpError> {
    check_version(&s.doc)?;
    let (node, src) = planet_entity(&s.doc, planet)?;
    planet_system(&node, src, planet)
}

/// A planet that may leave its system, and what goes with it.
struct Leaving {
    body: Body,
    /// It holds the moon bit.
    moon: bool,
    /// The bodies of its system.
    source: Vec<Body>,
    moons: Vec<u32>,
    /// The planet, then its moons.
    moved: Vec<u32>,
    colonies: Vec<u32>,
    stations: Vec<u32>,
    claims: Vec<Claim>,
}

/// Check that `planet` may leave system `from`, wherever it goes.
fn leaving(s: &Session, planet: u32, from: u32) -> Result<Leaving, OpError> {
    let source: Vec<Body> = frame(s, from)?.into_iter().map(|b| b.body).collect();
    let body = *source
        .iter()
        .find(|b| b.id == planet)
        .ok_or(OpError::NotABody {
            planet,
            system: from,
        })?;
    let moons = descendants(&source, planet);
    let moon = check_movable(s, &source, &body, &moons)?;
    let moved: Vec<u32> = std::iter::once(planet)
        .chain(moons.iter().copied())
        .collect();
    let mut colonies = Vec::new();
    let mut stations = Vec::new();
    let mut claims = Vec::new();
    for &id in &moved {
        let (node, src) = planet_entity(&s.doc, id)?;
        if node.find(keys::MEGASTRUCTURE, src).is_some() {
            return Err(OpError::MegastructurePlanet(id));
        }
        check_controller(&node, src, id)?;
        let owner = read::scalar_u32(&node, keys::OWNER, src);
        let colony = read::scalar_u32(&node, keys::COLONY, src);
        if let (Some(owner), Some(_)) = (owner, colony) {
            claims.push(Claim {
                planet: id,
                kind: PlanetMoveWarningKind::Colony,
                owner,
            });
        }
        colonies.extend(colony);
        let station = read::scalar_u32(&node, keys::SHIPCLASS_ORBITAL_STATION, src)
            .filter(|&fleet| stationed(s, fleet, from));
        if let (Some(_), Some(controller)) =
            (station, read::scalar_u32(&node, keys::CONTROLLER, src))
        {
            claims.push(Claim {
                planet: id,
                kind: PlanetMoveWarningKind::Station,
                owner: controller,
            });
        }
        stations.extend(station);
    }
    Ok(Leaving {
        body,
        moon,
        source,
        moons,
        moved,
        colonies,
        stations,
        claims,
    })
}

/// Refuse a star: the system's primary, a body of a star's class, or a body others orbit
/// without the moon bit. Returns whether the body is a moon: it orbits a planet, or holds
/// the moon bit and orbits a body the save has lost.
fn check_movable(s: &Session, frame: &[Body], body: &Body, moons: &[u32]) -> Result<bool, OpError> {
    let (node, src) = planet_entity(&s.doc, body.id)?;
    if is_star(frame, body.id, &node, src) {
        return Err(OpError::StarNotMovable(body.id));
    }
    let moon = match body.parent.map(|p| (p, planet_entity(&s.doc, p))) {
        None => false,
        Some((parent, Ok((node, src)))) => !is_star(frame, parent, &node, src),
        Some((_, Err(_))) => {
            read::scalar_u32(&node, keys::BINARY_FLAGS, src).is_some_and(|f| f & MOON_FLAG != 0)
        }
    };
    for &id in moons {
        let (node, src) = planet_entity(&s.doc, id)?;
        let flags = read::scalar_u32(&node, keys::BINARY_FLAGS, src).unwrap_or(0);
        if flags & MOON_FLAG == 0 {
            return Err(OpError::StarNotMovable(body.id));
        }
    }
    Ok(moon)
}

/// Refuse an owned planet that another country controls. An owned planet goes to any
/// system: the game hands a colony in another empire's territory to that empire.
fn check_controller(node: &Node, src: &[u8], planet: u32) -> Result<(), OpError> {
    let Some(owner) = read::scalar_u32(node, keys::OWNER, src) else {
        return Ok(());
    };
    match read::scalar_u32(node, keys::CONTROLLER, src) {
        Some(controller) if controller != owner => Err(OpError::PlanetOccupied {
            planet,
            owner,
            controller,
        }),
        _ => Ok(()),
    }
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

/// Whether body `id` of `frame`, whose entity is `node`, is a star: the system's primary
/// or a body of a star's class.
fn is_star(frame: &[Body], id: u32, node: &Node, src: &[u8]) -> bool {
    frame.first().is_some_and(|primary| primary.id == id)
        || is_star_class(&read::text(node, keys::PLANET_CLASS, src))
}

/// Whether fleet `fleet` is a fleet of the save standing in system `from`: its
/// `movement_manager.coordinate` names `from`. A station fleet that is gone, or stands
/// elsewhere, stays out of both systems' `fleet_presence`.
fn stationed(s: &Session, fleet: u32, from: u32) -> bool {
    let Some(anchor) = record(s, keys::FLEET, fleet) else {
        return false;
    };
    let Ok(Some((node, src))) = entity_at(&s.doc, anchor) else {
        return false;
    };
    node.find(keys::MOVEMENT_MANAGER, src)
        .and_then(|m| m.find(keys::COORDINATE, src))
        .and_then(|c| read::scalar_u32(c, keys::ORIGIN, src))
        == Some(from)
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
/// null one included, is left as it stands.
pub(crate) fn move_fleet(
    plan: &mut Plan,
    s: &Session,
    fleet: u32,
    [from, to]: [u32; 2],
    step: Option<(f64, f64)>,
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
        step,
    )?;
    shift(edit, &[keys::COMBAT, keys::COORDINATE], systems, None)?;
    let ships = read::ids(edit.entity()?, keys::SHIPS, &edit.buf);
    for ship in ships {
        let Some(anchor) = record(s, keys::SHIPS, ship) else {
            continue;
        };
        let edit = plan.edit_record(&s.doc, anchor)?;
        shift(edit, &[keys::COORDINATE], systems, step)?;
        shift(edit, &[keys::TARGET_COORDINATE], systems, step)?;
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
