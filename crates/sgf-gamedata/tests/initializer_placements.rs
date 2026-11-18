//! What the install's initializers place beside bodies, and the ruins a scenario system can be
//! given at each spot.

use crate::common;

use sgf_gamedata::initializer_placements::{InitializerRuin, RuinPlacement};
use sgf_gamedata::scenario_megastructure_fits::{
    ScenarioFit, ScenarioSpot, scenario_megastructure_fits,
};

#[test]
fn the_scan_finds_placed_derelicts_and_ownerless_ruins_with_how_they_stand() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.ambient_object_views();
    let placed_by = |key: &str| {
        &views
            .iter()
            .find(|view| view.key == key)
            .unwrap_or_else(|| panic!("{key} is an ambient object"))
            .placed_by
    };
    assert_eq!(placed_by("derelict_ship_object"), &["scavenger_system"]);
    assert!(
        placed_by("large_debris_object").contains(&"mega_shipyard_init_01".to_owned()),
        "the debris is created in the spawned ruin's own `init_effect`"
    );
    assert!(placed_by("sublight_probe_object").is_empty());

    let ruins = gd.initializer_ruins();
    let ruin = |kind: &str| -> &InitializerRuin {
        ruins
            .iter()
            .find(|ruin| ruin.kind == kind)
            .unwrap_or_else(|| panic!("an initializer spawns {kind} with no owner"))
    };
    let shipyard = ruin("mega_shipyard_ruined");
    assert_eq!(shipyard.placements, [RuinPlacement::Star]);
    assert_eq!(shipyard.placed_by, ["mega_shipyard_init_01"]);
    assert_eq!(
        ruin("matter_decompressor_ruined").placements,
        [RuinPlacement::Star],
        "`planet = event_target:matter_decompressor_hole` names the star block that saves it"
    );
    assert_eq!(ruin("gateway_ruined").placements, [RuinPlacement::Random]);
    assert_eq!(ruin("lgate_base").placements, [RuinPlacement::Point]);
    assert_eq!(
        ruin("think_tank_ruined").placements,
        [RuinPlacement::Planet]
    );
}

#[test]
fn a_scenario_is_offered_ruins_that_stand_alone_at_a_point_or_on_the_star() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let fits = |spot| -> Vec<(String, ScenarioFit)> {
        scenario_megastructure_fits(gd, spot)
            .into_iter()
            .map(|fit| (fit.kind, fit.fit))
            .collect()
    };
    let space = fits(ScenarioSpot::Space);
    let fit = |kind: &str| space.iter().find(|(k, _)| k == kind).map(|(_, fit)| *fit);
    assert_eq!(fit("gateway_ruined"), Some(ScenarioFit::Point));
    assert_eq!(
        fit("dyson_sphere_ruined"),
        Some(ScenarioFit::StarOnly),
        "it stands on its star with no offset"
    );
    assert_eq!(fit("mega_shipyard_ruined"), Some(ScenarioFit::Point));
    assert_eq!(
        fit("gateway_ness_ruined"),
        Some(ScenarioFit::Point),
        "the game builds its bypass, though a save's add leaves it out"
    );
    assert_eq!(
        fit("think_tank_ruined"),
        None,
        "the initializers spawn it only on planets"
    );
    assert_eq!(fit("ring_world_ruined"), None);
    assert_eq!(fit("lgate_base"), None, "the L-Cluster script connects it");
    assert_eq!(
        fit("dyson_sphere"),
        None,
        "no initializer spawns it without an owner"
    );
    let star = fits(ScenarioSpot::Star);
    let planet = fits(ScenarioSpot::Planet);
    assert_eq!(star.len(), space.len());
    assert_eq!(planet.len(), space.len());
    let on_star = |kind: &str| star.iter().find(|(k, _)| k == kind).map(|(_, fit)| *fit);
    assert_eq!(on_star("dyson_sphere_ruined"), Some(ScenarioFit::StarOnly));
    assert_eq!(
        on_star("mega_shipyard_ruined"),
        Some(ScenarioFit::StarOnly),
        "it floats free, but mega_shipyard_init_01 places it on the star"
    );
    assert_eq!(
        on_star("gateway_ruined"),
        Some(ScenarioFit::NotHere),
        "it floats free and no initializer puts it on a star"
    );
    assert!(planet.iter().all(|(_, fit)| *fit == ScenarioFit::NotHere));
}
