//! What a nebula leaves on a member system besides its member line, written the way the
//! game's start event `game_start.50` writes it: the permanent `nebula_cloaking` modifier
//! (First Contact only), and one ambient object, its cloud, whose type suits the star.
//! Turbulent members carry `turbulent_nebula` and a `turbulent_nebula_*` cloud instead.
//! The cloud draws the member's system view; the modifiers give only the numbers.
//!
//! Nothing re-runs that event, so every op that takes a system into its first nebula or
//! out of its last one writes this here, and a system moving straight from one cloud to
//! another keeps what it has. A new cloud takes the ambient table's slot past the highest,
//! with `last_created_ambient_object` raised to it; a leaving one becomes the tombstone
//! `<id>=none`, or gives back the slot an op appended. Only the last nebula cloud a system
//! lists is its own: one an initializer or an event placed, flagged or not of the table's
//! types, is left alone.

use crate::archive;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::{
    AmbientEntry, ambient_entry, ambient_list, timed_modifier_item, timed_modifiers,
};
use crate::emit::{coord, inline, quoted};
use crate::format::save::alloc::{self, Slot, SlotTable};
use crate::format::save::galaxy::systems::{
    TURBULENT_NEBULA, star_flags, timed_modifiers as modifiers_of,
};
use crate::format::save::write::add_system::write_slot;
use crate::format::save::write::game_tables::{
    CLASS_A, FIRST_CONTACT, HOME_SYSTEM, OCEAN_PARADISE, TURBULENT_KINDS, beside, calm_kinds,
    calm_of, is_cloud_kind, turbulent_of,
};
use crate::format::save::{entity, entity_at, planet_statement, system_statement};
use crate::keys;
use crate::ops::{Edit, Emitted, NebulaCloud, NebulaFootprint, OpError, Plan, Subject};
use crate::overlay::Anchor;
use crate::projections::galaxy::GalaxyGraph;
use crate::projections::read;
use crate::span::Span;

const CLOAKING: &str = "nebula_cloaking";
/// A star body's position in its system and its size.
pub(crate) type Star = ((f64, f64), f64);

/// One system's footprint as its bytes hold it now, with what writing one needs.
pub(crate) struct Standing {
    pub id: u32,
    pub footprint: NebulaFootprint,
    /// Where the cloud's table entry stands.
    cloud_at: Option<Anchor>,
    class: String,
    pub home: bool,
    ocean_paradise: bool,
    /// The star body's position in the system and its size.
    star: Option<Star>,
}

impl Standing {
    /// The system's cloud and where its table entry stands.
    pub fn cloud(&self) -> Option<(u32, Anchor)> {
        Some((self.footprint.cloud.as_ref()?.id, self.cloud_at?))
    }

    /// What a nebula a system joins gives it: the cloud `game_start.50` places for its
    /// star before any roll, or none for a star class the event does not dress.
    fn fresh_kind(&self) -> Option<&'static str> {
        let kinds = calm_kinds(&self.class)?;
        if self.ocean_paradise && CLASS_A.contains(&self.class.as_str()) {
            return Some("rare_nebula_1");
        }
        kinds.first().copied()
    }

    /// The footprint with the member turbulent or calm, its cloud's type to match.
    pub fn turbulent(&self, turbulent: bool) -> NebulaFootprint {
        let mut target = self.footprint.clone();
        target.turbulent = turbulent;
        if let Some(cloud) = &mut target.cloud {
            let is_turbulent = TURBULENT_KINDS.contains(&cloud.kind.as_str());
            if turbulent && !is_turbulent {
                cloud.kind = turbulent_of(&cloud.kind).to_owned();
            } else if !turbulent && is_turbulent {
                cloud.kind = calm_of(&cloud.kind, &self.class).to_owned();
            }
        }
        target
    }
}

/// Whether system `id` carries `nebula_cloaking`.
fn cloaked(doc: &Document, id: u32) -> bool {
    let entity = system_statement(doc, id).and_then(|at| entity_at(doc, at).ok().flatten());
    entity.is_some_and(|(node, src)| modifiers_of(&node, src).any(|m| m == CLOAKING))
}

/// Whether a footprint holds anything at all.
pub(crate) fn is_bare(footprint: &NebulaFootprint) -> bool {
    footprint.cloud.is_none() && !footprint.cloaking && !footprint.turbulent
}

/// The writer one plan's footprint edits go through: the ambient table as the plan leaves
/// it, which [`Footprints::finish`] settles once every system is written.
pub(crate) struct Footprints<'d> {
    doc: &'d Document,
    first_contact: bool,
    table: Option<SlotTable>,
}

impl<'d> Footprints<'d> {
    /// For a save [`crate::format::save::check_version`] passes: an older one writes its
    /// ambient objects in another shape, so its nebula ops keep to the member lines.
    /// Whether the save has First Contact comes from its `required_dlcs`, or, when `meta`
    /// cannot be read, from whether any nebula member carries `nebula_cloaking`.
    pub fn new(doc: &'d Document, graph: &GalaxyGraph) -> Self {
        let first_contact = match archive::parse_meta(doc.meta()) {
            Ok(meta) => meta.required_dlcs.iter().any(|dlc| dlc == FIRST_CONTACT),
            Err(_) => graph
                .nebulae
                .iter()
                .flat_map(|nebula| &nebula.systems)
                .any(|&id| cloaked(doc, id)),
        };
        Self {
            doc,
            first_contact,
            table: None,
        }
    }

    fn table(&mut self) -> Result<&mut SlotTable, OpError> {
        if self.table.is_none() {
            self.table = Some(SlotTable::ambient_objects(self.doc)?);
        }
        Ok(self.table.as_mut().expect("just filled"))
    }

    /// Ambient object `id`'s slot and whether it holds a live entry; `None` when the
    /// table has no slot of that id.
    fn locate(&mut self, id: u32) -> Result<Option<(Anchor, bool)>, OpError> {
        let at = self.table()?.end.at();
        if let Some(entry) = alloc::appended(self.doc, at)
            .into_iter()
            .find(|e| e.id == id)
        {
            return Ok(Some((entry.anchor, !entry.dead)));
        }
        let Some(entity) = self.doc.index().entity(keys::AMBIENT_OBJECT, u64::from(id)) else {
            return Ok(None);
        };
        let anchor = Anchor::Original(entity.stmt);
        let dead = alloc::tombstone_of(self.doc.current(anchor)?).is_some();
        Ok(Some((anchor, !dead)))
    }

    /// System `id`'s footprint as the document now holds it.
    pub fn read(&mut self, id: u32) -> Result<Standing, OpError> {
        let anchor = system_statement(self.doc, id).ok_or(OpError::UnknownSystem(id))?;
        let (node, src) = entity(self.doc, Subject::System(id), anchor)?;
        let node = &node;
        let mut cloud = None;
        for listed in read::ids(node, keys::AMBIENT_OBJECT, src).into_iter().rev() {
            if let Some((at, kind)) = self.cloud_entry(listed)? {
                cloud = Some((NebulaCloud { id: listed, kind }, at));
                break;
            }
        }
        let modifiers: Vec<&str> = modifiers_of(node, src).collect();
        let flags: Vec<&str> = star_flags(node, src).collect();
        let star = match node.find(keys::PLANET, src).and_then(|p| p.scalar_str(src)) {
            Some(planet) => planet
                .parse()
                .ok()
                .map(|p| self.star(p))
                .transpose()?
                .flatten(),
            None => None,
        };
        Ok(Standing {
            id,
            footprint: NebulaFootprint {
                system: id,
                cloud: cloud.as_ref().map(|(c, _)| c.clone()),
                cloaking: modifiers.contains(&CLOAKING),
                turbulent: modifiers.contains(&TURBULENT_NEBULA),
            },
            cloud_at: cloud.map(|(_, at)| at),
            class: read::text(node, keys::STAR_CLASS, src),
            home: flags.contains(&HOME_SYSTEM),
            ocean_paradise: flags.contains(&OCEAN_PARADISE),
            star,
        })
    }

    /// The slot and type of ambient object `id` when it is a nebula cloud no event flagged.
    fn cloud_entry(&mut self, id: u32) -> Result<Option<(Anchor, String)>, OpError> {
        let Some((at, true)) = self.locate(id)? else {
            return Ok(None);
        };
        let Ok(Some((node, src))) = entity_at(self.doc, at) else {
            return Ok(None);
        };
        let kind = read::text(&node, keys::DATA, src);
        let own = is_cloud_kind(&kind) && node.find(keys::FLAGS, src).is_none();
        Ok(own.then_some((at, kind)))
    }

    /// Planet `id`'s position and size, the star body a cloud is placed beside.
    fn star(&self, id: u32) -> Result<Option<Star>, OpError> {
        let Some(anchor) = planet_statement(self.doc, id)? else {
            return Ok(None);
        };
        let Ok(Some((node, src))) = entity_at(self.doc, anchor) else {
            return Ok(None);
        };
        let size = read::scalar(&node, keys::PLANET_SIZE, src).and_then(|s| s.parse().ok());
        Ok(read::coordinate(&node, src).ok().zip(size))
    }

    /// Give system `id` what a nebula it joins gives it: the cloaking modifier with First
    /// Contact, and a calm cloud of the first type its star class takes unless it lists
    /// one of its own already. Whatever it carried before stays. Returns what it carried.
    pub fn join(&mut self, plan: &mut Plan, id: u32) -> Result<NebulaFootprint, OpError> {
        let standing = self.read(id)?;
        let now = &standing.footprint;
        set_modifiers(
            plan.edit(self.doc, id)?,
            now.cloaking || self.first_contact,
            now.turbulent,
        )?;
        if let (None, Some(kind), Some(_)) = (&now.cloud, standing.fresh_kind(), standing.star) {
            let cloud = NebulaCloud {
                id: self.table()?.next_appended(),
                kind: kind.to_owned(),
            };
            self.place(plan, &standing, &cloud)?;
            relist(plan.edit(self.doc, id)?, None, Some((cloud.id, false)))?;
        }
        Ok(standing.footprint)
    }

    /// Take from system `id` what a nebula gave it. Returns what it carried.
    pub fn leave(&mut self, plan: &mut Plan, id: u32) -> Result<NebulaFootprint, OpError> {
        let standing = self.read(id)?;
        set_modifiers(plan.edit(self.doc, id)?, false, false)?;
        if let (Some(cloud), Some(at)) = (&standing.footprint.cloud, standing.cloud_at) {
            self.release(plan, cloud.id, at)?;
            relist(plan.edit(self.doc, id)?, Some(cloud.id), None)?;
        }
        Ok(standing.footprint)
    }

    /// Give the system `target`: its modifiers, and its cloud retyped in place, or the one
    /// `target` names written back in its own slot. The cloud it has goes when `target`
    /// names none, or when an op appended it; one the file held stays beside the other.
    pub fn set(
        &mut self,
        plan: &mut Plan,
        standing: &Standing,
        target: &NebulaFootprint,
    ) -> Result<(), OpError> {
        let id = standing.id;
        set_modifiers(plan.edit(self.doc, id)?, target.cloaking, target.turbulent)?;
        match (&standing.footprint.cloud, &target.cloud, standing.cloud_at) {
            (Some(now), Some(want), Some(at)) if now.id == want.id => {
                if now.kind != want.kind {
                    plan.edit_record(self.doc, at)?
                        .set_scalar(&[keys::DATA], quoted(&want.kind))?;
                }
            }
            (now, want, at) => {
                let released = match (now, at) {
                    (Some(now), Some(at)) if want.is_none() || at.is_inserted() => {
                        self.release(plan, now.id, at)?;
                        Some(now.id)
                    }
                    _ => None,
                };
                if let Some(want) = want {
                    self.place(plan, standing, want)?;
                }
                let drop = released;
                let add = want.as_ref().map(|c| (c.id, true));
                if drop.is_some() || add.is_some() {
                    relist(plan.edit(self.doc, id)?, drop, add)?;
                }
            }
        }
        Ok(())
    }

    /// Take cloud `id` at `at` out of the table: a tombstone in a slot the file held, the
    /// slot given back in one an op appended.
    pub fn release(&mut self, plan: &mut Plan, id: u32, at: Anchor) -> Result<(), OpError> {
        let doc = self.doc;
        self.table()?.free(plan, doc, Subject::Record(at), id, at)
    }

    /// Point cloud `id` at `at` at system `system`, which a removal renumbered to it.
    pub fn renumber(&mut self, plan: &mut Plan, at: Anchor, system: u32) -> Result<(), OpError> {
        let edit = plan.edit_record(self.doc, at)?;
        let origin = system.to_string();
        edit.set_scalar(&[keys::COORDINATE, keys::ORIGIN], origin.as_bytes())?;
        edit.set_scalar(
            &[keys::PROPERTIES, keys::COORDINATE, keys::ORIGIN],
            origin.into_bytes(),
        )
    }

    /// Move system `id`'s cloud beside a star at `star` of `size`, and, when the star class
    /// is no longer the one it had, give it the type `class` takes first.
    pub fn restar(
        &mut self,
        plan: &mut Plan,
        id: u32,
        (star, size): Star,
        class: &str,
    ) -> Result<(), OpError> {
        let standing = self.read(id)?;
        let (Some(cloud), Some(at)) = (&standing.footprint.cloud, standing.cloud_at) else {
            return Ok(());
        };
        let edit = plan.edit_record(self.doc, at)?;
        let (x, y) = beside(star, size);
        edit.set_scalar(&[keys::COORDINATE, keys::X], coord(star.0))?;
        edit.set_scalar(&[keys::COORDINATE, keys::Y], coord(star.1))?;
        edit.set_scalar(&[keys::PROPERTIES, keys::COORDINATE, keys::X], coord(x))?;
        edit.set_scalar(&[keys::PROPERTIES, keys::COORDINATE, keys::Y], coord(y))?;
        let Some(&calm) = calm_kinds(class).and_then(<[_]>::first) else {
            return Ok(());
        };
        let kind = match TURBULENT_KINDS.contains(&cloud.kind.as_str()) {
            true => turbulent_of(calm),
            false => calm,
        };
        if class != standing.class && kind != cloud.kind {
            edit.set_scalar(&[keys::DATA], quoted(kind))?;
        }
        Ok(())
    }

    /// Write `cloud` for the system: the bytes the file held in its slot when it held it
    /// there, else a new entry into its tombstone, or past the table's end when its id is
    /// the next one there.
    fn place(
        &mut self,
        plan: &mut Plan,
        standing: &Standing,
        cloud: &NebulaCloud,
    ) -> Result<(), OpError> {
        let slot = match self.locate(cloud.id)? {
            Some((_, true)) => return Err(OpError::AmbientSlotTaken(cloud.id)),
            Some((tombstone, false)) => self.table()?.reuse(cloud.id, tombstone),
            None if cloud.id == self.table()?.next_appended() => self.table()?.append(),
            None => return Err(OpError::AmbientSlotTaken(cloud.id)),
        };
        if let Slot::Reused {
            tombstone: at @ Anchor::Original(span),
            ..
        } = slot
        {
            let loaded = span.slice(self.doc.original());
            if alloc::tombstone_of(loaded).is_none() {
                return plan.replace(self.doc, Subject::Record(at), at, loaded.to_vec());
            }
        }
        let subject = Subject::System(standing.id);
        let (star, size) = standing
            .star
            .ok_or_else(|| subject.parse_error(0, "the system has no star to place a cloud by"))?;
        let entry = AmbientEntry {
            id: cloud.id,
            kind: &cloud.kind,
            system: standing.id,
            star,
            at: beside(star, size),
        };
        let doc = self.doc;
        let table = self.table()?;
        write_slot(plan, doc, slot, table, Emitted::Record, |indent| {
            ambient_entry(indent, &entry)
        })
    }

    /// Settle the table: each appended entry freed, and each tombstone an earlier removal
    /// left, is deleted from the end back until a live one stands, and every other freed
    /// entry becomes a tombstone; `last_created_ambient_object` then holds the larger of
    /// what the file held and the highest entry an op appended that stays.
    pub fn finish(self, plan: &mut Plan) -> Result<(), OpError> {
        let Some(table) = self.table.filter(SlotTable::touched) else {
            return Ok(());
        };
        let live = table.settle(plan, self.doc)?;
        let Ok(counter) = alloc::counter(self.doc, keys::LAST_CREATED_AMBIENT_OBJECT) else {
            return Ok(());
        };
        let loaded = counter.loaded(self.doc);
        let last = live.map_or(loaded, |live| live.max(loaded));
        if last == counter.last {
            return Ok(());
        }
        counter.set(plan, self.doc, last)
    }
}

/// Give the system's `timed_modifier` the two nebula modifiers `cloaking` and `turbulent`
/// ask for and no others of the two, in the order the game writes them: the block goes
/// after `index=` when it is new, and with the last item it held.
fn set_modifiers(edit: &mut Edit, cloaking: bool, turbulent: bool) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let block = entity.find(keys::TIMED_MODIFIER, &edit.buf);
    let items = block.and_then(|b| b.find(keys::ITEMS, &edit.buf));
    let listed: Vec<(Span, String)> = items
        .map(|items| {
            items
                .children()
                .iter()
                .map(|item| (item.span(), read::text(item, keys::MODIFIER, &edit.buf)))
                .collect()
        })
        .unwrap_or_default();
    let has = |m: &str| listed.iter().any(|(_, name)| name == m);
    let wanted = |m: &str| (m == CLOAKING && cloaking) || (m == TURBULENT_NEBULA && turbulent);
    let removing: Vec<Span> = listed
        .iter()
        .filter(|(_, name)| [CLOAKING, TURBULENT_NEBULA].contains(&name.as_str()) && !wanted(name))
        .map(|&(span, _)| span)
        .collect();
    let adding: Vec<&str> = [CLOAKING, TURBULENT_NEBULA]
        .into_iter()
        .filter(|m| wanted(m) && !has(m))
        .collect();
    if removing.is_empty() && adding.is_empty() {
        return Ok(());
    }
    let (Some(block), Some(items)) = (block, items.filter(|i| !i.children().is_empty())) else {
        let text = |indent: &[u8]| timed_modifiers(indent, &adding);
        return match block {
            Some(block) => {
                let span = block.span();
                let indent = edit.indent(span.start);
                edit.replace_statement(span, &inline(&indent, &text(&indent)));
                Ok(())
            }
            None => {
                let (at, indent) = match entity.find(keys::INDEX, &edit.buf) {
                    Some(index) => (
                        edit.line_end(index.span().end),
                        edit.indent(index.span().start),
                    ),
                    None => edit.before_close(entity),
                };
                edit.insert_lines(at, text(&indent));
                Ok(())
            }
        };
    };
    edit.require_block_shape(block)?;
    edit.require_block_shape(items)?;
    if listed.len() - removing.len() + adding.len() == 0 {
        edit.remove_statement(block.span());
        return Ok(());
    }
    let first = listed[0].0.start;
    let (at_close, indent) = edit.before_close(items);
    for span in removing {
        edit.remove_lines(span);
    }
    for modifier in adding {
        let at = match modifier {
            CLOAKING => edit.line_start(first),
            _ => at_close,
        };
        edit.insert_lines(at, timed_modifier_item(&indent, modifier));
    }
    Ok(())
}

/// Take `drop` out of the system's `ambient_object` list and put `add` in it, last or,
/// when its flag is set, before the first id above it; the list goes after the last
/// `planet=` when it is new, and with its last id.
fn relist(edit: &mut Edit, drop: Option<u32>, add: Option<(u32, bool)>) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let list = entity.find(keys::AMBIENT_OBJECT, &edit.buf);
    let items: Vec<(Span, u32)> = list
        .map(|list| {
            list.children()
                .iter()
                .filter(|item| item.key.is_none())
                .filter_map(|item| Some((item.span(), item.scalar_str(&edit.buf)?.parse().ok()?)))
                .collect()
        })
        .unwrap_or_default();
    let mut ids: Vec<u32> = items
        .iter()
        .map(|&(_, id)| id)
        .filter(|&id| Some(id) != drop)
        .collect();
    if let Some((id, ordered)) = add {
        let at = match ordered {
            true => ids
                .iter()
                .position(|&other| other > id)
                .unwrap_or(ids.len()),
            false => ids.len(),
        };
        ids.insert(at, id);
    }
    let text: Vec<String> = ids.iter().map(u32::to_string).collect();
    match (list, items.first(), items.last()) {
        (Some(list), _, _) if ids.is_empty() => edit.remove_statement(list.span()),
        (Some(_), Some(&(first, _)), Some(&(last, _))) => {
            edit.replace_span(Span::new(first.start, last.end), text.join(" "));
        }
        (list, _, _) => {
            if ids.is_empty() {
                return Ok(());
            }
            let (at, indent) = match entity.find_all(keys::PLANET, &edit.buf).last() {
                Some(planet) => (
                    edit.line_end(planet.span().end),
                    edit.indent(planet.span().start),
                ),
                None => {
                    let class = entity
                        .find(keys::STAR_CLASS, &edit.buf)
                        .map(Node::span)
                        .ok_or_else(|| edit.parse_error(0, "the system has no star_class"))?;
                    (edit.line_start(class.start), edit.indent(class.start))
                }
            };
            let block = ambient_list(&indent, &ids);
            match list {
                Some(list) => edit.replace_statement(list.span(), &inline(&indent, &block)),
                None => edit.insert_lines(at, block),
            }
        }
    }
    Ok(())
}
