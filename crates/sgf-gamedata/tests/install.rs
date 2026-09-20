//! Against the real Stellaris install when this machine has one; skipped
//! (with a message) otherwise, so CI without the game stays green.

mod common;

/// One line in the log either way, so a run that asserted nothing can be
/// told from one that did. `cargo test -- --nocapture` shows it.
#[test]
fn the_real_install_tests_ran_or_said_why() {
    if common::have_install() {
        println!("a Stellaris install is here: the tests in this file ran");
    } else {
        println!("no Stellaris install: the tests in this file asserted nothing");
    }
}

#[test]
fn vanilla_definitions_and_localisation() {
    let Some(gd) = common::load_real() else {
        return;
    };
    assert!(gd.version.as_deref().is_some_and(|v| v.starts_with('v')));
    assert!(gd.initializers.len() >= 350, "{}", gd.initializers.len());

    let dragon = gd
        .initializers
        .get("guardians_init_dragon")
        .expect("guardians_init_dragon");
    assert!(dragon.flags.iter().any(|f| f == "guardian"));
    assert_eq!(dragon.max_instances, Some(1));
    let voidwyrm = dragon
        .countries
        .iter()
        .find(|c| c.name_key == "NAME_Voidwyrm")
        .expect("NAME_Voidwyrm");
    assert_eq!(voidwyrm.country_type, "guardian_dragon");
    assert_eq!(
        voidwyrm.icon.as_ref().map(|i| i.category.as_str()),
        Some("zoological")
    );
    assert!(
        gd.initializers
            .ancestors("fallen_col_1")
            .iter()
            .any(|i| i.name == "fallen_1")
    );

    let hole = gd.star_classes.get("sc_black_hole").expect("sc_black_hole");
    assert_eq!(hole.texture_icon(), "black_hole");
    assert_eq!(hole.icon_scale, 2.0);
    let binary = gd.star_classes.get("sc_binary_1").expect("sc_binary_1");
    assert_eq!(binary.icon.as_deref(), Some("e_binary_star"));
    assert_eq!(binary.planet_key.as_deref(), Some("pc_a_star"));

    assert_eq!(
        gd.loc.get("NAME_Gamma_Refuge").as_deref(),
        Some("Gamma Refuge")
    );
    assert_eq!(gd.loc.get("NAME_Voidwyrm").as_deref(), Some("Voidwyrm"));
    let sc_g = gd.loc.get("sc_g").expect("sc_g");
    assert!(!sc_g.is_empty() && !sc_g.contains('$'), "{sc_g}");

    assert!(
        gd.country_types
            .get("guardian_dragon")
            .unwrap()
            .is_leviathan()
    );
    assert!(gd.country_types.get("enclave").unwrap().is_enclave);
    assert!(gd.country_types.get("fallen_empire").unwrap().fallen_empire);
    let country_type = |name: &str| gd.country_types.get(name).unwrap();
    assert!(!country_type("enclave").generate_borders);
    assert!(country_type("dormant_marauders").generate_borders);
    assert!(country_type("default").generate_borders);
    assert!(country_type("amoeba").is_space_critter);
    let views = gd.country_type_views();
    assert_eq!(views.len(), gd.country_types.len());
    assert!(views.windows(2).all(|w| w[0].name < w[1].name));
    let amoeba = views.iter().find(|v| v.name == "amoeba").expect("amoeba");
    assert!(amoeba.is_space_critter && amoeba.space_creatures && !amoeba.generate_borders);
}

#[test]
fn resource_icons_resolve_to_registered_sprites() {
    let Some(gd) = common::load_real() else {
        return;
    };
    let icon = |resource: &str| gd.resource_icon(resource);
    assert_eq!(icon("energy").as_deref(), Some("GFX_resource_energy"));
    assert_eq!(icon("minerals").as_deref(), Some("GFX_resource_minerals"));
    assert_eq!(
        icon("physics_research").as_deref(),
        Some("GFX_resource_physics")
    );
    for resource in [
        "engineering_research",
        "trade_value",
        "sr_zro",
        "sr_dark_matter",
        "sr_living_metal",
        "volatile_motes",
        "exotic_gases",
        "rare_crystals",
        "alloys",
        "minor_artifacts",
        "astral_threads",
    ] {
        let sprite = icon(resource).unwrap_or_else(|| panic!("no sprite for {resource}"));
        eprintln!("{resource} -> {sprite}");
        assert!(gd.sprites.get(&sprite).is_some());
    }
    // The texture `icons/resources/nanites.dds` exists, but no `.gfx` file names a sprite for it.
    assert_eq!(icon("nanites"), None);
    assert_eq!(icon("no_such_resource"), None);

    let icons = gd.resource_icons();
    assert!(icons.len() >= 12, "{icons:?}");
    assert!(icons.windows(2).all(|w| w[0].resource < w[1].resource));
    for icon in &icons {
        assert!(gd.sprites.get(&icon.sprite).is_some(), "{icon:?}");
    }
    let produced: std::collections::BTreeSet<&str> = gd
        .deposits
        .iter()
        .flat_map(|d| d.produces.iter().map(|(r, _)| r.as_str()))
        .collect();
    let without_icon: Vec<&str> = produced
        .iter()
        .copied()
        .filter(|r| gd.resource_icon(r).is_none())
        .collect();
    assert_eq!(
        without_icon,
        ["nanites"],
        "nanites is the one deposit resource vanilla names no sprite for",
    );
}
