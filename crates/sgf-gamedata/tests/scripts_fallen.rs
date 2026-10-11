//! A fallen empire's territory in a scenario: its home system and the
//! systems its chain spawns, which the game gives to the country it creates
//! in the home system.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::session::Session;
use sgf_gamedata::scripts::{OwnerIdentity, ScenarioOwners, ScenarioSystem, Territory};

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.4-early.scenario.txt"
);

const FALLEN_EMPIRES: &str = r#"fixture_fe = {
	initializer = "fixture_fe_home"
	create_country_effect = {
		create_country = {
			name = random
			type = fallen_empire
			ethos = {
				ethic = ethic_fanatic_fixture
			}
			flag = random
		}
	}
}
"#;

const INITIALIZERS: &str = r#"fixture_fe_home = {
	usage = fallen_empire_init
	planet = {
		class = pc_continental
		init_effect = {
			set_owner = root
		}
	}
	neighbor_system = {
		distance = { min = 0 max = 50 }
		initializer = "fixture_fe_outpost"
	}
	neighbor_system = {
		distance = { min = 0 max = 50 }
		initializer = "fixture_fe_ruin"
	}
	neighbor_system = {
		distance = { min = 0 max = 50 }
		initializer = "fixture_fe_held"
	}
}

fixture_fe_outpost = {
	init_effect = {
		create_starbase = {
			size = starbase_outpost
		}
	}
}

fixture_fe_ruin = {
	planet = {
		class = pc_barren
	}
}

fixture_fe_held = {
	init_effect = {
		create_starbase = {
			size = starbase_outpost
			owner = prev
		}
	}
}
"#;

/// A mod's file read after [`FALLEN_EMPIRES`], pointing the same entry at another home.
const REPOINTED: &str = r#"fixture_fe = {
	initializer = "fixture_fe_other_home"
}
"#;

fn fixture_install(extra: &[(&str, &str)]) -> (tempfile::TempDir, sgf_gamedata::GameData) {
    let mut files = vec![
        ("common/fallen_empires/00_fixture.txt", FALLEN_EMPIRES),
        (
            "common/solar_system_initializers/00_fixture.txt",
            INITIALIZERS,
        ),
        ("localisation/english/fx_l_english.yml", LOCALISATION),
    ];
    files.extend_from_slice(extra);
    common::hand_written(&files)
}

const LOCALISATION: &str =
    "l_english:\n COUNTRY_FALLEN_EMPIRE:0 \"Fallen Empire\"\n ethic_fixture:0 \"Fixture\"\n";

fn members(owners: &ScenarioOwners, territory: &Territory) -> BTreeSet<u32> {
    owners
        .owners
        .iter()
        .filter(|o| o.territory == territory.country.id)
        .map(|o| o.system)
        .collect()
}

#[test]
fn a_system_two_fallen_empires_of_one_kind_spawn_goes_to_the_nearer_home() {
    let (_dir, gd) = fixture_install(&[]);
    let systems = [
        ScenarioSystem::new(21, "fixture_fe_home", None).at(0.0, 0.0),
        ScenarioSystem::new(22, "fixture_fe_home", None).at(100.0, 0.0),
        ScenarioSystem::new(23, "fixture_fe_outpost", None).at(10.0, 0.0),
        ScenarioSystem::new(24, "fixture_fe_outpost", None).at(90.0, 0.0),
        ScenarioSystem::new(25, "fixture_fe_outpost", None).at(60.0, 0.0),
        ScenarioSystem::new(26, "fixture_fe_ruin", None).at(5.0, 0.0),
        ScenarioSystem::new(27, "fixture_fe_held", None).at(-5.0, 0.0),
        ScenarioSystem::new(28, "fixture_fe_outpost", None).at(300.0, 0.0),
    ];
    let owners = gd.scenario_owners(&systems);

    let tokens: Vec<&str> = owners
        .territories
        .iter()
        .map(|t| t.token.as_str())
        .collect();
    assert_eq!(
        tokens,
        ["root:fixture_fe_home:21", "root:fixture_fe_home:22"]
    );
    let [west, east] = [&owners.territories[0], &owners.territories[1]];
    assert_eq!(members(&owners, west), BTreeSet::from([21, 23]));
    assert_eq!(
        members(&owners, east),
        BTreeSet::from([22, 24, 25]),
        "25 stands nearer the eastern home"
    );
    assert!(
        owners.owners.iter().all(|o| o.system != 26),
        "a spawned system that builds nothing for the empire stays unowned"
    );
    assert!(
        owners.owners.iter().all(|o| o.system != 27),
        "a starbase given to prev is not the fallen empire's"
    );
    assert!(
        owners.owners.iter().all(|o| o.system != 28),
        "an outpost 200 from the nearer home is past the 50 its spawn allows"
    );

    for territory in [west, east] {
        assert_eq!(territory.identity, OwnerIdentity::FallenEmpire);
        assert_eq!(territory.country.name_key, "Fixture Fallen Empire");
        assert_eq!(territory.country.country_type, "fallen_empire");
        assert!(territory.country.colors.is_empty());
        assert_eq!(
            territory.defined_at.as_ref().map(|r| r.display.as_str()),
            Some("common/fallen_empires/00_fixture.txt:1")
        );
    }
    assert_eq!(west.country.capital_system, Some(21));
    assert_eq!(east.country.capital_system, Some(22));
    let wrote: Vec<(u32, &str)> = owners
        .unresolved
        .iter()
        .map(|u| (u.system, u.wrote.as_str()))
        .collect();
    assert_eq!(
        wrote,
        [(27, "set_owner = prev")],
        "root is the fallen empire, and prev still names no one"
    );
}

#[test]
fn an_entry_a_later_file_points_elsewhere_no_longer_makes_its_old_home_one() {
    let (_dir, gd) = fixture_install(&[("common/fallen_empires/01_mod.txt", REPOINTED)]);
    assert!(gd.scripts.fallen_empire("fixture_fe_home").is_none());
    assert_eq!(
        gd.scripts
            .fallen_empire("fixture_fe_other_home")
            .map(|f| f.key.as_str()),
        Some("fixture_fe")
    );

    let owners = gd.scenario_owners(&[
        ScenarioSystem::new(21, "fixture_fe_home", None).at(0.0, 0.0),
        ScenarioSystem::new(23, "fixture_fe_outpost", None).at(10.0, 0.0),
    ]);
    assert!(owners.territories.is_empty(), "{:?}", owners.territories);
}

#[test]
fn the_4_4_samples_fallen_empires_hold_what_the_save_gives_them() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let scenario = Session::open(SCENARIO).expect("open the scenario");
    let owners = ScenarioSystem::of_session(&scenario, |systems, _| gd.scenario_owners(systems));
    let save = common::open_4_4();
    let saved = |capital: u32| -> (Option<u32>, BTreeSet<u32>) {
        let owner = save.graph().systems[&capital].owner;
        let held = save
            .graph()
            .systems
            .values()
            .filter(|s| s.owner == owner)
            .map(|s| s.id)
            .collect();
        (owner, held)
    };
    let fallen: Vec<&Territory> = owners
        .territories
        .iter()
        .filter(|t| t.identity == OwnerIdentity::FallenEmpire)
        .collect();
    let tokens: Vec<&str> = fallen.iter().map(|t| t.token.as_str()).collect();
    assert_eq!(
        tokens,
        [
            "root:fallen_1:58",
            "root:fallen_2:521",
            "root:fallen_machine:246"
        ]
    );

    let [materialist, spiritualist, machine] = [fallen[0], fallen[1], fallen[2]];
    let label = |t: &Territory| gd.loc.get(&t.country.name_key);

    assert_eq!(
        members(&owners, machine),
        BTreeSet::from([0, 64, 246, 672, 774])
    );
    let (owner, held) = saved(246);
    assert_eq!(owner, Some(15), "the save's fallen machine empire");
    assert_eq!(members(&owners, machine), held);
    assert_eq!(label(machine).as_deref(), Some("Fallen Machine Empire"));

    let (_, held) = saved(58);
    assert_eq!(members(&owners, materialist), held);
    assert_eq!(materialist.country.name_key, "Materialist Fallen Empire");

    // The early save's spiritualist empire has since taken three plain
    // systems that no initializer gives it.
    let (_, held) = saved(521);
    let expanded: BTreeSet<u32> = held
        .difference(&members(&owners, spiritualist))
        .copied()
        .collect();
    assert_eq!(expanded, BTreeSet::from([63, 641, 721]));
    assert!(members(&owners, spiritualist).is_subset(&held));
    assert_eq!(spiritualist.country.name_key, "Spiritualist Fallen Empire");

    for territory in fallen {
        assert_eq!(territory.country.country_type, "fallen_empire");
        assert!(territory.country.colors.is_empty(), "flag = random");
    }
}
