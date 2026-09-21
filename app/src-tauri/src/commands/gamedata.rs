//! Loading the install's game data, and serving what the loaded data holds.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sgf_core::library;
use sgf_core::projections::name::NameTemplate;
use sgf_core::views::{ErrorKind, ProgressPhase, SgfError};
use sgf_gamedata::install::{discovery, mods};
use sgf_gamedata::textures::TextureView;
use sgf_gamedata::views::{
    BypassView, CountryTypeView, DepositView, GameDataSummary, InitializerView, MapColor,
    PaintModView, PlanetClassView, ResourceIcon, ShipSizeView, StarClassView, StarbaseLevelView,
};
use sgf_gamedata::{GameData, LoadOptions, Phase};
use tauri::{AppHandle, Manager, Runtime, State};

use super::{DEFINITIONS_AT, DISCOVER_AT, DONE, LOCALISATION_AT, join_error, load_error, progress};
use crate::state::{GameDataState, TextureState};
use crate::watch;

/// Read the install (discovered through Steam unless `install_path` is given) and the
/// enabled mods, replacing any loaded game data. Emits `sgf://progress`.
#[tauri::command]
pub async fn load_game_data<R: Runtime>(
    app: AppHandle<R>,
    install_path: Option<String>,
    language: Option<String>,
    mods: Option<bool>,
) -> Result<GameDataSummary, SgfError> {
    let opts = LoadOptions {
        install: install_path.map(PathBuf::from),
        language: language.unwrap_or_else(|| LoadOptions::default().language),
        mods: mods.unwrap_or(LoadOptions::default().mods),
        ..LoadOptions::default()
    };
    let task_app = app.clone();
    let gd = tauri::async_runtime::spawn_blocking(move || {
        let mut report = |phase: Phase| {
            let (phase, fraction) = match phase {
                Phase::Discover => (ProgressPhase::Discover, DISCOVER_AT),
                Phase::Definitions => (ProgressPhase::Definitions, DEFINITIONS_AT),
                Phase::Localisation => (ProgressPhase::Localisation, LOCALISATION_AT),
            };
            progress(&task_app, phase, fraction);
        };
        sgf_gamedata::load(&opts, &mut report).map_err(load_error)
    })
    .await
    .map_err(join_error)??;
    let gd = Arc::new(gd);
    app.state::<GameDataState>().store(Some(Arc::clone(&gd)));
    watch::start(&app, &gd);
    let summary = summary(&app, &gd);
    progress(&app, ProgressPhase::Done, DONE);
    Ok(summary)
}

#[tauri::command]
pub fn game_data_summary<R: Runtime>(app: AppHandle<R>) -> Option<GameDataSummary> {
    let gd = app.state::<GameDataState>().loaded()?;
    Some(summary(&app, &gd))
}

#[tauri::command(async)]
pub fn unload_game_data<R: Runtime>(app: AppHandle<R>) {
    watch::stop(&app);
    app.state::<GameDataState>().store(None);
}

/// Rebuild again after the auto-reload breaker paused the watcher; nothing
/// when no game data is loaded.
#[tauri::command]
pub fn resume_auto_reload<R: Runtime>(app: AppHandle<R>) {
    watch::resume(&app);
}

/// The counts, plus what only the shell knows: the generation and the watcher.
fn summary<R: Runtime>(app: &AppHandle<R>, gd: &GameData) -> GameDataSummary {
    GameDataSummary {
        generation: app.state::<GameDataState>().generation(),
        watch: watch::view(app),
        ..GameDataSummary::from(gd)
    }
}

/// Open a game-data file in the editor the shell prefers, or show it in its folder. Only a
/// file under the loaded install, user directory or a loaded mod is opened: the path comes from
/// the script index, and the check keeps a stray path in a view from reaching the shell.
#[tauri::command]
pub fn open_script(
    game_data: State<'_, GameDataState>,
    path: String,
    reveal: bool,
) -> Result<(), SgfError> {
    let Some(gd) = game_data.loaded() else {
        return Err(SgfError::new(
            ErrorKind::NotFound,
            "no game data is loaded".to_owned(),
        ));
    };
    let file = Path::new(&path);
    if !gd.layout.contains(file) {
        return Err(SgfError::new(
            ErrorKind::NotFound,
            format!("{path} is not a file of the loaded game data"),
        ));
    }
    let result = match reveal {
        true => tauri_plugin_opener::reveal_item_in_dir(file),
        false => tauri_plugin_opener::open_path(file, None::<&str>),
    };
    result.map_err(|e| SgfError::new(ErrorKind::Io, e.to_string()))
}

/// The links the app itself offers. Only these are opened: the check keeps a URL that reached a
/// view from elsewhere from being handed to the shell.
const LINKS: &[&str] = &[
    "https://oatmealproblem.github.io/paint-a-galaxy/",
    PAINT_MOD_WORKSHOP_URL,
    // Reserved Spawns submod, whose "Reserved Spawn A"-"Z" traits a reserved seat's empire needs.
    "https://steamcommunity.com/sharedfiles/filedetails/?id=3762808682",
    // Local Cluster submod, the usual workaround for Sol having no Sol-specific neighbours.
    "https://steamcommunity.com/sharedfiles/filedetails/?id=3634498401",
    super::update::RELEASES_URL,
];
/// Paint a Galaxy's Steam Workshop page, whose id must match `mods::PAINT_MOD_WORKSHOP_ID`.
const PAINT_MOD_WORKSHOP_URL: &str =
    "https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115";

/// Open one of the app's own links in the user's browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), SgfError> {
    if !LINKS.contains(&url.as_str()) {
        return Err(SgfError::new(
            ErrorKind::NotFound,
            format!("{url} is not a link this app opens"),
        ));
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| SgfError::new(ErrorKind::Io, e.to_string()))
}

/// Where Paint a Galaxy is on this machine, from the launcher's files alone, so it is known
/// before game data loads. `None` when the launcher lists no copy, or has no user directory.
#[tauri::command]
pub async fn paint_mod<R: Runtime>(app: AppHandle<R>) -> Result<Option<PaintModView>, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    tauri::async_runtime::spawn_blocking(move || {
        let user_dir = gd
            .as_ref()
            .and_then(|gd| gd.layout.user_dir.clone())
            .or_else(library::paradox_user_dir);
        let Some(user_dir) = user_dir else {
            return Ok(None);
        };
        let libraries = discovery::steam_libraries();
        let mut diagnostics = Vec::new();
        let installed = mods::installed_mods(&user_dir, &libraries, &mut diagnostics);
        let enabled = mods::enabled_mods(&user_dir, &libraries, &mut diagnostics);
        Ok(mods::find_paint_mod(&installed, &enabled, &libraries)
            .as_ref()
            .map(PaintModView::from))
    })
    .await
    .map_err(join_error)?
}

/// The localised text of each key the loaded localisation knows; empty without game data.
#[tauri::command(async)]
pub fn get_names(
    game_data: State<'_, GameDataState>,
    keys: Vec<String>,
) -> HashMap<String, String> {
    let Some(gd) = game_data.loaded() else {
        return HashMap::new();
    };
    keys.into_iter()
        .filter_map(|key| gd.loc.get(&key).map(|name| (key, name)))
        .collect()
}

/// Each templated name as the game shows it; without game data, its save stand-in.
#[tauri::command]
pub async fn resolve_names(
    game_data: State<'_, GameDataState>,
    names: Vec<NameTemplate>,
) -> Result<Vec<String>, SgfError> {
    let gd = game_data.loaded();
    tauri::async_runtime::spawn_blocking(move || match gd {
        Some(gd) => names.iter().map(|n| gd.loc.resolve_template(n)).collect(),
        None => names.iter().map(NameTemplate::stand_in).collect(),
    })
    .await
    .map_err(join_error)
}

#[tauri::command(async)]
pub fn get_star_classes(game_data: State<'_, GameDataState>) -> Vec<StarClassView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.star_classes.iter().map(StarClassView::from).collect()
    })
}

#[tauri::command(async)]
pub fn get_deposits(game_data: State<'_, GameDataState>) -> Vec<DepositView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.deposits.iter().map(DepositView::from).collect()
    })
}

#[tauri::command(async)]
pub fn get_bypasses(game_data: State<'_, GameDataState>) -> Vec<BypassView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.bypasses.iter().map(BypassView::from).collect()
    })
}

#[tauri::command(async)]
pub fn get_initializers(game_data: State<'_, GameDataState>) -> Vec<InitializerView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.initializers.iter().map(InitializerView::from).collect()
    })
}

#[tauri::command(async)]
pub fn get_map_colors(game_data: State<'_, GameDataState>) -> Vec<MapColor> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.colors.iter().map(MapColor::from).collect()
    })
}

#[tauri::command(async)]
pub fn get_planet_classes(game_data: State<'_, GameDataState>) -> Vec<PlanetClassView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.planet_classes
            .iter()
            .map(PlanetClassView::from)
            .collect()
    })
}

#[tauri::command(async)]
pub fn get_starbase_levels(game_data: State<'_, GameDataState>) -> Vec<StarbaseLevelView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.starbase_levels
            .iter()
            .map(StarbaseLevelView::from)
            .collect()
    })
}

#[tauri::command(async)]
pub fn get_ship_sizes(game_data: State<'_, GameDataState>) -> Vec<ShipSizeView> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        gd.ship_sizes.iter().map(ShipSizeView::from).collect()
    })
}

#[tauri::command(async)]
pub fn get_country_types(game_data: State<'_, GameDataState>) -> Vec<CountryTypeView> {
    game_data
        .loaded()
        .map_or_else(Vec::new, |gd| gd.country_type_views())
}

#[tauri::command(async)]
pub fn get_resource_icons(game_data: State<'_, GameDataState>) -> Vec<ResourceIcon> {
    game_data
        .loaded()
        .map_or_else(Vec::new, |gd| gd.resource_icons())
}

/// One view per key, in order; a key that fails carries its error instead of failing the call.
#[tauri::command]
pub async fn get_textures<R: Runtime>(
    app: AppHandle<R>,
    keys: Vec<String>,
) -> Result<Vec<TextureView>, SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let gd = app.state::<GameDataState>().loaded();
        let textures = app.state::<TextureState>();
        keys.iter()
            .map(|key| match &gd {
                Some(gd) => gd.texture(&textures.0, key),
                None => TextureView {
                    key: key.clone(),
                    width: 0,
                    height: 0,
                    png_base64: None,
                    error: Some("no game data loaded".to_owned()),
                },
            })
            .collect()
    })
    .await
    .map_err(join_error)
}
