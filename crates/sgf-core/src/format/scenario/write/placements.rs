//! The ruins, ambient objects and modifiers a scenario system's last `effect` block places,
//! as the editor writes them. A statement is edited where it stands only when the editor
//! writes it in that shape ([`placements::adopted`]); every other statement of the block stays
//! as written. New ones go at the end of the block, as [`effect_block`] splices it.

use crate::emit::rounded;
use crate::format::scenario::effect;
use crate::format::scenario::placed::{
    self, PER_SYSTEM, Placed, STAR_BODY, SYSTEMS, ambient_object_id, ruin_id,
};
use crate::ops::rules::{Form, check_text, named, polar};
use crate::ops::{
    Edit, MegastructureConstruction, MegastructureEdit, MegastructurePlace, MegastructureRefusal,
    NewMegastructure, NewMegastructurePlace, Op, OpError, Plan, Planned, SavedTable,
    restored_inverse,
};
use crate::placements::{
    self, AmbientObject, Orbit, SpawnMegastructure, SpawnPlace, Statement, game_at, point_at,
};
use crate::session::Session;
use crate::span::Span;

use super::effect_block::{self, EffectBlock};
use super::restore::kept;

/// The system's last `effect` block and what it places, read from the edit's bytes.
fn read(edit: &Edit, system: u32) -> Result<(Option<EffectBlock>, Vec<Placed>), OpError> {
    let block = effect_block::last(edit)?;
    let placed = match effect::block(edit.entity()?, &edit.buf) {
        Some(node) => placed::placed(system, placements::read(node, &edit.buf), &edit.buf),
        None => Vec::new(),
    };
    Ok((block, placed))
}

/// The inverse of an edit described as `description` that rewrote system `system`'s
/// statement: the statement written back as it stood.
fn restored(s: &Session, system: u32, description: &str) -> Result<Op, OpError> {
    Ok(restored_inverse(description, vec![kept(s, system)?]))
}

fn known(s: &Session, system: u32) -> Result<(), OpError> {
    match s.graph.systems.contains_key(&system) {
        true => Ok(()),
        false => Err(OpError::UnknownSystem(system)),
    }
}

/// The system of ruin `id`, or an [`OpError::UnknownEntity`] naming it.
fn ruin_system(s: &Session, id: u32) -> Result<u32, OpError> {
    placed::ruin(id)
        .map(|(system, _)| system)
        .filter(|system| s.graph.systems.contains_key(system))
        .ok_or(OpError::UnknownEntity {
            table: SavedTable::Megastructure,
            id,
        })
}

/// The ruin `id` names in `placed`, refused when it is in a shape the editor does not write.
fn ruin(
    placed: &[Placed],
    id: u32,
    edit: MegastructureEdit,
) -> Result<&SpawnMegastructure, OpError> {
    let found = placed
        .iter()
        .find(|p| p.id == Some(id))
        .ok_or(OpError::UnknownEntity {
            table: SavedTable::Megastructure,
            id,
        })?;
    let Statement::SpawnMegastructure(spawn) = &found.statement else {
        unreachable!("a ruin id names a spawn");
    };
    if !found.adopted {
        return Err(OpError::MegastructureKept {
            megastructure: id,
            edit,
            reason: "it is written in a shape the editor does not write, so it stays as written"
                .to_owned(),
        });
    }
    Ok(spawn)
}

/// The distance and the game's angle an orbit the editor writes gives as numbers.
fn numbers(orbit: &Orbit) -> Option<(f64, f64)> {
    Some((orbit.distance.number()?, orbit.angle.number()?))
}

/// The point `distance` and the game's `angle` name about the origin, to the decimals a
/// coordinate is written with.
fn point(distance: f64, angle: f64) -> (f64, f64) {
    let (x, y) = point_at((0.0, 0.0), distance, angle);
    (rounded(x) + 0.0, rounded(y) + 0.0)
}

pub(super) fn add_megastructure(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    spec: &NewMegastructure,
) -> Result<Planned, OpError> {
    check_text("a megastructure type", &spec.kind, Form::Bare)?;
    let refuse = |reason: &str| OpError::MegastructureRefused {
        kind: spec.kind.clone(),
        reason: MegastructureRefusal::Other(reason.to_owned()),
    };
    let save_only = [
        (spec.owner.is_some(), "a scenario's ruin has no owner"),
        (spec.bypass.is_some(), "a scenario's ruin spawns no bypass"),
        (
            spec.construction.is_some() || spec.left_out > 0,
            "a scenario's ruin runs no construction",
        ),
        (spec.planet.is_some(), "a scenario's ruin spawns no planet"),
        (spec.name.is_some(), "a scenario's ruin takes no name"),
    ];
    if let Some((_, reason)) = save_only.iter().find(|(refused, _)| *refused) {
        return Err(refuse(reason));
    }
    let (text, on_star) = match &spec.at {
        NewMegastructurePlace::Body {
            body, body_flags, ..
        } if *body == STAR_BODY => {
            if !body_flags.is_empty() {
                return Err(refuse("a scenario's ruin sets no planet flag"));
            }
            (placements::ruin_on_star_text(&spec.kind), true)
        }
        NewMegastructurePlace::Body { .. } | NewMegastructurePlace::Beside { .. } => {
            return Err(refuse(
                "a scenario places a ruin on its system's main star or at a point of its own",
            ));
        }
        &NewMegastructurePlace::Free { x, y } => {
            if !(x.is_finite() && y.is_finite()) {
                return Err(OpError::NotFinite);
            }
            let (distance, angle) = game_at((0.0, 0.0), (x, y));
            (placements::ruin_at_text(&spec.kind, distance, angle), false)
        }
    };
    known(s, system)?;
    let name = named(&s.graph, system);
    if system >= SYSTEMS {
        return Err(refuse(&format!(
            "the editor addresses the ruins of systems with ids below {SYSTEMS}"
        )));
    }
    let edit = plan.edit(&s.doc, system)?;
    let (block, placed) = read(edit, system)?;
    let ruins: Vec<&Placed> = placed
        .iter()
        .filter(|p| matches!(p.statement, Statement::SpawnMegastructure(_)))
        .collect();
    if on_star
        && let Some(held) = ruins.iter().find(|p| {
            matches!(&p.statement, Statement::SpawnMegastructure(spawn)
                if matches!(&spawn.place, SpawnPlace::OnBody { target, .. } if target == placements::STAR))
        })
    {
        return Err(OpError::MegastructureRefused {
            kind: spec.kind.clone(),
            reason: MegastructureRefusal::HoldsMegastructure {
                body: STAR_BODY,
                planet: format!("the star of {name}"),
                row: held.id,
            },
        });
    }
    let id = ruin_id(system, ruins.len()).ok_or_else(|| {
        refuse(&format!(
            "{name} holds {PER_SYSTEM} ruins, the most the editor addresses"
        ))
    })?;
    effect_block::splice(edit, block.as_ref(), &[], &[text])?;
    Ok(Planned {
        description: format!("Added megastructure {} in {name}", spec.kind),
        inverse: Op::RemoveMegastructure {
            megastructure: id,
            construction: None,
            left_out: 0,
        },
    })
}

pub(super) fn move_megastructure(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    at: MegastructurePlace,
) -> Result<Planned, OpError> {
    let system = ruin_system(s, id)?;
    let name = named(&s.graph, system);
    let edit = plan.edit(&s.doc, system)?;
    let (_, placed) = read(edit, system)?;
    let spawn = ruin(&placed, id, MegastructureEdit::Move)?;
    let kept = |reason: &str| OpError::MegastructureKept {
        megastructure: id,
        edit: MegastructureEdit::Move,
        reason: reason.to_owned(),
    };
    let (orbit, x, y) = match (&spawn.place, at) {
        (SpawnPlace::Free(orbit), MegastructurePlace::Free { x, y }) => (orbit, x, y),
        (SpawnPlace::OnBody { .. }, MegastructurePlace::Body { body }) if body == STAR_BODY => {
            return Err(OpError::unchanged(
                format!("megastructure {} in {name}", spawn.kind),
                "stands on the star already",
            ));
        }
        (SpawnPlace::OnBody { .. }, _) => return Err(kept("a ruin on the star stays on it")),
        _ => return Err(kept("a ruin at a point of its own goes to another point")),
    };
    if !(x.is_finite() && y.is_finite()) {
        return Err(OpError::NotFinite);
    }
    let (distance, angle) = game_at((0.0, 0.0), (x, y));
    let text = placements::ruin_at_text(&spawn.kind, distance, angle);
    let (was_distance, was_angle) = numbers(orbit).expect("an adopted ruin's orbit is numbers");
    let old = point(was_distance, was_angle);
    if text == placements::ruin_at_text(&spawn.kind, was_distance, was_angle) {
        return Err(OpError::unchanged(
            format!("megastructure {} in {name}", spawn.kind),
            "stands there already",
        ));
    }
    let (span, kind) = (spawn.span, spawn.kind.clone());
    edit.bytes().replace_span(span, text);
    let description = format!(
        "Moved megastructure {kind} in {name} from {} to {}",
        polar(old),
        polar((x, y))
    );
    Ok(Planned {
        inverse: restored(s, system, &description)?,
        description,
    })
}

pub(super) fn remove_megastructure(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    construction: Option<&MegastructureConstruction>,
    left_out: u32,
) -> Result<Planned, OpError> {
    let system = ruin_system(s, id)?;
    if construction.is_some() || left_out > 0 {
        return Err(OpError::MegastructureKept {
            megastructure: id,
            edit: MegastructureEdit::Delete,
            reason: "a scenario's ruin runs no construction to take back".to_owned(),
        });
    }
    let name = named(&s.graph, system);
    let edit = plan.edit(&s.doc, system)?;
    let (block, placed) = read(edit, system)?;
    let spawn = ruin(&placed, id, MegastructureEdit::Delete)?;
    let (span, kind) = (spawn.span, spawn.kind.clone());
    effect_block::splice(edit, block.as_ref(), &[span], &[])?;
    let description = format!("Removed megastructure {kind} from {name}");
    Ok(Planned {
        inverse: restored(s, system, &description)?,
        description,
    })
}

/// The ambient object `id` names in `placed` and the point it stands at about its main star,
/// refused when it is in a shape the editor does not write.
fn ambient_object(placed: &[Placed], id: u32) -> Result<(&AmbientObject, (f64, f64)), OpError> {
    let found = placed
        .iter()
        .find(|p| p.id == Some(id))
        .ok_or(OpError::UnknownAmbientObject(id))?;
    let (Statement::AmbientObject(object), true) = (&found.statement, found.adopted) else {
        return Err(OpError::unchanged(
            format!("ambient object #{id}"),
            "is written in a shape the editor does not write, so it stays as written",
        ));
    };
    let at = object
        .at
        .as_ref()
        .expect("an adopted ambient object has its point");
    Ok((object, point(at.distance, at.angle)))
}

fn ambient_system(s: &Session, id: u32) -> Result<u32, OpError> {
    placed::ambient_object(id)
        .map(|(system, _)| system)
        .filter(|system| s.graph.systems.contains_key(system))
        .ok_or(OpError::UnknownAmbientObject(id))
}

pub(super) fn add_ambient_object(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    kind: &str,
    (x, y): (f64, f64),
) -> Result<Planned, OpError> {
    check_text("an ambient object type", kind, Form::Bare)?;
    if !(x.is_finite() && y.is_finite()) {
        return Err(OpError::NotFinite);
    }
    known(s, system)?;
    let name = named(&s.graph, system);
    if system >= SYSTEMS {
        return Err(OpError::unchanged(
            format!("{name}'s ambient objects"),
            format!(
                "are not addressed: the editor addresses those of systems with ids below {SYSTEMS}"
            ),
        ));
    }
    let edit = plan.edit(&s.doc, system)?;
    let (block, placed) = read(edit, system)?;
    let held = placed
        .iter()
        .filter(|p| matches!(p.statement, Statement::AmbientObject(_)))
        .count();
    let id = ambient_object_id(system, held).ok_or_else(|| {
        OpError::unchanged(
            format!("{name}'s ambient objects"),
            format!("number {PER_SYSTEM}, the most the editor addresses"),
        )
    })?;
    let (distance, angle) = game_at((0.0, 0.0), (x, y));
    let texts = placements::ambient_object_texts(kind, distance, angle);
    effect_block::splice(edit, block.as_ref(), &[], &texts)?;
    Ok(Planned {
        description: format!("Added ambient object {kind} in {name}"),
        inverse: Op::RemoveAmbientObject { ambient_object: id },
    })
}

pub(super) fn move_ambient_object(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    (x, y): (f64, f64),
) -> Result<Planned, OpError> {
    if !(x.is_finite() && y.is_finite()) {
        return Err(OpError::NotFinite);
    }
    let system = ambient_system(s, id)?;
    let name = named(&s.graph, system);
    let edit = plan.edit(&s.doc, system)?;
    let (_, placed) = read(edit, system)?;
    let (object, old) = ambient_object(&placed, id)?;
    let at = object
        .at
        .as_ref()
        .expect("an adopted ambient object has its point");
    let (distance, angle) = game_at((0.0, 0.0), (x, y));
    let [_, text] = placements::ambient_object_texts(&object.kind, distance, angle);
    let [_, now] = placements::ambient_object_texts(&object.kind, at.distance, at.angle);
    if text == now {
        return Err(OpError::unchanged(
            format!("ambient object {} in {name}", object.kind),
            "stands there already",
        ));
    }
    let (span, kind) = (at.span, object.kind.clone());
    edit.bytes().replace_span(span, text);
    let description = format!(
        "Moved ambient object {kind} in {name} from {} to {}",
        polar(old),
        polar((x, y))
    );
    Ok(Planned {
        inverse: restored(s, system, &description)?,
        description,
    })
}

pub(super) fn remove_ambient_object(
    plan: &mut Plan,
    s: &Session,
    id: u32,
) -> Result<Planned, OpError> {
    let system = ambient_system(s, id)?;
    let name = named(&s.graph, system);
    let edit = plan.edit(&s.doc, system)?;
    let (block, placed) = read(edit, system)?;
    let (object, _) = ambient_object(&placed, id)?;
    let span = Statement::AmbientObject(object.clone()).span();
    let kind = object.kind.clone();
    effect_block::splice(edit, block.as_ref(), &[span], &[])?;
    let description = format!("Removed ambient object {kind} from {name}");
    Ok(Planned {
        inverse: restored(s, system, &description)?,
        description,
    })
}

pub(super) fn add_modifier(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    modifier: &str,
) -> Result<Planned, OpError> {
    check_text("a modifier", modifier, Form::Bare)?;
    known(s, system)?;
    let name = named(&s.graph, system);
    let edit = plan.edit(&s.doc, system)?;
    let (block, placed) = read(edit, system)?;
    if placed.iter().any(|p| adds(p, modifier)) {
        return Err(OpError::unchanged(
            format!("{name}'s modifier {modifier}"),
            "is added already",
        ));
    }
    effect_block::splice(
        edit,
        block.as_ref(),
        &[],
        &[placements::modifier_text(modifier)],
    )?;
    Ok(Planned {
        description: format!("Added modifier {modifier} to {name}"),
        inverse: Op::RemoveSystemModifier {
            system,
            modifier: modifier.to_owned(),
        },
    })
}

pub(super) fn remove_modifier(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    modifier: &str,
) -> Result<Planned, OpError> {
    known(s, system)?;
    let name = named(&s.graph, system);
    let edit = plan.edit(&s.doc, system)?;
    let (block, placed) = read(edit, system)?;
    let found: Vec<&Placed> = placed.iter().filter(|p| adds(p, modifier)).collect();
    let span: Span = match found.iter().find(|p| p.adopted) {
        Some(p) => p.statement.span(),
        None if found.is_empty() => {
            return Err(OpError::unchanged(
                format!("{name}'s modifier {modifier}"),
                "is not added",
            ));
        }
        None => {
            return Err(OpError::unchanged(
                format!("{name}'s modifier {modifier}"),
                "is written in a shape the editor does not write, so it stays as written",
            ));
        }
    };
    effect_block::splice(edit, block.as_ref(), &[span], &[])?;
    let description = format!("Removed modifier {modifier} from {name}");
    Ok(Planned {
        inverse: restored(s, system, &description)?,
        description,
    })
}

/// Whether `placed` adds modifier `modifier`.
fn adds(placed: &Placed, modifier: &str) -> bool {
    matches!(&placed.statement, Statement::SystemModifier(m) if m.modifier == modifier)
}
