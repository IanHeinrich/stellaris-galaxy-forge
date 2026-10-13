//! What the Add megastructure dialog offers at a spot of a system of the open save: each type
//! that goes there, the type the game makes of it there, where its row stands and why the save
//! would refuse it.

use serde::{Deserialize, Serialize};
use sgf_core::ops::rules::RELAY_RADIUS_FACTOR;
use sgf_core::ops::{MegastructurePlace, Op, OpError};
use sgf_core::session::Session;
use sgf_core::views::SgfError;
use sgf_core::views::details::SiteBody;
use sgf_gamedata::GameData;
use sgf_gamedata::construction::habitat::habitat;
use sgf_gamedata::construction::ring_world::RingStage;
use sgf_gamedata::generate::{self, Planned, Refusal};
use sgf_gamedata::registries::megastructure_swaps::made_at;
use sgf_gamedata::registries::megastructures::{MegastructureDef, Placement, Unsupported};
use tauri::{AppHandle, Runtime};
use ts_rs::TS;

use super::{game_data, with_session};

/// Where in a system the Add megastructure dialog was opened.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AddSpot {
    /// On a body of the system.
    Body { body: u32 },
    /// At a point in empty space, about the star.
    Space { x: f64, y: f64 },
}

/// One type the dialog offers at a spot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureFit {
    pub kind: String,
    /// The type Add writes: the one the game swaps a finished row of `kind` for at the spot,
    /// else `kind`.
    pub variant: String,
    /// Where a row of `variant` stands: on the body, at the point pressed, or for a type built
    /// outside the gravity well, just outside the system's inner radius in the pressed
    /// direction.
    pub place: MegastructurePlace,
    /// Why the save would refuse `variant` there, as the add would say it; `None` when it goes.
    pub refusal: Option<String>,
}

/// Each type the install defines that goes at `spot` of system `system` of the open save, in
/// the install's order, with its placement and refusal; see [`fits`].
#[tauri::command]
pub async fn get_megastructure_fits<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    spot: AddSpot,
) -> Result<Vec<MegastructureFit>, SgfError> {
    let gd = game_data(&app, "add a megastructure")?;
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        fits(&gd, session, system, spot)
    })
    .await
}

/// Each type that goes at `spot`: in empty space, one placed at a point of its own; on a star,
/// one placed on a body that is not kept off stars and does not change its planet, a ring world
/// and a whole structure; on a planet, one not built only round a star. A type whose build
/// changes its planet in a way the editor cannot tell, or makes it a class it gives no planet,
/// goes on any body. A bypass the editor has not tried and a type that becomes a starbase go
/// nowhere. Each one's refusal is the add's own: the op the add would build, checked against
/// the session without applying it.
pub fn fits(
    gd: &GameData,
    session: &Session,
    system: u32,
    spot: AddSpot,
) -> Result<Vec<MegastructureFit>, SgfError> {
    let site = session
        .save("adding a megastructure")?
        .construction_site(system)?;
    let body = match spot {
        AddSpot::Body { body } => Some(
            site.bodies
                .iter()
                .find(|b| b.id == body)
                .ok_or(OpError::NotABody { body, system })?,
        ),
        AddSpot::Space { .. } => None,
    };
    let flags = &session.graph().global_flags;
    let class = body.map(|b| b.class.as_str());
    let inner = inner_radius(session, system);
    Ok(gd
        .megastructures
        .iter()
        .filter(|def| goes(def, body))
        .map(|def| {
            let variant = made_at(&gd.megastructures, &def.key, class, flags);
            let made = gd.megastructures.get(&variant).unwrap_or(def);
            let place = place(made, spot, inner);
            let refusal = refusal(gd, session, system, made, place);
            MegastructureFit {
                kind: def.key.clone(),
                variant,
                place,
                refusal,
            }
        })
        .collect())
}

fn goes(def: &MegastructureDef, body: Option<&SiteBody>) -> bool {
    let Some(body) = body else {
        return matches!(def.placement, Placement::Free { .. });
    };
    match &def.placement {
        Placement::Free { .. } => false,
        Placement::Body { .. } if body.star => !def.planet_only && def.planet_change.is_none(),
        Placement::Body { star_only } => !star_only,
        Placement::Unsupported { why } => match why {
            Unsupported::ChangesBody | Unsupported::FixedClass { .. } => true,
            Unsupported::WholeStructure { star_only } => !star_only || body.star,
            Unsupported::RingWorld => body.star,
            Unsupported::Bypass { .. } | Unsupported::BecomesStarbase => false,
        },
    }
}

fn place(def: &MegastructureDef, spot: AddSpot, inner_radius: f64) -> MegastructurePlace {
    match (spot, &def.placement) {
        (AddSpot::Body { body }, _) => MegastructurePlace::Body { body },
        (
            AddSpot::Space { x, y },
            Placement::Free {
                outside_gravity_well: true,
            },
        ) => {
            let radius = RELAY_RADIUS_FACTOR * inner_radius;
            let angle = y.atan2(x);
            MegastructurePlace::Free {
                x: radius * angle.cos(),
                y: radius * angle.sin(),
            }
        }
        (AddSpot::Space { x, y }, _) => MegastructurePlace::Free { x, y },
    }
}

/// The save's `inner_radius` of system `system`; 0 where it writes none.
fn inner_radius(session: &Session, system: u32) -> f64 {
    session
        .details()
        .ok()
        .and_then(|details| details.raw(system).and_then(|raw| raw.inner_radius))
        .unwrap_or(0.0)
}

/// Why the add of `def` at `place` would be refused: a whole ring world round the star with
/// every quadrant finished and the system kept, the habitat a type finishes as round its body,
/// else the row.
fn refusal(
    gd: &GameData,
    session: &Session,
    system: u32,
    def: &MegastructureDef,
    place: MegastructurePlace,
) -> Option<String> {
    let key = &def.key;
    let ring = matches!(
        def.placement,
        Placement::Unsupported {
            why: Unsupported::RingWorld
        }
    );
    let planned = match place {
        _ if ring => {
            generate::ring_world_op(gd, session, system, key, &[RingStage::Finished; 4], false)
        }
        MegastructurePlace::Body { body } if habitat(gd, key, true, None).is_some() => {
            generate::habitat_op(gd, session, system, body, key)
        }
        _ => generate::megastructure_op(gd, session, system, key, place, false),
    };
    planned.map_or_else(
        |refused: Refusal| Some(refused.to_string()),
        |planned: Planned| checked(session, &planned.op),
    )
}

/// Why `op` would be refused; for a batch, the first of its ops that would be.
fn checked(session: &Session, op: &Op) -> Option<String> {
    match op {
        Op::Batch { ops, .. } => ops.iter().find_map(|op| session.check_op(op)),
        op => session.check_op(op),
    }
}
