//! Fallen empire zones: the `set_star_flag`s in a system's `effect` block that Paint a
//! Galaxy seats a fallen empire by. The zone's flags come out whole and go back in at
//! the end of the block, in the shape its statements are written in; the other flags
//! and every other statement of the block stay byte for byte.

use std::collections::BTreeSet;

use super::spawn::{insert_after, starts_line};
use crate::Span;
use crate::format::scenario::fe_zone::{FeZone, SET_STAR_FLAG, flags, is_zone_flag};
use crate::keys::scenario as keys;
use crate::ops::rules::fe_zone::{decide_set, label};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::projections::galaxy::SystemNode;
use crate::session::Session;

pub(super) fn set_zone(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    zone: Option<&FeZone>,
) -> Result<Planned, OpError> {
    let (description, previous) = write_zone(plan, s, id, zone)?;
    Ok(Planned {
        description,
        inverse: Op::SetFeZone {
            id,
            zone: previous.1,
        },
    })
}

pub(super) fn set_zones(
    plan: &mut Plan,
    s: &Session,
    entries: &[(u32, Option<FeZone>)],
) -> Result<Planned, OpError> {
    if entries.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    for (id, _) in entries {
        if !seen.insert(*id) {
            return Err(OpError::DuplicateSystem(*id));
        }
    }
    let mut previous = Vec::with_capacity(entries.len());
    for (id, zone) in entries {
        let (_, was) = write_zone(plan, s, *id, zone.as_ref())?;
        previous.push(was);
    }
    Ok(Planned {
        description: "Recompute automatic fallen empire zones".to_owned(),
        inverse: Op::SetFeZones { entries: previous },
    })
}

/// Write one system's zone, returning what to call the change and the entry that puts
/// it back.
fn write_zone(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    zone: Option<&FeZone>,
) -> Result<(String, (u32, Option<FeZone>)), OpError> {
    decide_set(&s.graph, id, zone)?;
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let previous = system.fe_zone.clone();
    let description = describe(system, zone);
    let edit = plan.edit(&s.doc, id)?;
    match (block(edit)?, zone) {
        (Some(block), Some(zone)) => {
            for span in &block.zone_flags {
                edit.remove_statement(*span);
            }
            for flag in flags(zone) {
                append(edit, &block, &statement(&flag));
            }
        }
        (Some(block), None) if block.zone_flags.len() == block.children => {
            edit.remove_statement(block.statement);
        }
        (Some(block), None) => {
            for span in &block.zone_flags {
                edit.remove_statement(*span);
            }
        }
        (None, Some(zone)) => {
            let statements: Vec<String> = flags(zone).iter().map(|f| statement(f)).collect();
            let text = format!("{} = {{ {} }}", keys::EFFECT, statements.join(" "));
            let last = edit
                .entity()?
                .children()
                .last()
                .ok_or_else(|| edit.parse_error(0, "empty system"))?
                .span()
                .end;
            insert_after(edit, last, &text);
        }
        (None, None) => {}
    }
    Ok((description, (id, previous)))
}

fn describe(system: &SystemNode, zone: Option<&FeZone>) -> String {
    let label = label(system);
    match (system.fe_zone.is_some(), zone.is_some()) {
        (false, true) => format!("Add fallen empire zone to {label}"),
        (true, false) => format!("Remove fallen empire zone from {label}"),
        (_, _) => format!("Change fallen empire zone of {label}"),
    }
}

fn statement(flag: &str) -> String {
    format!("{SET_STAR_FLAG} = {flag}")
}

/// The `effect` block of the statement being edited, as spans: the CST borrows the
/// buffer the splices then rewrite, so nothing but offsets is carried out of it.
struct Block {
    /// `effect = { … }`, key through closing brace.
    statement: Span,
    /// The braces and what stands between them.
    value: Span,
    /// How many statements the block holds.
    children: usize,
    last_child: Option<Span>,
    /// The `set_star_flag` statements naming a zone flag, in file order.
    zone_flags: Vec<Span>,
}

fn block(edit: &Edit) -> Result<Option<Block>, OpError> {
    let Some(node) = edit.entity()?.find(keys::EFFECT, &edit.buf) else {
        return Ok(None);
    };
    if node.scalar_span().is_some() {
        return Err(edit.parse_error(node.span().start, "effect is not a block"));
    }
    Ok(Some(Block {
        statement: node.span(),
        value: node.value_span(),
        children: node.children().len(),
        last_child: node.children().last().map(|child| child.span()),
        zone_flags: node
            .find_all(SET_STAR_FLAG, &edit.buf)
            .filter(|flag| flag.scalar_str(&edit.buf).is_some_and(is_zone_flag))
            .map(|flag| flag.span())
            .collect(),
    }))
}

/// Write `text` as the block's last statement, in the shape the one standing last is
/// written in. A flag removed from that place is removed up to where it ended, so a
/// statement written there follows what stands before it.
fn append(edit: &mut Edit, block: &Block, text: &str) {
    match block.last_child {
        Some(child) if starts_line(edit, child.start) => {
            let indent = edit.indent(child.start);
            let line = [&indent[..], text.as_bytes(), b"\n"].concat();
            let at = edit.line_end(child.end);
            edit.insert_lines(at, line);
        }
        Some(child) => edit.insert(child.end, format!(" {text}").into_bytes()),
        None => edit.insert(block.value.start + 1, format!(" {text}").into_bytes()),
    }
}
