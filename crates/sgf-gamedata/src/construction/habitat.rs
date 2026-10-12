//! The habitat a megastructure type's finished stage is, read from its [`layout`]: a type
//! whose completion removes its row and leaves one planet beside the body it was built at,
//! tied to that body by the body's `habitat<id>` flag and to the system by `has_habitat`.
//! The editor adds such a type as the planet, with [`sgf_core::ops::Op::AddHabitat`].

use sgf_core::ops::NewHabitat;
use sgf_core::views::OrbitPlacement;

use super::layout::{self, Around, IdOf, LaidFlag, Plan, SystemLayout};
use crate::GameData;

/// The flag the habitat's body takes, followed by the habitat's id.
const HOST_FLAG: &str = "habitat";
/// The flag the habitat's system takes.
const SYSTEM_FLAG: &str = "has_habitat";
/// How a name variable that the system's name fills in ends.
const SYSTEM_NAME: &str = "solar_system.GetName";
/// The suffix of a restored type's key.
const RESTORED: &str = "_restored";

/// The habitat finishing type `key` leaves round a star when `on_star` and round any other
/// body otherwise, its model drawn in `culture`; `None` when the type's finished stage is not
/// a habitat. A restored type whose own walk cannot tell which body it spawns at, as the
/// restored Habitat Central Complex picks the ruin's body by a flag, is the habitat of the
/// type it restores.
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
    let plan = Plan {
        on_star,
        sections: Vec::new(),
        culture: culture.map(str::to_owned),
    };
    let laid = layout::lay_out(gd, key, &plan)?;
    match of_layout(&laid, culture) {
        Some(habitat) => Some(habitat),
        None if key.ends_with(RESTORED) && laid.row.is_none() && laid.planets.is_empty() => {
            habitat(gd, def.variant_of.as_deref()?, on_star, culture)
        }
        None => None,
    }
}

/// The habitat `laid` leaves: one planet round the host and nothing else, the host's flag
/// naming it and the system's `has_habitat`.
fn of_layout(laid: &SystemLayout, culture: Option<&str>) -> Option<NewHabitat> {
    let [planet] = &laid.planets[..] else {
        return None;
    };
    let host_flag = [LaidFlag {
        flag: HOST_FLAG.to_owned(),
        id_of: Some(IdOf::Planet(0)),
    }];
    let alone = laid.row.is_none()
        && laid.sections.is_empty()
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
    })
}
