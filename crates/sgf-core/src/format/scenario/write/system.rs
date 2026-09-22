//! Systems: where they stand, what they are called and what they spawn from.

use std::collections::BTreeSet;

use super::{index, set_position, some_text, system_indent};
use crate::cst::Node;
use crate::document::Document;
use crate::emit::coord;
use crate::format;
use crate::format::scenario::emit::{SpawnStmt, SystemStmt, system_stmt};
use crate::format::scenario::index::{SCENARIO_X_SIGN, SCENARIO_Y_SIGN};
use crate::format::scenario::paint;
use crate::keys::scenario as keys;
use crate::ops::rules::systems::{decide_move, decide_moves};
use crate::ops::rules::{check_name, quoted};
use crate::ops::{
    Emitted, InitializerSet, NewSystem, Op, OpError, Plan, Planned, Subject, SystemMove,
};
use crate::overlay::Anchor;
use crate::projections::galaxy::SpawnScript;
use crate::session::Session;
use crate::{NULL_ID, plural};

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
pub(super) struct SystemFields<'a> {
    pub id: Option<u32>,
    pub x: f64,
    pub y: f64,
    pub name: Option<&'a str>,
    pub initializer: Option<&'a str>,
    pub spawn_weight: Option<f64>,
    pub spawn_script: Option<&'a SpawnScript>,
}

impl<'a> From<&'a NewSystem> for SystemFields<'a> {
    fn from(new: &'a NewSystem) -> Self {
        Self {
            id: Some(new.id),
            x: new.x,
            y: new.y,
            name: new.name.as_deref(),
            initializer: new.initializer.as_deref(),
            spawn_weight: new.spawn_weight,
            spawn_script: new.spawn_script.as_ref(),
        }
    }
}

pub(super) fn add_system(
    plan: &mut Plan,
    s: &Session,
    new: SystemFields,
) -> Result<Planned, OpError> {
    let indent = system_indent(&s.doc, index(&s.doc));
    let (id, description) = emit_system(plan, s, &indent, new)?;
    Ok(Planned {
        description,
        inverse: Op::RemoveSystem { id },
    })
}

pub(super) fn add_systems(
    plan: &mut Plan,
    s: &Session,
    systems: &[NewSystem],
) -> Result<Planned, OpError> {
    if systems.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    for new in systems {
        if !seen.insert(new.id) {
            return Err(OpError::DuplicateSystem(new.id));
        }
    }
    let indent = system_indent(&s.doc, index(&s.doc));
    let mut one = String::new();
    for new in systems {
        (_, one) = emit_system(plan, s, &indent, new.into())?;
    }
    let description = match systems.len() {
        1 => one,
        n => format!("Added {}", plural(n, "system")),
    };
    Ok(Planned {
        description,
        inverse: Op::RemoveSystems {
            ids: systems.iter().map(|new| new.id).collect(),
        },
    })
}

/// A seat needs a starting initializer, so a scripted system naming none is given the
/// dialect's basic one, as [`Op::SetSpawnScript`] gives it. Returns the id written and
/// what to call the change.
fn emit_system(
    plan: &mut Plan,
    s: &Session,
    indent: &[u8],
    new: SystemFields,
) -> Result<(u32, String), OpError> {
    let SystemFields {
        id,
        x,
        y,
        name,
        initializer,
        spawn_weight,
        spawn_script,
    } = new;
    if !x.is_finite() || !y.is_finite() {
        return Err(OpError::NotFinite);
    }
    if spawn_weight.is_some() && spawn_script.is_some() {
        return Err(OpError::WeightAndScript);
    }
    if let Some(weight) = spawn_weight {
        super::spawn::check_weight(weight)?;
    }
    if let Some(script) = spawn_script {
        paint::check(script)?;
    }
    if let Some(name) = name {
        check_name(name)?;
    }
    let scenario = index(&s.doc);
    let id = id.unwrap_or_else(|| scenario.next_id());
    if id == NULL_ID {
        return Err(OpError::NullSystemId(id));
    }
    if scenario.system(id).is_some() {
        return Err(OpError::SystemExists(id));
    }
    let initializer = match (initializer, spawn_script) {
        (None, Some(_)) => Some(paint::basic_initializer(id)),
        (initializer, _) => initializer,
    };
    let spawn = match (spawn_weight, spawn_script) {
        (Some(weight), _) => SpawnStmt::Base(weight),
        (_, Some(script)) => SpawnStmt::Script(script.clone()),
        (None, None) => SpawnStmt::None,
    };
    let text = system_stmt(
        indent,
        &SystemStmt {
            id,
            name: name.unwrap_or("").to_owned(),
            x: x * SCENARIO_X_SIGN,
            y: y * SCENARIO_Y_SIGN,
            initializer: initializer.map(str::to_owned),
            spawn,
            effect: None,
        },
    );
    plan.emit(Emitted::System(id), scenario.insert_at, text);
    let seat = match spawn_script {
        Some(script) => format!(" as a Paint a Galaxy spawn ({})", paint::label(script)),
        None => String::new(),
    };
    Ok((
        id,
        format!("Added system {id} at ({}, {}){seat}", coord(x), coord(y)),
    ))
}

pub(super) fn remove_system(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let (mut restore, lanes) = erase_systems(plan, s, &[id])?;
    let NewSystem {
        id,
        x,
        y,
        name,
        initializer,
        spawn_weight,
        spawn_script,
    } = restore.pop().expect("one system erased");
    Ok(Planned {
        description: format!("Removed system {id} ({lanes} lanes)"),
        inverse: Op::AddSystem {
            id: Some(id),
            x,
            y,
            name,
            initializer,
            spawn_weight,
            spawn_script,
        },
    })
}

pub(super) fn remove_systems(
    plan: &mut Plan,
    s: &Session,
    ids: &[u32],
) -> Result<Planned, OpError> {
    if ids.is_empty() {
        return Err(OpError::Empty);
    }
    let (restore, lanes) = erase_systems(plan, s, ids)?;
    let description = match ids {
        [id] => format!("Removed system {id} ({lanes} lanes)"),
        _ => format!("Removed {} ({lanes} lanes)", plural(ids.len(), "system")),
    };
    Ok(Planned {
        description,
        inverse: Op::AddSystems { systems: restore },
    })
}

/// Empty each system's statement and every hyperlane statement naming any of them, once
/// each. Returns what puts each system back (the spawn weight best effort, `None` when a
/// modifier stood) and how many `add_hyperlane` statements went with them.
fn erase_systems(
    plan: &mut Plan,
    s: &Session,
    ids: &[u32],
) -> Result<(Vec<NewSystem>, usize), OpError> {
    let scenario = index(&s.doc);
    let mut seen = BTreeSet::new();
    let mut restore = Vec::with_capacity(ids.len());
    for &id in ids {
        if !seen.insert(id) {
            return Err(OpError::DuplicateSystem(id));
        }
        let anchor = scenario.system(id).ok_or(OpError::UnknownSystem(id))?;
        let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
        let spawn_script = system.spawn_script.clone();
        restore.push(NewSystem {
            id,
            x: system.x,
            y: system.y,
            name: some_text(&system.name.key),
            initializer: some_text(&system.initializer),
            spawn_weight: match spawn_script {
                Some(_) => None,
                None => spawn_weight_of(&s.doc, anchor),
            },
            spawn_script,
        });
        plan.erase(&s.doc, Subject::System(id), anchor)?;
    }
    let statements = super::matching(&s.doc, seen.iter().copied(), |_| true);
    for stmt in &statements {
        super::erase(plan, &s.doc, stmt)?;
    }
    let lanes = statements.iter().filter(|l| !l.prevent).count();
    Ok((restore, lanes))
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
