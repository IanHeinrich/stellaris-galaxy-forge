//! Spawn weights: `spawn_weight = { base = N }`, the weight the generator seats an
//! empire by. The `modifier` blocks beside a base are script this editor reads and never
//! rewrites, so an edit here touches the `base` alone, except for the two modifiers the
//! editor writes itself, `modifier = { factor = 0 is_ai = yes|no }`, which hold the
//! system for a human player or for the AI by barring the other from it.

use std::collections::BTreeSet;

use crate::Span;
use crate::cst::Node;
use crate::emit::coord;
use crate::format::scenario::spawn::{modifier, preset, tests_ai};
use crate::keys::scenario as keys;
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::plural;
use crate::projections::galaxy::SpawnReservationPreset;
use crate::session::Session;

/// The modifier a reserved system carries: the kind of empire it names is given a weight
/// of zero there, so only the other kind can be placed in it.
fn preset_modifier(preset: SpawnReservationPreset) -> String {
    let is_ai = match preset {
        SpawnReservationPreset::Human => "yes",
        SpawnReservationPreset::Ai => "no",
    };
    format!(
        "{} = {{ {} = 0 {} = {is_ai} }}",
        keys::MODIFIER,
        keys::FACTOR,
        keys::IS_AI
    )
}

pub(super) fn set_weight(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    base: Option<f64>,
) -> Result<Planned, OpError> {
    let (description, previous) = write_weight(plan, s, id, base)?;
    Ok(Planned {
        description,
        inverse: Op::SetSpawnWeight {
            id,
            base: previous.1,
        },
    })
}

pub(super) fn set_weights(
    plan: &mut Plan,
    s: &Session,
    entries: &[(u32, Option<f64>)],
) -> Result<Planned, OpError> {
    if entries.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    for &(id, _) in entries {
        if !seen.insert(id) {
            return Err(OpError::DuplicateSystem(id));
        }
    }
    let mut one = String::new();
    let mut previous = Vec::with_capacity(entries.len());
    for &(id, base) in entries {
        let (description, was) = write_weight(plan, s, id, base)?;
        one = description;
        previous.push(was);
    }
    let description = match entries.len() {
        1 => one,
        n => format!("Set the spawn weight of {}", plural(n, "system")),
    };
    Ok(Planned {
        description,
        inverse: Op::SetSpawnWeights { entries: previous },
    })
}

pub(super) fn set_reservation(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    reserve: Option<SpawnReservationPreset>,
) -> Result<Planned, OpError> {
    if !s.graph.systems.contains_key(&id) {
        return Err(OpError::UnknownSystem(id));
    }
    let edit = plan.edit(&s.doc, id)?;
    let previous = write_reservation(edit, reserve)?;
    let description = match reserve {
        Some(SpawnReservationPreset::Human) => format!("Reserved system {id} for a human player"),
        Some(SpawnReservationPreset::Ai) => format!("Reserved system {id} for the AI"),
        None => format!("Released system {id}'s reservation"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetSpawnReservation {
            id,
            reserve: previous,
        },
    })
}

/// Write one system's spawn weight, returning what to call the change and the entry that
/// puts it back.
fn write_weight(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    base: Option<f64>,
) -> Result<(String, (u32, Option<f64>)), OpError> {
    if let Some(base) = base {
        check_weight(base)?;
    }
    let previous = s
        .graph
        .systems
        .get(&id)
        .ok_or(OpError::UnknownSystem(id))?
        .spawn_weight;
    let edit = plan.edit(&s.doc, id)?;
    let mut released = false;
    match (base, block(edit)?) {
        (Some(base), Some(block)) => match block.base {
            Some(_) => edit.set_value(&[keys::SPAWN_WEIGHT, keys::BASE], coord(base))?,
            None => insert_first(edit, &block, &format!("{} = {}", keys::BASE, coord(base))),
        },
        (Some(base), None) => insert_statement(
            edit,
            &format!(
                "{} = {{ {} = {} }}",
                keys::SPAWN_WEIGHT,
                keys::BASE,
                coord(base)
            ),
        )?,
        // A block of modifiers alone states no base, so there is nothing to clear.
        (None, Some(block)) => {
            // A reservation is written inside the weight, so it goes with the weight.
            let preset = block.preset.map(|(span, _)| span);
            released = preset.is_some();
            let script = block.modifiers.len() - usize::from(released);
            if script == 0 && (block.base.is_some() || released) {
                edit.remove_statement(block.statement);
            } else {
                if let Some(span) = block.base {
                    edit.remove_statement(span);
                }
                if let Some(span) = preset {
                    edit.remove_statement(span);
                }
            }
        }
        (None, None) => {}
    }
    let description = match (base, released) {
        (Some(base), _) => format!("Set system {id} spawn weight to {}", coord(base)),
        (None, false) => format!("Cleared system {id} spawn weight"),
        (None, true) => format!("Cleared system {id}'s spawn weight and its reservation"),
    };
    Ok((description, (id, previous)))
}

/// Hold the system for one kind of empire, taking back the preset it holds now and
/// saying which that was. A modifier that tests the AI in a form this editor does not
/// read is script that may well be a reservation of its own, so the op stops rather than
/// write a second one beside it.
fn write_reservation(
    edit: &mut Edit,
    reserve: Option<SpawnReservationPreset>,
) -> Result<Option<SpawnReservationPreset>, OpError> {
    let Some(block) = block(edit)? else {
        if let Some(preset) = reserve {
            insert_statement(
                edit,
                &format!(
                    "{} = {{ {} = 1 {} }}",
                    keys::SPAWN_WEIGHT,
                    keys::BASE,
                    preset_modifier(preset)
                ),
            )?;
        }
        return Ok(None);
    };
    let standing = block.preset.map(|(_, preset)| preset);
    if standing == reserve {
        return Ok(standing);
    }
    if let (Some(_), Some((span, trigger))) = (reserve, &block.ai) {
        return Err(edit.parse_error(
            span.start,
            format!("a spawn_weight modifier already tests the AI: {trigger}"),
        ));
    }
    match (block.preset, reserve) {
        (Some((span, _)), Some(preset)) => replace_statement(edit, span, &preset_modifier(preset)),
        (Some((span, _)), None) => edit.remove_statement(span),
        (None, Some(preset)) => append(edit, &block, &preset_modifier(preset)),
        (None, None) => {}
    }
    Ok(standing)
}

/// The `spawn_weight` block of the statement being edited, as spans: the CST borrows the
/// buffer the splices then rewrite, so nothing but offsets is carried out of it.
struct Block {
    /// `spawn_weight = { … }`, key through closing brace.
    statement: Span,
    /// The braces and what stands between them.
    value: Span,
    /// The `base = N` statement, when the block states one.
    base: Option<Span>,
    modifiers: Vec<Span>,
    /// The first modifier this editor wrote itself, and which of the two it is.
    preset: Option<(Span, SpawnReservationPreset)>,
    /// The first modifier testing `is_ai` that is not one of those, and its trigger.
    ai: Option<(Span, String)>,
    first_child: Option<Span>,
    last_child: Option<Span>,
}

fn block(edit: &Edit) -> Result<Option<Block>, OpError> {
    let Some(node) = edit.entity()?.find(keys::SPAWN_WEIGHT, &edit.buf) else {
        return Ok(None);
    };
    if node.scalar_span().is_some() {
        return Err(edit.parse_error(node.span().start, "spawn_weight is not a block"));
    }
    let modifiers: Vec<&Node> = node.find_all(keys::MODIFIER, &edit.buf).collect();
    Ok(Some(Block {
        statement: node.span(),
        value: node.value_span(),
        base: node.find(keys::BASE, &edit.buf).map(Node::span),
        preset: modifiers
            .iter()
            .find_map(|m| preset(m, &edit.buf).map(|preset| (m.span(), preset))),
        ai: modifiers
            .iter()
            .find(|m| preset(m, &edit.buf).is_none() && tests_ai(m, &edit.buf))
            .map(|m| (m.span(), modifier(m, &edit.buf).trigger)),
        modifiers: modifiers.iter().map(|m| m.span()).collect(),
        first_child: node.children().first().map(Node::span),
        last_child: node.children().last().map(Node::span),
    }))
}

/// Write `text` as the block's first statement, `base = N` standing before the modifiers
/// as the game's own example writes it.
fn insert_first(edit: &mut Edit, block: &Block, text: &str) {
    let at = block.value.start + 1;
    match block.first_child {
        Some(child) if starts_line(edit, child.start) => {
            let indent = edit.indent(child.start);
            let line = [&indent[..], text.as_bytes(), b"\n"].concat();
            let at = edit.line_start(child.start);
            edit.insert_lines(at, line);
        }
        _ => edit.insert(at, format!(" {text}").into_bytes()),
    }
}

/// Write `text` where the statement at `span` stands, taking that statement back. The two
/// splices meet at a boundary rather than overlapping: the replacement lands at the start
/// of the line the removal takes, or right where a statement removed in place ended.
fn replace_statement(edit: &mut Edit, span: Span, text: &str) {
    if starts_line(edit, span.start) {
        let indent = edit.indent(span.start);
        let line = [&indent[..], text.as_bytes(), b"\n"].concat();
        let at = edit.line_start(span.start);
        edit.insert_lines(at, line);
    } else {
        edit.insert(span.end, format!(" {text}").into_bytes());
    }
    edit.remove_statement(span);
}

/// Write `text` as the block's last statement.
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

/// Write `text` as a statement of the system: beside its `initializer`, or its
/// `position` when it names none, in the shape the statement it joins is written in.
fn insert_statement(edit: &mut Edit, text: &str) -> Result<(), OpError> {
    let after = match edit.entity()?.find(keys::INITIALIZER, &edit.buf) {
        Some(node) => node.span().end,
        None => edit.value(&[keys::POSITION])?.end,
    };
    if ends_line(edit, after) {
        let indent = edit.indent(after);
        let line = [&indent[..], text.as_bytes(), b"\n"].concat();
        let at = edit.line_end(after);
        edit.insert_lines(at, line);
    } else {
        edit.insert(after, format!(" {text}").into_bytes());
    }
    Ok(())
}

/// Whether nothing but whitespace stands between `at` and the end of its line, so a
/// statement inserted there belongs on a line of its own.
fn ends_line(edit: &Edit, at: usize) -> bool {
    let rest = &edit.buf[at.min(edit.buf.len())..];
    let line = rest.split(|&b| b == b'\n').next().unwrap_or_default();
    line.len() < rest.len() && line.iter().all(|&b| b == b' ' || b == b'\t')
}

fn starts_line(edit: &Edit, at: usize) -> bool {
    edit.buf[edit.line_start(at)..at]
        .iter()
        .all(|&b| b == b' ' || b == b'\t')
}

/// A weight is a number the generator multiplies and adds to, so a negative one says
/// nothing; zero is the mods' own idiom for "only a modifier can make this a start".
pub(super) fn check_weight(weight: f64) -> Result<(), OpError> {
    if !weight.is_finite() {
        return Err(OpError::NotFinite);
    }
    if weight < 0.0 {
        return Err(OpError::InvalidWeight {
            weight,
            reason: "a spawn weight may not be negative".to_owned(),
        });
    }
    Ok(())
}
