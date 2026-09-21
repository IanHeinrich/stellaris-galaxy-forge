//! Spawn weights: `spawn_weight = { base = N }`, the weight the generator seats an
//! empire by. The `modifier` blocks beside a base are script this editor reads and never
//! rewrites, so an edit here touches the `base` alone. A scripted seat is the whole
//! statement in its dialect's text, written and taken back whole, the player's marker
//! with it.

use std::collections::BTreeSet;

use crate::Span;
use crate::cst::Node;
use crate::emit::coord;
use crate::format::scenario::paint;
use crate::keys::scenario as keys;
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::plural;
use crate::projections::galaxy::SpawnScript;
use crate::session::Session;

pub(super) fn set_weight(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    base: Option<f64>,
) -> Result<Planned, OpError> {
    let (description, previous, script) = write_weight(plan, s, id, base)?;
    let inverse = match script {
        Some(script) => Op::SetSpawnScript {
            id,
            script: Some(script),
        },
        None => Op::SetSpawnWeight {
            id,
            base: previous.1,
        },
    };
    Ok(Planned {
        description,
        inverse,
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
        let (description, was, _) = write_weight(plan, s, id, base)?;
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

pub(super) fn set_script(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    script: Option<&SpawnScript>,
) -> Result<Planned, OpError> {
    let (description, previous) = write_script(plan, s, id, script)?;
    Ok(Planned {
        description,
        inverse: Op::SetSpawnScript {
            id,
            script: previous.1,
        },
    })
}

pub(super) fn set_scripts(
    plan: &mut Plan,
    s: &Session,
    entries: &[(u32, Option<SpawnScript>)],
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
    let mut one = String::new();
    let mut previous = Vec::with_capacity(entries.len());
    for (id, script) in entries {
        let (description, was) = write_script(plan, s, *id, script.as_ref())?;
        one = description;
        previous.push(was);
    }
    let description = match entries.len() {
        1 => one,
        n => format!("Set the scripted spawn of {}", plural(n, "system")),
    };
    Ok(Planned {
        description,
        inverse: Op::SetSpawnScripts { entries: previous },
    })
}

/// What to call a weight change, the entry that puts the base back and, when the whole
/// block went with it, the script that block was, which only a script puts back.
type WeightWritten = (String, (u32, Option<f64>), Option<SpawnScript>);

/// Write one system's spawn weight. A weight that is script is not a number to set:
/// only its kind changes.
fn write_weight(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    base: Option<f64>,
) -> Result<WeightWritten, OpError> {
    if let Some(base) = base {
        check_weight(base)?;
    }
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    if base.is_some() && system.spawn_script.is_some() {
        return Err(OpError::ScriptedSpawn(id));
    }
    let previous = system.spawn_weight;
    let mut removed_block = false;
    let edit = plan.edit(&s.doc, id)?;
    let standing = block(edit)?;
    // A script's base is not a number to set, and a script beside modifiers is only
    // ever a hand edit: taking its base would leave a block no op can put back.
    if let Some(block) = &standing
        && base.is_none()
        && system.spawn_script.is_some()
    {
        refuse_modifiers(edit, block)?;
    }
    match (base, standing) {
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
        (None, Some(block)) => match block.base {
            Some(_) if block.foreign_modifiers.is_empty() => {
                edit.remove_statement(block.statement);
                removed_block = true;
            }
            Some(span) => edit.remove_statement(span),
            None => {}
        },
        (None, None) => {}
    }
    let description = match base {
        Some(base) => format!("Set system {id} spawn weight to {}", coord(base)),
        None => format!("Cleared system {id} spawn weight"),
    };
    let script = removed_block.then(|| system.spawn_script.clone()).flatten();
    Ok((description, (id, previous), script))
}

/// Write one system's scripted seat whole, returning what to call the change and the
/// entry that puts it back. A seat needs a starting initializer, so a system naming
/// none is given the dialect's basic one, before the weight as the dialect orders them.
/// A block of modifiers is script this editor does not rewrite, so a seat is neither
/// written over one nor cleared with one.
fn write_script(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    script: Option<&SpawnScript>,
) -> Result<(String, (u32, Option<SpawnScript>)), OpError> {
    if let Some(script) = script {
        paint::check(script)?;
    }
    let previous = s
        .graph
        .systems
        .get(&id)
        .ok_or(OpError::UnknownSystem(id))?
        .spawn_script
        .clone();
    let edit = plan.edit(&s.doc, id)?;
    let standing = block(edit)?;
    if let Some(block) = &standing {
        refuse_modifiers(edit, block)?;
    }
    match (script, standing) {
        (Some(script), standing) => {
            if edit.entity()?.find(keys::INITIALIZER, &edit.buf).is_none() {
                let after = last_of_id_name_position(edit)?;
                let text = format!("{} = {}", keys::INITIALIZER, paint::basic_initializer(id));
                insert_after(edit, after, &text);
            }
            let text = paint::weight_statement(script);
            match standing {
                Some(block) => replace_statement(edit, block.statement, &text),
                None => insert_statement(edit, &text)?,
            }
        }
        (None, Some(block)) => edit.remove_statement(block.statement),
        (None, None) => {}
    }
    Ok((paint::description(id, script), (id, previous)))
}

/// A `modifier` block is script this editor keeps byte for byte, so nothing rewrites
/// the statement around one. The player's marker is the script's own text and is not
/// one.
fn refuse_modifiers(edit: &Edit, block: &Block) -> Result<(), OpError> {
    match block.foreign_modifiers.first() {
        Some(&modifier) => Err(edit.parse_error(
            modifier.start,
            "spawn_weight carries modifiers this editor does not rewrite; edit the block by hand",
        )),
        None => Ok(()),
    }
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
    /// The `modifier` blocks that are script, the player's marker not among them.
    foreign_modifiers: Vec<Span>,
    first_child: Option<Span>,
}

fn block(edit: &Edit) -> Result<Option<Block>, OpError> {
    let Some(node) = edit.entity()?.find(keys::SPAWN_WEIGHT, &edit.buf) else {
        return Ok(None);
    };
    if node.scalar_span().is_some() {
        return Err(edit.parse_error(node.span().start, "spawn_weight is not a block"));
    }
    let foreign_modifiers = if paint::has_player_marker(node, &edit.buf) {
        Vec::new()
    } else {
        node.find_all(keys::MODIFIER, &edit.buf)
            .map(Node::span)
            .collect()
    };
    Ok(Some(Block {
        statement: node.span(),
        value: node.value_span(),
        base: node.find(keys::BASE, &edit.buf).map(Node::span),
        foreign_modifiers,
        first_child: node.children().first().map(Node::span),
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

/// Write `text` as a statement of the system: beside its `initializer`, or after its
/// `name` and `position` when it names none.
fn insert_statement(edit: &mut Edit, text: &str) -> Result<(), OpError> {
    let after = match edit.entity()?.find(keys::INITIALIZER, &edit.buf) {
        Some(node) => node.span().end,
        None => last_of_id_name_position(edit)?,
    };
    insert_after(edit, after, text);
    Ok(())
}

/// Where a statement that follows the ones every system opens with goes: after the
/// `position`, or after the `name` when the file writes that second.
fn last_of_id_name_position(edit: &Edit) -> Result<usize, OpError> {
    let position = edit.value(&[keys::POSITION])?.end;
    let name = edit
        .entity()?
        .find(keys::NAME, &edit.buf)
        .map_or(0, |node| node.span().end);
    Ok(position.max(name))
}

/// Write `text` as the statement following the one ending at `after`, in the shape that
/// statement is written in: on a line of its own when that one ends its line, else
/// beside it. Two statements written after the same one land in the order written.
pub(super) fn insert_after(edit: &mut Edit, after: usize, text: &str) {
    if ends_line(edit, after) {
        let indent = edit.indent(after);
        let line = [&indent[..], text.as_bytes(), b"\n"].concat();
        let at = edit.line_end(after);
        edit.insert_lines(at, line);
    } else {
        edit.insert(after, format!(" {text}").into_bytes());
    }
}

/// Whether nothing but whitespace stands between `at` and the end of its line, so a
/// statement inserted there belongs on a line of its own.
fn ends_line(edit: &Edit, at: usize) -> bool {
    let rest = &edit.buf[at.min(edit.buf.len())..];
    let line = rest.split(|&b| b == b'\n').next().unwrap_or_default();
    line.len() < rest.len() && line.iter().all(|&b| b == b' ' || b == b'\t')
}

pub(super) fn starts_line(edit: &Edit, at: usize) -> bool {
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
