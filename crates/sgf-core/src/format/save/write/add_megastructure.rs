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
use crate::document::Document;
use crate::emit::megastructure::{BypassRow, MegastructureRow, bypass_row, megastructure_row};
use crate::emit::{Lines, inline};
use crate::entity::facts::megastructure;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::alloc::{SlotTable, TableEnd, next_id};
use crate::format::save::write::add_system::{day_one, write_slot};
use crate::format::save::write::id_list::append;
use crate::format::save::write::megastructure_links::{self, MEGASTRUCTURES, drop_bypass, unlink};
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text, named};
use crate::ops::{
    Edit, Emitted, MegastructurePlace, NewBypass, Op, OpError, ParseAt, Plan, Planned, SavedTable,
    Subject,
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
                .map_err(|reason| OpError::parse(ParseAt::Body(body), 0, reason))?;
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
    let tied = megastructure_links::read(&s.doc, id)?.ok_or(OpError::UnknownEntity {
        table: SavedTable::Megastructure,
        id,
    })?;
    if s.doc.added().get(EntityKind::Megastructure, id).is_none() {
        return Err(OpError::MegastructureNotAdded(id));
    }
    let system = tied
        .system
        .ok_or_else(|| OpError::parse(ParseAt::Record, 0, "missing coordinate.origin"))?;
    let bypass = match tied.bypass {
        Some(bypass) => row(&s.doc, Table::Bypass, bypass)?.map(|row| NewBypass {
            kind: read::text(&row.node, keys::TYPE, row.src),
            active: read::scalar(&row.node, keys::ACTIVE, row.src) == Some("yes"),
        }),
        None => None,
    };
    let ruined_orbital_ring = match tied.planet {
        Some(body) => ruin_flagged(s, body)?,
        None => false,
    };
    let at = match tied.planet {
        Some(body) => MegastructurePlace::Body { body },
        None => {
            let found =
                row(&s.doc, MEGASTRUCTURES, id)?.ok_or(OpError::MegastructureNotAdded(id))?;
            let (x, y) = read::coordinate(&found.node, found.src)
                .map_err(|reason| OpError::parse(ParseAt::Record, 0, reason))?;
            MegastructurePlace::Free { x, y }
        }
    };

    let mut table = SlotTable::megastructures(&s.doc)?;
    table.free(plan, &s.doc, Subject::Record(tied.anchor), id, tied.anchor)?;
    table.settle(plan, &s.doc)?;
    unlink(plan, s, &tied, None)?;
    if let Some(bypass) = tied.bypass {
        drop_bypass(plan, s, system, bypass, None)?;
    }
    let inverse = Op::AddMegastructure {
        system,
        kind: tied.kind.clone(),
        at,
        owner: tied.owner,
        bypass,
        ruined_orbital_ring,
    };
    Ok(Planned {
        description: format!(
            "Removed megastructure #{id} ({}) from {}",
            tied.kind,
            named(&s.graph, system)
        ),
        inverse,
    })
}

/// Whether body `body` has the ruined orbital ring flag.
fn ruin_flagged(s: &Session, body: u32) -> Result<bool, OpError> {
    let (node, src) = planet_entity(&s.doc, body)?;
    Ok(node
        .find(keys::FLAGS, src)
        .is_some_and(|flags| flags.find(keys::RUINED_ORBITAL_RING_PLANET, src).is_some()))
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
