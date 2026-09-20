//! What the loaded scripts say about systems: territories, bypasses and details.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use sgf_core::format::save::details::SystemDetails;
use sgf_core::session::{Session, SessionError};
use sgf_core::views::{DocumentKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::scripts::{ScenarioBypasses, ScenarioOwners, ScenarioSystem, SystemScripts};
use sgf_gamedata::special::{self, SpecialSystems};
use tauri::{AppHandle, Manager, Runtime};

use super::{join_error, lock, with_scenario};
use crate::state::{AppState, GameDataState};

#[tauri::command]
pub async fn get_special_systems<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SpecialSystems, SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = lock(&state);
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        let gd = app.state::<GameDataState>().loaded();
        Ok(special::classify_session(session, gd.as_deref()))
    })
    .await
    .map_err(join_error)?
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
/// loaded scripts. `None` on a save or without game data.
#[tauri::command]
pub async fn get_scenario_bypasses<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<ScenarioBypasses>, SgfError> {
    let bypasses = with_scenario(app, |session, gd, state, generation| {
        Some(scenario_bypasses(session, gd, state, generation))
    })
    .await?;
    Ok(bypasses.map(|bypasses| (*bypasses).clone()))
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
        let mut scripts = gd.system_scripts(id, initializer_of(&system.initializer), effect);
        scripts.attach_territory(&scenario_owners(session, gd, state, generation));
        Some(scripts)
    })
    .await
}

/// Details of each id that is a system, in the order given; resolved through the
/// install's definitions when game data is loaded, else by guessing from the keys.
///
/// A scenario holds no details sections: a system's planets, resources, megastructures,
/// dig sites and starbase are what its initializer defines, so only a system whose
/// initializer the install knows and that defines any of them gets a record.
#[tauri::command]
pub async fn get_system_details<R: Runtime>(
    app: AppHandle<R>,
    ids: Vec<u32>,
) -> Result<Vec<SystemDetails>, SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let gd_state = app.state::<GameDataState>();
        let guard = lock(&state);
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        if session.kind() == DocumentKind::Scenario {
            let Some((generation, gd)) = gd_state.snapshot() else {
                return Ok(Vec::new());
            };
            let owners = scenario_owners(session, &gd, &gd_state, generation);
            let initializers: Vec<(u32, String)> = ids
                .iter()
                .filter_map(|&id| Some((id, session.system(id)?.initializer.clone())))
                .collect();
            drop(guard);
            return Ok(initializers
                .iter()
                .filter_map(|(id, key)| gd.initializer_details(*id, key, Some(&owners)))
                .collect());
        }
        let gd = gd_state.loaded();
        let details = session.details().map_err(SessionError::from)?;
        drop(guard);
        let resolver = sgf_gamedata::resolver(gd.as_deref());
        Ok(ids
            .iter()
            .filter_map(|&id| details.resolve(id, resolver, gd.is_some()))
            .collect())
    })
    .await
    .map_err(join_error)?
}

/// A scenario system's initializer key; the empty string means "random", which has none.
fn initializer_of(key: &str) -> Option<&str> {
    Some(key).filter(|k| !k.is_empty())
}

/// Who owns each scenario system, computed from every system at once and kept until the
/// game data or the scenario changes, so a per-system command need not recompute it.
fn scenario_owners(
    session: &Session,
    gd: &GameData,
    state: &GameDataState,
    generation: u64,
) -> Arc<ScenarioOwners> {
    scenario_systems(session, |systems, digest| {
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
    scenario_systems(session, |systems, digest| {
        if let Some(cached) = state.bypasses(generation, digest) {
            return cached;
        }
        let bypasses = Arc::new(gd.scenario_bypasses(systems));
        state.store_bypasses(generation, digest, Arc::clone(&bypasses));
        bypasses
    })
}

/// Every scenario system as the scripts see it, with the digest a cache is keyed on.
fn scenario_systems<T>(session: &Session, f: impl FnOnce(&[ScenarioSystem<'_>], u64) -> T) -> T {
    let effects = session.scenario_system_effects();
    let by_system: HashMap<u32, &str> = effects
        .iter()
        .map(|(id, text, _)| (*id, text.as_str()))
        .collect();
    let systems: Vec<ScenarioSystem<'_>> = session
        .graph
        .systems
        .values()
        .map(|s| ScenarioSystem {
            id: s.id,
            initializer: initializer_of(&s.initializer),
            effect: by_system.get(&s.id).copied(),
        })
        .collect();
    let digest = digest(&systems);
    f(&systems, digest)
}

/// What the territories are computed from: every system's id, initializer and effect.
fn digest(systems: &[ScenarioSystem<'_>]) -> u64 {
    let mut hasher = DefaultHasher::new();
    systems.len().hash(&mut hasher);
    for system in systems {
        system.id.hash(&mut hasher);
        system.initializer.hash(&mut hasher);
        system.effect.hash(&mut hasher);
    }
    hasher.finish()
}
