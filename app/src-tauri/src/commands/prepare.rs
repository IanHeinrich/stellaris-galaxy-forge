//! Preparing the open scenario for a new game: what a set of choices would change, and the one
//! edit that writes them.

use std::sync::Arc;

use sgf_core::ops::Op;
use sgf_core::prepare::{self, PlainDraw, PrepareError, PrepareOptions, RowChoice, RowSystems};
use sgf_core::session::Session;
use sgf_core::views::{Capabilities, ErrorKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::prepare::{classify, plain_draw};
use sgf_gamedata::special;
use tauri::{AppHandle, Runtime};

use super::scenario::{placed_bypasses, scenario_owners};
use super::{game_data, is_save, require, with_session};
use crate::views::{NewZone, PreparePreview, PreparedEdit, PreparedMap};

const PREPARE: &str = "prepare a scenario for a new game";
const ONLY_A_SCENARIO: &str = "only a scenario is prepared for a new game";

/// What `choices` under `options` would do to the open scenario: each row's systems, sorted by
/// the loaded game data, how many systems the one edit would change, the systems keeping the
/// space around seats clear makes plain, the systems the edit cuts off, and the seats and zones
/// it draws, and with `map` the map as the edit would leave it. A row left out of `choices` is
/// kept.
#[tauri::command]
pub async fn prepare_preview<R: Runtime>(
    app: AppHandle<R>,
    choices: Vec<RowChoice>,
    options: PrepareOptions,
    map: bool,
) -> Result<PreparePreview, SgfError> {
    let gd = game_data(&app, PREPARE)?;
    with_session(app, move |guard| {
        let session = require(guard.as_ref(), is_scenario, ONLY_A_SCENARIO)?;
        let rows = classify(session, &gd);
        let draw = plain_draw(&gd, options.seed);
        let op = build(session, &rows, &choices, &draw, &options)?;
        let kept_clear = match options.clear_around_seats {
            true => {
                prepare::kept_clear(session, &rows, &choices, &draw, &options).map_err(refused)?
            }
            false => Vec::new(),
        };
        let drawn = prepare::drawn(session, &rows, &choices, &options).map_err(refused)?;
        let changes = op.as_ref().map_or(0, |op| prepare::changed(session, op));
        let cut_off = op
            .as_ref()
            .map_or_else(Vec::new, |op| prepare::cut_off(session, op));
        let map = op
            .filter(|_| map)
            .map(|op| projected(session, &gd, op))
            .transpose()?;
        Ok(PreparePreview {
            profile: prepare::profile(session),
            changes,
            cut_off,
            map,
            kept_clear,
            new_seats: drawn.seats,
            new_zones: drawn
                .zones
                .into_iter()
                .map(|(system, zone)| NewZone { system, zone })
                .collect(),
            seat_floor: drawn.seat_floor,
            rows,
        })
    })
    .await
}

/// Write `choices` under `options` over the open scenario as one `Batch`, one undo step, with how
/// many systems it changed; `None` when they change nothing. `options` are the default ones when
/// absent; the same options as a preview's give the edit it counted.
#[tauri::command]
pub async fn prepare_apply<R: Runtime>(
    app: AppHandle<R>,
    choices: Vec<RowChoice>,
    options: Option<PrepareOptions>,
) -> Result<Option<PreparedEdit>, SgfError> {
    let gd = game_data(&app, PREPARE)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_scenario, ONLY_A_SCENARIO)?;
        let rows = classify(session, &gd);
        let options = options.unwrap_or_default();
        let draw = plain_draw(&gd, options.seed);
        let Some(op) = build(session, &rows, &choices, &draw, &options)? else {
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

/// The map as `op` would leave the open scenario, read from a copy it is applied to.
fn projected(session: &Session, gd: &GameData, op: Op) -> Result<PreparedMap, SgfError> {
    let mut copy = session.clone();
    let result = copy.apply(op)?;
    let delta = copy.edit_result(result).delta;
    debug_assert!(
        delta.removed.is_empty() && delta.renumbered.is_empty(),
        "Prepare removed or renumbered systems: {:?} {:?}",
        delta.removed,
        delta.renumbered
    );
    let owners = Capabilities::of(copy.doc())
        .scripted_owners
        .then(|| Arc::unwrap_or_clone(scenario_owners(&copy, gd, None)));
    Ok(PreparedMap {
        systems: delta.systems,
        special: special::classify_session(&copy, Some(gd)).systems,
        owners,
        bypasses: placed_bypasses(&copy, Some(gd), None),
    })
}

fn is_scenario(capabilities: Capabilities) -> bool {
    !is_save(capabilities)
}

fn build(
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
    draw: &PlainDraw,
    options: &PrepareOptions,
) -> Result<Option<Op>, SgfError> {
    prepare::build(session, rows, choices, draw, options).map_err(refused)
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
        PrepareError::NoSeatsToDraw => {
            "This map has no seats, so there are none to draw again. Add a seat, or keep Empire seats."
                .to_owned()
        }
        PrepareError::SeatsDoNotFit { wanted, fit } => format!(
            "Only {fit} of the {wanted} seats fit on the systems left free, even close together. Let the game decide more rows, or keep Empire seats."
        ),
        PrepareError::RandomZonesOnPlain => {
            "Only a Paint a Galaxy map has fallen empire zones.".to_owned()
        }
        _ => error.to_string(),
    };
    SgfError::new(ErrorKind::Op, message)
}
