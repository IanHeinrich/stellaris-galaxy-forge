//! Planet classes the scripts only give a planet as its look, and classes whose model draws
//! nothing, in a hand-written install, then the real install's vanilla classes when this
//! machine has one.

use crate::common;

use std::collections::BTreeSet;
use std::fs;

use sgf_core::ops::ClassChange;
use sgf_gamedata::generate::body_classes;
use sgf_gamedata::{GameData, RegistryKind};
use tempfile::TempDir;

/// The classes a picture names, each placed by one more source, or by none.
const PICTURED: [&str; 11] = [
    "pc_look",
    "pc_param_look",
    "pc_changed",
    "pc_placed",
    "pc_param_class",
    "pc_terraformed",
    "pc_listed",
    "pc_built",
    "pc_frozen_ring",
    "pc_prescripted",
    "pc_preferred",
];

/// Each class spawns at a distance with a size and is never rolled, so only the scripts and
/// the models tell them apart.
fn class(key: &str, entity: &str) -> String {
    format!(
        "{key} = {{\n\tentity = \"{entity}\"\n\tmin_distance_from_sun = 40\n\tmax_distance_from_sun = 200\n\tplanet_size = {{ min = 10 max = 20 }}\n}}\n"
    )
}

fn classes() -> String {
    let mut text: String = PICTURED
        .iter()
        .map(|key| class(key, "rock_planet"))
        .collect();
    text += &class("pc_empty_space", "empty");
    text += &class("pc_cloned_empty", "cloned");
    text += &class("pc_first_hidden", "order");
    text += &class("pc_rock", "rock_planet");
    text += "random_list = {\n\tname = rl_looks\n\tplanets = { pc_listed pc_rock }\n}\n";
    text
}

const EVENTS: &str = "namespace = looks
event = {
\tid = looks.1
\timmediate = {
\t\tset_planet_entity = { picture = pc_look entity = rock_planet_01_entity }
\t\tset_planet_entity = { picture = pc_changed entity = rock_planet_01_entity }
\t\tset_planet_entity = { picture = \"pc_placed\" entity = rock_planet_01_entity }
\t\tset_planet_entity = { picture = pc_terraformed }
\t\tset_planet_entity = { picture = pc_listed }
\t\tset_planet_entity = { picture = pc_built }
\t\tset_planet_entity = { picture = pc_frozen_ring }
\t\tset_planet_entity = { picture = pc_prescripted }
\t\tset_planet_entity = { picture = pc_preferred }
\t\tlooks_give_look = { PICTURE = pc_param_look }
\t\tlooks_give_look = { CLASS = pc_param_class PICTURE = pc_param_class }
\t}
}
event = {
\tid = looks.2
\timmediate = { change_pc = pc_changed }
}
";

const INITIALIZERS: &str = "looks_init = {
\tclass = \"rl_standard_stars\"
\tplanet = { class = pc_placed orbit_distance = 50 }
}
";

const TERRAFORM: &str =
    "terraform_link = {\n\tfrom = \"pc_rock\"\n\tto = \"pc_terraformed\"\n\tduration = 100\n}\n";

/// A megastructure that turns its planet into a class only a parameter names in full, and
/// into classes a parameter names whole, which could be any and so place none.
const MEGASTRUCTURES: &str = "looks_ring = {
\ton_build_complete = {
\t\tchange_pc = pc_built
\t\tchange_pc = pc_$kind$_ring
\t\tchange_pc = pc_$climate$
\t\tspawn_planet = { class = $CLASS$ }
\t}
}
";

const PRESCRIPTED: &str = "looks_country = {\n\tplanet_class = pc_prescripted\n}\n";

const TRAITS: &str = "trait_looks = {\n\thabitability_preference = pc_preferred\n}\n";

/// `order`'s first name draws nothing, though its second has a mesh.
const ENTITIES: &str = "entity = {
\tname = \"rock_planet_01_entity\"
\tpdxmesh = \"rock_mesh\"
}
entity = { name = \"empty_01_entity\" scale = 1 }
entity = { name = \"cloned_01_entity\" clone = \"empty_01_entity\" }
entity = { name = \"order_01_entity\" scale = 1 }
entity = { name = \"order_entity\" pdxmesh = \"rock_mesh\" }
";

fn looks() -> (TempDir, GameData) {
    let classes = classes();
    common::hand_written(&[
        ("common/planet_classes/00_looks.txt", &classes),
        ("events/looks.txt", EVENTS),
        ("common/solar_system_initializers/looks.txt", INITIALIZERS),
        ("common/terraform/looks.txt", TERRAFORM),
        ("common/megastructures/looks.txt", MEGASTRUCTURES),
        ("prescripted_countries/looks.txt", PRESCRIPTED),
        ("common/traits/looks.txt", TRAITS),
        ("gfx/models/planets/_looks.asset", ENTITIES),
    ])
}

fn marked(
    gd: &GameData,
    flag: impl Fn(&sgf_gamedata::registries::planet_classes::PlanetClassDef) -> bool,
) -> Vec<&str> {
    gd.planet_classes
        .iter()
        .filter(|c| flag(c))
        .map(|c| c.key.as_str())
        .collect()
}

#[test]
fn a_class_only_a_picture_names_is_look_only_and_an_empty_model_hides_its_class() {
    let (_dir, gd) = looks();
    assert_eq!(marked(&gd, |c| c.look_only), ["pc_look", "pc_param_look"]);
    assert_eq!(
        marked(&gd, |c| c.hidden_model),
        ["pc_cloned_empty", "pc_empty_space", "pc_first_hidden"]
    );

    let never: BTreeSet<&str> = marked(&gd, |c| c.change() == ClassChange::Never)
        .into_iter()
        .collect();
    let flagged: BTreeSet<&str> = marked(&gd, |c| c.look_only || c.hidden_model)
        .into_iter()
        .collect();
    assert_eq!(never, flagged);
    let offered: BTreeSet<&str> = body_classes(&gd, false)
        .into_iter()
        .map(|c| c.key.as_str())
        .collect();
    assert!(offered.is_disjoint(&flagged), "{offered:?}");
    assert!(offered.contains("pc_changed") && offered.contains("pc_rock"));

    let views = gd.planet_class_views();
    let view = |key: &str| views.iter().find(|v| v.key == key).expect("a view");
    assert_eq!(view("pc_look").look_only, Some(true));
    assert_eq!(view("pc_empty_space").hidden_model, Some(true));
    assert_eq!(view("pc_rock").look_only, None);
    assert_eq!(view("pc_rock").hidden_model, None);
}

#[test]
fn rereading_the_scripts_marks_the_classes_again() {
    let (dir, gd) = looks();
    fs::write(
        dir.path().join("install/events/placed_later.txt"),
        "event = {\n\tid = looks.3\n\timmediate = { change_pc = pc_look }\n}\n",
    )
    .expect("an event file");
    let (rebuilt, _) = gd.rebuild(&BTreeSet::from([RegistryKind::Scripts]));
    assert_eq!(marked(&rebuilt, |c| c.look_only), ["pc_param_look"]);
    assert_eq!(marked(&rebuilt, |c| c.hidden_model).len(), 3);
}

#[test]
fn vanilla_has_no_look_only_or_hidden_model_class() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let marked = marked(gd, |c| c.look_only || c.hidden_model);
    assert!(marked.is_empty(), "{marked:?}");
}
