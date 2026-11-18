//! The scenario's side of the Add megastructure dialog: which ruins go at a spot of a scenario
//! system, and the op that writes one into the system's `effect` block, with no owner, on its
//! main star or at a point.

use sgf_core::format::scenario::placed::STAR_BODY;
use sgf_core::ops::{MegastructurePlace, NewMegastructure, Op, OpError};
use sgf_core::session::Session;

use super::megastructure::{
    AddSpot, HostMoonsFit, MegastructureFit, Planned, Refusal, defined, worded,
};
use crate::GameData;
use crate::scenario_megastructure_fits::{ScenarioFit, ScenarioSpot, scenario_megastructure_fits};

/// Each ruin [`scenario_megastructure_fits`] offers at `spot` of scenario system `system`, in
/// key order: one at its own point stands at the point pressed, and any other on the main
/// star. A type that goes only on the star is refused in empty space, so the player adds it
/// from the star. The rest are refused as the add's own op is: a second ruin on the star,
/// worded as the save words a body that holds a megastructure. A system the scenario does not
/// hold is refused.
pub(super) fn ruin_fits(
    gd: &GameData,
    session: &Session,
    system: u32,
    spot: AddSpot,
) -> Result<Vec<MegastructureFit>, Refusal> {
    if !session.graph().systems.contains_key(&system) {
        return Err(OpError::UnknownSystem(system).into());
    }
    let mut fits = Vec::new();
    for fit in scenario_megastructure_fits(gd, scenario_spot(spot)) {
        let place = match (fit.fit, spot) {
            (ScenarioFit::Point, AddSpot::Space { x, y }) => MegastructurePlace::Free { x, y },
            (ScenarioFit::StarOnly, _) => MegastructurePlace::Body { body: STAR_BODY },
            (ScenarioFit::Point, AddSpot::Body { .. }) | (ScenarioFit::NotHere, _) => continue,
        };
        let refusal = match (fit.fit, spot) {
            (ScenarioFit::StarOnly, AddSpot::Space { .. }) => Some(on_the_star(gd, &fit.kind)),
            _ => {
                let def = defined(gd, &fit.kind)?;
                session
                    .refusal(&ruin(system, &fit.kind, place))
                    .map(|refused| worded(gd, def, &refused, &[]))
            }
        };
        fits.push(MegastructureFit {
            variant: fit.kind.clone(),
            kind: fit.kind,
            place,
            refusal,
            host_moons: HostMoonsFit::Kept,
        });
    }
    Ok(fits)
}

/// The op that writes a ruin of type `kind` into scenario system `system` at `place`: at a
/// point for a type that stands at its own point, on the main star for one that goes there.
/// A type the scenario's add does not offer, and one asked for elsewhere than it goes, are
/// refused with the reason.
pub(super) fn ruin_op(
    gd: &GameData,
    system: u32,
    kind: &str,
    place: MegastructurePlace,
) -> Result<Planned, Refusal> {
    let def = defined(gd, kind)?;
    let spot = match place {
        MegastructurePlace::Free { x, y } => AddSpot::Space { x, y },
        MegastructurePlace::Body { body } | MegastructurePlace::Beside { body, .. } => {
            AddSpot::Body { body }
        }
    };
    let fit = scenario_megastructure_fits(gd, scenario_spot(spot))
        .into_iter()
        .find(|fit| fit.kind == def.key)
        .map_or(ScenarioFit::NotHere, |fit| fit.fit);
    let on_star = place == MegastructurePlace::Body { body: STAR_BODY };
    let reason = match (fit, place) {
        (ScenarioFit::Point, MegastructurePlace::Free { .. }) => None,
        (ScenarioFit::StarOnly, _) if on_star => None,
        (ScenarioFit::StarOnly, _) => Some(on_the_star(gd, kind)),
        _ => Some(format!(
            "{} can't go there in a scenario.",
            gd.loc.name_or_readable(kind)
        )),
    };
    match reason {
        Some(reason) => Err(Refusal::NotAdded {
            kind: def.key.clone(),
            reason,
        }),
        None => Ok(Planned::whole(ruin(system, kind, place))),
    }
}

/// Where in a scenario system `spot` is: the main star, any other body, or empty space.
fn scenario_spot(spot: AddSpot) -> ScenarioSpot {
    match spot {
        AddSpot::Body { body } if body == STAR_BODY => ScenarioSpot::Star,
        AddSpot::Body { .. } => ScenarioSpot::Planet,
        AddSpot::Space { .. } => ScenarioSpot::Space,
    }
}

fn ruin(system: u32, kind: &str, place: MegastructurePlace) -> Op {
    Op::AddMegastructure {
        system,
        spec: NewMegastructure {
            kind: kind.to_owned(),
            at: place.into(),
            ..NewMegastructure::default()
        },
    }
}

/// Why a type that stands round its star is not added in empty space.
fn on_the_star(gd: &GameData, kind: &str) -> String {
    format!(
        "{} goes on the star. Right-click the star to add it.",
        gd.loc.name_or_readable(kind)
    )
}
