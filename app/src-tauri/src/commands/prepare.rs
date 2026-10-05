//! Preparing the open scenario for a new game: what a set of choices would change, and the one
//! edit that writes them.

use sgf_core::ops::Op;
use sgf_core::prepare::{self, PrepareOptions, RowChoice, RowSystems};
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

/// What `choices` would do to the open scenario: each row's systems, sorted by the loaded game
/// data, and how many systems the one edit would change. A row left out of `choices` is kept.
#[tauri::command]
pub async fn prepare_preview<R: Runtime>(
    app: AppHandle<R>,
    choices: Vec<RowChoice>,
) -> Result<PreparePreview, SgfError> {
    let gd = game_data(&app, PREPARE)?;
    with_session(app, move |guard| {
        let session = require(guard.as_ref(), is_scenario, ONLY_A_SCENARIO)?;
        let rows = classify(session, &gd);
        let op = build(session, &gd, &rows, &choices, DEFAULT_SEED)?;
        Ok(PreparePreview {
            profile: prepare::profile(session),
            changes: op.map_or(0, |op| prepare::changed(session, &op)),
            rows,
        })
    })
    .await
}

/// Write `choices` over the open scenario as one `Batch`, one undo step, with how many systems it
/// changed; `None` when they change nothing. `seed` picks the ordinary layouts Plain system draws on a plain scenario, the
/// preview's when absent.
#[tauri::command]
pub async fn prepare_apply<R: Runtime>(
    app: AppHandle<R>,
    choices: Vec<RowChoice>,
    seed: Option<u64>,
) -> Result<Option<PreparedEdit>, SgfError> {
    let gd = game_data(&app, PREPARE)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_scenario, ONLY_A_SCENARIO)?;
        let rows = classify(session, &gd);
        let seed = seed.unwrap_or(DEFAULT_SEED);
        let Some(op) = build(session, &gd, &rows, &choices, seed)? else {
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
    seed: u64,
) -> Result<Option<Op>, SgfError> {
    let options = PrepareOptions::default();
    prepare::build(session, rows, choices, &plain_draw(gd, seed), &options)
        .map_err(|e| SgfError::new(ErrorKind::Op, e.to_string()))
}
