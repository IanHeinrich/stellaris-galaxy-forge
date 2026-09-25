//! Visual definition registries on the synthetic fixture install, then
//! against the real Stellaris install when this machine has one.

use crate::common;

use sgf_core::format::save::details::DetailsResolver;
use sgf_gamedata::views::{BypassView, ShipSizeView};

#[test]
fn sprites_resolve() {
    let gd = common::cached_fixture();
    assert_eq!(
        gd.sprites.resolve("GFX_fixture_flat", None),
        Some(("gfx/interface/icons/fixture_flat.dds".to_owned(), None))
    );
    assert_eq!(
        gd.sprites.resolve("GFX_fixture_camel", None),
        Some(("gfx/interface/icons/fixture_camel.dds".to_owned(), None))
    );
    assert_eq!(
        gd.sprites.resolve("GFX_fixture_camel", Some(2)),
        Some(("gfx/interface/icons/fixture_camel.dds".to_owned(), Some(2)))
    );
    assert_eq!(gd.sprites.frame_count("GFX_fixture_sheet"), Some(6));
    assert_eq!(
        gd.sprites.frame_count("GFX_fixture_sheet_frame"),
        Some(6),
        "a sheet-frame sprite reports its sheet's frame count"
    );
    assert_eq!(
        gd.sprites.resolve("GFX_fixture_sheet_frame", None),
        Some(("gfx/interface/icons/fixture_sheet.dds".to_owned(), Some(4))),
        "the sheet's file, at the sprite's own default_frame"
    );
    assert_eq!(
        gd.sprites.resolve("GFX_fixture_sheet_frame", Some(2)),
        Some(("gfx/interface/icons/fixture_sheet.dds".to_owned(), Some(2))),
        "an explicit frame overrides default_frame"
    );
    assert_eq!(gd.sprites.resolve("GFX_unknown", None), None);
}

#[test]
fn a_mod_overrides_a_sprite_by_name() {
    let without_mods = common::cached_fixture();
    assert_eq!(
        without_mods.sprites.resolve("GFX_fixture_flat", None),
        Some(("gfx/interface/icons/fixture_flat.dds".to_owned(), None))
    );
    let with_mods = common::cached_fixture_with_mods();
    assert_eq!(
        with_mods.sprites.resolve("GFX_fixture_flat", None),
        Some((
            "gfx/interface/icons/fixture_flat_override.dds".to_owned(),
            None
        ))
    );
}

#[test]
fn colors_read_rgb_and_hsv() {
    let gd = common::cached_fixture();
    let navy = gd.colors.entries.get("fixture_navy").expect("fixture_navy");
    assert_eq!(navy.flag, [10, 20, 30]);
    assert_eq!(navy.map, [40, 50, 60]);
    assert_eq!(navy.ship, [70, 80, 90]);

    let teal = gd.colors.entries.get("fixture_teal").expect("fixture_teal");
    assert_eq!(teal.flag, [71, 179, 179]);
    assert_eq!(teal.map, [71, 179, 179]);
    assert_eq!(teal.ship, [71, 179, 179]);
}

#[test]
fn a_mod_shipping_its_own_colors_txt_supplies_the_palette_and_is_named_as_its_source() {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    let user_dir = dir.path().join("user");
    let flags = install.join("flags");
    std::fs::create_dir_all(install.join("common")).unwrap();
    std::fs::create_dir_all(install.join("localisation")).unwrap();
    std::fs::create_dir_all(&flags).unwrap();
    std::fs::write(
        flags.join("colors.txt"),
        "colors = {\n\tblue = { flag = rgb { 0 0 200 } map = rgb { 0 0 150 } ship = rgb { 0 0 100 } }\n}\n",
    )
    .unwrap();
    common::add_mod(
        &user_dir,
        "palette",
        &[(
            "flags/colors.txt",
            "colors = {\n\tmod_teal = { flag = rgb { 0 128 128 } map = rgb { 0 100 100 } ship = rgb { 0 80 80 } }\n}\n",
        )],
    );
    let load = |mods: &[&str]| {
        common::enable(&user_dir, mods);
        let opts = sgf_gamedata::LoadOptions {
            install: Some(install.clone()),
            user_dir: Some(user_dir.clone()),
            language: "english".to_owned(),
            mods: true,
        };
        sgf_gamedata::load(&opts, &mut |_| {}).expect("the throwaway install loads")
    };

    let vanilla = load(&[]);
    assert!(vanilla.colors.entries.get("blue").is_some());
    assert_eq!(vanilla.colors.source, None);

    let modded = load(&["palette"]);
    assert!(
        modded.colors.entries.get("blue").is_none(),
        "the mod's file wins whole"
    );
    assert_eq!(
        modded.colors.entries.get("mod_teal").map(|c| c.map),
        Some([0, 100, 100])
    );
    assert_eq!(modded.colors.source.as_deref(), Some("palette"));
}

#[test]
fn deposit_produces_sums_repeated_keys_and_skips_triggers() {
    let gd = common::cached_fixture();
    let glow = gd.deposits.get("d_glow_2").expect("d_glow_2");
    assert_eq!(glow.produces, vec![("glow".to_owned(), 2.0)]);
    assert!(!glow.is_for_colonizable);

    let blocker = gd
        .deposits
        .get("d_fixture_blocker")
        .expect("d_fixture_blocker");
    assert!(blocker.produces.is_empty());
    assert!(
        !blocker.is_for_colonizable,
        "absent is_for_colonizable reads as no, as the game's README says"
    );
    assert!(!blocker.orbital(), "no station works it");
    assert_eq!(blocker.category.as_deref(), Some("deposit_cat_blockers"));
}

#[test]
fn planet_class_colonizable_vs_star() {
    let gd = common::cached_fixture();
    let meadow = gd.planet_classes.get("pc_meadow").expect("pc_meadow");
    assert!(meadow.colonizable);
    assert!(!meadow.star);
    assert_eq!(meadow.climate.as_deref(), Some("wet"));

    let star = gd
        .planet_classes
        .get("pc_fixture_star")
        .expect("pc_fixture_star");
    assert!(star.star);
    assert!(!star.colonizable);
}

#[test]
fn a_planet_list_is_no_planet_class_and_two_files_writing_lists_override_nothing() {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    for (rel, text) in [
        (
            "common/planet_classes/00_classes.txt",
            "pc_rock = {\n\tplanet_size = 10\n}\nrandom_list = {\n\tname = \"rl_one\"\n\tplanets = { pc_rock }\n}\n",
        ),
        (
            "common/planet_classes/01_more.txt",
            "pc_ice = {\n\tplanet_size = 10\n}\nrandom_list = {\n\tname = \"rl_two\"\n\tplanets = { pc_ice }\n}\n",
        ),
        ("localisation/english/fx_l_english.yml", "l_english:\n"),
    ] {
        let file = install.join(rel);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, text).unwrap();
    }
    let opts = sgf_gamedata::LoadOptions {
        install: Some(install),
        user_dir: Some(dir.path().join("user")),
        language: "english".to_owned(),
        mods: false,
    };
    let gd = sgf_gamedata::load(&opts, &mut |_| {}).expect("the hand-written install loads");
    let classes: Vec<&str> = gd.planet_classes.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(classes, ["pc_ice", "pc_rock"]);
    assert_eq!(gd.planet_lists.len(), 2);
    assert!(gd.diagnostics.is_empty(), "{:?}", gd.diagnostics);
}

#[test]
fn starbase_level_frame_and_negative_frame() {
    let gd = common::cached_fixture();
    let hut = gd
        .starbase_levels
        .get("starbase_level_hut")
        .expect("starbase_level_hut");
    assert_eq!(hut.icon_frame, Some(2));

    let roamer = gd
        .starbase_levels
        .get("starbase_level_roamer")
        .expect("starbase_level_roamer");
    assert_eq!(roamer.icon_frame, None, "icon_frame = -1 means none");
    assert!(roamer.empire_shield);
    assert!(!hut.empire_shield);
}

#[test]
fn ship_size_icon_is_read_and_absent_icon_is_none() {
    let gd = common::cached_fixture();
    let hut = gd.ship_sizes.get("starbase_hut").expect("starbase_hut");
    assert_eq!(hut.icon.as_deref(), Some("ship_size_military_1"));

    let roamer = gd
        .ship_sizes
        .get("starbase_roamer")
        .expect("starbase_roamer");
    assert_eq!(roamer.icon, None, "a ship size without an icon field");

    let view = ShipSizeView::from(hut);
    assert_eq!(view.key, "starbase_hut");
    assert_eq!(view.icon.as_deref(), Some("ship_size_military_1"));
}

#[test]
fn a_mod_overrides_a_ship_size_icon() {
    let without_mods = common::cached_fixture();
    assert_eq!(
        without_mods
            .ship_sizes
            .get("science")
            .unwrap()
            .icon
            .as_deref(),
        Some("ship_size_science")
    );
    let with_mods = common::cached_fixture_with_mods();
    assert_eq!(
        with_mods.ship_sizes.get("science").unwrap().icon.as_deref(),
        Some("ship_size_science_modded")
    );
}

#[test]
fn bypass_icon_frame_is_read_and_an_absent_frame_is_none() {
    let gd = common::cached_fixture();
    let gateway = gd.bypasses.get("fixture_gateway").expect("fixture_gateway");
    assert_eq!(gateway.icon_frame, Some(25));

    let rift = gd.bypasses.get("fixture_rift").expect("fixture_rift");
    assert_eq!(
        rift.icon_frame, None,
        "a bypass without an icon_frame field"
    );

    let view = BypassView::from(gateway);
    assert_eq!(view.key, "fixture_gateway");
    assert_eq!(view.icon_frame, Some(25));
}

#[test]
fn defines_survive_trailing_comments() {
    let gd = common::cached_fixture();
    assert_eq!(gd.border.system_radius, 40.0);
    assert_eq!(gd.border.hyperlane_thickness, 15.0);
}

#[test]
fn resolver_distinguishes_orbital_from_colonizable_and_unknown() {
    let gd = common::cached_fixture();
    assert_eq!(
        DetailsResolver::deposit_produces(gd, "d_glow_2"),
        Some(vec![("glow".to_owned(), 2.0)])
    );
    assert_eq!(
        DetailsResolver::deposit_produces(gd, "d_fixture_blocker"),
        None
    );
    assert_eq!(DetailsResolver::deposit_produces(gd, "d_unknown"), None);

    assert_eq!(
        DetailsResolver::planet_habitable(gd, "random_colonizable"),
        Some(true)
    );
    assert_eq!(
        DetailsResolver::planet_habitable(gd, "random_non_colonizable"),
        Some(false)
    );
    assert_eq!(DetailsResolver::planet_habitable(gd, "random"), None);
    assert_eq!(
        DetailsResolver::planet_habitable(gd, "ideal_planet_class"),
        Some(true)
    );
    assert_eq!(
        DetailsResolver::planet_habitable(gd, "pc_meadow"),
        Some(true)
    );
    assert_eq!(
        DetailsResolver::planet_habitable(gd, "pc_fixture_star"),
        Some(false)
    );
    assert_eq!(DetailsResolver::planet_habitable(gd, "pc_unknown"), None);
}

#[test]
fn vanilla_registries() {
    let Some(gd) = common::load_real() else {
        return;
    };
    assert!(gd.sprites.len() >= 76, "{}", gd.sprites.len());
    assert!(gd.deposits.len() >= 580, "{}", gd.deposits.len());
    assert_eq!(gd.planet_classes.len(), 69, "{}", gd.planet_classes.len());
    assert!(gd.planet_classes.iter().all(|c| c.key.starts_with("pc_")));
    assert_eq!(gd.colors.entries.len(), 72, "{}", gd.colors.entries.len());

    let blue = gd.colors.entries.get("blue").expect("blue");
    assert_eq!(blue.map, [46, 63, 153]);

    let continental = gd
        .planet_classes
        .get("pc_continental")
        .expect("pc_continental");
    assert!(continental.colonizable);
    let g_star = gd.planet_classes.get("pc_g_star").expect("pc_g_star");
    assert!(g_star.star);

    let energy_3 = gd.deposits.get("d_energy_3").expect("d_energy_3");
    assert_eq!(energy_3.produces, vec![("energy".to_owned(), 3.0)]);
    assert!(!energy_3.is_for_colonizable);

    let citadel = gd
        .starbase_levels
        .get("starbase_level_citadel")
        .expect("starbase_level_citadel");
    assert_eq!(citadel.icon_frame, Some(5));
    let swarm = gd
        .starbase_levels
        .get("starbase_level_swarm")
        .expect("starbase_level_swarm");
    assert_eq!(swarm.icon_frame, None);

    let corvette = gd.ship_sizes.get("corvette").expect("corvette");
    assert_eq!(corvette.icon.as_deref(), Some("ship_size_military_1"));

    for (key, frame) in [
        ("gateway", 25),
        ("quantum_catapult", 25),
        ("shroud_tunnel", 25),
        ("wormhole", 12),
        ("starlit_wormhole", 59),
        ("lgate", 30),
        ("relay_bypass", 30),
    ] {
        let bypass = gd.bypasses.get(key).unwrap_or_else(|| panic!("{key}"));
        assert_eq!(bypass.icon_frame, Some(frame), "{key}");
    }

    assert_eq!(gd.border.system_radius, 35.0);
    assert_eq!(gd.border.hyperlane_thickness, 20.0);

    assert_eq!(
        gd.sprites.resolve("GFX_planet_type_continental", None),
        Some((
            "gfx/interface/icons/planet_type_icons.dds".to_owned(),
            Some(4)
        ))
    );
    assert_eq!(
        gd.sprites.frame_count("GFX_planet_type_continental"),
        Some(46)
    );
    assert_eq!(
        gd.sprites.resolve("GFX_resource_energy", None),
        Some(("gfx/interface/icons/resources/energy.dds".to_owned(), None))
    );
    eprintln!(
        "GFX_starbase_ship_size_small frame count: {:?}",
        gd.sprites.frame_count("GFX_starbase_ship_size_small")
    );
}
