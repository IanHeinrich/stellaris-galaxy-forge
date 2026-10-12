//! The habitat a megastructure type's finished stage is, read from its [`layout`]: a type
//! whose completion removes its row and leaves one planet beside the body it was built at,
//! tied to that body by the body's `habitat<id>` flag and to the system by `has_habitat`.
//! A restored Habitat Central Complex also leaves an orbital: a row it spawns at the same
//! body, which the row's own completion flags `has_orbital`.
//! The editor adds such a type as the planet, with [`sgf_core::ops::Op::AddHabitat`].

use sgf_core::ops::{HabitatOrbital, NewHabitat};
use sgf_core::views::OrbitPlacement;

use super::layout::{self, Around, IdOf, LaidFlag, LaidRow, Plan, Section, SystemLayout};
use crate::GameData;

/// The flag the habitat's body takes, followed by the habitat's id.
const HOST_FLAG: &str = "habitat";
/// The flag the habitat's system takes.
const SYSTEM_FLAG: &str = "has_habitat";
/// How a name variable that the system's name fills in ends.
const SYSTEM_NAME: &str = "solar_system.GetName";
/// The flag an orbital's own completion sets on its body.
const ORBITAL_FLAG: &str = "has_orbital";
/// The suffix of a restored type's key.
const RESTORED: &str = "_restored";

/// The habitat finishing type `key` leaves round a star when `on_star` and round any other
/// body otherwise, its model drawn in `culture`; `None` when the type's finished stage is not
/// a habitat. The orbital it leaves, if any, has no owner: the caller gives it the one whose
/// culture it drew the model in. A restored type whose own walk lays out no habitat, as a mod's
/// restored complex can, is the habitat of the type it restores, with the orbital its walk
/// spawns at the host if there is one.
pub fn habitat(
    gd: &GameData,
    key: &str,
    on_star: bool,
    culture: Option<&str>,
) -> Option<NewHabitat> {
    let def = gd.megastructures.get(key)?;
    if !def.completes.removes_row {
        return None;
    }
    let laid = layout::lay_out(gd, key, &plan(on_star, culture))?;
    match of_layout(gd, &laid, on_star, culture) {
        Some(habitat) => Some(habitat),
        None if key.ends_with(RESTORED) && laid.row.is_none() => {
            let restored = habitat(gd, def.variant_of.as_deref()?, on_star, culture)?;
            let orbital = match &laid.sections[..] {
                [section] => orbital(gd, section, on_star),
                _ => None,
            };
            Some(NewHabitat {
                orbital,
                ..restored
            })
        }
        None => None,
    }
}

fn plan(on_star: bool, culture: Option<&str>) -> Plan {
    Plan {
        on_star,
        sections: Vec::new(),
        culture: culture.map(str::to_owned),
        held_flags: Vec::new(),
    }
}

/// The habitat `laid` leaves: one planet round the host and at most one orbital, the host's
/// flag naming the planet and the system's `has_habitat`.
fn of_layout(
    gd: &GameData,
    laid: &SystemLayout,
    on_star: bool,
    culture: Option<&str>,
) -> Option<NewHabitat> {
    let [planet] = &laid.planets[..] else {
        return None;
    };
    let orbital = match &laid.sections[..] {
        [] => None,
        [section] => Some(orbital(gd, section, on_star)?),
        _ => return None,
    };
    let host_flag = [LaidFlag {
        flag: HOST_FLAG.to_owned(),
        id_of: Some(IdOf::Planet(0)),
    }];
    let alone = laid.row.is_none()
        && !laid.cleared
        && !laid.belts_cleared
        && planet.at.around == Around::Host
        && laid.host_flags == host_flag
        && laid.system_flags == [SYSTEM_FLAG]
        && planet.flags.iter().all(|flag| flag.id_of.is_none());
    if !alone {
        return None;
    }
    let name = planet.name.as_ref()?;
    let system_name = match &name.variables[..] {
        [] => None,
        [variable] if variable.ends_with(SYSTEM_NAME) => Some(variable.clone()),
        _ => return None,
    };
    let model = planet
        .model
        .as_ref()
        .and_then(|model| match (model.cultured, culture) {
            (false, _) => Some(model.entity.clone()),
            (true, Some(culture)) => Some(format!("{culture}_{}", model.entity)),
            (true, None) => None,
        });
    Some(NewHabitat {
        class: planet.class.clone(),
        size: planet.size?,
        at: OrbitPlacement {
            radius: planet.at.distance,
            angle: planet.at.save_angle(),
        },
        name: name.key.clone(),
        system_name,
        model,
        flags: planet.flags.iter().map(|flag| flag.flag.clone()).collect(),
        orbital,
    })
}

/// The orbital `section` is: a row standing at the host, tied to it, taking the structure's
/// owner and culture, whose own completion flags the host `has_orbital` and nothing else.
fn orbital(gd: &GameData, section: &Section, on_star: bool) -> Option<HabitatOrbital> {
    let row: &LaidRow = section.row.as_ref()?;
    let at_host = section.at.around == Around::Host && section.at.distance == 0.0;
    if !(at_host && row.on_host && row.owned && row.cultured) {
        return None;
    }
    let own = layout::lay_out(gd, &row.kind, &plan(on_star, None))?;
    let flags = [LaidFlag {
        flag: ORBITAL_FLAG.to_owned(),
        id_of: None,
    }];
    let leaves_flag = own.row.is_some()
        && own.sections.is_empty()
        && own.planets.is_empty()
        && own.system_flags.is_empty()
        && own.host_flags == flags;
    if !leaves_flag {
        return None;
    }
    Some(HabitatOrbital {
        kind: row.kind.clone(),
        owner: None,
        name: row.name.clone(),
        system_name: row.system_name.clone(),
    })
}
