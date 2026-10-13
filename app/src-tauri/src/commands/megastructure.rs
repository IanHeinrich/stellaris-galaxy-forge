//! Deleting a megastructure from the open save, with what the install says its dismantle
//! takes back, and deleting a ring world whole, with the flags the install says each ring
//! leaves.

use sgf_core::ops::{Op, RingFlags, RingQuadrant};
use sgf_core::views::{EditResult, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::construction::ring_world::{RingStage, quadrants, ring_world};
use sgf_gamedata::registries::megastructures::{Placement, Unsupported};
use tauri::{AppHandle, Manager, Runtime};

use super::with_session;
use crate::state::GameDataState;

/// Delete megastructure row `megastructure` of the open save as one `DeleteMegastructure`,
/// taking back the modifiers, deposits and owner counters its type's dismantle removes.
/// Without game data, or for a type the install does not define, it is deleted with nothing
/// taken back.
#[tauri::command]
pub async fn delete_megastructure<R: Runtime>(
    app: AppHandle<R>,
    megastructure: u32,
) -> Result<EditResult, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let dismantle = gd.and_then(|gd| {
            let kind = session
                .save("reading a megastructure's type")
                .ok()?
                .megastructure_kind(megastructure)?;
            let dismantle = gd.megastructures.get(&kind)?.dismantle.clone();
            (!dismantle.is_empty()).then_some(dismantle)
        });
        let result = session.apply(Op::DeleteMegastructure {
            megastructure,
            dismantle,
        })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Delete every ring world of system `system` of the open save as one `DeleteRingWorld`,
/// taking the flags each ring's chain sets as the install lays it out. Without game data the
/// system loses the base game's ring's flags.
#[tauri::command]
pub async fn delete_ring_world<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
) -> Result<EditResult, SgfError> {
    let rings = app
        .state::<GameDataState>()
        .loaded()
        .map(|gd| ring_flags(&gd));
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.apply(Op::DeleteRingWorld {
            system,
            radius: None,
            rings,
        })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// The radius and system flags of the ring each ring world chain of the install lays out
/// with every quadrant finished, on a system holding no flags; the flags of chains whose
/// rings stand at one radius together.
fn ring_flags(gd: &GameData) -> Vec<RingFlags> {
    let mut rings: Vec<RingFlags> = Vec::new();
    for def in gd.megastructures.iter() {
        let Placement::Unsupported {
            why: Unsupported::RingWorld,
        } = def.placement
        else {
            continue;
        };
        let count = quadrants(gd, &def.key).unwrap_or(4);
        let Ok(ring) = ring_world(gd, &def.key, &vec![RingStage::Finished; count], None, &[])
        else {
            continue;
        };
        let Some(radius) = ring.quadrants.iter().find_map(|quadrant| match quadrant {
            RingQuadrant::Finished { segments } => segments.first().map(|s| s.planet.at.radius),
            _ => None,
        }) else {
            continue;
        };
        let entry = match rings.iter().position(|known| known.radius == radius) {
            Some(at) => &mut rings[at],
            None => {
                rings.push(RingFlags {
                    radius,
                    flags: Vec::new(),
                });
                rings.last_mut().expect("just pushed")
            }
        };
        for flag in ring.system_flags {
            if !entry.flags.contains(&flag) {
                entry.flags.push(flag);
            }
        }
    }
    rings
}
