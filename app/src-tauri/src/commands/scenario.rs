//! What the loaded scripts say about systems: territories, bypasses and details.

use std::sync::{Arc, MutexGuard};

use sgf_core::format::save::details::SystemDetails;
use sgf_core::session::{Session, SessionError};
use sgf_core::views::{DocumentKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::scripts::{
    ScenarioBypasses, ScenarioOwners, ScenarioSystem, SystemScripts, bypasses::add_flagged_pairs,
};
use sgf_gamedata::special::{self, SpecialSystems};
use sgf_gamedata::views::SystemRoll;
use tauri::{AppHandle, Manager, Runtime};

use super::{with_scenario, with_session};
use crate::state::GameDataState;

#[tauri::command]
pub async fn get_special_systems<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SpecialSystems, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(special::classify_session(session, gd.as_deref()))
    })
    .await
}

/// Who owns each scenario system at galaxy generation, read from the loaded scripts.
/// `None` on a save or without game data.
#[tauri::command]
pub async fn get_scenario_owners<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<ScenarioOwners>, SgfError> {
    let owners = with_scenario(app, |session, gd, state, generation| {
        Some(scenario_owners(session, gd, state, generation))
    })
    .await?;
    Ok(owners.map(|owners| (*owners).clone()))
}

/// The wormholes and gateways the initializers and the day-one events place, read from the
/// loaded scripts, and the wormhole pairs Paint a Galaxy's star flags name, which its
/// own day-one event joins. `None` on a save; without game data only the flagged pairs.
#[tauri::command]
pub async fn get_scenario_bypasses<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<ScenarioBypasses>, SgfError> {
    with_session(app.clone(), move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        if session.kind() != DocumentKind::Scenario {
            return Ok(None);
        }
        let game_data = app.state::<GameDataState>();
        let mut bypasses = match game_data.snapshot() {
            Some((generation, gd)) => {
                (*scenario_bypasses(session, &gd, &game_data, generation)).clone()
            }
            None => ScenarioBypasses {
                bypasses: Vec::new(),
                open_endpoints: 0,
                random_wormhole_pairs: 0,
                random_gateways: 0,
                with_game_data: false,
            },
        };
        add_flagged_pairs(&mut bypasses, &session.graph().bypasses);
        Ok(Some(bypasses))
    })
    .await
}

/// The scripts that reach one scenario system: its initializer chain, and everything in the
/// loaded game data that references what the chain sets. `None` on a save, without game data,
/// or for an unknown system.
#[tauri::command]
pub async fn get_system_scripts<R: Runtime>(
    app: AppHandle<R>,
    id: u32,
) -> Result<Option<SystemScripts>, SgfError> {
    with_scenario(app, move |session, gd, state, generation| {
        let system = session.system(id)?;
        let effect = session.scenario_system_effect(id);
        let mut scripts = gd.system_scripts(
            id,
            ScenarioSystem::initializer_of(&system.initializer),
            effect,
        );
        scripts.attach_territory(&scenario_owners(session, gd, state, generation));
        Some(scripts)
    })
    .await
}

/// Details of each id that is a system, in the order given; resolved through the
/// install's definitions when game data is loaded, else by guessing from the keys.
///
/// A scenario holds no details sections: a system's planets, resources, megastructures,
/// dig sites and starbase are what its initializer defines. A system gets a record when the
/// install defines its initializer, with empty lists if the initializer places nothing. A
/// system whose initializer is `random`, empty or not defined gets none.
#[tauri::command]
pub async fn get_system_details<R: Runtime>(
    app: AppHandle<R>,
    ids: Vec<u32>,
) -> Result<Vec<SystemDetails>, SgfError> {
    with_session(app.clone(), move |guard| {
        details_for(guard, &app.state::<GameDataState>(), &ids)
    })
    .await
}

/// Details of each of `ids` that is a system of the open document, from where its kind keeps
/// them. The lock is let go before the details are resolved.
fn details_for(
    guard: MutexGuard<'_, Option<Session>>,
    gd_state: &GameDataState,
    ids: &[u32],
) -> Result<Vec<SystemDetails>, SgfError> {
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    match session.kind() {
        DocumentKind::Scenario => {
            let Some((generation, gd)) = gd_state.snapshot() else {
                return Ok(Vec::new());
            };
            let owners = scenario_owners(session, &gd, gd_state, generation);
            let initializers: Vec<(u32, String)> = ids
                .iter()
                .filter_map(|&id| Some((id, session.system(id)?.initializer.clone())))
                .collect();
            drop(guard);
            Ok(initializers
                .iter()
                .filter_map(|(id, key)| gd.initializer_details(*id, key, Some(&owners)))
                .collect())
        }
        DocumentKind::Save => {
            let gd = gd_state.loaded();
            let details = session.details().map_err(SessionError::from)?;
            let stars: Vec<(u32, String)> = ids
                .iter()
                .filter_map(|&id| Some((id, session.system(id)?.star_class.clone())))
                .collect();
            drop(guard);
            let resolver = sgf_gamedata::resolver(gd.as_deref());
            Ok(stars
                .iter()
                .filter_map(|(id, star)| {
                    let mut resolved = details.resolve(*id, resolver, gd.is_some())?;
                    if let Some(gd) = gd.as_deref() {
                        gd.resolve_save_bodies(&mut resolved, star);
                    }
                    Some(resolved)
                })
                .collect())
        }
    }
}

/// Roll `roll` of scenario system `id`: where each body its details list lands, or, when the
/// game rolls its planets, placeholder planets inside `within`. The same system and roll give
/// the same answer. Empty on a save, whose bodies stand where the save puts them, and without
/// game data.
#[tauri::command]
pub async fn get_system_roll<R: Runtime>(
    app: AppHandle<R>,
    id: u32,
    roll: u32,
    within: f64,
) -> Result<SystemRoll, SgfError> {
    with_session(app.clone(), move |guard| {
        let gd = app.state::<GameDataState>().loaded();
        roll_for(guard, gd.as_deref(), id, roll, within)
    })
    .await
}

/// Roll `roll` of system `id` of the open document, where its kind rolls its bodies. The lock
/// is let go before the roll.
fn roll_for(
    guard: MutexGuard<'_, Option<Session>>,
    gd: Option<&GameData>,
    id: u32,
    roll: u32,
    within: f64,
) -> Result<SystemRoll, SgfError> {
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    let none = SystemRoll::none(id, roll);
    match session.kind() {
        DocumentKind::Save => Ok(none),
        DocumentKind::Scenario => {
            let (Some(gd), Some(system)) = (gd, session.system(id)) else {
                return Ok(none);
            };
            let (initializer, star_class) = (system.initializer.clone(), system.star_class.clone());
            drop(guard);
            Ok(gd.system_roll(id, &initializer, &star_class, roll, within))
        }
    }
}

/// Who owns each scenario system, computed from every system at once and kept until the
/// game data or the scenario changes, so a per-system command need not recompute it.
fn scenario_owners(
    session: &Session,
    gd: &GameData,
    state: &GameDataState,
    generation: u64,
) -> Arc<ScenarioOwners> {
    ScenarioSystem::of_session(session, |systems, digest| {
        if let Some(cached) = state.owners(generation, digest) {
            return cached;
        }
        let owners = Arc::new(gd.scenario_owners(systems));
        state.store_owners(generation, digest, Arc::clone(&owners));
        owners
    })
}

/// The bypasses the initializers and the day-one events place, on the same terms.
fn scenario_bypasses(
    session: &Session,
    gd: &GameData,
    state: &GameDataState,
    generation: u64,
) -> Arc<ScenarioBypasses> {
    ScenarioSystem::of_session(session, |systems, digest| {
        if let Some(cached) = state.bypasses(generation, digest) {
            return cached;
        }
        let bypasses = Arc::new(gd.scenario_bypasses(systems));
        state.store_bypasses(generation, digest, Arc::clone(&bypasses));
        bypasses
    })
}
