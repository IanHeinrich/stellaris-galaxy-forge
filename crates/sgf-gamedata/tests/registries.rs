//! Visual definition registries on the synthetic fixture install, then
//! against the real Stellaris install when this machine has one.

use crate::common;

use sgf_core::format::save::details::DetailsResolver;
use sgf_gamedata::registries::asteroid_belts::BeltLook;
use sgf_gamedata::views::{BypassView, GameDataSummary, ShipSizeView, TerraformCandidateView};

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

/// The first `flag` (or any other duplicated colour key) wins, as `Def::scalar` reads every
/// other field of the same definition.
#[test]
fn a_duplicate_colour_key_reads_the_first_one() {
    let (_dir, gd) = common::hand_written(&[
        (
            "flags/colors.txt",
            "colors = {\n\tduped = { flag = rgb { 1 2 3 } flag = rgb { 9 9 9 } map = rgb { 0 0 0 } ship = rgb { 0 0 0 } }\n}\n",
        ),
        ("common/.keep", ""),
    ]);
    let duped = gd.colors.entries.get("duped").expect("duped");
    assert_eq!(duped.flag, [1, 2, 3]);
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
        common::load_tree(&install, Some(&user_dir), true)
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
    let (_dir, gd) = common::hand_written(&[
        (
            "common/planet_classes/00_classes.txt",
            "pc_rock = {\n\tplanet_size = 10\n}\nrandom_list = {\n\tname = \"rl_one\"\n\tplanets = { pc_rock }\n}\n",
        ),
        (
            "common/planet_classes/01_more.txt",
            "pc_ice = {\n\tplanet_size = 10\n}\nrandom_list = {\n\tname = \"rl_two\"\n\tplanets = { pc_ice }\n}\n",
        ),
        ("localisation/english/fx_l_english.yml", "l_english:\n"),
    ]);
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
    assert_eq!(gd.border.moon_scale, 0.65);
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

/// An install whose terraform links exercise the parser: `NOT`/`NOR` and checks outside
/// `from` are skipped, a later `game_rules` file's rule wins, a candidate the static
/// modifiers do not define is dropped, a candidate needs what most of its links ask for, and
/// an `OR` in a condition is one requirement, its alternatives in any order.
const TERRAFORM_FILES: [(&str, &str); 6] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_rock = {}\npc_fx_ice = {}\npc_fx_old = {}\npc_fx_plain = {}\n",
    ),
    (
        "common/static_modifiers/00_fx.txt",
        "fx_candidate = { icon = x }\nfx_cold_candidate = { icon = x }\nfx_old_candidate = { icon = x }\n",
    ),
    (
        "common/game_rules/00_fx.txt",
        "is_terraforming_candidate = {\n\tOR = { has_modifier = fx_old_candidate }\n}\n",
    ),
    (
        "common/game_rules/01_fx.txt",
        "is_terraforming_candidate = {\n\tOR = {\n\t\thas_modifier = fx_candidate\n\t\thas_modifier = fx_undefined_candidate\n\t\thas_modifier = fx_cold_candidate\n\t}\n}\n",
    ),
    (
        "common/terraform/00_fx.txt",
        "terraform_link = {\n\tfrom = pc_fx_rock\n\tpotential = {\n\t\thas_modifier = fx_cold_candidate\n\t\tfrom = {\n\t\t\tNOT = { has_modifier = fx_cold_candidate }\n\t\t\tNOR = { has_modifier = fx_cold_candidate }\n\t\t\tAND = { has_modifier = fx_candidate }\n\t\t}\n\t}\n\tcondition = {\n\t\thas_ascension_perk = ap_fx_shaper\n\t\thas_technology = tech_fx_restore\n\t\tNOT = { has_technology = tech_fx_never }\n\t}\n}\n\
         terraform_link = {\n\tfrom = pc_fx_ice\n\tpotential = { from = { has_modifier = fx_undefined_candidate } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_ice\n\tpotential = { OR = { from = { has_modifier = fx_cold_candidate } } }\n\tcondition = { has_technology = tech_fx_restore has_ascension_perk = ap_fx_cold OR = { has_technology = tech_fx_alt has_ascension_perk = ap_fx_alt has_country_flag = fx_flag } NOT = { OR = { has_technology = tech_fx_never } } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_plain\n\tpotential = { from = { has_modifier = fx_cold_candidate } }\n\tcondition = { has_ascension_perk = ap_fx_cold has_technology = tech_fx_restore AND = { OR = { has_country_flag = fx_flag has_ascension_perk = ap_fx_alt has_technology = tech_fx_alt } } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_plain\n\tpotential = { has_ascension_perk = ap_fx_other from = { has_modifier = fx_cold_candidate } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_old\n\tpotential = { from = { has_modifier = fx_old_candidate } }\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n tech_fx_restore:0 \"Fx Restoration\"\n ap_fx_cold:0 \"Cold Hands\"\n",
    ),
];

#[test]
fn terraform_links_read_the_candidate_rule_and_the_links_that_check_it() {
    let (_dir, gd) = common::hand_written(&TERRAFORM_FILES);
    let candidate = |class: &str| gd.terraform_links.candidate(class, &gd.static_modifiers);
    assert_eq!(candidate("pc_fx_rock"), Some("fx_candidate".to_owned()));
    assert_eq!(candidate("pc_fx_ice"), Some("fx_cold_candidate".to_owned()));
    assert_eq!(
        candidate("pc_fx_old"),
        None,
        "an earlier rule file's candidate"
    );

    let views: Vec<(String, Option<String>)> = gd
        .planet_class_views()
        .into_iter()
        .map(|v| (v.key, v.terraform_candidate))
        .collect();
    assert!(
        views.contains(&("pc_fx_rock".to_owned(), Some("fx_candidate".to_owned()))),
        "{views:?}"
    );

    let requires = |modifier: &str, names: &[&str]| TerraformCandidateView {
        modifier: modifier.to_owned(),
        requires: names.iter().map(|&n| n.to_owned()).collect(),
    };
    assert_eq!(
        gd.terraform_candidate_views(),
        [
            requires("fx_candidate", &["Fx Restoration", "Ap Fx Shaper"]),
            requires(
                "fx_cold_candidate",
                &[
                    "Fx Restoration",
                    "Cold Hands",
                    "Tech Fx Alt or Ap Fx Alt or another condition"
                ],
            ),
        ]
    );
}

/// Two links that check one candidate and ask for different techs, the second checking it
/// twice.
const TIED_FILES: [(&str, &str); 5] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_a = {}\npc_fx_b = {}\n",
    ),
    (
        "common/static_modifiers/00_fx.txt",
        "fx_candidate = { icon = x }\n",
    ),
    (
        "common/game_rules/00_fx.txt",
        "is_terraforming_candidate = { OR = { has_modifier = fx_candidate } }\n",
    ),
    (
        "common/terraform/00_fx.txt",
        "terraform_link = {\n\tfrom = pc_fx_a\n\tpotential = { from = { has_modifier = fx_candidate } }\n\tcondition = { has_technology = tech_fx_first }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_b\n\tpotential = {\n\t\tfrom = { has_modifier = fx_candidate }\n\t\tOR = { from = { has_modifier = fx_candidate } }\n\t}\n\tcondition = { has_technology = tech_fx_second }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

#[test]
fn a_tie_between_requirement_sets_goes_to_the_first_seen_and_a_link_votes_once() {
    let (_dir, gd) = common::hand_written(&TIED_FILES);
    assert_eq!(
        gd.terraform_candidate_views(),
        [TerraformCandidateView {
            modifier: "fx_candidate".to_owned(),
            requires: vec!["Tech Fx First".to_owned()],
        }]
    );
}

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

#[test]
fn vanilla_registries() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    assert!(gd.sprites.len() >= 76, "{}", gd.sprites.len());
    assert!(gd.deposits.len() >= 580, "{}", gd.deposits.len());

    assert!(
        gd.asteroid_belts.get("rocky_asteroid_belt").is_some(),
        "{:?}",
        gd.asteroid_belts.iter().map(|b| &b.key).collect::<Vec<_>>()
    );
    for init in gd.initializers.iter() {
        for belt in &init.asteroid_belts {
            assert!(
                gd.asteroid_belts.get(&belt.kind).is_some(),
                "{} names undeclared belt kind {}",
                init.name,
                belt.kind
            );
        }
    }

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

    let candidate = |class: &str| gd.terraform_links.candidate(class, &gd.static_modifiers);
    for class in ["pc_barren", "pc_barren_cold", "pc_gray_goo"] {
        assert_eq!(
            candidate(class),
            Some("terraforming_candidate".to_owned()),
            "{class}"
        );
    }
    assert_eq!(
        candidate("pc_frozen"),
        Some("frozen_terraforming_candidate".to_owned())
    );
    assert_eq!(
        candidate("pc_toxic"),
        Some("toxic_terraforming_candidate".to_owned())
    );
    for class in ["pc_continental", "pc_desert"] {
        assert_eq!(candidate(class), None, "{class}");
    }
    let requires = |modifier: &str, names: &[&str]| TerraformCandidateView {
        modifier: modifier.to_owned(),
        requires: names.iter().map(|&n| n.to_owned()).collect(),
    };
    assert_eq!(
        gd.terraform_candidate_views(),
        [
            requires("terraforming_candidate", &["Climate Restoration"]),
            requires(
                "frozen_terraforming_candidate",
                &["Climate Restoration", "Hydrocentric"]
            ),
            requires(
                "toxic_terraforming_candidate",
                &["Climate Restoration", "Detox or another condition"],
            ),
        ]
    );

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
    assert_eq!(gd.border.moon_scale, 0.7);

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
