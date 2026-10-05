//! The asteroid belt kinds an install defines: their names, and the look each takes from
//! its meshes, on hand-written installs and the real one.

use crate::common;

use sgf_gamedata::registries::asteroid_belts::BeltLook;
use sgf_gamedata::views::GameDataSummary;

#[test]
fn asteroid_belt_kinds_read_and_localised_or_readable() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/asteroid_belts/00_test.txt",
            "fx_named_belt = {\n\tmesh = \"x\"\n}\nfx_unnamed_belt = {\n\tmesh = \"y\"\n}\n",
        ),
        (
            "localisation/english/fx_l_english.yml",
            "l_english:\n fx_named_belt:0 \"Named Belt\"\n",
        ),
    ]);
    let keys: Vec<&str> = gd.asteroid_belts.iter().map(|b| b.key.as_str()).collect();
    assert_eq!(keys, ["fx_named_belt", "fx_unnamed_belt"]);
    assert_eq!(gd.loc.name_or_readable("fx_named_belt"), "Named Belt");
    assert_eq!(
        gd.loc.name_or_readable("fx_unnamed_belt"),
        "Fx Unnamed Belt",
        "a kind with no localisation is made readable from its key"
    );
}

#[test]
fn summary_lists_belt_kinds_with_readable_names() {
    let (_dir, gd) = common::hand_written(&[(
        "common/asteroid_belts/00_test.txt",
        "fx_a_belt = {
	mesh = \"x\"
}
fx_b_belt = {
	mesh = \"y\"
}
",
    )]);
    let summary = GameDataSummary::from(&gd);
    let named: Vec<(&str, &str)> = summary
        .belt_kinds
        .iter()
        .map(|k| (k.key.as_str(), k.name.as_str()))
        .collect();
    assert_eq!(
        named,
        [("fx_a_belt", "Fx A Belt"), ("fx_b_belt", "Fx B Belt")]
    );
}

const BELT_LOOK_FILES: [(&str, &str); 1] = [(
    "common/asteroid_belts/00_test.txt",
    "fx_rocky = {
	mesh=\"asteroid_01_mesh\"
	mesh=\"asteroid_02_mesh\"
}
     fx_icy = {
	mesh=\"asteroid_ice_small_01_mesh\"
	shader = \"AsteroidEmissive\"
}
     fx_crystal = {
	mesh=\"asteroid_crystal_small_01_mesh\"
}
     fx_debris = {
	mesh=\"asteroid_01_mesh\"
	mesh=\"asteroid_shatter_mesh\"
	mesh=\"cargo_container_small_01_mesh\"
	width = 1.3
	density = 0.8
}
     fx_dust = {
	mesh=\"asteroid_shatter_mesh\"
	width = 2
	density = 0.3
}
     fx_fauna = {
	mesh=\"space_amoeba_mesh\"
	mesh=\"leviathan_01_elder_tiyanki_gibbed_mesh\"
	width = 5
	density = 0.2
}
     fx_modded = {
	mesh=\"fx_mystery_rock_mesh\"
}
",
)];

#[test]
fn belt_kinds_resolve_a_look_from_their_meshes() {
    let (_dir, gd) = common::hand_written(&BELT_LOOK_FILES);
    let summary = GameDataSummary::from(&gd);
    let looks: Vec<(&str, BeltLook, f64, f64, bool)> = summary
        .belt_kinds
        .iter()
        .map(|k| (k.key.as_str(), k.look, k.width, k.density, k.emissive))
        .collect();
    assert_eq!(
        looks,
        [
            ("fx_crystal", BeltLook::Crystal, 1.0, 1.0, false),
            ("fx_debris", BeltLook::Debris, 1.3, 0.8, false),
            ("fx_dust", BeltLook::Dust, 2.0, 0.3, false),
            ("fx_fauna", BeltLook::Fauna, 5.0, 0.2, false),
            ("fx_icy", BeltLook::Icy, 1.0, 1.0, true),
            ("fx_modded", BeltLook::Rocky, 1.0, 1.0, false),
            ("fx_rocky", BeltLook::Rocky, 1.0, 1.0, false),
        ]
    );
}

#[test]
fn vanilla_belt_kinds_resolve_their_looks() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let look = |key: &str| {
        gd.asteroid_belts
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
            .look
    };
    assert_eq!(look("rocky_asteroid_belt"), BeltLook::Rocky);
    assert_eq!(look("icy_asteroid_belt"), BeltLook::Icy);
    assert_eq!(look("crystal_asteroid_belt"), BeltLook::Crystal);
    assert_eq!(look("debris_asteroid_belt"), BeltLook::Debris);
    assert_eq!(look("empty_asteroid_belt"), BeltLook::Dust);
    assert_eq!(look("space_fauna_belt"), BeltLook::Fauna);
    assert!(gd.asteroid_belts.get("icy_asteroid_belt").unwrap().emissive);
    let empty = gd.asteroid_belts.get("empty_asteroid_belt").unwrap();
    assert_eq!((empty.width, empty.density), (2.0, 0.3));
}
