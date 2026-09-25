//! What the planet page reads from the install: deposit rows, modifiers and
//! designations, on the fixture install and then on the real one when this
//! machine has one.

use crate::common;

use std::fs;

use image::GenericImageView;
use sgf_gamedata::Diagnostic;
use sgf_gamedata::textures::TextureKey;

#[test]
fn fixture_deposit_values_resolve_global_and_file_variables() {
    let gd = common::cached_fixture();
    assert_eq!(gd.variables.get("FIXTURE_DISTRICTS"), Some("2"));

    let blocker = gd
        .deposit_type_view("d_fixture_blocker")
        .expect("d_fixture_blocker");
    assert!(blocker.blocker && !blocker.rare && !blocker.orbital);
    assert_eq!(blocker.texture_key, "sprite:GFX_deposit_blocker_unknown");
    let clearing = blocker.clearing.expect("a blocker has a clearing");
    assert_eq!(clearing.days, Some(90), "the file's own @FIXTURE_DAYS wins");
    assert_eq!(clearing.cost.len(), 1);
    assert_eq!(
        (clearing.cost[0].resource.as_str(), clearing.cost[0].amount),
        ("glow", 250.0)
    );
    assert_eq!(clearing.techs[0].key, "tech_fixture_clearing");
    assert_eq!(blocker.effects[0].value, -1.0);
    assert!(blocker.effects[0].text.starts_with("-1 "));

    let rare = gd
        .deposit_type_view("d_fixture_rare")
        .expect("d_fixture_rare");
    assert!(rare.rare && !rare.blocker);
    assert!(rare.clearing.is_none());
    assert_eq!(rare.texture_key, "sprite:GFX_deposit_unknown");
    assert_eq!(rare.effects[0].key, "district_farming_max_add");
    assert_eq!(rare.effects[0].value, 2.0, "@FIXTURE_DISTRICTS is global");
    assert_eq!(
        rare.side_effects.len(),
        1,
        "only the tech-gated trigger counts"
    );
    assert_eq!(rare.side_effects[0].tech.key, "tech_fixture_gas");
    assert_eq!(rare.side_effects[0].effects[0].value, 0.05);

    let gas = gd
        .deposit_type_view("d_fixture_hab_gas")
        .expect("d_fixture_hab_gas");
    let [side] = gas.side_effects.as_slice() else {
        panic!("the gestalt branch is dropped: {:?}", gas.side_effects);
    };
    assert_eq!(side.tech.key, "tech_fixture_gas");
    assert_eq!(side.effects[0].key, "job_gas_extractor_add");
    assert_eq!(
        side.effects[0].value, 100.0,
        "read from the nested modifier"
    );

    let hatchery = gd
        .deposit_type_view("d_fixture_hatchery")
        .expect("d_fixture_hatchery");
    assert_eq!(
        hatchery
            .effects
            .iter()
            .map(|e| (e.key.as_str(), e.value))
            .collect::<Vec<_>>(),
        [
            ("planet_max_districts_add", -1.0),
            ("planet_max_districts_add", -4.0),
            ("habitability_ceil_add", -0.1),
        ],
        "an unconditional block's lines are effects, its mult is not"
    );
    assert!(hatchery.side_effects.is_empty());

    let orbital = gd.deposit_type_view("d_glow_2").expect("d_glow_2");
    assert!(orbital.orbital && orbital.clearing.is_none());
    assert_eq!(orbital.yields[0].amount, 2.0);
    assert!(gd.deposit_type_view("d_unknown").is_none());
}

#[test]
fn modifier_amounts_are_signed_and_percentages_follow_the_key() {
    use sgf_gamedata::loc::modifiers::modifier_amount;
    assert_eq!(modifier_amount("district_farming_max_add", 3.0), "+3");
    assert_eq!(modifier_amount("planet_max_districts_add", -1.0), "-1");
    assert_eq!(modifier_amount("planet_jobs_produces_mult", 0.2), "+20%");
    assert_eq!(modifier_amount("pop_happiness", -0.05), "-5%");
    assert_eq!(modifier_amount("planet_x_produces_add", 0.05), "+0.05");
    assert_eq!(modifier_amount("planet_x_add", 0.0), "0");
    assert_eq!(modifier_amount("habitability_ceil_add", -0.1), "-10%");
    assert_eq!(modifier_amount("pop_growth_speed_reduction", 0.75), "+75%");
}

#[test]
fn install_bubbling_swamp_adds_districts_and_a_tech_gated_side_effect() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let swamp = gd
        .deposit_type_view("d_bubbling_swamp")
        .expect("d_bubbling_swamp");
    assert_eq!(swamp.name, "Bubbling Swamp");
    assert!(swamp.rare && !swamp.blocker && !swamp.orbital);
    assert_eq!(swamp.texture_key, "deposit:d_bubbling_swamp");
    assert_eq!(
        swamp
            .effects
            .iter()
            .map(|e| e.text.as_str())
            .collect::<Vec<_>>(),
        ["+3 Max Agriculture Districts"]
    );
    let [side] = swamp.side_effects.as_slice() else {
        panic!("{:?}", swamp.side_effects);
    };
    assert_eq!(side.tech.key, "tech_mine_exotic_gases");
    assert!(!side.tech.name.is_empty() && side.tech.name != side.tech.key);
    assert_eq!(side.effects[0].value, 0.05, "@SR_SMALL");
    assert!(side.effects[0].text.starts_with("+0.05 "), "{side:?}");
}

#[test]
fn install_massive_glacier_is_a_blocker_with_its_clearing() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let glacier = gd
        .deposit_type_view("d_massive_glacier")
        .expect("d_massive_glacier");
    assert_eq!(glacier.name, "Massive Glacier");
    assert!(glacier.blocker && !glacier.orbital);
    assert_eq!(glacier.effects[0].text, "-1 Max Districts");
    let clearing = glacier.clearing.expect("clearing");
    assert_eq!(clearing.days, Some(180));
    assert_eq!(clearing.cost[0].resource, "energy");
    assert_eq!(clearing.cost[0].amount, 500.0);
    assert!(clearing.cost[0].icon.is_some());
    assert_eq!(clearing.techs.len(), 1);
    assert_eq!(clearing.techs[0].key, "tech_massive_glacier");
    assert!(!clearing.techs[0].name.is_empty());
}

#[test]
fn install_orbital_deposits_lead_with_their_yield() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let energy = gd.deposit_type_view("d_energy_2").expect("d_energy_2");
    assert!(energy.orbital && !energy.blocker);
    assert_eq!(energy.station.as_deref(), Some("shipclass_mining_station"));
    assert_eq!(energy.yields.len(), 1);
    assert_eq!(
        (energy.yields[0].resource.as_str(), energy.yields[0].amount),
        ("energy", 2.0)
    );
    assert_eq!(
        energy.yields[0].icon.as_deref(),
        Some("sprite:GFX_resource_energy")
    );

    let trade = gd
        .deposit_type_view("d_trade_value_4")
        .expect("d_trade_value_4");
    assert_eq!(trade.texture_key, "deposit:unused/d_strategic_resources");
    assert_eq!(trade.yields[0].amount, 4.0);
    let (_dir, textures) = common::temp_textures();
    let view = gd.texture(&textures, &trade.texture_key);
    assert!(view.error.is_none(), "{view:?}");
    assert_eq!((view.width, view.height), (98, 75));
}

#[test]
fn install_every_deposit_parses() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    assert!(gd.deposits.len() >= 580, "{}", gd.deposits.len());
    for def in gd.deposits.iter() {
        let view = gd
            .deposit_type_view(&def.key)
            .expect("every deposit has a view");
        assert_eq!(view.clearing.is_some(), view.blocker, "{}", def.key);
        assert!(!view.name.is_empty(), "{}", def.key);
        assert!(
            view.texture_key.parse::<TextureKey>().is_ok(),
            "{}",
            view.texture_key
        );
        for line in view
            .effects
            .iter()
            .chain(view.side_effects.iter().flat_map(|s| &s.effects))
        {
            assert!(
                !line.text.contains(['$', '£', '[']),
                "{}: {}",
                def.key,
                line.text
            );
        }
    }
}

#[test]
fn install_blockers_are_the_ones_the_game_calls_blockers() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    for key in [
        "d_massive_glacier",
        "d_active_volcano",
        "d_dangerous_wildlife_blocker",
    ] {
        let view = gd.deposit_type_view(key).unwrap_or_else(|| panic!("{key}"));
        assert!(view.blocker && !view.orbital, "{key}");
        assert!(view.clearing.is_some(), "{key}");
    }
    for key in [
        "d_bubbling_swamp",
        "d_crystalline_caverns",
        "d_alien_pets_deposit",
        "d_energy_2",
        "d_minerals_3",
    ] {
        let view = gd.deposit_type_view(key).unwrap_or_else(|| panic!("{key}"));
        assert!(!view.blocker, "{key}");
        assert!(view.clearing.is_none(), "{key}");
    }
}

#[test]
fn install_side_effects_read_nested_modifiers_and_keep_the_regular_branch() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let gas = gd.deposit_type_view("d_hab_gas_1").expect("d_hab_gas_1");
    let [side] = gas.side_effects.as_slice() else {
        panic!("{:?}", gas.side_effects);
    };
    assert_eq!(side.tech.key, "tech_mine_exotic_gases");
    assert_eq!(
        side.effects
            .iter()
            .map(|e| (e.key.as_str(), e.value))
            .collect::<Vec<_>>(),
        [("job_gas_extractor_add", 100.0)]
    );

    let hatchery = gd
        .deposit_type_view("d_ruined_hatchery")
        .expect("d_ruined_hatchery");
    assert!(
        hatchery
            .effects
            .iter()
            .any(|e| e.key == "planet_max_districts_add" && e.value == -4.0),
        "{:?}",
        hatchery.effects
    );
    assert!(
        hatchery
            .effects
            .iter()
            .any(|e| e.key == "habitability_ceil_add" && e.text.starts_with("-10% ")),
        "{:?}",
        hatchery.effects
    );
}

#[test]
fn install_new_registries_raise_no_diagnostics() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let dirs = [
        "deposits",
        "deposit_categories",
        "static_modifiers",
        "planet_modifiers",
        "colony_types",
        "scripted_variables",
        "planet_classes",
    ];
    let raised: Vec<_> = gd
        .diagnostics
        .iter()
        .filter(|d| {
            let file = match d {
                Diagnostic::Override { to, .. } => to,
                Diagnostic::ParseError { file, .. } | Diagnostic::Unreadable { file, .. } => file,
                _ => return false,
            };
            let file = file.to_string_lossy().replace('\\', "/");
            dirs.iter()
                .any(|dir| file.contains(&format!("common/{dir}/")))
        })
        .collect();
    assert!(raised.is_empty(), "{raised:?}");
}

#[test]
fn a_global_variable_resolves_inside_an_initializer() {
    let (_dir, gd) = common::hand_written(&[
        ("common/scripted_variables/00_gaps.txt", "@moon_gap = 12\n"),
        (
            "common/solar_system_initializers/00_gap.txt",
            "gap_init = {\n\tclass = sc_g\n\tplanet = {\n\t\tclass = pc_barren\n\t\torbit_distance = @moon_gap\n\t}\n}\n",
        ),
        ("localisation/english/gap_l_english.yml", "l_english:\n"),
    ]);
    let init = gd.initializers.get("gap_init").expect("gap_init");
    assert_eq!(init.planets[0].orbit(), Some(12.0));
}

#[test]
fn install_scripted_variables_resolve() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    assert_eq!(gd.variables.get("SR_SMALL"), Some("0.05"));
    assert_eq!(gd.variables.get("DISTRICTS_FROM_SR_DEPOSITS"), Some("3"));
    let caverns = gd
        .deposit_type_view("d_crystalline_caverns")
        .expect("d_crystalline_caverns");
    assert_eq!(caverns.effects[0].value, 3.0);
}

#[test]
fn install_planet_modifier_goes_through_its_static_modifier() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let pm = gd
        .modifier_view("pm_abundant_geothermal_activity")
        .expect("pm_abundant_geothermal_activity");
    assert_eq!(pm.name, "Abundant Geothermal Activity");
    assert_eq!(
        pm.static_modifier.as_deref(),
        Some("abundant_geothermal_activity")
    );
    assert_eq!(
        pm.icon.as_deref(),
        Some("icon:planet_modifiers/pm_drilling_for_gas.dds")
    );
    assert_eq!(
        pm.icon_frame.as_deref(),
        Some("sprite:GFX_modifier_frames#1")
    );
    assert!(
        pm.effects
            .iter()
            .any(|e| e.text == "+4 Max Generator Districts"),
        "{:?}",
        pm.effects
    );

    let timed = gd
        .modifier_view("abundant_geothermal_activity")
        .expect("a timed modifier names its static modifier");
    assert_eq!(timed.effects, pm.effects);
    assert!(gd.modifier_view("pm_nowhere").is_none());

    let (_dir, textures) = common::temp_textures();
    for key in [pm.icon.unwrap(), pm.icon_frame.unwrap()] {
        let view = gd.texture(&textures, &key);
        assert!(view.error.is_none() && view.width > 0, "{view:?}");
    }
}

#[test]
fn install_colony_type_has_a_name_and_an_icon() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.colony_type_views(&["col_fe_colony".to_owned(), "col_nowhere".to_owned()]);
    let [fe] = views.as_slice() else {
        panic!("{views:?}");
    };
    assert_eq!(fe.name, "Fallen Empire Colony");
    assert_eq!(
        fe.icon.as_deref(),
        Some("sprite:GFX_colony_type_normal_colony")
    );
    let (_dir, textures) = common::temp_textures();
    let view = gd.texture(&textures, fe.icon.as_deref().unwrap());
    assert!(view.error.is_none() && view.width > 0, "{view:?}");
}

#[test]
fn install_deposit_art_decodes_and_the_fallbacks_exist() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let (_dir, textures) = common::temp_textures();
    for key in [
        "deposit:d_bubbling_swamp",
        "sprite:GFX_deposit_unknown",
        "sprite:GFX_deposit_blocker_unknown",
    ] {
        let png = gd
            .texture_png(&textures, key)
            .unwrap_or_else(|e| panic!("{key}: {e}"));
        let image = image::load_from_memory(&png).expect("valid PNG");
        assert_eq!(image.dimensions(), (98, 75), "{key}");
    }
    assert!(fs::read_dir(textures.cache_dir()).unwrap().count() >= 3);
}
