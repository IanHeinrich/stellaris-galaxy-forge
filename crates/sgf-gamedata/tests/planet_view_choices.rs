//! The rest of what the planet page reads from the install: variables, modifiers, colony
//! types, models and classes, on the fixture install and then on the real one.

use crate::common;

use std::fs;

use image::GenericImageView;
use sgf_core::ops::ClassChange;
use sgf_gamedata::modifier_choices::ModifierCategory;

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

#[test]
fn real_modifier_choices_offer_features_candidates_and_planet_modifiers() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let choices = gd.modifier_choices();
    let find = |modifier: &str| {
        choices
            .iter()
            .find(|c| c.modifier == modifier)
            .unwrap_or_else(|| panic!("{modifier} is offered"))
    };
    let poor = find("mineral_poor");
    assert_eq!(poor.feature.as_deref(), Some("pm_mineral_poor"));
    assert_eq!(poor.category, ModifierCategory::Feature);
    assert_eq!(poor.view.key, "pm_mineral_poor");
    assert!(!poor.view.effects.is_empty());
    assert_eq!(
        find("terraforming_candidate").category,
        ModifierCategory::Terraforming
    );
    assert!(
        choices.iter().all(|c| c.feature.is_some()
            || c.view.icon.is_some()
            || c.category == ModifierCategory::Terraforming),
        "every plain modifier has its planet modifier icon"
    );
    let keys: std::collections::HashSet<(&str, Option<&str>)> = choices
        .iter()
        .map(|c| (c.modifier.as_str(), c.feature.as_deref()))
        .collect();
    assert_eq!(keys.len(), choices.len(), "each choice once");
    for empire_wide in [
        "difficulty_admiral",
        "food_crisis",
        "ai_fleet",
        "ship_graveyard",
    ] {
        assert!(
            !choices.iter().any(|c| c.modifier == empire_wide),
            "{empire_wide} is not offered"
        );
    }
    assert!((600..1200).contains(&choices.len()), "{}", choices.len());
}

#[test]
fn real_planet_models_offer_the_looks_the_install_gives_planets() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let models = gd.planet_model_choices();
    let find = |entity: &str| {
        models
            .iter()
            .find(|m| m.entity == entity)
            .unwrap_or_else(|| panic!("{entity} is offered"))
    };
    let paradise = find("ocean_paradise_planet_01_entity");
    assert_eq!(paradise.label, "Ocean Paradise");
    assert_eq!(paradise.classes, ["pc_ocean"]);
    let earth = find("desert_planet_earth_entity");
    assert!(earth.label.starts_with("Earth ("), "{}", earth.label);
    assert_eq!(earth.classes, ["pc_desert"]);
    assert_eq!(
        find("previously_terraformed_planet_entity").classes,
        ["pc_continental"]
    );
    assert_eq!(find("gas_giant_02_entity").label, "Gas Giant 2");
    for left_out in [
        "m_star_class_star_entity",
        "infernal_system_crisis_star_entity",
        "pc_molten",
        "habitat_phase_03_entity",
        "ringworld_habitable_entity_01_entity",
        "invisible_turret_entity",
    ] {
        assert!(
            !models.iter().any(|m| m.entity == left_out),
            "{left_out} is not offered"
        );
    }
    assert!(
        models.iter().all(|m| m
            .entity
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')),
        "every model is named outright"
    );
    let labels: std::collections::HashSet<&str> = models.iter().map(|m| m.label.as_str()).collect();
    assert_eq!(labels.len(), models.len(), "each label once");
    assert!((30..120).contains(&models.len()), "{}", models.len());
}

/// Which save planets each class may be given to, from the install's flags, and how many
/// models its `.asset` files number for it.
#[test]
fn install_planet_classes_say_who_may_take_them_and_their_models() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let rule = |class: &str| {
        let rule = gd.planet_class_rule(class).expect(class);
        (rule.change, rule.models)
    };
    for class in ["pc_desert", "pc_continental", "pc_nuked", "pc_gaia"] {
        assert_eq!(rule(class).0, ClassChange::Any, "{class}");
    }
    for class in [
        "pc_barren",
        "pc_gas_giant",
        "pc_asteroid",
        "pc_volcanic",
        "pc_city",
        "pc_hive",
        "pc_machine",
        "pc_gray_goo",
        "pc_infested",
        "pc_ai",
    ] {
        assert_eq!(rule(class).0, ClassChange::Uncolonised, "{class}");
    }
    for class in [
        "pc_g_star",
        "pc_black_hole",
        "pc_pulsar",
        "pc_neutron_star",
        "pc_habitat",
        "pc_ringworld_habitable",
        "pc_ringworld_seam_damaged",
        "pc_shattered_ring_habitable",
        "pc_cosmogenesis_world",
        "pc_ark",
        "pc_shrouded",
        "pc_astral_scar",
    ] {
        assert_eq!(rule(class).0, ClassChange::Never, "{class}");
    }
    assert_eq!(rule("pc_continental").1, 4);
    assert_eq!(rule("pc_barren").1, 3);
    assert_eq!(rule("pc_gas_giant").1, 5);
    assert_eq!(rule("pc_nuked").1, 1);
    assert_eq!(rule("pc_ice_asteroid").1, 1);
    assert!(gd.planet_class_rule("pc_no_such_class").is_none());
}

#[test]
fn install_views_of_several_keys_come_in_order_and_leave_the_unknown_out() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let keys = |keys: &[&str]| -> Vec<String> { keys.iter().map(|k| (*k).to_owned()).collect() };

    let deposits = gd.deposit_type_views(&keys(&[
        "d_massive_glacier",
        "d_no_such_deposit",
        "d_energy_3",
    ]));
    let found: Vec<&str> = deposits.iter().map(|d| d.key.as_str()).collect();
    assert_eq!(found, ["d_massive_glacier", "d_energy_3"]);

    let modifiers = gd.modifier_views(&keys(&[
        "pm_abundant_geothermal_activity",
        "pm_no_such_modifier",
        "abundant_geothermal_activity",
    ]));
    let [planet, timed] = modifiers.as_slice() else {
        panic!("{modifiers:?}");
    };
    assert_eq!(
        planet.static_modifier.as_deref(),
        Some("abundant_geothermal_activity")
    );
    assert_eq!(
        planet.name, timed.name,
        "the pm_ key shares its static modifier's name"
    );
}
