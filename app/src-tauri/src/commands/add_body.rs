//! Rolling a planet or moon from the install's rules and adding it to a system of the open
//! save.

use sgf_core::views::{OrbitPlacement, SgfError};
use sgf_gamedata::generate::{self, BodyAsk};
use sgf_gamedata::picks::BodyClassPick;
use tauri::{AppHandle, Runtime, State};

use super::{game_data, require, with_session};
use crate::state::GameDataState;
use crate::views::Added;

const NO_ADDED_BODIES: &str = "this document takes no added planet";

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
) -> Result<Added, SgfError> {
    let gd = game_data(
        &app,
        if parent.is_some() {
            "add a moon"
        } else {
            "add a planet"
        },
    );
    let ask = BodyAsk {
        system,
        parent,
        class,
        size,
        at: OrbitPlacement { radius, angle },
        name: None,
    };
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.add_bodies, NO_ADDED_BODIES)?;
        let gd = gd?;
        let op = generate::body_for_save(&gd, session, seed, ask)?;
        let result = session.apply(op)?;
        Ok(Added::of(session, result))
    })
    .await
}

/// The classes a planet, or with `moon` a moon, added to a save may take, each with its
/// localised name and the sizes a random one is drawn from, by name; empty without game data.
#[tauri::command(async)]
pub fn get_body_classes(game_data: State<'_, GameDataState>, moon: bool) -> Vec<BodyClassPick> {
    game_data
        .loaded()
        .map_or_else(Vec::new, |gd| gd.body_class_picks(moon))
}
