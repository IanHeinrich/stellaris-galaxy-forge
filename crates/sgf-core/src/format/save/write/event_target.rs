//! `AddEventTarget` and `RemoveEventTarget`: one top-level `saved_event_target` block, by
//! which the game's events find a planet, a system or a country.

use crate::NULL_ID;
use crate::emit::{Lines, quoted};
use crate::format::save::country_statement;
use crate::format::save::event_targets::{self, EventTarget};
use crate::format::save::write::planet_entry::named_planet;
use crate::keys;
use crate::ops::rules::{Form, check_text, named};
use crate::ops::{Emitted, EventTargetOf, Op, OpError, Plan, Planned, Subject};
use crate::session::Session;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    name: &str,
    target: EventTargetOf,
) -> Result<Planned, OpError> {
    check_text("an event target name", name, Form::Bare)?;
    if event_targets::find(&s.doc, name).is_some() {
        return Err(OpError::Unchanged {
            what: format!("event target {name}"),
            state: "is already saved".to_owned(),
        });
    }
    let shown = target_named(s, target)?;
    let (at, indent) = event_targets::insert_at(&s.doc);
    plan.emit(Emitted::Record, at, target_block(&indent, name, target));
    Ok(Planned {
        description: format!("Added event target {name} for {shown}"),
        inverse: Op::RemoveEventTarget {
            name: name.to_owned(),
        },
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, name: &str) -> Result<Planned, OpError> {
    let (anchor, EventTarget { target, .. }) = event_targets::find(&s.doc, name)
        .ok_or_else(|| OpError::UnknownEventTarget(name.to_owned()))?;
    if !anchor.is_inserted() {
        return Err(OpError::Unchanged {
            what: format!("event target {name}"),
            state: "was in the file when it was opened, and only an added one can be removed"
                .to_owned(),
        });
    }
    let subject = Subject::Record(anchor);
    let target = target.ok_or_else(|| {
        subject.parse_error(0, "the target is neither a planet, a system nor a country")
    })?;
    plan.erase(&s.doc, subject, anchor)?;
    Ok(Planned {
        description: format!("Removed event target {name}"),
        inverse: Op::AddEventTarget {
            name: name.to_owned(),
            target,
        },
    })
}

/// What a description calls what `target` names, refused when the save does not hold it.
fn target_named(s: &Session, target: EventTargetOf) -> Result<String, OpError> {
    match target {
        EventTargetOf::Body { body } => named_planet(s, body),
        EventTargetOf::System { system } => match s.graph.systems.contains_key(&system) {
            true => Ok(named(&s.graph, system)),
            false => Err(OpError::UnknownSystem(system)),
        },
        EventTargetOf::Country { country } => {
            country_statement(&s.doc, country)?;
            Ok(format!("empire {country}"))
        }
    }
}

/// The block for target `name`, indented with `indent` and ending its line.
fn target_block(indent: &[u8], name: &str, target: EventTargetOf) -> Vec<u8> {
    let (kind, id) = match target {
        EventTargetOf::Body { body } => (keys::PLANET, body),
        EventTargetOf::System { system } => (keys::GALACTIC_OBJECT, system),
        EventTargetOf::Country { country } => (keys::COUNTRY, country),
    };
    let mut w = Lines::new(indent);
    w.open(0, keys::SAVED_EVENT_TARGET);
    w.pair(1, keys::TYPE, kind);
    w.pair(1, keys::ID, &id.to_string());
    w.pair(1, keys::OPENER_ID, &NULL_ID.to_string());
    w.pair(1, keys::NAME, &quoted(name));
    w.close(0);
    w.into_bytes()
}
