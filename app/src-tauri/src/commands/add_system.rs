//! Rolling a star system from the install's rules and writing it into the open save, and
//! deleting the systems added this session.

use sgf_core::ops::{LaneEnd, Op};
use sgf_core::views::Capabilities;
use sgf_core::views::{EditResult, ErrorKind, SgfError};
use sgf_gamedata::generate::{self, BuiltSystem, ClusterRoll, Pick, SystemAsk};
use sgf_gamedata::multi_star::{self, Arrangement, StarType};
use sgf_gamedata::picks::StarClassPick;
use sgf_gamedata::summary::{self, AddSystemPicks, ClusterPick, SpecialPick};
use tauri::{AppHandle, Runtime, State};

use super::{game_data, require, with_session};
use crate::state::GameDataState;

const ADD_A_SYSTEM: &str = "add a system";
const NO_ROLLS: &str = "this document takes no rolled system";
const NO_BULK_ADD: &str = "this document takes no systems added together";
const NO_SPECIAL: &str = "this document takes no special systems";
const NO_ADDED: &str = "this document has no systems added this session";
const NONE_ADDED: &str = "none of these systems was added this session";
const NO_BUILT: &str = "this document takes no built binary or trinary systems";

/// A document that takes a binary or trinary built star by star: a save whose systems are
/// rolled together, not a scenario, whose systems name their initializers.
fn builds_stars(c: Capabilities) -> bool {
    c.bulk_add_systems && !c.create_systems
}

/// Roll a system at (`x`, `y`) from `seed`, around `star_class` when given, named from the
/// save's pool of unused star names, and add it to the open save as one `AddSystemFromSpec`.
/// With `star_count`, it is a random binary (2) or trinary (3) instead, drawn among the plain
/// layouts of that many stars at their odds, and `star_class` says nothing.
#[tauri::command]
pub async fn add_random_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    star_class: Option<String>,
    star_count: Option<usize>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ROLLS)?;
        let pick = match star_count {
            Some(count) => Pick::Stars(count),
            None => Pick::Random(star_class),
        };
        let spec = generate::for_save(&gd, session, seed, (x, y), &pick)?;
        let result = session.apply(Op::AddSystemFromSpec { spec })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Roll a system at each of `systems` around its star class, all from `seed`, named from one
/// draw so no two share a name, and add them with `lanes` to the open save as one `Batch`
/// described as `description`.
#[tauri::command]
pub async fn add_random_systems<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    systems: Vec<SystemAsk>,
    lanes: Vec<(LaneEnd, LaneEnd)>,
    description: String,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        let op = generate::systems_op(&gd, session, seed, &systems, &lanes, description)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Build a system of the special layout `layout` at (`x`, `y`) from `seed`, and add it to the
/// open save with what its script plants beside its bodies, as one `Batch`: the planet flags
/// and global event targets always, the anomalies and dig sites when `extras`. It takes the
/// layout's fixed name unless a system of the save holds it, and a name from the pool
/// otherwise. A capped layout the galaxy already has is placed all the same. A scenario takes
/// a system statement naming the layout as its initializer, and `extras` says nothing. Each
/// of `links`, a system the document holds, is joined to the new one by a lane in the same
/// step; an id naming no system refuses the add with nothing applied.
#[tauri::command]
pub async fn add_special_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    layout: String,
    extras: bool,
    links: Vec<u32>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_SPECIAL)?;
        let op = generate::special_op(&gd, session, seed, (x, y), &layout, extras, &links)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// The Special menu's cluster `cluster` rolled from `seed` with its home at (`x`, `y`), as
/// `add_special_cluster` adds it from the same arguments: each system's layout, name, place
/// and star class, why the add refuses its place, and the lanes between them. Nothing is
/// written; another seed places and rolls them again.
#[tauri::command]
pub async fn roll_special_cluster<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    cluster: String,
) -> Result<ClusterRoll, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_SPECIAL)?;
        let rolled = generate::roll_cluster(&gd, session, seed, (x, y), &cluster)?;
        Ok(rolled.view(&gd))
    })
    .await
}

/// Add the Special menu's cluster `cluster`, rolled from `seed` with its home at (`x`, `y`)
/// as `roll_special_cluster` previews it, as one `Batch` with the lanes between its systems.
/// A save takes each system as `add_special_system` does, with the anomalies, dig sites and
/// megastructures of all of them when `extras`; a scenario takes a statement naming each
/// one's initializer, and `extras` says nothing. Each of `links`, an index into the roll's
/// systems and a system the document holds, is a lane laid after the cluster's own. Refused
/// with nothing applied when a system's place is refused, or a link names no system.
#[tauri::command]
pub async fn add_special_cluster<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    cluster: String,
    extras: bool,
    links: Vec<(usize, u32)>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_SPECIAL)?;
        let op = generate::cluster_op(&gd, session, seed, (x, y), &cluster, extras, &links)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// The Special menu's layouts for the open document, each with its card, in a scenario as in a
/// save: what `get_add_system_picks` lists as its `special`.
#[tauri::command]
pub async fn get_special_layouts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SpecialPick>, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_SPECIAL)?;
        Ok(summary::special_picks(&gd, session))
    })
    .await
}

/// The Special menu's clusters for the open document, each with its card, in a scenario as
/// in a save: what `get_add_system_picks` lists as its `clusters`.
#[tauri::command]
pub async fn get_special_clusters<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ClusterPick>, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_SPECIAL)?;
        Ok(summary::cluster_picks(&gd, session))
    })
    .await
}

/// Roll the added save system `system` again from `seed`, keeping its name, position and lanes:
/// one `ReplaceSystemFromSpec`. With `stars`, it is built from them as `add_built_system`
/// builds one, in `layout` or else its own layout, filed under `star_class` when given, with
/// planets unless `planets` is false. With `star_count`, it is a random binary or trinary.
/// Otherwise, with `keep_special`, a system of a Special menu layout is built from that layout
/// again, and else it is rolled around `star_class` when given, a random class when not.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn reroll_system<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    seed: u64,
    star_class: Option<String>,
    keep_special: Option<bool>,
    layout: Option<String>,
    stars: Option<Vec<String>>,
    planets: Option<bool>,
    star_count: Option<usize>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ROLLS)?;
        let keep_special = keep_special.unwrap_or(false);
        let pick = match (stars, star_count) {
            (Some(stars), _) => Pick::built_for(
                session,
                system,
                layout,
                stars,
                star_class,
                planets.unwrap_or(true),
            ),
            (None, Some(count)) => Ok(Pick::Stars(count)),
            (None, None) => Pick::of_added(session, &gd, system, keep_special, star_class),
        };
        let spec = pick.and_then(|pick| generate::reroll(&gd, session, seed, system, &pick))?;
        let result = session.apply(Op::ReplaceSystemFromSpec { system, spec })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// The plain layouts of more than one star the builder arranges stars in, each with its
/// shape, its share of the draw among the layouts of as many stars, and where its stars stand.
#[tauri::command]
pub async fn get_star_arrangements<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<Arrangement>, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        require(guard.as_mut(), builds_stars, NO_BUILT)?;
        Ok(multi_star::arrangements(&gd))
    })
    .await
}

/// Every star type a slot of the builder offers, the ones a galaxy draws first.
#[tauri::command]
pub async fn get_star_types<R: Runtime>(app: AppHandle<R>) -> Result<Vec<StarType>, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        require(guard.as_mut(), builds_stars, NO_BUILT)?;
        Ok(multi_star::star_types(&gd))
    })
    .await
}

/// The star class a system of `stars`, in slot order, is filed under. Refused for no stars and
/// for a slot that is no star.
#[tauri::command]
pub async fn file_star_class<R: Runtime>(
    app: AppHandle<R>,
    stars: Vec<String>,
) -> Result<String, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        require(guard.as_mut(), builds_stars, NO_BUILT)?;
        let filed = multi_star::file_star_class(&gd, &stars, None)
            .map_err(|e| SgfError::new(ErrorKind::Op, e.to_string()))?;
        Ok(filed.class)
    })
    .await
}

/// Build a system at (`x`, `y`) from `seed` in the plain layout `layout` with the planet
/// classes `stars` in its star slots, in order, filed under `star_class` when given and else
/// as `file_star_class` files the stars, with planets rolled at that class's odds unless
/// `planets` is false, and add it to the open save as one step, named from the save's pool.
/// Each of `links`, a system the save holds, is joined to the new one by a lane in the same
/// step. Refused with nothing applied in a scenario, for a layout that is not plain, a count
/// of stars other than its slots, and a link naming no system.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_built_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    layout: String,
    stars: Vec<String>,
    star_class: Option<String>,
    planets: Option<bool>,
    links: Vec<u32>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), builds_stars, NO_BUILT)?;
        let built = BuiltSystem {
            layout,
            stars,
            star_class,
            planets: planets.unwrap_or(true),
        };
        let op = generate::built_op(&gd, session, seed, (x, y), &built, &links)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Delete the systems among `ids` added to the open save this session as one `RemoveSystems`,
/// leaving the file's own systems among them alone.
#[tauri::command]
pub async fn remove_added_systems<R: Runtime>(
    app: AppHandle<R>,
    ids: Vec<u32>,
) -> Result<EditResult, SgfError> {
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ADDED)?;
        let added = generate::added_among(session, ids);
        if added.is_empty() {
            return Err(SgfError::new(ErrorKind::Op, NONE_ADDED));
        }
        let result = session.apply(Op::RemoveSystems { systems: added })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Everything the Add system menu offers for the open save, each with what it can produce:
/// Random, each star class, and the Special menu's layouts with their marks.
#[tauri::command]
pub async fn get_add_system_picks<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AddSystemPicks, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ROLLS)?;
        Ok(summary::add_system_picks(&gd, session))
    })
    .await
}

/// The star classes a rolled system can have, each with its localised name, in the order the
/// install's layouts name them; empty without game data.
#[tauri::command(async)]
pub fn get_generator_star_classes(game_data: State<'_, GameDataState>) -> Vec<StarClassPick> {
    game_data
        .loaded()
        .map_or_else(Vec::new, |gd| gd.star_class_picks())
}
