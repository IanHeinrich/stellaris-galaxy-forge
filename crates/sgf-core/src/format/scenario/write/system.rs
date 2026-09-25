//! Systems: where they stand, what they are called and what they spawn from.

use std::collections::BTreeSet;

use super::{index, set_position, some_text, system_indent, undirected};
use crate::cst::{self, Node};
use crate::emit::coord;
use crate::format::scenario::emit::{SpawnStmt, SystemStmt, system_stmt};
use crate::format::scenario::index::{LaneStmt, SCENARIO_X_SIGN, SCENARIO_Y_SIGN, statement_id};
use crate::format::scenario::paint;
use crate::keys::scenario as keys;
use crate::ops::rules::systems::{decide_move, decide_moves};
use crate::ops::rules::{Form, bulk_description, check_name, check_text, each_once, quoted};
use crate::ops::{
    Emitted, InitializerSet, LanePair, NewSystem, Op, OpError, Plan, Planned, Subject, SystemMove,
};
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
    pub statement: Option<&'a str>,
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
            statement: new.statement.as_deref(),
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
    each_once(systems, |new| new.id)?;
    let indent = system_indent(&s.doc, index(&s.doc));
    let mut one = String::new();
    for new in systems {
        (_, one) = emit_system(plan, s, &indent, new.into())?;
    }
    Ok(Planned {
        description: bulk_description(systems.len(), one, "Added"),
        inverse: Op::RemoveSystems {
            ids: systems.iter().map(|new| new.id).collect(),
        },
    })
}

/// A seat needs a starting initializer, so a scripted system naming none is given the
/// dialect's basic one, as [`Op::SetSpawnScript`] gives it. A statement carried whole is
/// written as it stands. Returns the id written and what to call the change.
fn emit_system(
    plan: &mut Plan,
    s: &Session,
    indent: &[u8],
    new: SystemFields,
) -> Result<(u32, String), OpError> {
    if new.statement.is_none() {
        check_fields(&new)?;
    }
    let SystemFields {
        id,
        x,
        y,
        name,
        initializer,
        spawn_weight,
        spawn_script,
        statement,
    } = new;
    let scenario = index(&s.doc);
    let id = id.unwrap_or_else(|| scenario.next_id());
    if id == NULL_ID {
        return Err(OpError::NullSystemId(id));
    }
    if scenario.system(id).is_some() {
        return Err(OpError::SystemExists(id));
    }
    let text = match statement {
        Some(statement) => verbatim(indent, id, statement)?,
        None => {
            let initializer = match (initializer, spawn_script) {
                (None, Some(_)) => Some(paint::basic_initializer(id)),
                (initializer, _) => initializer,
            };
            let spawn = match (spawn_weight, spawn_script) {
                (Some(weight), _) => SpawnStmt::Base(weight),
                (_, Some(script)) => SpawnStmt::Script(script.clone()),
                (None, None) => SpawnStmt::None,
            };
            system_stmt(
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
            )
        }
    };
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

fn check_fields(new: &SystemFields) -> Result<(), OpError> {
    if !new.x.is_finite() || !new.y.is_finite() {
        return Err(OpError::NotFinite);
    }
    if new.spawn_weight.is_some() && new.spawn_script.is_some() {
        return Err(OpError::WeightAndScript);
    }
    if let Some(weight) = new.spawn_weight {
        super::spawn::check_weight(weight)?;
    }
    if let Some(script) = new.spawn_script {
        paint::check(script)?;
    }
    if let Some(name) = new.name {
        check_name(name)?;
    }
    if let Some(initializer) = new.initializer {
        check_initializer(initializer)?;
    }
    Ok(())
}

/// An initializer is written bare, as the key the game looks it up by.
fn check_initializer(initializer: &str) -> Result<(), OpError> {
    check_text("an initializer", initializer, Form::Bare)
}

/// `statement` on a line of its own, once it reads as one `system` statement for `id`
/// with nothing before or after it.
fn verbatim(indent: &[u8], id: u32, statement: &str) -> Result<Vec<u8>, OpError> {
    let bytes = statement.trim().as_bytes();
    let refuse = |offset: usize, reason: &str| OpError::Parse {
        system: id,
        offset,
        reason: reason.to_owned(),
    };
    let root = cst::parse_script(bytes, 0).map_err(|e| refuse(e.offset, e.reason))?;
    match root.children() {
        [node]
            if node.key_str(bytes) == Some(keys::SYSTEM)
                && node.span().start == 0
                && node.span().end == bytes.len()
                && statement_id(node, bytes) == Some(id) => {}
        _ => return Err(refuse(0, "not one system statement with this id")),
    }
    Ok([indent, bytes, b"\n"].concat())
}

pub(super) fn remove_system(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    remove_systems(plan, s, &[id])
}

pub(super) fn remove_systems(
    plan: &mut Plan,
    s: &Session,
    ids: &[u32],
) -> Result<Planned, OpError> {
    let (inverse, lanes) = erase_systems(plan, s, ids)?;
    let lanes = plural(lanes, "lane");
    let description = match ids {
        [id] => format!("Removed system {id} ({lanes})"),
        _ => format!("Removed {} ({lanes})", plural(ids.len(), "system")),
    };
    Ok(Planned {
        description,
        inverse,
    })
}

/// Empty each system's statement and every hyperlane statement naming any of them, once
/// each. Returns the op that puts them all back and how many `add_hyperlane` statements
/// went with them.
fn erase_systems(plan: &mut Plan, s: &Session, ids: &[u32]) -> Result<(Op, usize), OpError> {
    each_once(ids, |&id| id)?;
    let scenario = index(&s.doc);
    let mut restore = Vec::with_capacity(ids.len());
    for &id in ids {
        let anchor = scenario.system(id).ok_or(OpError::UnknownSystem(id))?;
        let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
        let statement =
            std::str::from_utf8(s.doc.current(anchor)?).map_err(|e| OpError::Parse {
                system: id,
                offset: e.valid_up_to(),
                reason: "the statement is not UTF-8 text".to_owned(),
            })?;
        restore.push(NewSystem {
            id,
            x: system.x,
            y: system.y,
            name: some_text(&system.name.key),
            initializer: some_text(&system.initializer),
            spawn_weight: None,
            spawn_script: system.spawn_script.clone(),
            statement: Some(statement.trim().to_owned()),
        });
        plan.erase(&s.doc, Subject::System(id), anchor)?;
    }
    let statements = super::matching(&s.doc, ids.iter().copied(), |_| true);
    for stmt in &statements {
        super::erase(plan, &s.doc, stmt)?;
    }
    let lanes = statements.iter().filter(|l| !l.prevent).count();
    Ok((put_back(s, restore, &statements), lanes))
}

/// The batch that undoes [`erase_systems`]: the systems' statements as they stood, then
/// each pair the erased hyperlane statements prevented and linked, once, where the graph
/// holds both ends. A pair is prevented before it is linked, since a linked pair cannot be.
fn put_back(s: &Session, systems: Vec<NewSystem>, statements: &[LaneStmt]) -> Op {
    let description = format!("Restored {}", plural(systems.len(), "system"));
    let mut ops = vec![Op::AddSystems { systems }];
    let mut seen = BTreeSet::new();
    let mut lanes = Vec::new();
    for stmt in statements {
        let (a, b) = (stmt.from, stmt.to);
        let held = [a, b].iter().all(|id| s.graph.systems.contains_key(id));
        if a == b || !held || !seen.insert((stmt.prevent, undirected(a, b))) {
            continue;
        }
        if stmt.prevent {
            ops.push(Op::PreventLane { a, b });
        } else {
            lanes.push(LanePair {
                a,
                b,
                bridge: false,
            });
        }
    }
    if !lanes.is_empty() {
        ops.push(Op::AddLanePairs { lanes });
    }
    Op::Batch { description, ops }
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
    each_once(entries, |entry| entry.id)?;
    let mut one = String::new();
    let mut previous = Vec::with_capacity(entries.len());
    for entry in entries {
        let (description, was) =
            write_initializer(plan, s, entry.id, entry.initializer.as_deref())?;
        one = description;
        previous.push(was);
    }
    Ok(Planned {
        description: bulk_description(entries.len(), one, "Set initializer of"),
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
    if let Some(initializer) = initializer {
        check_initializer(initializer)?;
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
