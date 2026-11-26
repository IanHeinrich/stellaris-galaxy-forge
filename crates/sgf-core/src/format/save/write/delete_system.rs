//! `DeleteSystem`, which inverts to `RestoreEntities`.
//!
//! A system goes as the game's `remove_system` leaves one: `<id>=none` in its slot and its
//! planets', its lanes gone from the other ends and its id out of every block of `clusters`,
//! where a game loading it left in crashes. Everything else that names the system or its
//! planets is the game's to clear or lets stand: deposits' holders, survey lists, the rim, a
//! nebula's member lines and the hyperlane lists among it. A system added since the file was
//! opened goes as `RemoveSystem` takes it.

use std::collections::{BTreeMap, BTreeSet};

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::read_spec;
use crate::format::save::write::id_list::{Emptied, unlist_in};
use crate::format::save::write::remove_system;
use crate::format::save::write::restore::{Saved, tombstone_planets, tombstoned};
use crate::format::save::write::system_kept;
use crate::format::save::{check_delete_systems, planet_entity, system_statement};
use crate::keys;
use crate::ops::rules::named;
use crate::ops::{OpError, Plan, Planned, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::plural;
use crate::session::Session;

pub(crate) fn plan_delete(plan: &mut Plan, s: &Session, system: u32) -> Result<Planned, OpError> {
    let doc = &s.doc;
    if doc.added().get(EntityKind::System, system).is_some() {
        return remove_system::plan_remove(plan, s, &[system]);
    }
    check_delete_systems(doc)?;
    if !s.graph.systems.contains_key(&system) {
        return Err(OpError::UnknownSystem(system));
    }
    let planets = planets(doc, system)?;
    system_kept::check(s, system, &planets)?;

    let removed = BTreeSet::from([system]);
    let mut saved = Saved::default();
    for &id in &s.graph.order {
        if id != system && s.graph.lane(id, system).is_some() {
            let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
            saved.keep(doc, SavedTable::System, id, anchor)?;
        }
    }
    remove_system::rewrite_lanes(plan, s, &removed, &BTreeMap::new())?;
    tombstone_planets(plan, doc, &mut saved, system, &planets)?;
    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    saved.keep(doc, SavedTable::System, system, anchor)?;
    let bytes = tombstoned(doc, anchor, system)?;
    plan.replace(doc, Subject::System(system), anchor, bytes)?;
    leave_clusters(plan, doc, &mut saved, system)?;
    plan.renumber(system, None);

    let named = named(&s.graph, system);
    let lanes = plural(remove_system::lane_count(s, &removed), "lane");
    Ok(Planned {
        description: format!("Deleted {named} and {lanes}"),
        inverse: saved.inverse(format!("Restored {named} and {lanes}")),
    })
}

/// The planets system `system` lists that the save holds.
fn planets(doc: &Document, system: u32) -> Result<Vec<u32>, OpError> {
    let mut held = Vec::new();
    for planet in read_spec::bodies(doc, system)? {
        match planet_entity(doc, planet) {
            Ok(_) => held.push(planet),
            Err(OpError::UnknownPlanet(_)) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(held)
}

/// Take `system` out of the `objects` of every block of `clusters` that lists it.
fn leave_clusters(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    system: u32,
) -> Result<(), OpError> {
    let Some(section) = doc.index().section(keys::CLUSTERS) else {
        return Ok(());
    };
    let anchor = Anchor::Original(section.stmt);
    let edit = plan.edit_record(doc, anchor)?;
    let clusters = edit.entity()?.children().iter();
    let lists: Vec<Node> = clusters
        .filter_map(|cluster| cluster.find(keys::OBJECTS, &edit.buf).cloned())
        .collect();
    let mut left = 0;
    for list in lists {
        left += unlist_in(edit, &list, &[system], Emptied::Drop);
    }
    if left > 0 {
        saved.keep(doc, SavedTable::Clusters, 0, anchor)?;
    }
    Ok(())
}
