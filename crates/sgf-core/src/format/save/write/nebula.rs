//! A save's nebula sections: the centre, the radius, the name block and the
//! `galactic_object` member lines the game never re-derives, which is why every op that
//! changes what a cloud covers rewrites them here.
//!
//! A member line is inserted in id order among the existing ones (the game writes them
//! ascending), so moving a system out and back restores the section byte for byte.
//!
//! A new nebula's name is taken out of the pool of unused nebula names when the pool holds
//! it, a removed one's goes back when an add took it from there, and a rename does both.

use crate::Span;
use crate::cst::{self, Node};
use crate::emit::{self, NebulaSection, coord};
use crate::format;
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::write::name_pool;
use crate::keys;
use crate::ops::rules::nebula::{
    Membership, Prospect, all_systems, decide_add, decide_membership, decide_move, decide_name,
    decide_radius, decide_remove, prospective,
};
use crate::ops::rules::quoted;
use crate::ops::{Edit, Emitted, OpError, Plan, Planned, Subject, SystemMove};
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
    write_membership(plan, s, &changes, None)?;

    Ok(Planned {
        description: moved.describe(),
        inverse: moved.inverse(),
    })
}

/// Keep the member lists in step with `moves`: a member that lands outside its nebula's
/// radius leaves it, and a system joins the nearest cloud its new position falls in.
pub(crate) fn plan_membership(
    plan: &mut Plan,
    s: &Session,
    moves: &[SystemMove],
) -> Result<Vec<Membership>, OpError> {
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
    write_membership(plan, s, &changes, None)?;
    Ok(changes)
}

/// Write the member-line edit each change asks for, leaving out `skip`: the cloud an op
/// is adding, whose members go into its own text, or the one it is erasing, whose lines
/// go with it.
fn write_membership(
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
    write_membership(plan, s, &added.changes, Some(added.index))?;
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
    Ok(Planned {
        description: added.describe(),
        inverse: added.inverse(),
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, index: usize) -> Result<Planned, OpError> {
    let removed = decide_remove(&s.graph, index)?;
    write_membership(plan, s, &removed.changes, Some(index))?;
    let anchor = format::of(s.doc.kind()).statement(&s.doc, Subject::Nebula(index))?;
    plan.erase(&s.doc, Subject::Nebula(index), anchor)?;
    let name = &removed.nebula.name.key;
    let staying = others_named(s, index, name);
    name_pool::give_back(plan, &s.doc, &[keys::NEBULA_NAMES], name, staying)?;
    Ok(Planned {
        description: removed.describe(&s.graph),
        inverse: removed.inverse(),
    })
}

pub(crate) fn plan_set_radius(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    radius: f64,
) -> Result<Planned, OpError> {
    let set = decide_radius(&s.graph, index, radius)?;
    write_membership(plan, s, &set.changes, None)?;
    plan.edit_nebula(&s.doc, index)?
        .set_scalar(&[keys::RADIUS], coord(set.to))?;
    Ok(Planned {
        description: set.describe(),
        inverse: set.inverse(),
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
        (true, None) => {
            let mut text = indent;
            text.extend_from_slice(
                b"literal=yes
",
            );
            edit.insert_lines(after_key, text);
        }
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
        let close = entity.value_span().end - 1;
        let mut indent = edit.indent(close);
        indent.push(b'\t');
        (edit.line_start(close), indent)
    };
    let mut text = indent;
    text.extend_from_slice(keys::GALACTIC_OBJECT.as_bytes());
    text.push(b'=');
    text.extend_from_slice(id.to_string().as_bytes());
    text.push(b'\n');
    edit.insert_lines(at, text);
    Ok(())
}

fn member_id(node: &Node, buf: &[u8]) -> Option<u32> {
    node.scalar_str(buf)?.parse().ok()
}
