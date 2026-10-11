//! `AddMegastructure` and `RemoveMegastructure`: one `megastructures` row written finished,
//! with the `bypasses` row a gateway or a relay stands for, and taken out again.
//!
//! A row takes the slot past the highest the table has used, never a dead one: a dead
//! slot's old id may be named in the save's record of destroyed structures. Its bypass
//! takes the id past the highest the `bypasses` table has held this session, and is
//! connected both ways to the bypasses it reaches: every other gateway, or the relays of
//! the systems a lane joins to its own. The game fills in the lock fields on load.

use std::collections::BTreeMap;

use crate::NULL_ID;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::megastructure::{BypassRow, MegastructureRow, bypass_row, megastructure_row};
use crate::emit::{Lines, inline};
use crate::entity::facts::megastructure::{self, MegastructureFacts};
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::alloc::{SlotTable, TableEnd, next_id};
use crate::format::save::write::add_system::{day_one, write_slot};
use crate::format::save::write::id_list::{Emptied, append, unlist};
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text, named};
use crate::ops::{
    Edit, Emitted, MegastructurePlace, NewBypass, Op, OpError, Plan, Planned, Subject,
};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;

/// The bypass types a row the editor adds may stand for.
const GATEWAY: &str = "gateway";
const RELAY: &str = "relay_bypass";

/// What [`Op::AddMegastructure`] asks for.
pub(crate) struct NewRow<'a> {
    pub system: u32,
    pub kind: &'a str,
    pub at: MegastructurePlace,
    pub owner: Option<u32>,
    pub bypass: Option<&'a NewBypass>,
    pub ruined_orbital_ring: bool,
}

pub(crate) fn plan_add(plan: &mut Plan, s: &Session, new: &NewRow<'_>) -> Result<Planned, OpError> {
    check_text("a megastructure type", new.kind, Form::Bare)?;
    let system = new.system;
    if !s.graph.systems.contains_key(&system) {
        return Err(OpError::UnknownSystem(system));
    }
    let refuse = |reason: String| OpError::MegastructureRefused {
        kind: new.kind.to_owned(),
        reason,
    };
    let live = Live::read(&s.doc)?;
    let (at, body) = match new.at {
        MegastructurePlace::Free { x, y } => {
            if !(x.is_finite() && y.is_finite()) {
                return Err(OpError::NotFinite);
            }
            if new.ruined_orbital_ring {
                return Err(refuse(
                    "the ruined orbital ring flag goes on a planet, and a free point has none"
                        .to_owned(),
                ));
            }
            ((x, y), None)
        }
        MegastructurePlace::Body { body } => {
            let (node, src) = planet_entity(&s.doc, body)?;
            if planet_system(&node, src, body)? != system {
                return Err(OpError::NotABody { body, system });
            }
            let held = read::scalar_u32(&node, keys::MEGASTRUCTURE, src)
                .filter(|&id| id != NULL_ID)
                .or_else(|| live.on_body(body));
            if let Some(held) = held {
                return Err(refuse(format!(
                    "planet {body} already has megastructure {held}"
                )));
            }
            let at = read::coordinate(&node, src)
                .map_err(|reason| OpError::parse(crate::ops::ParseAt::Body(body), 0, reason))?;
            (at, Some(body))
        }
    };
    if let Some(bypass) = new.bypass {
        if bypass.kind != GATEWAY && bypass.kind != RELAY {
            return Err(refuse(format!(
                "its bypass is a {}, which has not been tried in game",
                bypass.kind
            )));
        }
        if live.bypass_in(system, &bypass.kind).is_some() {
            return Err(refuse(format!(
                "{} already has a {}",
                named(&s.graph, system),
                bypass.kind
            )));
        }
    }
    let culture = match new.owner {
        Some(owner) => Some(culture_of(plan.edit_country(&s.doc, owner)?)?),
        None => None,
    };

    let mut table = SlotTable::megastructures(&s.doc)?;
    let slot = table.append();
    let id = slot.id();
    let bypass_id = match new.bypass {
        Some(_) => Some(next_id(&s.doc, Table::Bypass)?),
        None => None,
    };
    let row = MegastructureRow {
        id,
        kind: new.kind,
        at,
        system,
        owner: new
            .owner
            .map(|owner| (owner, culture.as_ref().and_then(Option::as_deref))),
        planet: body.unwrap_or(NULL_ID),
        bypass: bypass_id,
    };
    write_slot(plan, &s.doc, slot, &mut table, Emitted::Record, |indent| {
        megastructure_row(indent, &row)
    })?;
    if let (Some(bypass), Some(bypass_id)) = (new.bypass, bypass_id) {
        connect(plan, s, &live, system, id, bypass_id, bypass)?;
    }
    append(
        plan.edit(&s.doc, system)?,
        &place::system::MEGASTRUCTURES,
        &[id],
    )?;
    if let Some(owner) = new.owner {
        append(
            plan.edit_country(&s.doc, owner)?,
            &place::country::OWNED_MEGASTRUCTURES,
            &[id],
        )?;
    }
    if let Some(body) = body {
        let date = match new.ruined_orbital_ring {
            true => Some(day_one(&s.doc)?),
            false => None,
        };
        tie(plan.edit_planet(&s.doc, body, system)?, id, date.as_deref())?;
    }
    let with = match bypass_id {
        Some(bypass) => format!(", with bypass #{bypass}"),
        None => String::new(),
    };
    Ok(Planned {
        description: format!(
            "Added megastructure #{id} ({}) in {}{with}",
            new.kind,
            named(&s.graph, system)
        ),
        inverse: Op::RemoveMegastructure { megastructure: id },
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let Some(slot) = s.doc.added().get(EntityKind::Megastructure, id) else {
        return Err(OpError::MegastructureNotAdded(id));
    };
    let found = row(&s.doc, Table::Entity(EntityKind::Megastructure), id)?
        .ok_or(OpError::MegastructureNotAdded(id))?;
    let facts = megastructure::read(&found.node, found.src);
    let system = facts.origin.ok_or_else(|| {
        OpError::parse(crate::ops::ParseAt::Record, 0, "missing coordinate.origin")
    })?;
    let bypass = match facts.bypass {
        Some(bypass) => row(&s.doc, Table::Bypass, bypass)?.map(|row| {
            let kind = read::text(&row.node, keys::TYPE, row.src);
            let active = read::scalar(&row.node, keys::ACTIVE, row.src) == Some("yes");
            (bypass, row.anchor, NewBypass { kind, active })
        }),
        None => None,
    };
    let ruined_orbital_ring = match facts.planet {
        Some(body) => untie(plan, s, body, system, id)?,
        None => false,
    };

    let mut table = SlotTable::megastructures(&s.doc)?;
    table.free(plan, &s.doc, Subject::Record(slot), id, slot)?;
    table.settle(plan, &s.doc)?;
    let edit = plan.edit(&s.doc, system)?;
    unlist(edit, keys::MEGASTRUCTURES, &[id], Emptied::Drop)?;
    if let Some((bypass, anchor, _)) = &bypass {
        unlist(edit, keys::BYPASSES, &[*bypass], Emptied::Drop)?;
        disconnect(plan, s, *bypass, *anchor)?;
    }
    if let Some(owner) = facts.owner {
        unlist(
            plan.edit_country(&s.doc, owner)?,
            keys::OWNED_MEGASTRUCTURES,
            &[id],
            Emptied::Drop,
        )?;
    }
    let inverse = Op::AddMegastructure {
        system,
        kind: facts.kind.clone(),
        at: place_of(&facts)?,
        owner: facts.owner,
        bypass: bypass.map(|(_, _, bypass)| bypass),
        ruined_orbital_ring,
    };
    Ok(Planned {
        description: format!(
            "Removed megastructure #{id} ({}) from {}",
            facts.kind,
            named(&s.graph, system)
        ),
        inverse,
    })
}

/// Where a row stands, as the add that writes it back takes it.
fn place_of(facts: &MegastructureFacts) -> Result<MegastructurePlace, OpError> {
    if let Some(body) = facts.planet {
        return Ok(MegastructurePlace::Body { body });
    }
    let (x, y) = facts
        .at
        .ok_or_else(|| OpError::parse(crate::ops::ParseAt::Record, 0, "missing coordinate"))?;
    Ok(MegastructurePlace::Free { x, y })
}

/// The `graphical_culture` the country `edit` holds names, when it names one.
fn culture_of(edit: &Edit) -> Result<Option<String>, OpError> {
    let country = edit.entity()?;
    Ok(read::scalar(country, keys::GRAPHICAL_CULTURE, &edit.buf).map(str::to_owned))
}

/// Write the new bypass `bypass_id`, owned by row `id` in `system`, and its id into the
/// lists of every bypass it connects to.
fn connect(
    plan: &mut Plan,
    s: &Session,
    live: &Live,
    system: u32,
    id: u32,
    bypass_id: u32,
    bypass: &NewBypass,
) -> Result<(), OpError> {
    let partners: Vec<&LiveBypass> = match bypass.kind.as_str() {
        GATEWAY => live
            .bypasses
            .values()
            .filter(|b| b.kind == GATEWAY)
            .collect(),
        _ => {
            let neighbours: Vec<u32> = s
                .graph
                .systems
                .get(&system)
                .map(|node| node.lanes.iter().map(|lane| lane.to).collect())
                .unwrap_or_default();
            live.bypasses
                .values()
                .filter(|b| b.kind == RELAY && b.system.is_some_and(|s| neighbours.contains(&s)))
                .collect()
        }
    };
    let connections: Vec<u32> = partners.iter().map(|b| b.id).collect();
    let active_connections: Vec<u32> = partners
        .iter()
        .filter(|b| b.active && bypass.active)
        .map(|b| b.id)
        .collect();
    let text = |indent: &[u8]| {
        bypass_row(
            indent,
            &BypassRow {
                id: bypass_id,
                kind: &bypass.kind,
                active: bypass.active,
                connections: &connections,
                active_connections: &active_connections,
                owner: id,
            },
        )
    };
    let mut end = TableEnd::of(&s.doc, Table::Bypass)?;
    let entry = text(end.indent());
    plan.emit(Emitted::Record, end.at(), end.shape(entry));
    for partner in partners {
        let edit = plan.edit_record(&s.doc, partner.anchor)?;
        append(edit, &place::bypass::CONNECTIONS, &[bypass_id])?;
        if partner.active && bypass.active {
            append(edit, &place::bypass::ACTIVE_CONNECTIONS, &[bypass_id])?;
        }
    }
    append(
        plan.edit(&s.doc, system)?,
        &place::system::BYPASSES,
        &[bypass_id],
    )?;
    Ok(())
}

/// Erase the inserted bypass at `anchor` and take its id out of every other bypass's lists.
fn disconnect(plan: &mut Plan, s: &Session, bypass: u32, anchor: Anchor) -> Result<(), OpError> {
    plan.erase(&s.doc, Subject::Record(anchor), anchor)?;
    for other in rows(&s.doc, Table::Bypass)? {
        if other.id == bypass {
            continue;
        }
        let lists = [keys::CONNECTIONS, keys::ACTIVE_CONNECTIONS];
        let names = lists
            .iter()
            .any(|key| read::ids(&other.node, key, other.src).contains(&bypass));
        if !names {
            continue;
        }
        let edit = plan.edit_record(&s.doc, other.anchor)?;
        for key in lists {
            unlist(edit, key, &[bypass], Emptied::Drop)?;
        }
    }
    Ok(())
}

/// Tie the body `edit` holds to row `id`, with the ruin flag dated `ruin` when given.
fn tie(edit: &mut Edit, id: u32, ruin: Option<&str>) -> Result<(), OpError> {
    insert_key(edit, &[], &place::planet::MEGASTRUCTURE, |_| {
        format!("{}={id}", keys::MEGASTRUCTURE)
    })?;
    let Some(date) = ruin else {
        return Ok(());
    };
    let flag = format!("{}={date}", keys::RUINED_ORBITAL_RING_PLANET);
    let flags = edit.entity()?.find(keys::FLAGS, &edit.buf).cloned();
    match flags.as_ref().and_then(|block| block.children().last()) {
        Some(last) => {
            let end = last.span().end;
            edit.bytes().insert_after(end, &flag);
        }
        None => {
            let write = |indent: &[u8]| {
                let mut w = Lines::new(indent);
                w.open(0, keys::FLAGS);
                w.line(1, &flag);
                w.close(0);
                inline(indent, &w.into_bytes())
            };
            match flags {
                Some(block) => {
                    let text = write(&edit.indent(block.span().start));
                    edit.bytes().replace_statement(block.span(), &text);
                }
                None => insert_key(edit, &[], &place::planet::FLAGS, write)?,
            }
        }
    }
    Ok(())
}

/// Take row `id` off body `body` of `system`: its `megastructure` key and the ruin flag,
/// the `flags` block going with its last flag. Returns whether the ruin flag stood.
fn untie(plan: &mut Plan, s: &Session, body: u32, system: u32, id: u32) -> Result<bool, OpError> {
    let edit = plan.edit_planet(&s.doc, body, system)?;
    let entity = edit.entity()?.clone();
    let tied = entity
        .find_all(keys::MEGASTRUCTURE, &edit.buf)
        .find(|node| node.scalar_str(&edit.buf).and_then(|t| t.parse().ok()) == Some(id))
        .map(Node::span);
    if let Some(span) = tied {
        edit.bytes().remove_statement(span);
    }
    let Some(flags) = entity.find(keys::FLAGS, &edit.buf) else {
        return Ok(false);
    };
    let Some(flag) = flags.find(keys::RUINED_ORBITAL_RING_PLANET, &edit.buf) else {
        return Ok(false);
    };
    let span = match flags.children().len() {
        1 => flags.span(),
        _ => flag.span(),
    };
    edit.bytes().remove_statement(span);
    Ok(true)
}

/// One live `bypasses` row, and the system its megastructure stands in.
struct LiveBypass {
    id: u32,
    anchor: Anchor,
    kind: String,
    active: bool,
    system: Option<u32>,
}

/// The live `megastructures` and `bypasses` rows an add looks at.
struct Live {
    /// Body → the first row tied to it.
    on_body: BTreeMap<u32, u32>,
    bypasses: BTreeMap<u32, LiveBypass>,
}

impl Live {
    fn read(doc: &Document) -> Result<Self, OpError> {
        let mut on_body = BTreeMap::new();
        let mut bypass_system = BTreeMap::new();
        for row in rows(doc, Table::Entity(EntityKind::Megastructure))? {
            let facts = megastructure::read(&row.node, row.src);
            if let Some(body) = facts.planet {
                on_body.entry(body).or_insert(row.id);
            }
            if let (Some(bypass), Some(system)) = (facts.bypass, facts.origin) {
                bypass_system.insert(bypass, system);
            }
        }
        let bypasses = rows(doc, Table::Bypass)?
            .into_iter()
            .map(|row| {
                let bypass = LiveBypass {
                    id: row.id,
                    anchor: row.anchor,
                    kind: read::text(&row.node, keys::TYPE, row.src),
                    active: read::scalar(&row.node, keys::ACTIVE, row.src) == Some("yes"),
                    system: bypass_system.get(&row.id).copied(),
                };
                (row.id, bypass)
            })
            .collect();
        Ok(Self { on_body, bypasses })
    }

    fn on_body(&self, body: u32) -> Option<u32> {
        self.on_body.get(&body).copied()
    }

    /// The bypass of type `kind` a megastructure in `system` stands for.
    fn bypass_in(&self, system: u32, kind: &str) -> Option<u32> {
        self.bypasses
            .values()
            .find(|b| b.system == Some(system) && b.kind == kind)
            .map(|b| b.id)
    }
}
