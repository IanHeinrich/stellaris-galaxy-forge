//! Adding the habitat a megastructure type's finished stage is to a body of the open save,
//! as a planet in place of the type's row.

use sgf_core::ops::Op;
use sgf_core::views::{ErrorKind, SgfError};
use sgf_gamedata::construction::habitat::habitat;
use tauri::{AppHandle, Runtime};

use super::{game_data, is_save, require, with_session};
use crate::views::AddedHabitat;

const ONLY_A_SAVE_ADDS: &str = "only a save takes an added habitat";

/// Add the habitat finishing a megastructure of type `kind` at body `body` of system `system`
/// leaves, as one `AddHabitat`: a planet round the body, placed as the install's habitat
/// effect places one round a star or round any other body, with no owner. Its model is drawn
/// in the culture of the system's owner, and the class's own model is drawn when the system
/// has none. The orbital a restored complex leaves is owned by the system's owner, and by
/// nobody when the system has none. A type whose finished stage is not a habitat, and one
/// the install does not define, are refused.
#[tauri::command]
pub async fn add_habitat<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    body: u32,
    kind: String,
) -> Result<AddedHabitat, SgfError> {
    let gd = game_data(&app, "add a habitat")?;
    if gd.megastructures.get(&kind).is_none() {
        return Err(SgfError::new(
            ErrorKind::Op,
            format!("the install and its mods define no megastructure {kind}"),
        ));
    }
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_save, ONLY_A_SAVE_ADDS)?;
        let site = session.construction_site(system)?;
        let host = site.bodies.iter().find(|b| b.id == body).ok_or_else(|| {
            SgfError::new(
                ErrorKind::Op,
                format!("planet {body} is not a body of system {system}"),
            )
        })?;
        let graph = session.graph();
        let owner = graph.systems.get(&system).and_then(|node| node.owner);
        let culture = owner
            .and_then(|owner| graph.countries.iter().find(|c| c.id == owner))
            .and_then(|country| country.graphical_culture.clone());
        let mut habitat = habitat(&gd, &kind, host.star, culture.as_deref()).ok_or_else(|| {
            SgfError::new(
                ErrorKind::Op,
                format!("a {kind} is not finished as a habitat"),
            )
        })?;
        if let Some(orbital) = &mut habitat.orbital {
            orbital.owner = owner;
        }
        let result = session.apply(Op::AddHabitat { body, habitat })?;
        let planet = match &result.inverse {
            Op::RemoveBody { body } => Some(*body),
            Op::Batch { ops, .. } => ops.iter().find_map(|op| match op {
                Op::RemoveBody { body } => Some(*body),
                _ => None,
            }),
            _ => None,
        }
        .ok_or_else(|| SgfError::new(ErrorKind::Op, "the add named no new habitat"))?;
        Ok(AddedHabitat {
            edit: session.edit_result(result),
            planet,
        })
    })
    .await
}
