//! An initializer or a megastructure definition reads its `inline_script` calls when it loads,
//! so rereading the script's folder rereads both.

use crate::common;

use std::collections::BTreeSet;
use std::fs;

use sgf_gamedata::{GameData, RegistryKind};

const INITIALIZER: &str = "common/solar_system_initializers/00_inline.txt";
const SCRIPT: &str = "common/inline_scripts/inl_bodies.txt";
const MEGASTRUCTURE: &str = "common/megastructures/00_inline.txt";
const MEGASTRUCTURE_SCRIPT: &str = "common/inline_scripts/inl_mega.txt";

fn classes(gd: &GameData) -> Vec<String> {
    gd.initializer_details(1, "inl_init", None)
        .expect("inl_init")
        .planets
        .iter()
        .map(|p| p.class.clone())
        .collect()
}

fn entity(gd: &GameData) -> Option<String> {
    gd.megastructures.get("inl_mega")?.entity.clone()
}

#[test]
fn changing_an_inline_script_changes_what_the_initializers_and_megastructures_that_use_it_read() {
    let (dir, _) = common::hand_written(&[(
        "common/planet_classes/00_planets.txt",
        "pc_rock = {
	planet_size = { min = 10 max = 20 }
}
         pc_toxic = {
	planet_size = { min = 10 max = 20 }
}
         pc_ice = {
	planet_size = { min = 10 max = 20 }
}
",
    )]);
    let install = dir.path().join("install");
    let user = dir.path().join("user");
    let root = common::add_mod(
        &user,
        "inline",
        &[
            (
                INITIALIZER,
                "inl_init = {\n\tclass = sc_sun\n\tinline_script = { script = inl_bodies }\n}\n",
            ),
            (SCRIPT, "planet = { class = pc_rock orbit_distance = 30 }\n"),
            (
                MEGASTRUCTURE,
                "inl_mega = { inline_script = { script = inl_mega } }\n",
            ),
            (MEGASTRUCTURE_SCRIPT, "entity = \"inl_first_entity\"\n"),
        ],
    );
    common::enable(&user, &["inline"]);
    let before = common::load_tree(&install, Some(&user), true);
    assert_eq!(classes(&before), ["pc_rock"]);
    assert_eq!(entity(&before), Some("inl_first_entity".to_owned()));

    fs::write(
        root.join(SCRIPT),
        "planet = { class = pc_toxic orbit_distance = 30 }\nplanet = { class = pc_ice orbit_distance = 60 }\n",
    )
    .expect("rewrite the inline script");
    fs::write(
        root.join(MEGASTRUCTURE_SCRIPT),
        "entity = \"inl_second_entity\"\n",
    )
    .expect("rewrite the megastructure's inline script");

    let changed = root.join(SCRIPT);
    let kind = RegistryKind::classify(&before.layout, &changed).expect("a registry reads it");
    let (rebuilt, replaced) = before.rebuild(&BTreeSet::from([kind]));
    let full = common::load_tree(&install, Some(&user), true);

    assert_eq!(classes(&full), ["pc_toxic", "pc_ice"]);
    assert_eq!(classes(&rebuilt), classes(&full));
    assert_eq!(entity(&full), Some("inl_second_entity".to_owned()));
    assert_eq!(entity(&rebuilt), entity(&full));
    assert_eq!(
        RegistryKind::classify(&before.layout, &root.join(MEGASTRUCTURE_SCRIPT)),
        Some(kind)
    );
    assert_eq!(
        rebuilt.initializer_details(1, "inl_init", None),
        full.initializer_details(1, "inl_init", None)
    );
    assert!(
        replaced.contains(&RegistryKind::Initializers),
        "{replaced:?}"
    );
}
