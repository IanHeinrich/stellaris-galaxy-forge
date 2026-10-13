//! A planet a megastructure type's completion spawns, as the editor writes it, and what a
//! finished type leaves at the body its row stands on, read from its [`layout`]: a planet
//! spawned round that body while the row stays, and whether the body's moons are removed.
//! The editor writes the planet with the row, as `spec.planet` of
//! [`sgf_core::ops::Op::AddMegastructure`].

use sgf_core::ops::{NewPlanet, TimedModifier};
use sgf_core::views::OrbitPlacement;

use super::lasting;
use super::layout::{self, Around, LaidPlanet, Plan};
use crate::GameData;
use crate::registries::megastructures::Placement;

/// What finishing a type leaves at the body its row stands on, beyond the row.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AtHost {
    /// The planet it spawns round the body, its row left standing there; `None` when it
    /// spawns none, or one the editor cannot write.
    pub planet: Option<NewPlanet>,
    /// What the planet's own `init_effect` does that the editor does not write, as the
    /// script says it.
    pub unwritten: Vec<String>,
    /// Every moon of the body is removed.
    pub removes_moons: bool,
}

/// What finishing type `key` leaves at the planet its row stands on, the spawned planet's
/// model drawn in `culture`. The planet is written only when the row stays on its body and
/// the type spawns that one planet round it and nothing else: no row, no clearing, a name
/// with nothing filled in, a size the game does not roll and no flag naming an id. With no
/// `culture`, a model the spawn draws in its builder's culture is left to the class.
pub fn at_host(gd: &GameData, key: &str, culture: Option<&str>) -> AtHost {
    let plan = Plan {
        on_star: false,
        sections: Vec::new(),
        culture: culture.map(str::to_owned),
        held_flags: Vec::new(),
    };
    let Some(laid) = layout::lay_out(gd, key, &plan) else {
        return AtHost::default();
    };
    let alone = laid.row.as_ref().is_some_and(|row| row.on_host)
        && laid.sections.is_empty()
        && !laid.cleared
        && !laid.belts_cleared;
    let spawned = match &laid.planets[..] {
        [planet] if alone && planet.at.around == Around::Host => host_planet(planet, culture),
        _ => None,
    };
    AtHost {
        unwritten: spawned
            .as_ref()
            .map(|_| laid.planets[0].unfollowed.clone())
            .unwrap_or_default(),
        planet: spawned,
        removes_moons: laid.host_moons_removed,
    }
}

/// Whether a stage of `key`'s build chain spawns a planet round the body its row stands on
/// and leaves the row standing.
pub(crate) fn spawns_beside(gd: &GameData, key: &str) -> bool {
    gd.megastructures
        .chain(key)
        .iter()
        .any(|stage| stage.completes.spawns_beside())
}

/// The types placed on a body whose chain spawns a planet beside the row that the editor
/// cannot write, as [`at_host`] tells.
pub(crate) fn unwritten_beside(gd: &GameData) -> Vec<String> {
    gd.megastructures
        .iter()
        .filter(|def| matches!(def.placement, Placement::Body { .. }))
        .filter(|def| spawns_beside(gd, &def.key))
        .filter(|def| at_host(gd, &def.key, None).planet.is_none())
        .map(|def| def.key.clone())
        .collect()
}

/// `planet` round the host, when its name, size and flags can be written.
fn host_planet(planet: &LaidPlanet, culture: Option<&str>) -> Option<NewPlanet> {
    let name = planet
        .name
        .as_ref()
        .filter(|name| name.variables.is_empty())?;
    if planet.flags.iter().any(|flag| flag.id_of.is_some()) {
        return None;
    }
    Some(new_planet(planet, name.key.clone(), planet.size?, culture))
}

/// `planet` as the editor writes it, named `name` and of size `size`: where it was laid out,
/// its model, a cultured one prefixed with `culture` and left to the class with none, its
/// flags and its timed modifiers.
pub(crate) fn new_planet(
    planet: &LaidPlanet,
    name: String,
    size: u32,
    culture: Option<&str>,
) -> NewPlanet {
    let model = planet
        .model
        .as_ref()
        .and_then(|model| match (model.cultured, culture) {
            (false, _) => Some(model.entity.clone()),
            (true, Some(culture)) => Some(format!("{culture}_{}", model.entity)),
            (true, None) => None,
        });
    NewPlanet {
        class: planet.class.clone(),
        size,
        at: OrbitPlacement {
            radius: planet.at.distance,
            angle: planet.at.save_angle(),
        },
        name,
        model,
        flags: planet.flags.iter().map(|flag| flag.flag.clone()).collect(),
        modifiers: planet
            .modifiers
            .iter()
            .map(|(modifier, days)| TimedModifier {
                modifier: modifier.clone(),
                days: lasting(*days),
            })
            .collect(),
    }
}
