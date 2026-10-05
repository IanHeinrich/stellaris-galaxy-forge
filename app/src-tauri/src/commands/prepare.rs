//! Preparing the open scenario for a new game: what a set of choices would change, and the one
//! edit that writes them.

use sgf_core::ops::Op;
use sgf_core::prepare::{self, PrepareError, PrepareOptions, RowChoice, RowSystems};
use sgf_core::session::Session;
use sgf_core::views::{Capabilities, ErrorKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::prepare::{classify, plain_draw};
use tauri::{AppHandle, Runtime};

use super::{game_data, is_save, require, with_session};
use crate::views::{PreparePreview, PreparedEdit};

const PREPARE: &str = "prepare a scenario for a new game";
const ONLY_A_SCENARIO: &str = "only a scenario is prepared for a new game";
/// The draw Plain system takes when the app names no seed, so a preview counts what Apply writes.
const DEFAULT_SEED: u64 = 0;

/// What `choices` under `options` would do to the open scenario: each row's systems, sorted by
/// the loaded game data, how many systems the one edit would change, the systems keeping the
/// space around seats clear makes plain, and the systems the edit cuts off. A row left out of
/// `choices` is kept.
#[tauri::command]
pub async fn prepare_preview<R: Runtime>(
    app: AppHandle<R>,
    choices: Vec<RowChoice>,
    options: PrepareOptions,
) -> Result<PreparePreview, SgfError> {
    let gd = game_data(&app, PREPARE)?;
    with_session(app, move |guard| {
        let session = require(guard.as_ref(), is_scenario, ONLY_A_SCENARIO)?;
        let rows = classify(session, &gd);
        let draw = plain_draw(&gd, DEFAULT_SEED);
        let op = build(session, &gd, &rows, &choices, &options, DEFAULT_SEED)?;
        let kept_clear = match options.clear_around_seats {
            true => prepare::kept_clear(session, &rows, &choices, &draw).map_err(refused)?,
            false => Vec::new(),
        };
        Ok(PreparePreview {
            profile: prepare::profile(session),
            changes: op.as_ref().map_or(0, |op| prepare::changed(session, op)),
            cut_off: op.map_or_else(Vec::new, |op| prepare::cut_off(session, &op)),
            kept_clear,
            rows,
        })
    })
    .await
}

/// Write `choices` under `options` over the open scenario as one `Batch`, one undo step, with how
/// many systems it changed; `None` when they change nothing. `options` are the default ones when
/// absent. `seed` picks the ordinary layouts Plain system draws on a plain scenario, the
/// preview's when absent.
#[tauri::command]
pub async fn prepare_apply<R: Runtime>(
    app: AppHandle<R>,
    choices: Vec<RowChoice>,
    options: Option<PrepareOptions>,
    seed: Option<u64>,
) -> Result<Option<PreparedEdit>, SgfError> {
    let gd = game_data(&app, PREPARE)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_scenario, ONLY_A_SCENARIO)?;
        let rows = classify(session, &gd);
        let seed = seed.unwrap_or(DEFAULT_SEED);
        let options = options.unwrap_or_default();
        let Some(op) = build(session, &gd, &rows, &choices, &options, seed)? else {
            return Ok(None);
        };
        let changes = prepare::changed(session, &op);
        let result = session.apply(op)?;
        Ok(Some(PreparedEdit {
            edit: session.edit_result(result),
            changes,
        }))
    })
    .await
}

fn is_scenario(capabilities: Capabilities) -> bool {
    !is_save(capabilities)
}

fn build(
    session: &Session,
    gd: &GameData,
    rows: &[RowSystems],
    choices: &[RowChoice],
    options: &PrepareOptions,
    seed: u64,
) -> Result<Option<Op>, SgfError> {
    prepare::build(session, rows, choices, &plain_draw(gd, seed), options).map_err(refused)
}

fn refused(error: PrepareError) -> SgfError {
    let message = match &error {
        PrepareError::UneSeatOnPlain => "Only a Paint a Galaxy map has a UNE seat.".to_owned(),
        PrepareError::SolSeatTaken(system) => format!(
            "System #{system} already holds the Sol seat. Keep Sol, or take that seat off first."
        ),
        PrepareError::SeveralSols(systems) => {
            let ids: Vec<String> = systems.iter().map(|id| format!("#{id}")).collect();
            format!(
                "A UNE seat goes on one Sol, and this map has {}: {}.",
                systems.len(),
                ids.join(", ")
            )
        }
        _ => error.to_string(),
    };
    SgfError::new(ErrorKind::Op, message)
}
