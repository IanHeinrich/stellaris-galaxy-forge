//! Tauri shell: the commands in [`commands`] are the whole IPC surface.

pub mod commands;
pub mod state;
pub mod views;
pub mod watch;

use sgf_gamedata::textures::Textures;
use tauri::{Builder, Runtime};

/// Register state and commands. `run()` and the tests build the same app from this.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .manage(state::AppState::default())
        .manage(state::GameDataState::default())
        .manage(state::TextureState(Textures::new(None)))
        .manage(watch::WatchState::default())
        .manage(state::UpdateState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::save_dirs,
            commands::list_saves,
            commands::list_campaigns,
            commands::list_campaign_saves,
            commands::list_scenarios,
            commands::open_save,
            commands::open_as_scenario,
            commands::open_scenario_text,
            commands::new_scenario,
            commands::export_scenario,
            commands::get_system,
            commands::search,
            commands::warm_details,
            commands::apply_op,
            commands::undo,
            commands::redo,
            commands::save,
            commands::save_as,
            commands::close_save,
            commands::is_cloud_save,
            commands::load_game_data,
            commands::game_data_summary,
            commands::unload_game_data,
            commands::resume_auto_reload,
            commands::get_special_systems,
            commands::get_entity,
            commands::get_entity_source,
            commands::get_entity_schema,
            commands::get_scenario_owners,
            commands::get_scenario_bypasses,
            commands::open_script,
            commands::open_url,
            commands::get_system_scripts,
            commands::get_names,
            commands::resolve_names,
            commands::get_star_classes,
            commands::get_deposits,
            commands::get_bypasses,
            commands::get_initializers,
            commands::get_map_colors,
            commands::get_planet_classes,
            commands::get_starbase_levels,
            commands::get_ship_sizes,
            commands::get_country_types,
            commands::get_resource_icons,
            commands::get_textures,
            commands::get_system_details,
            commands::check_for_update,
            commands::install_update,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
