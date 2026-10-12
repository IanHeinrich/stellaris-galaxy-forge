use super::Session;
use crate::format::save::write::{add_ring_world, copy_bodies, megastructure_links, move_planet};
use crate::format::scenario::effect;
use crate::ops::{NewBody, NewRingWorld, Op, OpError, Plan};
use crate::search;
use crate::views::{
    OrbitPlacement, PlanetMoveCheck, PlanetMoveTargets, RingWorldClearing, SearchResult,
};

impl Session {
    /// A scenario system's own `effect = { … }` block and the line it starts on.
    pub fn scenario_system_effect(&self, id: u32) -> Option<(String, u32)> {
        effect::system_effect(&self.doc, id)
    }

    /// The `type` of save megastructure row `id` as it stands now; `None` when the document
    /// holds no such row.
    pub fn megastructure_kind(&self, id: u32) -> Option<String> {
        megastructure_links::read(&self.doc, id)
            .ok()
            .flatten()
            .map(|tied| tied.kind)
    }

    /// Save system `system` as a megastructure's construction scripts look at it.
    pub fn construction_site(
        &self,
        system: u32,
    ) -> Result<crate::format::save::site::ConstructionSite, OpError> {
        crate::format::save::site::read(self, system)
    }

    /// What clearing save system `system` for a ring world takes, as the game's frame
    /// clears it: every body that is not a star, with the colonies on them, and every belt.
    pub fn ring_world_clearing(&self, system: u32) -> Result<RingWorldClearing, OpError> {
        add_ring_world::clearing(self, system)
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
        add_ring_world::add_op(self, system, owner, ring, clear)
    }

    /// Every scenario system carrying an `effect = { … }` block, in file order: its id,
    /// the block's text and the line it starts on. A save document has none.
    pub fn scenario_system_effects(&self) -> Vec<(u32, String, u32)> {
        effect::system_effects(&self.doc)
    }

    /// Systems, countries, planets, fleets and nebulae matching `query` by id, key or
    /// resolved name; see [`search::search`].
    ///
    /// Planets and fleets are only searched once the details projection is built, which
    /// search never does itself: it runs under the session lock, and building parses about
    /// half the file. The app calls [`Session::warm_details`] after a save opens.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        resolve: search::NameResolver<'_>,
        special: search::SpecialLabels<'_>,
    ) -> SearchResult {
        search::search(
            &self.graph,
            self.built_details().as_deref(),
            &self.stars,
            query,
            limit,
            resolve,
            special,
        )
    }

    /// Where the save planets `planets` may move together, and which of them cannot move.
    pub fn planet_move_targets(&self, planets: &[u32]) -> PlanetMoveTargets {
        move_planet::targets(self, planets)
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
        move_planet::move_op(self, planets, to, at)
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
        move_planet::check(self, planets, to, at)
    }

    /// The save bodies `bodies` as specs that [`Self::paste_bodies_op`] writes back, in any
    /// save: a moon whose planet is among them goes with its planet, a moon alone becomes a
    /// planet, and each planet carries its moons placed about it. A numbered name is left
    /// for the paste to number again. Refused for a star, a body with a megastructure on or
    /// around it or a moon that has one, a ring world segment, and a save before Stellaris 4.0.
    pub fn copy_bodies(&self, bodies: &[u32]) -> Result<Vec<NewBody>, OpError> {
        copy_bodies::copy(self, bodies)
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
        copy_bodies::paste_op(self, system, copies, at)
    }

    /// Why `op` would be refused, or `None` when it would apply. Nothing is written: the op
    /// is planned against the session and dropped. A batch is refused, since its members
    /// after the first would be planned against a session none of them had changed, and so
    /// is an op with a second step, which is planned against its first.
    pub fn check_op(&self, op: &Op) -> Option<String> {
        if matches!(op, Op::Batch { .. }) {
            return Some("a batch cannot be checked: check each of its ops".to_owned());
        }
        if let Err(error) = op.check_kind(self.kind()) {
            return Some(error.to_string());
        }
        if let Err(error) = op.check_sendable() {
            return Some(error.to_string());
        }
        if op.reach().follow_up {
            return Some(format!(
                "{} cannot be checked: its second step needs its first applied",
                op.name()
            ));
        }
        self.format()
            .write(&mut Plan::new(), self, op)
            .err()
            .map(|error| error.to_string())
    }
}
