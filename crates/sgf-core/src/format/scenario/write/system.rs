//! Systems: where they stand, what they are called and what they spawn from.

use std::collections::BTreeSet;

use super::{index, set_position, some_text, system_indent};
use crate::cst::Node;
use crate::document::Document;
use crate::emit::coord;
use crate::format;
use crate::format::scenario::emit::{SpawnStmt, SystemStmt, system_stmt};
use crate::format::scenario::index::{SCENARIO_X_SIGN, SCENARIO_Y_SIGN};
use crate::keys::scenario as keys;
use crate::ops::rules::systems::{decide_move, decide_moves};
use crate::ops::rules::{check_name, quoted};
use crate::ops::{Emitted, InitializerSet, Op, OpError, Plan, Planned, Subject, SystemMove};
use crate::overlay::Anchor;
use crate::plural;
use crate::session::Session;

pub(super) fn move_one(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    x: f64,
    y: f64,
) -> Result<Planned, OpError> {
    let moved = decide_move(&s.graph, id, x, y)?;
    set_position(plan.edit(&s.doc, id)?, x, y)?;
    Ok(Planned {
        description: moved.describe(),
        inverse: moved.inverse(),
    })
}

pub(super) fn move_many(
    plan: &mut Plan,
    s: &Session,
    moves: &[SystemMove],
) -> Result<Planned, OpError> {
    if moves.is_empty() {
        return Err(OpError::Empty);
    }
    let origin = decide_moves(&s.graph, moves)?;
    for m in moves {
        set_position(plan.edit(&s.doc, m.id)?, m.x, m.y)?;
    }
    Ok(Planned {
        description: format!("Moved {}", plural(moves.len(), "system")),
        inverse: Op::MoveSystems { moves: origin },
    })
}

/// [`Op::AddSystem`]'s fields, borrowed for planning.
pub(super) struct NewSystem<'a> {
    pub id: Option<u32>,
    pub x: f64,
    pub y: f64,
    pub name: Option<&'a str>,
    pub initializer: Option<&'a str>,
    pub spawn_weight: Option<f64>,
}

pub(super) fn add_system(plan: &mut Plan, s: &Session, new: NewSystem) -> Result<Planned, OpError> {
    let NewSystem {
        id,
        x,
        y,
        name,
        initializer,
        spawn_weight,
    } = new;
    if !x.is_finite() || !y.is_finite() {
        return Err(OpError::NotFinite);
    }
    if let Some(weight) = spawn_weight {
        super::spawn::check_weight(weight)?;
    }
    if let Some(name) = name {
        check_name(name)?;
    }
    let scenario = index(&s.doc);
    let id = id.unwrap_or_else(|| scenario.next_id());
    if scenario.system(id).is_some() {
        return Err(OpError::SystemExists(id));
    }
    let text = system_stmt(
        &system_indent(&s.doc, scenario),
        &SystemStmt {
            id,
            name: name.unwrap_or("").to_owned(),
            x: x * SCENARIO_X_SIGN,
            y: y * SCENARIO_Y_SIGN,
            initializer: initializer.map(str::to_owned),
            spawn: spawn_weight.map_or(SpawnStmt::None, SpawnStmt::Base),
            effect: None,
        },
    );
    plan.emit(Emitted::System(id), scenario.insert_at, text);
    Ok(Planned {
        description: format!("Added system {id} at ({}, {})", coord(x), coord(y)),
        inverse: Op::RemoveSystem { id },
    })
}

pub(super) fn remove_system(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let scenario = index(&s.doc);
    let anchor = scenario.system(id).ok_or(OpError::UnknownSystem(id))?;
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let restore = Op::AddSystem {
        id: Some(id),
        x: system.x,
        y: system.y,
        name: some_text(&system.name.key),
        initializer: some_text(&system.initializer),
        spawn_weight: spawn_weight_of(&s.doc, anchor),
    };

    let statements = super::matching(&s.doc, |l| l.from == id || l.to == id);
    let lanes = statements.iter().filter(|l| !l.prevent).count();
    plan.erase(&s.doc, Subject::System(id), anchor)?;
    for stmt in &statements {
        super::erase(plan, &s.doc, stmt)?;
    }
    Ok(Planned {
        description: format!("Removed system {id} ({lanes} lanes)"),
        inverse: restore,
    })
}

/// The removed statement's spawn weight, when it stood as a plain `base = N` with no
/// modifier; `None` otherwise, same best-effort limit as the rest of the inverse.
fn spawn_weight_of(doc: &Document, anchor: Anchor) -> Option<f64> {
    let buf = doc.current(anchor).ok()?;
    let root = format::of(doc.kind()).parse(buf, 0).ok()?;
    let weight = root.children().first()?.find(keys::SPAWN_WEIGHT, buf)?;
    if weight.find(keys::MODIFIER, buf).is_some() {
        return None;
    }
    weight
        .find(keys::BASE, buf)
        .and_then(|n| n.scalar_str(buf))
        .and_then(|text| text.parse::<f64>().ok())
}

/// No name is not a name: an empty one takes the `name` statement away, so the inverse
/// of naming a system the file left nameless puts it back as it was.
pub(super) fn set_name(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    name: &str,
) -> Result<Planned, OpError> {
    if !name.is_empty() {
        check_name(name)?;
    }
    let old = s
        .graph
        .systems
        .get(&id)
        .ok_or(OpError::UnknownSystem(id))?
        .name
        .key
        .clone();
    let edit = plan.edit(&s.doc, id)?;
    let named = edit.entity()?.find(keys::NAME, &edit.buf).map(Node::span);
    match (named, name.is_empty()) {
        (Some(span), true) => edit.remove_statement(span),
        (Some(_), false) => edit.set_scalar(&[keys::NAME], quoted(name))?,
        (None, true) => {}
        // The id opens the statement, so a name belongs right after it.
        (None, false) => {
            let at = edit.value(&[keys::ID])?.end;
            let text = format!(" {} = {}", keys::NAME, quoted(name));
            edit.insert(at, text.into_bytes());
        }
    }
    Ok(Planned {
        description: format!("Renamed system {id} from \"{old}\" to \"{name}\""),
        inverse: Op::SetSystemName { id, name: old },
    })
}

pub(super) fn set_initializer(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    initializer: Option<&str>,
) -> Result<Planned, OpError> {
    let (description, previous) = write_initializer(plan, s, id, initializer)?;
    Ok(Planned {
        description,
        inverse: Op::SetInitializer {
            id: previous.id,
            initializer: previous.initializer,
        },
    })
}

pub(super) fn set_initializers(
    plan: &mut Plan,
    s: &Session,
    entries: &[InitializerSet],
) -> Result<Planned, OpError> {
    if entries.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    for entry in entries {
        if !seen.insert(entry.id) {
            return Err(OpError::DuplicateSystem(entry.id));
        }
    }
    let mut one = String::new();
    let mut previous = Vec::with_capacity(entries.len());
    for entry in entries {
        let (description, was) =
            write_initializer(plan, s, entry.id, entry.initializer.as_deref())?;
        one = description;
        previous.push(was);
    }
    let description = match entries.len() {
        1 => one,
        n => format!("Set initializer of {}", plural(n, "system")),
    };
    Ok(Planned {
        description,
        inverse: Op::SetInitializers { entries: previous },
    })
}

/// Write one system's initializer, returning what to call the change and the entry that
/// puts it back. The `spawn_weight` beside it is not this op's to touch: a weight is a
/// separate statement with its own op, and a modifier-only one is script we do not read.
fn write_initializer(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    initializer: Option<&str>,
) -> Result<(String, InitializerSet), OpError> {
    if !s.graph.systems.contains_key(&id) {
        return Err(OpError::UnknownSystem(id));
    }
    let edit = plan.edit(&s.doc, id)?;
    let entity = edit.entity()?;
    let old_initializer = entity
        .find(keys::INITIALIZER, &edit.buf)
        .and_then(|n| n.scalar_str(&edit.buf))
        .map(str::to_owned);
    let after_position = edit.value(&[keys::POSITION])?.end;

    match (initializer, old_initializer.is_some()) {
        (Some(text), true) => edit.set_scalar(&[keys::INITIALIZER], text)?,
        (Some(text), false) => edit.insert(
            after_position,
            format!(" {} = {text}", keys::INITIALIZER).into_bytes(),
        ),
        (None, true) => {
            let span = edit
                .entity()?
                .find(keys::INITIALIZER, &edit.buf)
                .expect("just found")
                .span();
            edit.remove_statement(span);
        }
        (None, false) => {}
    }

    let description = match initializer {
        Some(text) => format!("Set system {id} initializer to {text}"),
        None => format!("Cleared system {id} initializer"),
    };
    Ok((
        description,
        InitializerSet {
            id,
            initializer: old_initializer,
        },
    ))
}
