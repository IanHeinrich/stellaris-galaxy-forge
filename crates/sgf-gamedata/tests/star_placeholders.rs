//! Star classes defined only so their key is valid, and classes that list more stars than any
//! class a new galaxy rolls, in a hand-written install, then the real install's vanilla
//! classes when this machine has one.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::generate::star_classes;
use sgf_gamedata::registries::star_classes::StarClass;
use sgf_gamedata::report::PlaysetReport;
use sgf_gamedata::views::StarClassView;
use tempfile::TempDir;

const STARS: &str = "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n\
sc_trio = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tplanet = { key = pc_red_star }\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 5\n}\n\
sc_crisis_trio = {\n\tclass = red_star\n\tplanet = { key = pc_red_star }\n\tplanet = { key = pc_red_star }\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 0\n}\n\
sc_hollow = { class = sc_void spawn_odds = 0 }\n\
sc_named_hollow = { class = sun_star spawn_odds = 0 }\n\
sc_rolled_hollow = { class = sun_star spawn_odds = 2 }\n\
sc_starless = {\n\tclass = sun_star\n\tspawn_odds = 0\n\tnum_planets = { min = 2 max = 4 }\n}\n\
sc_shell = {\n\tclass = shell_star\n\tplanet = { key = pc_sun_star }\n\tplanet = { key = pc_red_star }\n\tplanet = { key = pc_blue_star }\n\tplanet = { key = pc_white_star }\n\tspawn_odds = 0\n}\n";

const PLANETS: &str = "pc_sun_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
pc_red_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
pc_blue_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
pc_white_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n";

/// A plain layout that fixes a placeholder class, beside one that draws the single star.
const INITIALIZERS: &str = "fx_sun = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
fx_hollow = {\n\tclass = \"sc_named_hollow\"\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n";

const NAMES: &str = "l_english:\n sc_named_hollow:0 \"Hollow\"\n";

fn stars() -> (TempDir, GameData) {
    common::hand_written(&[
        ("common/star_classes/00_stars.txt", STARS),
        ("common/planet_classes/00_stars.txt", PLANETS),
        ("common/solar_system_initializers/00_fx.txt", INITIALIZERS),
        ("localisation/english/fx_l_english.yml", NAMES),
    ])
}

fn marked(gd: &GameData, flag: impl Fn(&StarClass) -> bool) -> Vec<&str> {
    gd.star_classes
        .iter()
        .filter(|c| flag(c))
        .map(|c| c.key.as_str())
        .collect()
}

#[test]
fn a_class_with_only_a_look_and_no_odds_is_a_placeholder() {
    let (_dir, gd) = stars();
    assert_eq!(
        marked(&gd, |c| c.placeholder),
        ["sc_hollow", "sc_named_hollow"]
    );
    assert_eq!(marked(&gd, |c| c.alternatives), ["sc_shell"]);
    assert_eq!(
        star_classes(&gd),
        ["sc_sun"],
        "a layout fixing a placeholder adds no star class"
    );

    let view = |key: &str| StarClassView::new(gd.star_classes.get(key).expect(key), &gd.loc);
    assert_eq!(view("sc_hollow").placeholder, Some(true));
    assert_eq!(view("sc_shell").alternatives, Some(true));
    assert_eq!(view("sc_starless").placeholder, None);
    assert_eq!(view("sc_crisis_trio").alternatives, None);
}

/// A mod's rolled class with more stars than the shell lists.
const CLUSTER: &str = "sc_cluster = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tplanet = { key = pc_red_star }\n\tplanet = { key = pc_blue_star }\n\tplanet = { key = pc_white_star }\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 10\n}\n";

#[test]
fn a_mod_rolling_a_class_of_many_stars_leaves_the_base_game_count_in_place() {
    let (dir, _) = stars();
    let user = dir.path().join("user");
    common::playset(
        &user,
        &[(
            "clusters",
            &[("common/star_classes/50_cluster.txt", CLUSTER)],
        )],
    );
    let gd = common::load_tree(&dir.path().join("install"), Some(&user), true);
    assert!(gd.star_classes.get("sc_cluster").is_some(), "the mod loads");
    assert_eq!(
        marked(&gd, |c| c.alternatives),
        ["sc_shell"],
        "a class a new galaxy rolls has one entry per star"
    );
}

#[test]
fn the_report_lists_placeholders_apart_from_classes_with_no_star_body() {
    let (_dir, gd) = stars();
    let (_cache, textures) = common::temp_textures();
    let report = PlaysetReport::new(&gd, &textures);
    let keys = |rows: &[sgf_gamedata::report::Row]| -> Vec<String> {
        rows.iter().map(|r| r.key.clone()).collect()
    };
    assert_eq!(
        keys(&report.placeholder_stars),
        ["sc_hollow", "sc_named_hollow"]
    );
    assert_eq!(
        keys(&report.stars_without_body),
        ["sc_rolled_hollow", "sc_starless"]
    );
    assert_eq!(keys(&report.star_choices), ["sc_shell"]);
    assert_eq!(
        keys(&report.stars_with_bodies),
        ["sc_crisis_trio", "sc_trio"]
    );
}

#[test]
fn vanilla_has_no_placeholder_star_class_or_one_listing_more_stars_than_it_rolls() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let marked = marked(gd, |c| c.placeholder || c.alternatives);
    assert!(marked.is_empty(), "{marked:?}");
}
