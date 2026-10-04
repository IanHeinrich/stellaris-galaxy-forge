//! Rolling a planet or moon from the install's rules and adding it to a system of the open
//! save.

use sgf_core::ops::{NewBody, Op};
use sgf_core::views::{DocumentKind, ErrorKind, OrbitPlacement, SgfError};
use sgf_gamedata::generate::{self, ForSaveError};
use tauri::{AppHandle, Runtime, State};

use super::add_system::game_data;
use super::{require, with_session};
use crate::state::GameDataState;
use crate::views::{AddedBody, BodyClassPick};

const ONLY_A_SAVE_ADDS: &str = "only a save takes an added planet";

/// Roll a body from `seed` and add it to system `system` of the open save as one
/// `AddBody`, `radius` from what it orbits at `angle` degrees: a moon of `parent` when
/// given, else a planet. It is of `class` when given and a class drawn at its orbit when not,
/// of `size` when given and one drawn from its class's range when not, with the deposits it
/// rolls at the save's Resource Abundance.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn add_body<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    parent: Option<u32>,
    class: Option<String>,
    size: Option<u32>,
    radius: f64,
    angle: f64,
    seed: u64,
) -> Result<AddedBody, SgfError> {
    let gd = game_data(&app)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), DocumentKind::Save, ONLY_A_SAVE_ADDS)?;
        let body = generate::body_for_save(
            &gd,
            session,
            seed,
            system,
            parent,
            class.as_deref(),
            size,
            radius,
        )
        .map_err(refusal)?;
        let result = session.apply(Op::AddBody {
            system,
            spec: NewBody {
                class: body.class,
                size: body.size,
                moon_of: parent,
                name: None,
                deposits: body.deposits,
                ring: body.ring,
            },
            at: OrbitPlacement { radius, angle },
        })?;
        let planet = added(&result.inverse)
            .ok_or_else(|| SgfError::new(ErrorKind::Op, "the add named no new body"))?;
        Ok(AddedBody {
            edit: session.edit_result(result),
            planet,
        })
    })
    .await
}

/// The classes a planet, or with `moon` a moon, added to a save may take, each with its
/// localised name and the sizes a random one is drawn from, by name; empty without game data.
#[tauri::command(async)]
pub fn get_body_classes(game_data: State<'_, GameDataState>, moon: bool) -> Vec<BodyClassPick> {
    let Some(gd) = game_data.loaded() else {
        return Vec::new();
    };
    let mut picks: Vec<BodyClassPick> = generate::body_classes(&gd, moon)
        .into_iter()
        .filter_map(|class| {
            let range = class.size(moon)?;
            Some(BodyClassPick {
                key: class.key.clone(),
                name: gd.loc.get(&class.key).unwrap_or_else(|| class.key.clone()),
                min_size: range.min.round() as u32,
                max_size: range.max.round() as u32,
            })
        })
        .collect();
    tell_apart(&mut picks);
    picks.sort_by(|a, b| a.name.cmp(&b.name));
    picks
}

/// Classes can share a name (`pc_nanotech` is named `$pc_gray_goo$`, `pc_barren_cold` is
/// "Barren World" like `pc_barren`), so each of them shows its key after the name.
fn tell_apart(picks: &mut [BodyClassPick]) {
    let shared: Vec<String> = picks
        .iter()
        .filter(|a| picks.iter().filter(|b| b.name == a.name).count() > 1)
        .map(|a| a.key.clone())
        .collect();
    for pick in picks.iter_mut().filter(|p| shared.contains(&p.key)) {
        pick.name = format!("{} ({})", pick.name, pick.key);
    }
}

/// The body an add's inverse takes out again.
fn added(inverse: &Op) -> Option<u32> {
    match inverse {
        Op::RemoveBody { body: planet } => Some(*planet),
        Op::Batch { ops, .. } => ops.iter().find_map(added),
        _ => None,
    }
}

fn refusal(e: ForSaveError) -> SgfError {
    match e {
        ForSaveError::NoSystem(id) => SgfError::not_found(format!("system {id}")),
        e => SgfError::new(ErrorKind::Op, e.to_string()),
    }
}
