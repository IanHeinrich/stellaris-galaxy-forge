use std::collections::HashMap;

use tauri::State;

use crate::state::GameDataState;

/// Each key's localisation entry as written, its `$KEY$` references kept, for a name format
/// the app fills in itself; only the keys the loaded localisation has; empty without game data.
#[tauri::command(async)]
pub fn get_raw_names(
    game_data: State<'_, GameDataState>,
    keys: Vec<String>,
) -> HashMap<String, String> {
    let Some(gd) = game_data.loaded() else {
        return HashMap::new();
    };
    keys.into_iter()
        .filter_map(|key| gd.loc.raw(&key).map(|text| (key, text.to_owned())))
        .collect()
}
