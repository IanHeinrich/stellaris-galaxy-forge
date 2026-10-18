use super::Session;
use crate::format::save::write::{
    add_megastructure, add_ring_world, add_system, add_systems, copy_bodies, megastructure_links,
    move_planet,
};
use crate::format::save::{alloc, event_targets, site};
use crate::ops::{LaneEnd, NewBody, NewRingWorld, Op, OpError, SystemAdd};
use crate::views::details::ConstructionSite;
use crate::views::{OrbitPlacement, PlanetMoveCheck, PlanetMoveTargets, RingWorldClearing};

/// The queries only a save answers, over its megastructure rows, construction sites, ring
/// worlds and planets. [`Session::save`] hands them out.
#[derive(Clone, Copy)]
pub struct SaveQueries<'s> {
    session: &'s Session,
}

impl Session {
    /// The save-only queries, for `query`, what the caller asks them for, such as "copying
    /// planets"; refused once for a document that is not a save, naming `query` and the
    /// kind, and for a save before Stellaris 4.0.
    pub fn save(&self, query: &'static str) -> Result<SaveQueries<'_>, OpError> {
        self.format().save_queries(&self.doc, query)?;
        Ok(SaveQueries { session: self })
    }
}

impl SaveQueries<'_> {
    /// The `type` of save megastructure row `id` as it stands now; `None` when the document
    /// holds no such row.
    pub fn megastructure_kind(&self, id: u32) -> Option<String> {
        megastructure_links::read(&self.session.doc, id)
            .ok()
            .flatten()
            .map(|tied| tied.kind)
    }

    /// Save system `system` as a megastructure's construction scripts look at it.
    pub fn construction_site(&self, system: u32) -> Result<ConstructionSite, OpError> {
        site::read(self.session, system)
    }

    /// What the [`Op::Batch`] that adds megastructure `shown`, as the install names it, at
    /// save planet `body` and changes the planet as the megastructure's build does, says in
    /// the undo list: "Added the Yggdrasil Orchid at Gas Giant Beta #6 and made it a Food
    /// Giant, removing its 3 moons". `class` is the new class as the install names it, and
    /// `size` the new size; each is `None` when it stays. `moons` is how many of the planet's
    /// moons the batch deletes.
    pub fn megastructure_planet_change_description(
        &self,
        shown: &str,
        body: u32,
        class: Option<&str>,
        size: Option<u32>,
        moons: usize,
    ) -> Result<String, OpError> {
        add_megastructure::planet_change_description(self.session, shown, body, class, size, moons)
    }

    /// What clearing save system `system` for a ring world takes, as the game's frame
    /// clears it: every body that is not a star, with the colonies on them, and every belt.
    pub fn ring_world_clearing(&self, system: u32) -> Result<RingWorldClearing, OpError> {
        add_ring_world::clearing(self.session, system)
    }

    /// The op that adds `ring` round save system `system`'s star for `owner`: one
    /// [`Op::AddRingWorld`], or with `clear` a batch that first deletes every body that is
    /// not a star with [`Op::DeleteBody`], moons first, and every belt with
    /// [`Op::RemoveBelt`], as [`Self::ring_world_clearing`] lists them. Clearing a body a
    /// starbase orbits is refused.
    pub fn ring_world_op(
        &self,
        system: u32,
        owner: Option<u32>,
        ring: NewRingWorld,
        clear: bool,
    ) -> Result<Op, OpError> {
        add_ring_world::add_op(self.session, system, owner, ring, clear)
    }

    /// The op that adds `systems` to the save, the one way a save takes new systems: an
    /// [`Op::AddSystemFromSpec`] per system, the `j`th taking the next system id plus `j`
    /// and its spec's own lanes dropped; then each system's extras, its anomalies and dig
    /// sites only with `extras` and its global event targets whatever it says, leaving out
    /// a target whose name the save already holds; then one [`Op::AddLanePairs`] laying
    /// `lanes` between new and held systems. The extras name the ids the new bodies take.
    /// It is one [`Op::Batch`] described as `description`, or by what it adds when that is
    /// `None`, and then a lone system with nothing beside it is its add alone. Refused
    /// before any op is built when there are none or more than
    /// [`crate::ops::BULK_ADD_CAP`], when one stands nearer than the game spawns a system
    /// to another or to a new one before it, and when a lane end names no system.
    pub fn add_systems_op(
        &self,
        systems: Vec<SystemAdd>,
        lanes: &[(LaneEnd, LaneEnd)],
        extras: bool,
        description: Option<String>,
    ) -> Result<Op, OpError> {
        add_systems::add_op(self.session, systems, lanes, extras, description)
    }

    /// Why [`Self::add_systems_op`] would refuse the place of each of `points`, systems added
    /// together in that order, or `None` for each place it takes: one nearer than the game
    /// spawns a system to another, or to one of `points` before it, or outside the galaxy.
    pub fn place_refusals(&self, points: &[(f64, f64)]) -> Result<Vec<Option<OpError>>, OpError> {
        let s = self.session;
        let first = alloc::next_system(&s.doc, &s.graph)?;
        Ok(add_system::place_refusals(&s.graph, first, points))
    }

    /// Whether the save holds a global event target named `name`, which an add of a system
    /// whose script saves it leaves to the one there.
    pub fn holds_event_target(&self, name: &str) -> bool {
        event_targets::find(&self.session.doc, name).is_some()
    }

    /// Where the save planets `planets` may move together, and which of them cannot move.
    pub fn planet_move_targets(&self, planets: &[u32]) -> PlanetMoveTargets {
        move_planet::targets(self.session, planets)
    }

    /// The op that moves `planets` to system `to`: one [`Op::MoveBodyToSystem`] per planet
    /// [`Self::planet_move_targets`] keeps, in order, the first at `at` when given, batched
    /// when there are several. Refused when it keeps none.
    pub fn planet_move_op(
        &self,
        planets: &[u32],
        to: u32,
        at: Option<OrbitPlacement>,
    ) -> Result<Op, OpError> {
        move_planet::move_op(self.session, planets, to, at)
    }

    /// Why [`Self::planet_move_op`] would be refused, or else the colonies and stations it
    /// takes into another country's system. Nothing is written: each move is planned
    /// against the session and dropped.
    pub fn planet_move_check(
        &self,
        planets: &[u32],
        to: u32,
        at: Option<OrbitPlacement>,
    ) -> PlanetMoveCheck {
        move_planet::check(self.session, planets, to, at)
    }

    /// The save bodies `bodies` as specs that [`Self::paste_bodies_op`] writes back, in any
    /// save: a moon whose planet is among them goes with its planet, a moon alone becomes a
    /// planet, and each planet carries its moons placed about it. A numbered name is left
    /// for the paste to number again. Refused for a star, a body with a megastructure on or
    /// around it or a moon that has one, a ring world segment, and a save before Stellaris 4.0.
    pub fn copy_bodies(&self, bodies: &[u32]) -> Result<Vec<NewBody>, OpError> {
        copy_bodies::copy(self.session, bodies)
    }

    /// The op that pastes `copies` into system `system`: one [`Op::AddBody`] per copy,
    /// batched when there are several. With `at`, the first copy goes there and each next one
    /// follows outward at the same angle, past the one before and both their moons by the
    /// system's usual gap. Without it, each takes the next free orbit past the system's
    /// reach at 0°.
    pub fn paste_bodies_op(
        &self,
        system: u32,
        copies: &[NewBody],
        at: Option<OrbitPlacement>,
    ) -> Result<Op, OpError> {
        copy_bodies::paste_op(self.session, system, copies, at)
    }
}
