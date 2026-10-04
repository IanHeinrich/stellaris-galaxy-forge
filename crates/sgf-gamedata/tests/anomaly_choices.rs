//! The anomaly categories a planet's page offers: on a hand-written install, the ones left
//! out, the name, level and description each is shown with, and which could turn up on the
//! body asked about; a mod's categories; and the real install's counts.

use crate::common;
use common::by_key;
use common::scripts::install_with_mod;

use sgf_gamedata::choices::AskedBody;

const FILES: [(&str, &str); 4] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_rock = {\n\tplanet_size = { min = 10 max = 20 }\n}\n\
         pc_fx_asteroid = {\n\tasteroid = yes\n\tplanet_size = 5\n}\n\
         pc_fx_pulsar = {\n\tstar = yes\n}\n\
         pc_fx_dwarf = {\n\tstar = yes\n}\n",
    ),
    (
        "common/star_classes/00_fx.txt",
        "sc_fx_pulsar = {\n\tclass = pulsar\n\tplanet = { key = pc_fx_pulsar }\n}\n\
         sc_fx_dwarf = {\n\tclass = dwarf\n\tplanet = { key = pc_fx_dwarf }\n}\n",
    ),
    (
        "common/anomalies/00_fx.txt",
        "@fx_hard = 7\n\
         fx_rock_cat = {\n\tlevel = 2\n\tspawn_chance = { modifier = { add = 3 is_asteroid = no } }\n}\n\
         fx_asteroid_cat = {\n\tdesc = fx_asteroid_text\n\tlevel = @fx_hard\n\tspawn_chance = { modifier = { add = 3 is_asteroid = yes } }\n}\n\
         fx_debris_cat = {\n\tdesc = fx_debris_text\n\tlevel = 1\n\tspawn_chance = { base = 1 }\n}\n\
         fx_pulsar_cat = {\n\tlevel = 3\n\tspawn_chance = { modifier = { add = 1 is_star = yes is_star_class = sc_fx_pulsar } }\n}\n\
         fx_ship_cat = {\n\tlevel = 1\n\tspawn_chance = { modifier = { add = 3 from = { has_scientist = yes } } }\n}\n\
         fx_spawn_cat = {\n\tlevel = 4\n\tspawn_chance = { base = 5 }\n\ton_spawn = { set_planet_flag = fx }\n}\n\
         fx_chain_cat = {\n\tlevel = 4\n\tspawn_chance = { modifier = { add = 5 from.owner = { has_event_chain = fx_chain } } }\n}\n\
         AIANOM_FX_CAT = {\n\tlevel = 1\n\tspawn_chance = { base = 5 }\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n fx_rock_cat:0 \"Strange Rock\"\n fx_rock_cat_desc:0 \"§YA rock§! £energy£that $fx_word$.\"\n fx_word:0 \"hums\"\n fx_asteroid_text:0 \"It tumbles.\"\n fx_debris_text:0 \"Debris drifts in orbit of [Root.GetName].\"\n",
    ),
];

fn asked(class: &str) -> AskedBody<'_> {
    AskedBody {
        class: Some(class),
        size: Some(10),
        moon: false,
    }
}

#[test]
fn categories_run_on_spawn_gated_by_a_chain_or_the_ais_own_are_left_out() {
    let (_dir, gd) = common::hand_written(&FILES);
    let choices = gd.anomaly_choices(&asked("pc_fx_rock"));
    let keys: Vec<&str> = choices.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "fx_asteroid_cat",
            "fx_debris_cat",
            "fx_pulsar_cat",
            "fx_rock_cat",
            "fx_ship_cat"
        ]
    );

    let rock = by_key(&choices, "fx_rock_cat");
    assert_eq!(rock.name, "Strange Rock");
    assert_eq!(rock.level, Some(2));
    assert_eq!(
        rock.description.as_deref(),
        Some("A rock that hums."),
        "colour and icon codes stripped, references resolved"
    );
    let asteroid = by_key(&choices, "fx_asteroid_cat");
    assert_eq!(
        asteroid.name, "Fx Asteroid Cat",
        "no name: the key made readable"
    );
    assert_eq!(asteroid.level, Some(7), "the level through its variable");
    assert_eq!(asteroid.description.as_deref(), Some("It tumbles."));
    let debris = by_key(&choices, "fx_debris_cat");
    assert_eq!(
        debris.description.as_deref(),
        Some("Debris drifts in orbit of it."),
        "a scope's name reads as a stand-in"
    );
}

#[test]
fn a_category_is_usual_where_its_spawn_chance_could_be_above_zero() {
    let (_dir, gd) = common::hand_written(&FILES);
    let usual = |class: &str| -> Vec<String> {
        gd.anomaly_choices(&asked(class))
            .into_iter()
            .filter(|c| c.usual)
            .map(|c| c.key)
            .collect()
    };
    // Whether the surveying ship has a scientist is not the body's to answer, so
    // fx_ship_cat could turn up anywhere.
    assert_eq!(
        usual("pc_fx_rock"),
        ["fx_debris_cat", "fx_rock_cat", "fx_ship_cat"]
    );
    assert_eq!(
        usual("pc_fx_asteroid"),
        ["fx_asteroid_cat", "fx_debris_cat", "fx_ship_cat"]
    );
    assert_eq!(
        usual("pc_fx_pulsar"),
        [
            "fx_debris_cat",
            "fx_pulsar_cat",
            "fx_rock_cat",
            "fx_ship_cat"
        ],
        "a pulsar body is the star of a pulsar system"
    );
    assert_eq!(
        usual("pc_fx_dwarf"),
        ["fx_debris_cat", "fx_rock_cat", "fx_ship_cat"]
    );
    let none = gd.anomaly_choices(&AskedBody {
        class: None,
        size: None,
        moon: false,
    });
    assert!(none.iter().all(|c| !c.usual), "no class, nothing usual");
}

#[test]
fn a_mods_categories_are_offered_beside_the_installs() {
    let (_dir, gd) = install_with_mod(&[(
        "common/anomalies/zz_many.txt",
        "many_cat = {\n\tlevel = 5\n\tspawn_chance = { base = 1 }\n}\n",
    )]);
    let choices = gd.anomaly_choices(&asked("pc_desert"));
    let many = by_key(&choices, "many_cat");
    assert_eq!(many.level, Some(5));
    assert!(many.usual);
}

#[test]
fn real_anomaly_choices_leave_out_those_the_game_would_not_run() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let all = gd.anomaly_categories.len();
    let choices = gd.anomaly_choices(&asked("pc_barren"));
    assert!(
        (200..all).contains(&choices.len()),
        "{} of {all}",
        choices.len()
    );
    let offered = |key: &str| choices.iter().any(|c| c.key == key);
    assert!(offered("asteroid_uninhabitable_category"));
    assert!(!offered("AIANOM_LUMP_CAT"), "the AI's own");
    assert!(!offered("vultaum_1_cat"), "runs on_spawn");
    assert!(!offered("transmitter_cat"), "an event chain gates it");
    assert!(choices.iter().all(|c| c.level.is_some()));
    let rubricator = choices
        .iter()
        .find(|c| c.key == "ANCREL_RUBRICATOR_CAT")
        .and_then(|c| c.description.as_deref())
        .expect("ANCREL_RUBRICATOR_CAT has a description");
    assert!(
        rubricator.ends_with("detected on it."),
        "scope text kept: {rubricator}"
    );
}

#[test]
fn real_star_anomalies_are_usual_on_their_stars() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let usual = |class: &str, key: &str| {
        gd.anomaly_choices(&asked(class))
            .iter()
            .any(|c| c.key == key && c.usual)
    };
    for key in [
        "BLACK_HOLE_INSTABLE_CAT",
        "DISTAR_RAINBOW_CAT",
        "DISTAR_HOLO_CAT",
        "DISTAR_FLOW_CAT",
        "disco_breathing_rift_cat",
        "irregular_energy_cat",
    ] {
        assert!(usual("pc_black_hole", key), "{key} on a black hole");
        assert!(!usual("pc_barren", key), "{key} on a barren world");
    }
    assert!(usual("pc_pulsar", "DISTAR_TIME_CAT"));
    assert!(!usual("pc_g_star", "DISTAR_TIME_CAT"));
    assert!(usual("pc_f_star", "DISTAR_DIAMOND_CAT"));
}
