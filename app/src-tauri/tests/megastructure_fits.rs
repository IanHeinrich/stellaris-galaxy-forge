//! What the Add megastructure dialog offers at spots of the real 4.5 sample save, read through
//! the shell from the add's own refusals and worded with no key. The tables are what the
//! dialog decided in TypeScript before it asked the shell, on the base game, after a relay is
//! added in system 0 and a ring world in system 2.
use std::collections::BTreeSet;

use serde_json::{Value, json};
use sgf_core::ops::MegastructurePlace;
use sgf_core::views::ErrorKind;
use sgf_gamedata::generate::MegastructureFit;
use tauri::WebviewWindow;
use tauri::test::MockRuntime;

use crate::common;
use common::{SAMPLE_45, invoke, open, webview, with_game_data};

const ON_ANY_BODY: [&str; 32] = [
    "arkship_civilian_dummy",
    "arkship_military_dummy",
    "arkship_ruined",
    "arkship_science_dummy",
    "behemoth_big_egg_ruined",
    "behemoth_chrysalis",
    "behemoth_chrysalis_big",
    "behemoth_chrysalis_big_hatch",
    "behemoth_chrysalis_hatch",
    "collossus_arthropoid_dummy",
    "collossus_avian_dummy",
    "collossus_fungoid_dummy",
    "collossus_mammalian_dummy",
    "collossus_molluscoid_dummy",
    "collossus_reptile_dummy",
    "cosmogenesis_needle",
    "crisis_sphere_0",
    "crisis_sphere_1",
    "crisis_sphere_2",
    "crisis_sphere_3",
    "crisis_sphere_4",
    "crisis_sphere_ruined",
    "galactic_crucible_dummy",
    "habitat_central_complex",
    "habitat_central_complex_restored",
    "habitat_central_complex_ruined",
    "habitat_major_orbital",
    "habitat_minor_orbital",
    "orbital_ring_restored",
    "orbital_ring_ruined",
    "paladin_dummy",
    "star_eater_dummy",
];

const ON_A_STAR: [&str; 52] = [
    "dyson_gun_0",
    "dyson_gun_0_restored",
    "dyson_gun_1",
    "dyson_gun_2",
    "dyson_gun_3",
    "dyson_gun_ruined",
    "dyson_sphere_0",
    "dyson_sphere_1",
    "dyson_sphere_2",
    "dyson_sphere_3",
    "dyson_sphere_4",
    "dyson_sphere_5",
    "dyson_sphere_disco",
    "dyson_sphere_disco_restored",
    "dyson_sphere_permanently_ruined",
    "dyson_sphere_restored",
    "dyson_sphere_ruined",
    "dyson_swarm_1",
    "dyson_swarm_2",
    "dyson_swarm_3",
    "galactic_crucible_0",
    "galactic_crucible_1",
    "galactic_crucible_2",
    "galactic_crucible_3",
    "galactic_crucible_4",
    "galactic_crucible_5",
    "galactic_crucible_ruined",
    "matter_decompressor_0",
    "matter_decompressor_1",
    "matter_decompressor_2",
    "matter_decompressor_3",
    "matter_decompressor_4",
    "matter_decompressor_permanently_ruined",
    "matter_decompressor_restored",
    "matter_decompressor_ruined",
    "mega_shipyard_0",
    "mega_shipyard_1",
    "mega_shipyard_2",
    "mega_shipyard_3",
    "mega_shipyard_permanently_ruined",
    "mega_shipyard_restored",
    "mega_shipyard_ruined",
    "quantum_catapult_0",
    "quantum_catapult_permanently_ruined",
    "quantum_catapult_ruined",
    "quantum_catapult_ruined_slingshot",
    "ring_world_1",
    "ring_world_2",
    "ring_world_2_intermediate",
    "ring_world_3_intermediate",
    "ring_world_restored",
    "ring_world_ruined",
];

const ON_A_PLANET: [&str; 56] = [
    "behemoth_egg",
    "behemoth_egg_hatch",
    "behemoth_egg_ruined",
    "behemoth_fast_egg_hatch",
    "behemoth_fleet_egg",
    "behemoth_slow_egg_hatch",
    "behemoth_strong_egg_hatch",
    "cosmogenesis_world_0",
    "cosmogenesis_world_ruined",
    "grand_archive_0",
    "interstellar_assembly_0",
    "interstellar_assembly_1",
    "interstellar_assembly_2",
    "interstellar_assembly_3",
    "interstellar_assembly_4",
    "interstellar_assembly_permanently_ruined",
    "interstellar_assembly_restored",
    "interstellar_assembly_ruined",
    "mega_art_installation_0",
    "mega_art_installation_1",
    "mega_art_installation_2",
    "mega_art_installation_3",
    "mega_art_installation_4",
    "mega_art_installation_permanently_ruined",
    "mega_art_installation_restored",
    "mega_art_installation_restored_2",
    "mega_art_installation_ruined",
    "orbital_arc_furnace_1",
    "orbital_arc_furnace_2",
    "orbital_arc_furnace_3",
    "orbital_arc_furnace_4",
    "orbital_arc_furnace_destroyed",
    "orbital_arc_furnace_restored",
    "spy_orb_0",
    "spy_orb_1",
    "spy_orb_2",
    "spy_orb_3",
    "spy_orb_4",
    "spy_orb_permanently_ruined",
    "spy_orb_restored",
    "spy_orb_ruined",
    "strategic_coordination_center_0",
    "strategic_coordination_center_1",
    "strategic_coordination_center_2",
    "strategic_coordination_center_3",
    "strategic_coordination_center_permanently_ruined",
    "strategic_coordination_center_restored",
    "strategic_coordination_center_ruined",
    "think_tank_0",
    "think_tank_1",
    "think_tank_2",
    "think_tank_3",
    "think_tank_4",
    "think_tank_permanently_ruined",
    "think_tank_restored",
    "think_tank_ruined",
];

const IN_SPACE: [&str; 12] = [
    "civilian_arkship_megastructure",
    "gateway_0",
    "gateway_derelict",
    "gateway_final",
    "gateway_restored",
    "gateway_ruined",
    "hyper_relay",
    "hyper_relay_restored",
    "hyper_relay_ruined",
    "military_arkship_megastructure",
    "science_arkship_megastructure",
    "shroud_seal",
];

const HABITATS: [&str; 2] = [
    "habitat_central_complex",
    "habitat_central_complex_restored",
];
const RINGS: [&str; 5] = [
    "ring_world_2",
    "ring_world_2_intermediate",
    "ring_world_3_intermediate",
    "ring_world_restored",
    "ring_world_ruined",
];
const RELAYS: [&str; 2] = ["hyper_relay", "hyper_relay_restored"];

#[derive(Clone, Copy)]
enum Spot {
    Star(u32),
    Planet(u32),
    Space(f64, f64),
}

/// Which of the types offered at a spot the save refuses there.
#[derive(Clone, Copy)]
enum Refused {
    Only(&'static [&'static str]),
    AllBut(&'static [&'static str]),
}

const NONE: Refused = Refused::Only(&[]);

/// Each spot asked about, with what the dialog refused there: a habitat round a moon, a row on
/// a body that holds one, a ring world round two stars or over a ring, a second relay.
const SPOTS: [(u32, Spot, Refused); 23] = [
    (169, Spot::Star(0), NONE),
    (169, Spot::Planet(6), NONE),
    (169, Spot::Planet(7), Refused::Only(&HABITATS)),
    (169, Spot::Planet(2), NONE),
    (
        7,
        Spot::Star(631),
        Refused::AllBut(&[
            "habitat_central_complex",
            "habitat_central_complex_restored",
            "ring_world_2",
            "ring_world_2_intermediate",
            "ring_world_3_intermediate",
            "ring_world_restored",
            "ring_world_ruined",
        ]),
    ),
    (7, Spot::Planet(634), Refused::Only(&HABITATS)),
    (7, Spot::Planet(633), NONE),
    (38, Spot::Star(931), Refused::Only(&RINGS)),
    (38, Spot::Planet(936), Refused::AllBut(&HABITATS)),
    (38, Spot::Planet(934), NONE),
    (4, Spot::Star(616), NONE),
    (60, Spot::Star(1139), Refused::Only(&RINGS)),
    (25, Spot::Star(801), NONE),
    (14, Spot::Star(712), NONE),
    (5, Spot::Star(618), Refused::Only(&RINGS)),
    (14, Spot::Space(100.0, 50.0), NONE),
    (25, Spot::Space(0.0, 200.0), NONE),
    (0, Spot::Space(0.0, -300.0), Refused::Only(&RELAYS)),
    (0, Spot::Star(571), NONE),
    (0, Spot::Planet(572), NONE),
    (2, Spot::Star(592), Refused::Only(&RINGS)),
    (2, Spot::Planet(593), NONE),
    (2, Spot::Space(50.0, 50.0), NONE),
];

fn spot_json(spot: Spot) -> Value {
    match spot {
        Spot::Star(body) | Spot::Planet(body) => json!({ "kind": "body", "body": body }),
        Spot::Space(x, y) => json!({ "kind": "space", "x": x, "y": y }),
    }
}

fn fits(w: &WebviewWindow<MockRuntime>, system: u32, spot: Spot) -> Vec<MegastructureFit> {
    invoke(
        w,
        "get_megastructure_fits",
        json!({ "system": system, "spot": spot_json(spot) }),
    )
    .unwrap_or_else(|e| panic!("system {system}: {}", e.message))
}

fn keys(lists: &[&[&str]]) -> BTreeSet<String> {
    lists
        .iter()
        .flat_map(|list| list.iter().map(|key| (*key).to_owned()))
        .collect()
}

/// The sample with a relay in system 0 and a ring world round the star of system 2.
fn with_relay_and_ring() -> Option<WebviewWindow<MockRuntime>> {
    let (w, _) = with_game_data(SAMPLE_45)?;
    let relay = json!({
        "system": 0, "kind": "hyper_relay",
        "place": { "place": "free", "x": 0.0, "y": -280.812 }, "keepPlanet": false
    });
    invoke::<Value>(&w, "add_megastructure", relay).expect("the relay");
    let ring = json!({
        "system": 2, "kind": "ring_world_2",
        "stages": ["finished", "finished", "finished", "finished"], "clear": false
    });
    invoke::<Value>(&w, "add_ring_world", ring).expect("the ring world");
    Some(w)
}

#[test]
fn each_spot_offers_and_refuses_what_the_dialog_did() {
    let Some(w) = with_relay_and_ring() else {
        return;
    };
    for (system, spot, refused) in SPOTS {
        let expected = match spot {
            Spot::Star(_) => keys(&[&ON_ANY_BODY, &ON_A_STAR]),
            Spot::Planet(_) => keys(&[&ON_ANY_BODY, &ON_A_PLANET]),
            Spot::Space(..) => keys(&[&IN_SPACE]),
        };
        let fits = fits(&w, system, spot);
        let offered: BTreeSet<String> = fits.iter().map(|fit| fit.kind.clone()).collect();
        let at = spot_json(spot);
        assert_eq!(offered, expected, "offered in system {system} at {at}");
        let got: BTreeSet<String> = fits
            .iter()
            .filter(|fit| fit.refusal.is_some())
            .map(|fit| fit.kind.clone())
            .collect();
        let want = match refused {
            Refused::Only(only) => keys(&[only]),
            Refused::AllBut(but) => &expected - &keys(&[but]),
        };
        let differing: Vec<_> = fits
            .iter()
            .filter(|fit| got.contains(&fit.kind) != want.contains(&fit.kind))
            .map(|fit| (&fit.kind, &fit.refusal))
            .collect();
        assert_eq!(
            got, want,
            "refused in system {system} at {at}: {differing:?}"
        );
        let keyed: Vec<_> = fits
            .iter()
            .filter_map(|fit| fit.refusal.as_ref())
            .filter(|refusal| refusal.contains('_'))
            .collect();
        assert!(
            keyed.is_empty(),
            "worded with a key in system {system}: {keyed:?}"
        );
    }
}

/// A type is offered as itself, but for a stage the game swaps whatever the star: the Ring
/// World's intermediate stage makes the finished ring and a hatched behemoth egg a ruined one.
#[test]
fn each_type_is_written_as_the_game_swaps_it() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    for (spot, swaps) in [
        (Spot::Star(0), ("ring_world_2_intermediate", "ring_world_2")),
        (
            Spot::Planet(6),
            ("behemoth_egg_hatch", "behemoth_egg_ruined"),
        ),
    ] {
        let swapped: Vec<(String, String)> = fits(&w, 169, spot)
            .into_iter()
            .filter(|fit| fit.variant != fit.kind)
            .map(|fit| (fit.kind, fit.variant))
            .collect();
        assert_eq!(swapped, [(swaps.0.to_owned(), swaps.1.to_owned())]);
    }
}

/// A row goes on the body clicked, at the point pressed in space, and a relay just outside the
/// system's inner radius of 267.44 in the pressed direction.
#[test]
fn each_type_stands_where_the_add_puts_it() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let place = |spot: Spot, kind: &str| {
        fits(&w, 0, spot)
            .into_iter()
            .find(|fit| fit.kind == kind)
            .unwrap_or_else(|| panic!("{kind}"))
            .place
    };
    assert_eq!(
        place(Spot::Star(571), "dyson_sphere_5"),
        MegastructurePlace::Body { body: 571 }
    );
    assert_eq!(
        place(Spot::Space(30.0, 40.0), "shroud_seal"),
        MegastructurePlace::Free { x: 30.0, y: 40.0 }
    );
    let MegastructurePlace::Free { x, y } = place(Spot::Space(0.0, -10.0), "hyper_relay") else {
        panic!("a relay stands free");
    };
    assert!(
        x.abs() < 1e-9 && (y + 1.05 * 267.44).abs() < 1e-9,
        "({x}, {y})"
    );
}

#[test]
fn the_fits_need_game_data_and_a_body_of_the_system() {
    let w = webview();
    open(&w, SAMPLE_45);
    let refused = invoke::<Vec<MegastructureFit>>(
        &w,
        "get_megastructure_fits",
        json!({ "system": 0, "spot": spot_json(Spot::Star(571)) }),
    )
    .expect_err("no game data");
    assert!(refused.message.contains("game data"), "{}", refused.message);
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let elsewhere = invoke::<Vec<MegastructureFit>>(
        &w,
        "get_megastructure_fits",
        json!({ "system": 0, "spot": spot_json(Spot::Star(0)) }),
    )
    .expect_err("planet 0 is in system 169");
    assert_eq!(elsewhere.kind, ErrorKind::Op, "{}", elsewhere.message);
}
