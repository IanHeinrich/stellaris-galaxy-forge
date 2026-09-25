//! Lane ops: `AddLane`, `AddLanes`, `RemoveLane`, `RemoveLanes`, `SetLaneLength`,
//! `NormaliseLaneLength`, `IsolateSystem`.
//!
//! Inserted text copies the indentation of the lines it lands next to; removed
//! entries take their single-space separator line with them, and a `hyperlane`
//! block left empty is removed whole, as the game omits it.

use crate::emit::{coord, hyperlane_block, lane_entry};
use crate::format::save::write::bulk;
use crate::keys;
use crate::ops::rules::lanes as rules;
use crate::ops::{Edit, LaneLength, Op, OpError, Plan, Planned};
use crate::plural;
use crate::projections::galaxy::bypass_between;
use crate::projections::galaxy::{GalaxyGraph, lane_length};
use crate::session::Session;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
    bridge: bool,
) -> Result<Planned, OpError> {
    let length = rules::check_new_lane(&s.graph, a, b)?;
    insert_entries(plan.edit(&s.doc, a)?, &[(b, length, bridge)])?;
    insert_entries(plan.edit(&s.doc, b)?, &[(a, length, bridge)])?;
    Ok(Planned {
        description: format!(
            "Added {}lane {a} <-> {b} (length {length})",
            if bridge { "bridge " } else { "" }
        ),
        inverse: Op::RemoveLane { a, b },
    })
}

pub(crate) fn plan_add_many(
    plan: &mut Plan,
    s: &Session,
    from: u32,
    to: &[(u32, bool)],
) -> Result<Planned, OpError> {
    if to.is_empty() {
        return Err(OpError::Empty);
    }
    let mut entries = Vec::with_capacity(to.len());
    for (i, &(other, bridge)) in to.iter().enumerate() {
        if to[..i].iter().any(|&(seen, _)| seen == other) {
            return Err(OpError::LaneExists(from, other));
        }
        let length = rules::check_new_lane(&s.graph, from, other)?;
        entries.push((other, length, bridge));
        insert_entries(plan.edit(&s.doc, other)?, &[(from, length, bridge)])?;
    }
    insert_entries(plan.edit(&s.doc, from)?, &entries)?;
    let ids: Vec<String> = to.iter().map(|(id, _)| id.to_string()).collect();
    Ok(Planned {
        description: format!(
            "Added {} from {from} to {}",
            plural(to.len(), "lane"),
            ids.join(", ")
        ),
        inverse: Op::RemoveLanes {
            from,
            to: to.iter().map(|&(id, _)| id).collect(),
        },
    })
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
) -> Result<Planned, OpError> {
    let restore = rules::decide_remove_pairs(&s.graph, &[(a, b)])?;
    let bridge = restore.first().ok_or(OpError::NoSuchLane(a, b))?.bridge;
    let mut removed = remove_entries(plan.edit(&s.doc, a)?, &[b])?;
    if b != a {
        removed += remove_entries(plan.edit(&s.doc, b)?, &[a])?;
    }
    Ok(Planned {
        description: format!(
            "Removed lane {a} <-> {b} ({removed} entries){}",
            wayline_note(&s.graph, &[(a, b)])
        ),
        inverse: Op::AddLane { a, b, bridge },
    })
}

pub(crate) fn plan_remove_many(
    plan: &mut Plan,
    s: &Session,
    from: u32,
    to: &[u32],
) -> Result<Planned, OpError> {
    let pairs: Vec<(u32, u32)> = to.iter().map(|&other| (from, other)).collect();
    let restore = rules::decide_remove_pairs(&s.graph, &pairs)?;
    let mut removed = remove_entries(plan.edit(&s.doc, from)?, to)?;
    for &other in to {
        if other != from && s.graph.systems.contains_key(&other) {
            removed += remove_entries(plan.edit(&s.doc, other)?, &[from])?;
        }
    }
    let ids: Vec<String> = to.iter().map(u32::to_string).collect();
    Ok(Planned {
        description: format!(
            "Removed {} from {from} to {} ({removed} entries){}",
            plural(to.len(), "lane"),
            ids.join(", "),
            wayline_note(&s.graph, &pairs)
        ),
        inverse: Op::AddLanes {
            from,
            to: restore
                .iter()
                .filter(|l| l.b != from)
                .map(|l| (l.b, l.bridge))
                .collect(),
        },
    })
}

pub(crate) fn plan_set_length(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
    length: f64,
) -> Result<Planned, OpError> {
    let (old, updated) = set_one_length(plan, s, a, b, length)?;
    Ok(Planned {
        description: format!(
            "Set lane {a} <-> {b} length from {} to {} ({updated} entries)",
            coord(old),
            coord(length)
        ),
        inverse: Op::SetLaneLength { a, b, length: old },
    })
}

pub(crate) fn plan_normalise_length(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
) -> Result<Planned, OpError> {
    if a == b {
        return Err(OpError::SelfLane(a));
    }
    let sa = s.graph.systems.get(&a).ok_or(OpError::UnknownSystem(a))?;
    let sb = s.graph.systems.get(&b).ok_or(OpError::UnknownSystem(b))?;
    let length = lane_length(sa, sb);
    let old = bulk::agreed_length(s, a, b)?;
    rules::check_length(length)?;
    if old == length {
        return Err(OpError::Empty);
    }
    let (old, updated) = set_one_length(plan, s, a, b, length)?;
    Ok(Planned {
        description: format!(
            "Normalised lane {a} <-> {b} length from {} to {} ({updated} entries)",
            coord(old),
            coord(length)
        ),
        inverse: Op::SetLaneLength { a, b, length: old },
    })
}

/// [`bulk::set_lengths`] for one lane: its old length and how many entries it rewrote.
fn set_one_length(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
    length: f64,
) -> Result<(f64, usize), OpError> {
    let (restore, updated) = bulk::set_lengths(plan, s, &[LaneLength { a, b, length }])?;
    Ok((restore[0].length, updated))
}

pub(crate) fn plan_isolate(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let (lanes, removed) = bulk::isolate(plan, s, &[id])?;
    let restore: Vec<(u32, bool)> = lanes
        .iter()
        .filter(|&&(_, to, _)| to != id && s.graph.systems.contains_key(&to))
        .map(|&(_, to, bridge)| (to, bridge))
        .collect();
    Ok(Planned {
        description: format!(
            "Isolated {} (#{id}): removed {} ({removed} entries){}",
            s.graph.systems[&id].display_name(),
            plural(lanes.len(), "lane"),
            wayline_note(&s.graph, &pairs(&lanes))
        ),
        inverse: Op::AddLanes {
            from: id,
            to: restore,
        },
    })
}

/// What a removal's description ends with when it cuts a lane the galaxy currently runs
/// a wayline over and nothing else joins the pair: the game derives a wayline from the
/// connection alone, so removing the last connection ends the wayline.
pub(crate) fn wayline_note(graph: &GalaxyGraph, removed: &[(u32, u32)]) -> &'static str {
    let cuts = removed.iter().any(|&(a, b)| {
        graph
            .waylines
            .iter()
            .any(|w| (w.a, w.b) == (a.min(b), a.max(b)))
            && !bypass_between(graph, a, b)
    });
    if cuts {
        "; the wayline between them ends"
    } else {
        ""
    }
}

/// The undirected ends of the lanes an isolate removed.
pub(crate) fn pairs(lanes: &[(u32, u32, bool)]) -> Vec<(u32, u32)> {
    lanes.iter().map(|&(a, b, _)| (a, b)).collect()
}

/// A length the caller set, written in the form of the entry it replaces: a decimal entry
/// stays decimal, and an integer one stays integer unless the length has a fraction.
pub(crate) fn length_form(length: f64) -> impl Fn(&str) -> String + Copy {
    move |existing: &str| match existing.contains('.') || length.fract() != 0.0 {
        true => coord(length),
        false => (length as u32).to_string(),
    }
}

/// The length a lane between `a` and `b` takes once one of them moves, in the form of the
/// entry it replaces: an event's decimal lane carries the exact distance, and the
/// generator's integer lane [`lane_length`].
pub(crate) fn moved_length(a: (f64, f64), b: (f64, f64)) -> impl Fn(&str) -> String + Copy {
    move |existing: &str| match existing.contains('.') {
        true => coord((a.0 - b.0).hypot(a.1 - b.1)),
        false => (lane_length(&a, &b) as u32).to_string(),
    }
}

/// Append `(to, length, bridge)` entries to the entity's `hyperlane` block, creating the
/// block after `star_class=` when the system has none.
pub(crate) fn insert_entries(edit: &mut Edit, entries: &[(u32, u32, bool)]) -> Result<(), OpError> {
    let (at, key_indent, in_block) = match edit.hyperlane()? {
        Some(block) => {
            edit.require_block_shape(block)?;
            let key = block.key.expect("found by key");
            let close = block.value_span().end - 1;
            (edit.line_start(close), edit.indent(key.start), true)
        }
        None => {
            let entity = edit.entity()?;
            match entity.find(keys::STAR_CLASS, &edit.buf) {
                Some(star_class) => (
                    edit.line_end(star_class.span().end),
                    edit.indent(star_class.span().start),
                    false,
                ),
                None => {
                    let (at, indent) = edit.before_close(entity);
                    (at, indent, false)
                }
            }
        }
    };
    let mut entry_indent = key_indent.clone();
    entry_indent.push(b'\t');
    let mut text = Vec::new();
    for &(to, length, bridge) in entries {
        text.extend(lane_entry(&entry_indent, to, length, bridge));
    }
    if !in_block {
        text = hyperlane_block(&key_indent, &text);
    }
    edit.insert_lines(at, text);
    Ok(())
}

/// Delete every `hyperlane` entry whose `to` is one of `targets`, and the whole block when nothing
/// is left. Returns the number of entries removed.
pub(crate) fn remove_entries(edit: &mut Edit, targets: &[u32]) -> Result<usize, OpError> {
    let Some(block) = edit.hyperlane()? else {
        return Ok(0);
    };
    edit.require_block_shape(block)?;
    let mut removing = Vec::new();
    let mut remaining = 0;
    for entry in block.children() {
        if edit.lane_to(entry).is_some_and(|to| targets.contains(&to)) {
            removing.push(entry.span());
        } else {
            remaining += 1;
        }
    }
    let removed = removing.len();
    if removed > 0 && remaining == 0 {
        removing = vec![block.span()];
    }
    for span in removing {
        edit.remove_lines(span);
    }
    Ok(removed)
}
