//! Partial rebuilds on a throwaway copy of the synthetic install: a
//! rebuilt registry says what a full load would say, the registries that
//! did not change are the same allocation, and which registry a changed
//! path belongs to.

mod common;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sgf_gamedata::scripts::ScenarioSystem;
use sgf_gamedata::views::GameDataSummary;
use sgf_gamedata::{GameData, LoadOptions, RegistryKind};
use tempfile::TempDir;

use common::scripts::sys;

const SCENARIO: [ScenarioSystem<'static>; 3] = [
    sys(1, "empire_capital_init"),
    sys(2, "empire_colony_init"),
    sys(5, "basic_init_01"),
];

/// The systems the bypass readers reach: the two ends of the day-one pair
/// and one whose own initializer spawns a wormhole.
const BYPASSES: [ScenarioSystem<'static>; 3] = [
    sys(40, "wormhole_a_init"),
    sys(41, "wormhole_b_init"),
    sys(43, "tunnel_init"),
];

const INITIALIZERS: &str = "userdata/mod/one/common/solar_system_initializers/zz_one.txt";
const ENGLISH: &str = "userdata/mod/one/localisation/english/one_l_english.yml";
const EVENTS: &str = "userdata/mod/one/events/zz_fixture_events.txt";
const ON_ACTIONS: &str = "userdata/mod/one/common/on_actions/zz_fixture.txt";
const VARIABLES: &str = "install/common/scripted_variables/00_fixture.txt";

#[test]
fn rebuilding_the_initializers_says_what_a_full_load_says() {
    let tree = fixture_copy();
    let before = load(tree.path());
    append(
        &tree.path().join(INITIALIZERS),
        "\nreloaded_init = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tinit_effect = { set_star_flag = fixture_beacon }\n}\n",
    );

    let (rebuilt, replaced) = before.rebuild(&kinds([RegistryKind::Initializers]));
    let full = load(tree.path());

    assert!(
        rebuilt.initializers.get("reloaded_init").is_some(),
        "the appended initializer is missing"
    );
    assert_eq!(summary(&rebuilt), summary(&full));
    assert_eq!(
        rebuilt.scenario_owners(&SCENARIO),
        full.scenario_owners(&SCENARIO)
    );
    assert_eq!(
        rebuilt.system_scripts(1, Some("empire_capital_init"), None),
        full.system_scripts(1, Some("empire_capital_init"), None)
    );
    assert_eq!(
        rebuilt.scenario_bypasses(&BYPASSES),
        full.scenario_bypasses(&BYPASSES)
    );
    // The script index was built from the initializers just read: the new one's flag reaches
    // the fixture event that reads it.
    let scripts = rebuilt.system_scripts(9, Some("reloaded_init"), None);
    assert!(
        scripts.rows.iter().any(|r| r.name.contains("fixture")),
        "{:?}",
        scripts.rows.iter().map(|r| &r.name).collect::<Vec<_>>()
    );
    assert_eq!(scripts, full.system_scripts(9, Some("reloaded_init"), None));

    assert_eq!(
        replaced,
        kinds([RegistryKind::Initializers, RegistryKind::Scripts])
    );
    assert!(!Arc::ptr_eq(&before.initializers, &rebuilt.initializers));
    assert!(!Arc::ptr_eq(&before.scripts, &rebuilt.scripts));
    assert!(Arc::ptr_eq(&before.colors, &rebuilt.colors));
    assert!(Arc::ptr_eq(&before.deposits, &rebuilt.deposits));
    assert!(Arc::ptr_eq(&before.loc, &rebuilt.loc));
}

#[test]
fn rebuilding_the_scripts_says_what_a_full_load_says_about_the_bypasses() {
    let tree = fixture_copy();
    let before = load(tree.path());
    append(
        &tree.path().join(EVENTS),
        "\nevent = {\n\tid = fixture.11\n\tis_triggered_only = yes\n\timmediate = {\n\t\tevery_system = {\n\t\t\tlimit = { has_star_flag = wh_a }\n\t\t\tspawn_megastructure = { type = gateway_final }\n\t\t}\n\t}\n}\n",
    );
    append(
        &tree.path().join(ON_ACTIONS),
        "\non_game_start = {\n\tevents = {\n\t\tfixture.11\n\t}\n}\n",
    );

    let (rebuilt, _) = before.rebuild(&kinds([RegistryKind::Scripts]));
    let full = load(tree.path());

    let found = rebuilt.scenario_bypasses(&BYPASSES);
    assert!(
        found.bypasses.iter().any(|b| b.system == 40
            && b.kind == sgf_gamedata::scripts::BypassKind::Gateway { ruined: false }),
        "the appended event's gateway is missing: {:#?}",
        found.bypasses,
    );
    assert_eq!(found, full.scenario_bypasses(&BYPASSES));
    assert_ne!(found, before.scenario_bypasses(&BYPASSES));
    assert_eq!(summary(&rebuilt), summary(&full));

    assert!(!Arc::ptr_eq(&before.scripts, &rebuilt.scripts));
    assert!(Arc::ptr_eq(&before.initializers, &rebuilt.initializers));
}

#[test]
fn rebuilding_the_localisation_says_what_a_full_load_says() {
    let tree = fixture_copy();
    let before = load(tree.path());
    append(
        &tree.path().join(ENGLISH),
        " reloaded_key:0 \"read again\"\n",
    );

    let (rebuilt, _) = before.rebuild(&kinds([RegistryKind::Localisation]));
    let full = load(tree.path());

    assert_eq!(
        rebuilt.loc.get("reloaded_key").as_deref(),
        Some("read again")
    );
    assert_eq!(summary(&rebuilt), summary(&full));
    assert_eq!(
        rebuilt.scenario_owners(&SCENARIO),
        full.scenario_owners(&SCENARIO)
    );
    assert_eq!(
        rebuilt.system_scripts(1, Some("empire_capital_init"), None),
        full.system_scripts(1, Some("empire_capital_init"), None)
    );

    assert!(!Arc::ptr_eq(&before.loc, &rebuilt.loc));
    assert!(Arc::ptr_eq(&before.initializers, &rebuilt.initializers));
    assert!(Arc::ptr_eq(&before.scripts, &rebuilt.scripts));
    assert!(Arc::ptr_eq(&before.colors, &rebuilt.colors));
}

#[test]
fn rebuilding_the_variables_rereads_everything_that_reads_them() {
    let tree = fixture_copy();
    let before = load(tree.path());
    append(&tree.path().join(VARIABLES), "\n@FIXTURE_DISTRICTS = 5\n");

    let (rebuilt, replaced) = before.rebuild(&kinds([RegistryKind::Variables]));
    let full = load(tree.path());

    let rare = ["d_fixture_rare".to_owned()];
    let effect = |gd: &GameData| gd.deposit_type_views(&rare)[0].effects[0].value;
    assert_eq!(effect(&before), 2.0);
    assert_eq!(effect(&rebuilt), 5.0);
    assert_eq!(
        rebuilt.deposit_type_views(&rare),
        full.deposit_type_views(&rare)
    );
    assert_eq!(summary(&rebuilt), summary(&full));
    assert_eq!(
        rebuilt.scenario_owners(&SCENARIO),
        full.scenario_owners(&SCENARIO)
    );
    assert!(replaced.contains(&RegistryKind::Variables));
    assert!(replaced.contains(&RegistryKind::Initializers));
    assert!(!Arc::ptr_eq(&before.variables, &rebuilt.variables));
    assert!(!Arc::ptr_eq(&before.deposits, &rebuilt.deposits));
}

#[test]
fn a_reread_that_finds_nothing_keeps_the_old_registry_and_is_not_named_replaced() {
    let tree = fixture_copy();
    let before = load(tree.path());
    fs::remove_file(tree.path().join("install/flags/colors.txt")).expect("remove the colours");

    let (rebuilt, replaced) = before.rebuild(&kinds([RegistryKind::Colors]));

    assert!(replaced.is_empty(), "{replaced:?}");
    assert!(Arc::ptr_eq(&before.colors, &rebuilt.colors));
    assert!(
        rebuilt
            .diagnostics
            .iter()
            .any(|d| d.kind() == "rebuild_failed"),
        "{:?}",
        rebuilt.diagnostics
    );
}

#[test]
fn a_changed_path_names_the_registry_that_reads_it() {
    let tree = fixture_copy();
    let gd = load(tree.path());
    let install = tree.path().join("install");
    let one = tree.path().join("userdata/mod/one");

    let table: [(PathBuf, Option<RegistryKind>); 16] = [
        (
            install.join("common/scripted_variables/00_fixture.txt"),
            Some(RegistryKind::Variables),
        ),
        (
            install.join("common/solar_system_initializers/00_a.txt"),
            Some(RegistryKind::Initializers),
        ),
        (
            one.join("common/solar_system_initializers/nested/nested_init.txt"),
            Some(RegistryKind::Initializers),
        ),
        (
            one.join("common/scripted_effects/zz_countries.txt"),
            Some(RegistryKind::Scripts),
        ),
        (
            one.join("events/zz_fixture_events.txt"),
            Some(RegistryKind::Scripts),
        ),
        (
            one.join("common/on_actions/zz_fixture.txt"),
            Some(RegistryKind::Scripts),
        ),
        (
            install.join("prescripted_countries/00_fixture.txt"),
            Some(RegistryKind::Scripts),
        ),
        (
            install.join("common/country_types/00_types.txt"),
            Some(RegistryKind::CountryTypes),
        ),
        (
            install.join("common/bypass/00_fixture.txt"),
            Some(RegistryKind::Bypasses),
        ),
        (install.join("flags/colors.txt"), Some(RegistryKind::Colors)),
        (
            install.join("localisation/english/a_l_english.yml"),
            Some(RegistryKind::Localisation),
        ),
        (
            install.join("localisation/german/a_l_german.yml"),
            Some(RegistryKind::Localisation),
        ),
        (
            PathBuf::from(install.display().to_string().to_uppercase())
                .join("COMMON/COUNTRY_TYPES/00_TYPES.TXT"),
            Some(RegistryKind::CountryTypes),
        ),
        (
            install.join("common/solar_system_initializers/00_a.txt.tmp"),
            None,
        ),
        (install.join("gfx/map/star_classes/g_star.dds"), None),
        (
            tree.path().join("elsewhere/common/country_types/99.txt"),
            None,
        ),
    ];

    for (path, want) in table {
        assert_eq!(
            RegistryKind::classify(&gd.layout, &path),
            want,
            "{}",
            path.display()
        );
    }
}

/// The diagnostics a rebuild merges keep no order a full load promises, so
/// both lists are sorted before they are compared.
fn summary(gd: &GameData) -> GameDataSummary {
    let mut summary = GameDataSummary::from(gd);
    summary
        .diagnostics
        .sort_by(|a, b| (&a.kind, &a.message).cmp(&(&b.kind, &b.message)));
    summary
}

fn kinds<const N: usize>(kinds: [RegistryKind; N]) -> BTreeSet<RegistryKind> {
    kinds.into_iter().collect()
}

fn load(tree: &Path) -> GameData {
    let opts = LoadOptions {
        install: Some(tree.join("install")),
        user_dir: Some(tree.join("userdata")),
        language: "english".to_owned(),
        mods: true,
    };
    sgf_gamedata::load(&opts, &mut |_| {}).expect("the copied fixture loads")
}

fn fixture_copy() -> TempDir {
    let tree = tempfile::tempdir().expect("temp dir");
    copy_dir(&common::fixture("install"), &tree.path().join("install"));
    copy_dir(&common::fixture("userdata"), &tree.path().join("userdata"));
    tree
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create dir");
    for entry in fs::read_dir(from).expect("read dir").flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).expect("copy file");
        }
    }
}

fn append(file: &Path, text: &str) {
    let mut bytes = fs::read(file).expect("read fixture file");
    bytes.extend_from_slice(text.as_bytes());
    fs::write(file, bytes).expect("write fixture file");
}
