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
use crate::archive;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::megastructure::{BypassRow, MegastructureRow, bypass_row, megastructure_row};
use crate::entity::facts::megastructure;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::alloc::{SlotTable, TableEnd, next_id};
use crate::format::save::write::add_system::{day_one, write_slot};
use crate::format::save::write::bodies::frame;
use crate::format::save::write::construction;
use crate::format::save::write::id_list::append;
use crate::format::save::write::megastructure_links::{
    self, HAS_ORBITAL, MEGASTRUCTURES, add_flags, drop_bypass, unlink,
};
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::planet_entry::{is_star, role};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text, named};
use crate::ops::{
    Edit, Emitted, MegastructureConstruction, MegastructurePlace, NewBypass, Op, OpError, ParseAt,
    Plan, Planned, SavedTable, Subject,
};
use crate::overlay::Anchor;
use crate::projections::name::NameTemplate;
use crate::projections::read;
use crate::session::Session;
use crate::{plural, plural_of};

/// The bypass types a row the editor adds may stand for.
const GATEWAY: &str = "gateway";
const RELAY: &str = "relay_bypass";

/// What [`Op::AddMegastructure`] asks for.
pub(crate) struct NewRow<'a> {
    pub system: u32,
    pub kind: &'a str,
    pub name: Option<&'a NameTemplate>,
    pub at: MegastructurePlace,
    pub owner: Option<u32>,
    pub bypass: Option<&'a NewBypass>,
    pub ruined_orbital_ring: bool,
    pub megastructure_flag: bool,
    pub orbital_flag: bool,
    pub star_only: bool,
    pub construction: Option<&'a MegastructureConstruction>,
    pub left_out: u32,
}

pub(crate) fn plan_add(plan: &mut Plan, s: &Session, new: &NewRow<'_>) -> Result<Planned, OpError> {
    check_text("a megastructure type", new.kind, Form::Bare)?;
    if let Some(name) = new.name {
        check_name(name)?;
    }
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
            if new.ruined_orbital_ring
                || new.megastructure_flag
                || new.orbital_flag
                || new.star_only
            {
                return Err(refuse(
                    "it stands on or around a planet or star, and a free point has none".to_owned(),
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
            if planet_flag(&node, src, keys::HAS_MEGASTRUCTURE) {
                return Err(refuse(format!(
                    "the game counts a megastructure built at planet {body} already"
                )));
            }
            if new.star_only && !is_star_body(s, system, body, &node, src)? {
                return Err(refuse(format!(
                    "it is built only around a star, and planet {body} is not one"
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
    if let Some(built) = new.construction {
        construction::check(s, new.kind, system, new.owner, built)?;
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
        name: new.name,
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
    if let Some(built) = new.construction {
        construction::write_modifiers(plan, s, new.kind, system, built)?;
        construction::write_rest(plan, s, system, new.owner, built)?;
    }
    if let Some(body) = body {
        let mut flags = Vec::new();
        if new.megastructure_flag {
            flags.push((keys::HAS_MEGASTRUCTURE, today(&s.doc)?));
        }
        if new.ruined_orbital_ring {
            flags.push((keys::RUINED_ORBITAL_RING_PLANET, day_one(&s.doc)?));
        }
        if new.orbital_flag {
            flags.push((HAS_ORBITAL, today(&s.doc)?));
        }
        tie(plan.edit_planet(&s.doc, body, system)?, id, &flags)?;
    }
    let mut with: Vec<String> = bypass_id
        .map(|bypass| format!("bypass #{bypass}"))
        .into_iter()
        .collect();
    with.extend(new.construction.map(counts).filter(|c| !c.is_empty()));
    let mut with = match with.as_slice() {
        [] => String::new(),
        parts => format!(", with {}", parts.join(" and ")),
    };
    if new.left_out > 0 {
        with.push_str(&format!(
            ", leaving out {} of its construction",
            plural(new.left_out as usize, "effect")
        ));
    }
    Ok(Planned {
        description: format!(
            "Added megastructure #{id} ({}) in {}{with}",
            new.kind,
            named(&s.graph, system)
        ),
        inverse: Op::RemoveMegastructure {
            megastructure: id,
            construction: new.construction.cloned(),
        },
    })
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    built: Option<&MegastructureConstruction>,
) -> Result<Planned, OpError> {
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
    let (ruined_orbital_ring, megastructure_flag, orbital_flag) = match tied.planet {
        Some(body) => {
            let (node, src) = planet_entity(&s.doc, body)?;
            (
                planet_flag(&node, src, keys::RUINED_ORBITAL_RING_PLANET),
                planet_flag(&node, src, keys::HAS_MEGASTRUCTURE),
                planet_flag(&node, src, HAS_ORBITAL),
            )
        }
        None => (false, false, false),
    };
    let found = row(&s.doc, MEGASTRUCTURES, id)?.ok_or(OpError::MegastructureNotAdded(id))?;
    let name = found
        .node
        .find(keys::NAME, found.src)
        .map(|_| read::name(&found.node, found.src));
    let at = match tied.planet {
        Some(body) => MegastructurePlace::Body { body },
        None => {
            let (x, y) = read::coordinate(&found.node, found.src)
                .map_err(|reason| OpError::parse(ParseAt::Record, 0, reason))?;
            MegastructurePlace::Free { x, y }
        }
    };

    let built = built.cloned().or_else(|| construction::of_session(s, id));
    let taken = match &built {
        Some(built) => construction::take_back(plan, s, system, tied.owner, built)?,
        None => MegastructureConstruction::default(),
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
        name,
        at,
        owner: tied.owner,
        bypass,
        ruined_orbital_ring,
        megastructure_flag,
        orbital_flag,
        star_only: false,
        construction: (!taken.is_empty()).then(|| taken.clone()),
        left_out: 0,
    };
    let with = match counts(&taken) {
        counted if counted.is_empty() => String::new(),
        counted => format!(", with {counted}"),
    };
    Ok(Planned {
        description: format!(
            "Removed megastructure #{id} ({}) from {}{with}",
            tied.kind,
            named(&s.graph, system)
        ),
        inverse,
    })
}

/// Refuse a row name with a key or variable that cannot be written.
fn check_name(name: &NameTemplate) -> Result<(), OpError> {
    check_text("a name key", &name.key, Form::Quoted)?;
    for variable in &name.variables {
        check_text("a name variable", &variable.name, Form::Quoted)?;
        check_name(&variable.value)?;
    }
    Ok(())
}

/// "12 modifiers, 12 deposits and a counter", or nothing for an empty construction.
fn counts(built: &MegastructureConstruction) -> String {
    let mut parts = Vec::new();
    if !built.modifiers.is_empty() {
        parts.push(plural(built.modifiers.len(), "modifier"));
    }
    if !built.deposits.is_empty() {
        parts.push(plural(built.deposits.len(), "deposit"));
    }
    if !built.variables.is_empty() {
        parts.push(plural_of(built.variables.len(), "counter", "counters"));
    }
    match parts.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// Whether the planet `node` holds has the planet flag `flag`.
fn planet_flag(node: &Node, src: &[u8], flag: &str) -> bool {
    node.find(keys::FLAGS, src)
        .is_some_and(|flags| flags.find(flag, src).is_some())
}

/// Whether body `body` of `system`, whose entry is `node`, is a star.
fn is_star_body(
    s: &Session,
    system: u32,
    body: u32,
    node: &Node,
    src: &[u8],
) -> Result<bool, OpError> {
    let primary = frame(s, system)?
        .first()
        .is_some_and(|first| first.body.id == body);
    Ok(is_star(role(node, src, primary, s.star_classes())))
}

/// The save's current date as the game dates a planet flag it sets: hours counted from a
/// fixed origin, in the game's years of twelve 30-day months. The save's `meta` holds the
/// date it was written on.
pub(crate) fn today(doc: &Document) -> Result<String, OpError> {
    let date = archive::parse_meta(doc.meta())
        .map(|meta| meta.date)
        .map_err(|_| OpError::MissingKey(keys::meta::DATE))?;
    flag_hours(&date)
        .map(|hours| hours.to_string())
        .ok_or_else(|| OpError::parse(ParseAt::Meta, 0, format!("date {date:?} is not a date")))
}

/// Days in each of the game's months and years.
const MONTH_DAYS: u64 = 30;
const YEAR_DAYS: u64 = 360;
/// The hour count of year 0's first day: `2200.01.01` is 62808000, the date of
/// `game_started` in both 4.x samples.
const FLAG_ORIGIN: u64 = 43_800_000;

/// `yyyy.mm.dd` as a planet flag's date.
fn flag_hours(date: &str) -> Option<u64> {
    let mut parts = date.split('.').map(|part| part.parse::<u64>().ok());
    let (year, month, day) = (parts.next()??, parts.next()??, parts.next()??);
    if !(1..=12).contains(&month) || !(1..=MONTH_DAYS).contains(&day) {
        return None;
    }
    let days = year * YEAR_DAYS + (month - 1) * MONTH_DAYS + day - 1;
    Some(days * 24 + FLAG_ORIGIN)
}

/// The `graphical_culture` the country `edit` holds names, when it names one.
pub(crate) fn culture_of(edit: &Edit) -> Result<Option<String>, OpError> {
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

/// Tie the body `edit` holds to row `id`, with the planet flags `flags`, each with its date.
pub(crate) fn tie(edit: &mut Edit, id: u32, flags: &[(&str, String)]) -> Result<(), OpError> {
    insert_key(edit, &[], &place::planet::MEGASTRUCTURE, |_| {
        format!("{}={id}", keys::MEGASTRUCTURE)
    })?;
    add_flags(edit, flags, &place::planet::FLAGS)
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
