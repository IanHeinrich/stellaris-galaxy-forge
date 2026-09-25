//! A save's nebula sections: the centre, the radius, the name block and the
//! `galactic_object` member lines the game never re-derives, which is why every op that
//! changes what a cloud covers rewrites them here.
//!
//! A member line is inserted in id order among the existing ones (the game writes them
//! ascending), so moving a system out and back restores the section byte for byte.
//!
//! A system that enters its first nebula or leaves its last gets or loses what the game
//! dresses a member with ([`super::footprint`]), and the inverse carries what each one
//! had, so that applying it puts those back rather than new ones.
//!
//! A new nebula's name is taken out of the pool of unused nebula names when the pool holds
//! it, a removed one's goes back when an add took it from there, and a rename does both.

use std::collections::{BTreeMap, BTreeSet};

use crate::Span;
use crate::cst::{self, Node};
use crate::emit::{self, NebulaSection, coord};
use crate::format;
use crate::format::save::check_version;
use crate::format::save::write::footprint::{Footprints, is_bare};
use crate::format::save::write::game_tables::is_cloud_kind;
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::write::name_pool;
use crate::keys;
use crate::ops::rules::nebula::{
    Membership, Prospect, all_systems, decide_add, decide_membership, decide_move, decide_name,
    decide_radius, decide_remove, prospective,
};
use crate::ops::rules::{each_once, quoted};
use crate::ops::{Edit, Emitted, NebulaFootprint, Op, OpError, Plan, Planned, Subject, SystemMove};
use crate::plural;
use crate::projections::name::looks_like_key;
use crate::session::Session;

pub(crate) fn plan_move(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    x: f64,
    y: f64,
) -> Result<Planned, OpError> {
    let moved = decide_move(&s.graph, index, x, y)?;
    let (x, y) = moved.to;
    splice_coordinate(plan.edit_nebula(&s.doc, index)?, x, y)?;

    let mut prospective = prospective(&s.graph);
    if let Some(patched) = &mut prospective[index] {
        patched.x = x;
        patched.y = y;
    }
    let changes = decide_membership(&s.graph, &prospective, &all_systems(&s.graph))?;
    let had = write_membership(plan, s, &changes, None)?;
    let description = moved.describe();
    Ok(Planned {
        inverse: restoring(moved.inverse(), had, &description),
        description,
    })
}

/// Keep the member lists in step with `moves`: a member that lands outside its nebula's
/// radius leaves it, and a system joins the nearest cloud its new position falls in.
pub(crate) fn plan_membership(
    plan: &mut Plan,
    s: &Session,
    moves: &[SystemMove],
) -> Result<(Vec<Membership>, Vec<NebulaFootprint>), OpError> {
    let mut subjects: Vec<Prospect> = moves
        .iter()
        .map(|m| Prospect {
            id: m.id,
            x: m.x,
            y: m.y,
        })
        .collect();
    subjects.sort_by_key(|p| p.id);
    let changes = decide_membership(&s.graph, &prospective(&s.graph), &subjects)?;
    let had = write_membership(plan, s, &changes, None)?;
    Ok((changes, had))
}

/// Write the member-line edit each change asks for, leaving out `skip`: the cloud an op
/// is adding, whose members go into its own text, or the one it is erasing, whose lines
/// go with it. A system that enters its first nebula or leaves its last gets or loses its
/// footprint, counting every section that lists it, since a hand-edited save can list one
/// system in two. Returns what those systems carried that an inverse has to put back:
/// each leaver's, and a joiner's when it carried anything.
fn write_membership(
    plan: &mut Plan,
    s: &Session,
    changes: &[Membership],
    skip: Option<usize>,
) -> Result<Vec<NebulaFootprint>, OpError> {
    write_member_lines(plan, s, changes, skip)?;
    if check_version(&s.doc).is_err() {
        return Ok(Vec::new());
    }
    let mut footprints = Footprints::new(&s.doc, &s.graph);
    let erased = skip.filter(|&index| index < s.graph.nebulae.len());
    let mut listed: BTreeMap<u32, (bool, BTreeSet<usize>)> = BTreeMap::new();
    for change in changes {
        let (_, after) = listed.entry(change.system).or_insert_with(|| {
            let now: BTreeSet<usize> = (s.graph.nebulae.iter().enumerate())
                .filter(|(_, nebula)| nebula.systems.contains(&change.system))
                .map(|(index, _)| index)
                .collect();
            (!now.is_empty(), now)
        });
        match change.joined {
            true => after.insert(change.nebula),
            false => after.remove(&change.nebula),
        };
    }
    let mut had = Vec::new();
    for (id, (was, mut after)) in listed {
        if let Some(index) = erased {
            after.remove(&index);
        }
        match (was, !after.is_empty()) {
            (false, true) => {
                let before = footprints.join(plan, id)?;
                if !is_bare(&before) {
                    had.push(before);
                }
            }
            (true, false) => had.push(footprints.leave(plan, id)?),
            _ => {}
        }
    }
    footprints.finish(plan)?;
    Ok(had)
}

/// `inverse`, followed by the [`Op::SetNebulaFootprints`] that puts back what `had` holds
/// when it holds anything, as one step described after the op it undoes.
pub(crate) fn restoring(inverse: Op, had: Vec<NebulaFootprint>, description: &str) -> Op {
    if had.is_empty() {
        return inverse;
    }
    Op::Batch {
        description: format!("Undo of \"{description}\""),
        ops: vec![inverse, Op::SetNebulaFootprints { footprints: had }],
    }
}

fn write_member_lines(
    plan: &mut Plan,
    s: &Session,
    changes: &[Membership],
    skip: Option<usize>,
) -> Result<(), OpError> {
    for change in changes {
        if Some(change.nebula) == skip {
            continue;
        }
        let edit = plan.edit_nebula(&s.doc, change.nebula)?;
        if change.joined {
            insert_member(edit, change.system)?;
        } else {
            remove_member(edit, change.system)?;
        }
    }
    Ok(())
}

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    x: f64,
    y: f64,
    radius: f64,
    name: Option<&str>,
) -> Result<Planned, OpError> {
    let added = decide_add(&s.graph, x, y, radius, name)?;
    let had = write_membership(plan, s, &added.changes, Some(added.index))?;
    let at = format::save::nebula_insert_at(&s.doc);
    let text = emit::nebula_section(
        &section_indent(s),
        &NebulaSection {
            name: &added.name,
            literal: written_literal(&added.name),
            x: added.x,
            y: added.y,
            radius: added.radius,
            members: &added.members,
        },
    );
    plan.emit(Emitted::Nebula(added.index), at, text);
    name_pool::take(plan, &s.doc, &[keys::NEBULA_NAMES], &added.name)?;
    let description = added.describe();
    Ok(Planned {
        inverse: restoring(added.inverse(), had, &description),
        description,
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, index: usize) -> Result<Planned, OpError> {
    let removed = decide_remove(&s.graph, index)?;
    let had = write_membership(plan, s, &removed.changes, Some(index))?;
    let anchor = format::of(s.doc.kind()).statement(&s.doc, Subject::Nebula(index))?;
    plan.erase(&s.doc, Subject::Nebula(index), anchor)?;
    let name = &removed.nebula.name.key;
    let staying = others_named(s, index, name);
    name_pool::give_back(plan, &s.doc, &[keys::NEBULA_NAMES], name, staying)?;
    let description = removed.describe(&s.graph);
    Ok(Planned {
        inverse: restoring(removed.inverse(), had, &description),
        description,
    })
}

pub(crate) fn plan_set_radius(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    radius: f64,
) -> Result<Planned, OpError> {
    let set = decide_radius(&s.graph, index, radius)?;
    let had = write_membership(plan, s, &set.changes, None)?;
    plan.edit_nebula(&s.doc, index)?
        .set_scalar(&[keys::RADIUS], coord(set.to))?;
    let description = set.describe();
    Ok(Planned {
        inverse: restoring(set.inverse(), had, &description),
        description,
    })
}

/// `SetNebulaTurbulent`: every member not already so made turbulent or calm.
pub(crate) fn plan_set_turbulent(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    turbulent: bool,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let nebula = s
        .graph
        .nebulae
        .get(index)
        .ok_or(OpError::UnknownNebula(index))?;
    let name = nebula.display_name();
    let state = if turbulent { "turbulent" } else { "calm" };
    let mut footprints = Footprints::new(&s.doc, &s.graph);
    let mut had = Vec::new();
    let mut homes = Vec::new();
    for &id in &nebula.systems {
        let standing = footprints.read(id)?;
        let target = standing.turbulent(turbulent);
        if target == standing.footprint {
            continue;
        }
        if turbulent && standing.home {
            let system = s.graph.systems.get(&id);
            homes.push(system.map_or_else(|| id.to_string(), |sys| sys.display_name()));
        }
        footprints.set(plan, &standing, &target)?;
        had.push(standing.footprint);
    }
    if had.is_empty() {
        return Err(OpError::TurbulenceUnchanged {
            nebula: name,
            state,
        });
    }
    footprints.finish(plan)?;
    let mut description = format!(
        "Made {name} {state}: {} changed",
        plural(had.len(), "system")
    );
    if !homes.is_empty() {
        let verb = match homes.len() {
            1 => "is an empire's home system",
            _ => "are empires' home systems",
        };
        description.push_str(&format!(
            "; {} {verb}, which the game never makes turbulent",
            homes.join(", ")
        ));
    }
    Ok(Planned {
        description,
        inverse: Op::SetNebulaFootprints { footprints: had },
    })
}

/// `SetNebulaFootprints`: each system's footprint set as given.
pub(crate) fn plan_set_footprints(
    plan: &mut Plan,
    s: &Session,
    targets: &[NebulaFootprint],
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    each_once(targets, |f| f.system)?;
    let mut footprints = Footprints::new(&s.doc, &s.graph);
    let mut had = Vec::new();
    for target in targets {
        if let Some(cloud) = target.cloud.as_ref().filter(|c| !is_cloud_kind(&c.kind)) {
            return Err(OpError::InvalidCloudType(cloud.kind.clone()));
        }
        let standing = footprints.read(target.system)?;
        footprints.set(plan, &standing, target)?;
        had.push(standing.footprint);
    }
    footprints.finish(plan)?;
    Ok(Planned {
        description: format!(
            "Set the nebula clouds and modifiers of {}",
            plural(targets.len(), "system")
        ),
        inverse: Op::SetNebulaFootprints { footprints: had },
    })
}

/// A save keeps the name in the `name={ key="…" }` block the section carries.
pub(crate) fn plan_set_name(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    name: &str,
) -> Result<Planned, OpError> {
    let mut set = decide_name(&s.graph, index, name)?;
    let literal = written_literal(&set.to);
    let edit = plan.edit_nebula(&s.doc, index)?;
    let block = edit
        .entity()?
        .find(keys::NAME, &edit.buf)
        .ok_or_else(|| edit.parse_error(0, "the nebula has no name"))?;
    let key = block
        .find(keys::KEY, &edit.buf)
        .ok_or_else(|| edit.parse_error(block.span().start, "the name holds no key"))?
        .span();
    let flag = block.find(keys::LITERAL, &edit.buf).map(Node::span);
    let variables = block.find(keys::VARIABLES, &edit.buf).map(Node::span);
    // The flag is written and erased a line at a time, beside the key's own line.
    edit.require_alone_on_line(key, "the name's key")?;
    for (span, what) in [
        (flag, "the name's literal flag"),
        (variables, "the name's variables"),
    ] {
        if let Some(span) = span {
            edit.require_alone_on_line(span, what)?;
        }
    }
    let (after_key, indent) = (edit.line_end(key.end), edit.indent(key.start));

    edit.set_scalar(&[keys::NAME, keys::KEY], quoted(&set.to))?;
    match (literal, flag) {
        (true, None) => edit.insert(after_key, emit::literal_line(&indent)),
        (true, Some(_)) => edit.set_scalar(&[keys::NAME, keys::LITERAL], "yes")?,
        (false, Some(span)) => edit.remove_lines(span),
        (false, None) => {}
    }
    // The new name is one text, not a format string: whatever the old one substituted
    // into has nowhere left to go.
    if let Some(span) = variables {
        edit.remove_lines(span);
        set.dropped_variables = true;
    }
    let staying = others_named(s, index, &set.from);
    name_pool::swap(
        plan,
        &s.doc,
        &[keys::NEBULA_NAMES],
        (&set.from, &set.to),
        staying,
    )?;
    Ok(Planned {
        description: set.describe(),
        inverse: set.inverse(),
    })
}

/// How many nebulae besides the `index`th are named `name`: a pool entry taken for the
/// name stays taken for each of them. Every nebula counts, the file's own included, since
/// a rename can give one of those a pooled name, where only an added system holds one.
fn others_named(s: &Session, index: usize, name: &str) -> usize {
    s.graph
        .nebulae
        .iter()
        .enumerate()
        .filter(|&(i, nebula)| i != index && nebula.name.key == name)
        .count()
}

/// Whether a name is written `literal=yes`: one the user typed rather than a localisation
/// key, which the game would otherwise look up and draw as the raw key or as nothing.
pub(crate) fn written_literal(name: &str) -> bool {
    !name.is_empty() && !looks_like_key(name)
}

/// A new section is indented like the last nebula the file holds; a save writes its
/// top-level sections at column 0, so that is normally nothing at all.
fn section_indent(s: &Session) -> Vec<u8> {
    match s.doc.index().sections_named(keys::NEBULA).last() {
        Some(last) => cst::indent_of(s.doc.original(), last.stmt.start).to_vec(),
        None => Vec::new(),
    }
}

/// Delete every `galactic_object=<id>` line of the section.
fn remove_member(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let removing: Vec<Span> = entity
        .find_all(keys::GALACTIC_OBJECT, &edit.buf)
        .filter(|n| member_id(n, &edit.buf) == Some(id))
        .map(Node::span)
        .collect();
    if removing.is_empty() {
        return Err(edit.parse_error(entity.span().start, format!("system {id} is not a member")));
    }
    for &span in &removing {
        edit.require_alone_on_line(span, "member line")?;
    }
    for span in removing {
        edit.remove_lines(span);
    }
    Ok(())
}

/// Add a `galactic_object=<id>` line before the first member with a larger id, else after
/// the last member, else after `radius=`, copying that line's indentation.
fn insert_member(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let members: Vec<&Node> = entity.find_all(keys::GALACTIC_OBJECT, &edit.buf).collect();
    let (at, indent) = if let Some(next) = members
        .iter()
        .find(|n| member_id(n, &edit.buf).is_some_and(|m| m > id))
    {
        let start = next.span().start;
        (edit.line_start(start), edit.indent(start))
    } else if let Some(last) = members.last() {
        let span = last.span();
        (edit.line_end(span.end), edit.indent(span.start))
    } else if let Some(radius) = entity.find(keys::RADIUS, &edit.buf) {
        let span = radius.span();
        (edit.line_end(span.end), edit.indent(span.start))
    } else {
        edit.before_close(entity)
    };
    edit.insert(at, emit::member_line(&indent, id));
    Ok(())
}

fn member_id(node: &Node, buf: &[u8]) -> Option<u32> {
    node.scalar_str(buf)?.parse().ok()
}
