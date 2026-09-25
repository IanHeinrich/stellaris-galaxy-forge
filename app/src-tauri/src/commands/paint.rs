//! What the open Paint a Galaxy scenario's fallen empire zones and header counts should be.

use sgf_core::format::scenario::fe_zone::FeZone;
use sgf_core::format::scenario::header_counts::{empire_counts, for_graph};
use sgf_core::ops::Op;
use sgf_core::ops::rules::fe_zone as placement;
use sgf_core::views::{DocumentKind, EditResult, SgfError};
use tauri::{AppHandle, Runtime};

use super::{apply_op, require, with_session};

const NO_ZONES: &str = "only a scenario has fallen empire zones";
const NO_COUNTS: &str = "only a scenario has empire counts";

/// Link `linked` to the fallen empire zone `anchor` anchors, as one `SetFeLinks` op:
/// the mod then lays the fallen empire's hyperlanes from those systems and no other.
/// An empty `linked` gives the zone back to the mod's own rule.
#[tauri::command]
pub async fn set_fe_links<R: Runtime>(
    app: AppHandle<R>,
    anchor: u32,
    linked: Vec<u32>,
) -> Result<EditResult, SgfError> {
    apply_op(app, Op::SetFeLinks { anchor, linked }).await
}

/// The entries of one `SetFeZones` op that replace the open scenario's automatic
/// fallen empire zones with `count` of the ones Paint a Galaxy's own rule would place
/// now, spread over the map; the zones the map author placed by hand are not among
/// them. The app applies the op.
#[tauri::command]
pub async fn fe_zone_fit<R: Runtime>(
    app: AppHandle<R>,
    count: usize,
) -> Result<Vec<(u32, Option<FeZone>)>, SgfError> {
    with_session(app, move |guard| {
        let session = require(guard.as_ref(), DocumentKind::Scenario, NO_ZONES)?;
        Ok(placement::fit(&placement::sites(&session.graph), count))
    })
    .await
}

/// How many automatic fallen empire zones Paint a Galaxy's rule can place on the open
/// scenario: the most `fe_zone_fit` accepts.
#[tauri::command]
pub async fn fe_zone_candidate_count<R: Runtime>(app: AppHandle<R>) -> Result<usize, SgfError> {
    with_session(app, |guard| {
        let session = require(guard.as_ref(), DocumentKind::Scenario, NO_ZONES)?;
        Ok(placement::candidate_count(&placement::sites(
            &session.graph,
        )))
    })
    .await
}

/// The five empire-count header keys and the values Paint a Galaxy's formulas give
/// the open scenario's seats, for the app to apply as one `SetHeaderKeys`.
#[tauri::command]
pub async fn header_empire_counts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<(String, String)>, SgfError> {
    with_session(app, |guard| {
        let session = require(guard.as_ref(), DocumentKind::Scenario, NO_COUNTS)?;
        let (seats, zones, clans) = for_graph(&session.graph);
        Ok(empire_counts(seats, zones, clans)
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect())
    })
    .await
}
