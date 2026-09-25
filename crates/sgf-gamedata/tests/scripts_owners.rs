//! Scripted ownership on the synthetic install and its mod layer: every
//! route to an empire's identity, an owner set through a scope, and a
//! system two statements fight over.

use crate::common;

use sgf_gamedata::scripts::{OwnerIdentity, TERRITORY_BASE};

use common::scripts::{SCENARIO, capital_scripts, install_with_mod, names, owners, sys};

#[test]
fn the_systems_sharing_an_event_target_become_one_territory() {
    let gd = common::cached_fixture_with_mods();
    let owners = owners(gd);
    assert!(owners.with_game_data);

    let tokens: Vec<&str> = owners
        .territories
        .iter()
        .map(|t| t.token.as_str())
        .collect();
    assert_eq!(tokens, ["fixture_empire", "fixture_fallen"]);

    let ids: Vec<u32> = owners.territories.iter().map(|t| t.country.id).collect();
    assert_eq!(ids, [TERRITORY_BASE, TERRITORY_BASE + 1]);

    let owned: Vec<(u32, u32)> = owners
        .owners
        .iter()
        .map(|o| (o.system, o.territory))
        .collect();
    assert_eq!(
        owned,
        [
            (1, TERRITORY_BASE),
            (2, TERRITORY_BASE),
            (3, TERRITORY_BASE + 1)
        ]
    );
}

#[test]
fn a_mod_empire_is_named_through_the_country_flag_its_scripted_effect_sets() {
    let gd = common::cached_fixture_with_mods();
    let owners = owners(gd);
    let empire = &owners.territories[0];
    assert_eq!(empire.identity, OwnerIdentity::CountryFlag);
    assert_eq!(empire.country.name_key, "NAME_Fixture_Empire");
    assert_eq!(empire.country.name.key, "NAME_Fixture_Empire");
    assert_eq!(
        gd.loc.get("NAME_Fixture_Empire").as_deref(),
        Some("Fixture Empire")
    );
    assert_eq!(empire.country.colors, ["fixture_red", "fixture_red"]);
    assert_eq!(empire.country.country_type, "default");
    assert_eq!(empire.country.capital_system, Some(1));
    assert_eq!(empire.country.system_count, 2);

    let icon = empire.country.flag_icon.as_ref().expect("flag icon");
    assert_eq!(icon.file, "flag_synthetic_1.dds");
    assert!(gd.colors.get("fixture_red").is_some());

    let origin = empire.origin.as_ref().expect("origin");
    assert_eq!(origin.layer, "Mod One");
    assert!(
        origin
            .display
            .starts_with("common/solar_system_initializers/zz_one.txt:"),
        "{}",
        origin.display
    );
    let defined = empire.defined_at.as_ref().expect("defined_at");
    assert_eq!(
        defined.display,
        "common/scripted_effects/zz_countries.txt:2"
    );
}

#[test]
fn a_vanilla_country_that_saves_its_own_target_resolves_directly() {
    let gd = common::cached_fixture_with_mods();
    let owners = owners(gd);
    let fallen = &owners.territories[1];
    assert_eq!(fallen.identity, OwnerIdentity::Created);
    assert_eq!(fallen.country.name_key, "NAME_Fixture_Fallen");
    assert_eq!(fallen.country.country_type, "fallen_empire");
    assert_eq!(fallen.country.colors, ["fixture_navy", "fixture_navy"]);
    assert_eq!(fallen.country.capital_system, Some(3));
    assert_eq!(fallen.country.system_count, 1);
    assert_eq!(
        fallen.defined_at.as_ref().map(|r| r.layer.as_str()),
        Some("vanilla")
    );
}

#[test]
fn the_remaining_identity_routes_are_prescripted_custom_and_bare() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&[
        sys(11, "prescripted_capital_init"),
        sys(12, "custom_capital_init"),
        sys(13, "bare_capital_init"),
    ]);
    let by_token = |token: &str| {
        owners
            .territories
            .iter()
            .find(|t| t.token == token)
            .unwrap_or_else(|| panic!("no territory {token}"))
    };

    let prescripted = by_token("fixture_prescripted");
    assert_eq!(prescripted.identity, OwnerIdentity::Prescripted);
    assert_eq!(prescripted.country.name_key, "EMPIRE_DESIGN_fixture");
    assert_eq!(prescripted.country.colors, ["fixture_teal", "fixture_navy"]);
    assert_eq!(
        prescripted
            .country
            .flag_icon
            .as_ref()
            .map(|f| f.file.as_str()),
        Some("flag_synthetic_3.dds")
    );
    assert_eq!(
        prescripted.defined_at.as_ref().map(|r| r.display.as_str()),
        Some("prescripted_countries/00_fixture.txt:1")
    );

    assert_eq!(
        gd.scripts
            .prescripted("prescripted_twin_init")
            .map(|p| p.name_key.as_str()),
        Some("EMPIRE_DESIGN_fixture_twin_late"),
        "the last file to name an initializer wins, whatever its definition sorts as"
    );

    let custom = by_token("fixture_custom");
    assert_eq!(custom.identity, OwnerIdentity::CustomEmpireSpawn);
    assert_eq!(custom.country.name_key, "Custom empire spawn");
    assert!(custom.country.colors.is_empty());
    assert_eq!(custom.defined_at, None);

    let bare = by_token("fixture_bare");
    assert_eq!(bare.identity, OwnerIdentity::Unresolved);
    assert_eq!(bare.country.name_key, "fixture_bare");
    assert_eq!(
        bare.country.country_type, "global_event",
        "an owner nobody claims is not drawn as an empire"
    );
    assert!(bare.country.colors.is_empty());
}

#[test]
fn a_country_named_in_a_last_created_country_sibling_still_resolves() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&[sys(14, "guardian_capital_init")]);
    let guardian = &owners.territories[0];
    assert_eq!(guardian.token, "fixture_guardian");
    assert_eq!(guardian.identity, OwnerIdentity::Created);
    assert_eq!(guardian.country.name_key, "NAME_Fixture_Guardian");
    assert_eq!(guardian.country.country_type, "guardian");
    assert_eq!(guardian.country.colors, ["fixture_red"]);
    assert_eq!(guardian.country.capital_system, Some(14));
    assert_eq!(
        guardian.defined_at.as_ref().map(|r| r.display.as_str()),
        Some("common/solar_system_initializers/02_c.txt:87")
    );
}

#[test]
fn an_owner_set_through_a_scope_is_listed_unresolved_and_not_owned() {
    let gd = common::cached_fixture_with_mods();
    let owners = owners(gd);
    let wrote: Vec<(u32, &str)> = owners
        .unresolved
        .iter()
        .map(|u| (u.system, u.wrote.as_str()))
        .collect();
    assert_eq!(wrote, [(4, "set_owner = prev")]);
    assert!(owners.owners.iter().all(|o| o.system != 4));
}

#[test]
fn a_system_given_away_twice_keeps_the_first_owner_and_reports_the_second() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&[sys(7, "contested_init")]);

    let owned: Vec<(u32, &str)> = owners
        .owners
        .iter()
        .map(|o| {
            let territory = owners
                .territories
                .iter()
                .find(|t| t.country.id == o.territory)
                .expect("territory");
            (o.system, territory.token.as_str())
        })
        .collect();
    assert_eq!(owned, [(7, "fixture_empire")], "one owner per system");
    assert_eq!(owners.territories.len(), 1);
    assert_eq!(owners.territories[0].country.system_count, 1);

    let wrote: Vec<(u32, &str)> = owners
        .unresolved
        .iter()
        .map(|u| (u.system, u.wrote.as_str()))
        .collect();
    assert_eq!(wrote, [(7, "also set_owner = event_target:fixture_fallen")]);

    let scripts = gd.system_scripts(7, Some("contested_init"), None);
    assert_eq!(
        scripts.owner.as_ref().map(|o| o.token.as_str()),
        Some("fixture_empire"),
        "the owner line agrees with the territory"
    );
}

#[test]
fn two_systems_of_one_empire_do_not_list_each_others_initializers() {
    let gd = common::cached_fixture_with_mods();
    let capital = capital_scripts(gd);
    let colony = gd.system_scripts(2, Some("empire_colony_init"), None);

    assert!(
        !names(&capital).contains(&"empire_colony_init"),
        "{:#?}",
        capital.rows
    );
    assert!(
        !names(&colony).contains(&"empire_capital_init"),
        "{:#?}",
        colony.rows
    );

    // The empire is still one territory, with the capital resolved.
    let owners = owners(gd);
    let empire = &owners.territories[0];
    assert_eq!(empire.token, "fixture_empire");
    assert_eq!(empire.country.capital_system, Some(1));
    assert_eq!(empire.country.system_count, 2);
    assert!(capital.owner.as_ref().expect("owner").capital);
}

#[test]
fn without_the_mod_layer_the_mod_empire_is_gone() {
    let gd = common::cached_fixture();
    let owners = gd.scenario_owners(&SCENARIO);
    let tokens: Vec<&str> = owners
        .territories
        .iter()
        .map(|t| t.token.as_str())
        .collect();
    assert_eq!(tokens, ["fixture_fallen"]);
    assert!(owners.unresolved.is_empty());
}

/// A mod initializer whose `create_country` redefines the fixture
/// guardian's country behind the flag and the target it already saves,
/// written under `key` so a test can vary where the name sorts.
fn modded_guardian(key: &str) -> String {
    format!(
        r#"{key} = {{
	class = sc_sun
	planet = {{
		count = 1
		class = star
		init_effect = {{
			create_country = {{
				name = "NAME_Modded_Guardian"
				type = guardian
			}}
			last_created_country = {{
				save_global_event_target_as = fixture_guardian
				set_country_flag = fixture_guardian
			}}
		}}
	}}
}}
"#
    )
}

#[test]
fn the_last_file_to_define_a_country_wins_whatever_its_initializer_is_called() {
    for key in ["aa_modded_guardian_init", "zz_modded_guardian_init"] {
        let text = modded_guardian(key);
        let (_dir, gd) = install_with_mod(&[(
            "common/solar_system_initializers/zz_guardian.txt",
            text.as_str(),
        )]);
        let by_flag = gd
            .scripts
            .country_of_flag("fixture_guardian")
            .unwrap_or_else(|| panic!("no country behind the flag, for {key}"));
        assert_eq!(by_flag.name_key, "NAME_Modded_Guardian", "{key}");
        let by_target = gd
            .scripts
            .country_of_target("fixture_guardian")
            .unwrap_or_else(|| panic!("no country behind the target, for {key}"));
        assert_eq!(by_target.name_key, "NAME_Modded_Guardian", "{key}");
    }
}
