//! Which megastructure types the add dialog offers, and the swaps a stage's completion makes:
//! on hand-written types, on the real install, and on Gigastructural Engineering when the
//! enabled playset has it.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::registries::megastructure_offers::{HiddenWhy, Offer};
use sgf_gamedata::registries::megastructure_swaps::Swap;
use sgf_gamedata::registries::megastructures::{MegastructureDef, Placement, Unsupported};

fn mega<'g>(gd: &'g GameData, key: &str) -> &'g MegastructureDef {
    gd.megastructures
        .get(key)
        .unwrap_or_else(|| panic!("{key}"))
}

fn hidden(why: HiddenWhy) -> Offer {
    Offer::Hidden { why }
}

const BUILT: &str = "resources = { cost = { alloys = 100 } }\n\tprerequisites = { tech_fx }";

fn types() -> String {
    format!(
        "fx_player = {{
	{BUILT}
	potential = {{ is_ai = no is_country_type = default }}
	country_modifier = {{ fx_research = 0.1 fx_unity = 2 }}
}}
fx_ai_only = {{
	{BUILT}
	potential = {{ is_ai = yes }}
}}
fx_scripted = {{
	{BUILT}
	potential = {{ always = no }}
}}
fx_free = {{
	potential = {{ always = yes }}
}}
fx_settings = {{
	{BUILT}
	potential = {{ NOR = {{ has_global_flag = fx_a_off has_global_flag = fx_b_off }} }}
}}
fx_settings_2 = {{
	upgrade_from = {{ fx_settings }}
	resources = {{ cost = {{ alloys = 100 }} }}
}}
fx_cannon_0 = {{
	{BUILT}
}}
fx_cannon_1 = {{
	upgrade_from = {{ fx_cannon_0 fx_cannon_aiming }}
	resources = {{ cost = {{ alloys = 100 }} }}
}}
fx_cannon_aiming = {{
	upgrade_from = {{ fx_cannon_1 }}
}}
fx_wreck_ruined = {{
	potential = {{ always = no }}
}}
fx_wreck_restored = {{
	{BUILT}
	upgrade_from = {{ fx_wreck_ruined }}
	on_build_complete = {{
		fx_raise_fleet = {{ OWNER = from }}
		remove_megastructure = fromfrom
	}}
}}
fx_lonely_ruined = {{
	potential = {{ always = no }}
}}
fx_harvest = {{
	{BUILT}
	on_build_complete = {{
		from = {{ add_resource = {{ minerals = 100 }} }}
		remove_megastructure = fromfrom
	}}
}}
fx_gun_0 = {{
	{BUILT}
}}
fx_gun_1_fake = {{
	upgrade_from = {{ fx_gun_0 }}
	resources = {{ cost = {{ alloys = 100 }} }}
	on_build_complete = {{
		fromfrom = {{ upgrade_megastructure_to = fx_gun_1 finish_upgrade = yes }}
	}}
}}
fx_gun_1 = {{
	potential = {{ always = no }}
	on_build_complete = {{
		fromfrom.planet = {{ change_pc = pc_fx_barren }}
	}}
}}
fx_sphere_0 = {{
	{BUILT}
	on_build_complete = {{
		if = {{
			limit = {{ fromfrom.planet = {{ fx_is_hot_star = yes }} }}
			spawn_megastructure = {{ type = \"fx_sphere_0_hot\" }}
			remove_megastructure = fromfrom
		}}
		if = {{
			limit = {{ has_global_flag = fx_scaling }}
			fromfrom = {{
				if = {{ limit = {{ planet = {{ is_planet_class = pc_fx_red }} }} upgrade_megastructure_to = fx_sphere_0_red }}
				else_if = {{ limit = {{ planet = {{ fx_is_cool_star = yes }} }} upgrade_megastructure_to = fx_sphere_0_cool }}
				else = {{ upgrade_megastructure_to = fx_sphere_0_other }}
			}}
		}}
		else = {{
			fromfrom = {{ upgrade_megastructure_to = fx_sphere_0_basic }}
		}}
		if = {{
			limit = {{ fromfrom.planet = {{ has_modifier = fx_shiny }} }}
			fromfrom = {{ upgrade_megastructure_to = fx_sphere_0_shiny }}
		}}
	}}
}}
"
    )
}

const TRIGGERS: &str = "fx_is_hot_star = {
	optimize_memory
	or = {
		is_planet_class = pc_fx_blue
		is_planet_class = pc_fx_white
	}
}
fx_is_cool_star = {
	Or = { is_planet_class = pc_fx_red is_planet_class = pc_fx_brown }
}
";

const EFFECTS: &str = "fx_raise_fleet = {
	$OWNER$ = { create_fleet = { name = fx_fleet } }
}
";

fn fixture() -> (tempfile::TempDir, GameData) {
    common::hand_written(&[
        ("common/megastructures/fx.txt", &types()),
        ("common/scripted_triggers/fx.txt", TRIGGERS),
        ("common/scripted_effects/fx.txt", EFFECTS),
    ])
}

/// A type is offered when a player starts it from the build menu, and every stage after it
/// is offered too. A `potential` only an AI or a script passes hides it, as does a type with
/// no cost or technology.
#[test]
fn a_type_is_offered_when_a_player_builds_it() {
    let (_dir, gd) = fixture();
    let player = mega(&gd, "fx_player");
    assert_eq!(
        player.offer,
        Offer::Offered,
        "is_ai = no and the default country type"
    );
    assert_eq!(
        player.country_modifier,
        [
            ("fx_research".to_owned(), 0.1),
            ("fx_unity".to_owned(), 2.0)
        ]
    );
    assert_eq!(mega(&gd, "fx_ai_only").offer, hidden(HiddenWhy::NotBuilt));
    assert_eq!(mega(&gd, "fx_scripted").offer, hidden(HiddenWhy::NotBuilt));
    assert_eq!(
        mega(&gd, "fx_free").offer,
        hidden(HiddenWhy::NotBuilt),
        "no cost and no technology"
    );
    assert_eq!(
        mega(&gd, "fx_settings_2").offer,
        Offer::Offered,
        "a later stage needs no technology of its own"
    );
}

/// A global flag in the `potential` never hides a type: flags only pick the variant a swap
/// writes.
#[test]
fn a_global_flag_in_the_potential_does_not_hide_the_family() {
    let (_dir, gd) = fixture();
    assert_eq!(mega(&gd, "fx_settings").offer, Offer::Offered);
    assert_eq!(mega(&gd, "fx_settings_2").offer, Offer::Offered);
}

/// A stage on a cycle of `upgrade_from` is a state of the finished structure unless the
/// cycle is entered at it.
#[test]
fn a_stage_on_an_upgrade_cycle_is_a_state() {
    let (_dir, gd) = fixture();
    assert_eq!(mega(&gd, "fx_cannon_1").offer, Offer::Offered);
    assert_eq!(
        mega(&gd, "fx_cannon_aiming").offer,
        hidden(HiddenWhy::State)
    );
}

/// A wreck stays while its repair, which removes it and leaves a fleet through a scripted
/// effect, is hidden. A ruin nothing repairs is hidden, and so is a completion that removes
/// the row and leaves nothing.
#[test]
fn a_wreck_is_offered_and_its_repair_is_not() {
    let (_dir, gd) = fixture();
    assert_eq!(mega(&gd, "fx_wreck_ruined").offer, Offer::Offered);
    assert_eq!(
        mega(&gd, "fx_wreck_restored").offer,
        hidden(HiddenWhy::LeavesFleet)
    );
    assert_eq!(
        mega(&gd, "fx_lonely_ruined").offer,
        hidden(HiddenWhy::RuinWithoutRestore)
    );
    assert_eq!(
        mega(&gd, "fx_harvest").offer,
        hidden(HiddenWhy::LeavesNothing)
    );
}

fn swap(into: &str) -> Swap {
    Swap {
        into: into.to_owned(),
        flags: Vec::new(),
        no_flags: Vec::new(),
        classes: None,
        not_classes: Vec::new(),
        resolved: true,
    }
}

fn names(keys: &[&str]) -> Vec<String> {
    keys.iter().map(|key| (*key).to_owned()).collect()
}

/// A completion's swaps, in the order written, each with the flags and star classes every
/// branch on the way asks: a spawn beside the row's removal and an upgrade inside
/// `fromfrom`, an `else_if` the negation of the branch before it, an `else` of all of them,
/// and a lowercase `or` in a scripted trigger. A condition that is neither leaves the swap
/// unresolved.
#[test]
fn a_completion_swaps_its_row_by_flag_and_star_class() {
    let (_dir, gd) = fixture();
    let sphere = mega(&gd, "fx_sphere_0");
    let hot = names(&["pc_fx_blue", "pc_fx_white"]);
    let red = names(&["pc_fx_red"]);
    let scaling = names(&["fx_scaling"]);
    assert_eq!(
        sphere.swaps,
        [
            Swap {
                classes: Some(hot),
                ..swap("fx_sphere_0_hot")
            },
            Swap {
                flags: scaling.clone(),
                classes: Some(red.clone()),
                ..swap("fx_sphere_0_red")
            },
            Swap {
                flags: scaling.clone(),
                classes: Some(names(&["pc_fx_red", "pc_fx_brown"])),
                not_classes: red.clone(),
                ..swap("fx_sphere_0_cool")
            },
            Swap {
                flags: scaling.clone(),
                not_classes: names(&["pc_fx_red", "pc_fx_brown"]),
                ..swap("fx_sphere_0_other")
            },
            Swap {
                no_flags: scaling,
                ..swap("fx_sphere_0_basic")
            },
            Swap {
                resolved: false,
                ..swap("fx_sphere_0_shiny")
            },
        ]
    );
    assert_eq!(
        sphere.turns_into,
        names(&[
            "fx_sphere_0_hot",
            "fx_sphere_0_red",
            "fx_sphere_0_cool",
            "fx_sphere_0_other",
            "fx_sphere_0_basic",
            "fx_sphere_0_shiny",
        ])
    );
}

/// A stage whose completion always swaps it for another type is placed as that type, which is
/// what the dialog writes for it.
#[test]
fn a_stage_that_always_swaps_takes_the_swapped_types_placement() {
    let (_dir, gd) = fixture();
    let unknown_class = Placement::Unsupported {
        why: Unsupported::FixedClass {
            class: "pc_fx_barren".to_owned(),
        },
    };
    assert_eq!(
        mega(&gd, "fx_gun_1").placement,
        unknown_class,
        "the fixture defines no pc_fx_barren"
    );
    assert_eq!(mega(&gd, "fx_gun_1_fake").swaps, [swap("fx_gun_1")]);
    assert_eq!(mega(&gd, "fx_gun_1_fake").placement, unknown_class);
    assert_eq!(
        mega(&gd, "fx_gun_0").placement,
        Placement::Body { star_only: false }
    );
}

/// The base game's families as the add dialog offers them, and the types it hides.
#[test]
fn the_installs_types_are_offered_as_a_player_builds_them() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let offered = |key: &str| mega(gd, key).offer == Offer::Offered;
    for key in [
        "think_tank_0",
        "think_tank_3",
        "think_tank_ruined",
        "think_tank_restored",
        "dyson_sphere_0",
        "dyson_sphere_5",
        "dyson_sphere_ruined",
        "dyson_swarm_3",
        "matter_decompressor_4",
        "mega_shipyard_3",
        "mega_art_installation_4",
        "interstellar_assembly_4",
        "strategic_coordination_center_3",
        "spy_orb_4",
        "quantum_catapult_3",
        "orbital_arc_furnace_4",
        "orbital_arc_furnace_destroyed",
        "hyper_relay",
        "gateway_0",
        "gateway_final",
        "gateway_ruined",
        "orbital_ring",
        "orbital_ring_ruined",
        "habitat_central_complex",
        "grand_archive_0",
        "dyson_gun_0",
        "cosmogenesis_world_0",
        "deep_space_citadel_0",
        "ring_world_1",
    ] {
        assert!(offered(key), "{key}: {:?}", mega(gd, key).offer);
    }
    let not_built = [
        "star_eater_dummy",
        "collossus_mammalian_dummy",
        "galactic_crucible_dummy",
        "arkship_civilian_dummy",
        "paladin_dummy",
        "think_tank_4",
        "habitat_major_orbital",
        "habitat_minor_orbital",
        "lgate_base",
    ];
    for key in not_built {
        assert_eq!(mega(gd, key).offer, hidden(HiddenWhy::NotBuilt), "{key}");
    }
    for key in [
        "civilian_arkship_megastructure",
        "science_arkship_megastructure",
        "military_arkship_megastructure",
    ] {
        assert_eq!(mega(gd, key).offer, hidden(HiddenWhy::ShipEntity), "{key}");
    }
    for key in [
        "gateway_derelict",
        "dyson_sphere_permanently_ruined",
        "think_tank_permanently_ruined",
        "arkship_ruined",
        "crisis_sphere_ruined",
    ] {
        assert_eq!(
            mega(gd, key).offer,
            hidden(HiddenWhy::RuinWithoutRestore),
            "{key}"
        );
    }
    for key in [
        "crisis_sphere_0",
        "crisis_sphere_4",
        "galactic_crucible_0",
        "galactic_crucible_5",
        "cosmogenesis_needle",
        "behemoth_egg",
        "behemoth_chrysalis",
        "behemoth_chrysalis_big",
        "dyson_sphere_disco",
        "dyson_sphere_disco_restored",
        "shroud_seal",
        "waystation_megastructure",
    ] {
        assert!(!offered(key), "{key}");
    }
    assert_eq!(
        mega(gd, "think_tank_3").country_modifier,
        [("all_technology_research_speed".to_owned(), 0.15)]
    );
}

/// Gigastructural Engineering's families as the audit sorts them, its settings flags, its
/// star-class swaps, whose stages stand as the plain stages do, and its wrecks. Runs with
/// `SGF_PLAYSET=1` when the enabled mods include Giga.
#[test]
fn gigas_types_are_offered_as_the_audit_sorts_them() {
    let Some(gd) = common::giga() else {
        return;
    };
    let offered = |key: &str| mega(gd, key).offer == Offer::Offered;
    for key in [
        "asteroid_artillery_0",
        "asteroid_artillery_ruined",
        "asteroid_manufactory_0",
        "atmosphere_shredder_3",
        "atmosphere_shredder_ruined",
        "automated_stripmine_1",
        "crystal_megabore_1",
        "kugelblitz_3",
        "macro_test_site_3",
        "orbital_artificial_eco_3",
        "orbital_naval_logistics_office_1",
        "planetary_seeder_nexus_3",
        "succ_1",
        "the_vat_4",
        "eq_shipyard_2",
        "ehof_megastructure_phase4",
        "ehof_megastructure_ruined",
        "fusion_suppressor_5",
        "terraform_shattered_0",
        "lunar_disco_ball_2",
        "maginot_world_0",
        "neutronium_gigaforge_3",
        "penrose_sphere_3",
        "planetary_computer_1",
        "planetary_drive_yard_1_shipyard",
        "psychic_beacon_3",
        "psychic_hypersiphon_2",
        "star_lifter_0",
        "star_lifter_5",
        "stellar_ring_habitat_2",
        "substellar_compressor_2",
        "terraform_site_0",
        "yggdrasil_orchid_3",
        "alderson_disk_0",
        "planetcraft_printer_3",
        "ringworld_titanic_0",
        "hrae_mc_4",
        "hyperstructural_ass_4",
        "lunar_macroreplicator_2",
        "matrioshka_brain_0_g_star",
        "nicoll_beam_4",
        "nidavellir_forge_4",
        "birch_world_3",
        "quasi_stellar_obliterator_6",
        "supermassive_ehof_3",
        "dyson_swarm_3",
        "dyson_sphere_5",
        "habitat_central_complex",
        "orbital_ring_ruined",
        "giga_battleship_ruined",
        "giga_titan_ruined",
        "giga_juggernaut_ruined",
        "giga_colossus_ruined",
        "aeternum_planetcraft_ruined",
    ] {
        assert!(offered(key), "{key}: {:?}", mega(gd, key).offer);
    }
    for key in [
        "frameworld_outpost_construction",
        "frameworld_harvest_0",
        "orbital_elysium_0",
        "orbital_elysium_origin_platform_1",
        "asteroid_manufactory_ai_alloys",
        "asteroid_artillery_config",
        "interstellar_habitat_0",
        "interstellar_habitat_3",
        "interstellar_habitat_5",
        "kaiser_moon_0",
        "kaiser_planetcraft_1",
        "moon_printer_orbital_mass_harvester_0",
        "blokkat_gigarelay_0",
        "blokkat_gigarelay_1",
        "blokkat_gigarelay_2",
        "frameworld_decompressor_1",
        "frameworld_penrose_1",
        "frameworld_salvage_habitat_0",
        "kaiser_moon_1",
        "improbable_kaiser_moon_0",
        "improbable_kaiser_moon_1",
        "stellarite_kaiser_moon_0",
        "stellarite_kaiser_moon_1",
        "pouchkinn_engine_1",
        "pouchkinn_engine_2",
        "penrose_bomb_armed",
        "penrose_bomb_detonate",
        "lunar_macroreplicator_make_moon",
        "planetcraft_printer_make_planet",
        "substellar_compressor_5",
        "psychic_beacon_4",
        "blokkat_prison_1_empty",
        "blokkat_shield_killer_0",
        "blokkat_shipyard_0",
        "blokkat_star_fix_0",
        "blokkat_dummy_mega",
        "giga_eawaf_sirens_megaphone_1",
        "interstellar_habitat_completed_core",
        "flusion_attack_moon_0",
        "katzen_forge_0",
        "kaiser_ehof_0",
        "aeternum_forge_0",
        "lgate_base",
        "war_moon_0",
        "war_planet_0",
        "war_system_0",
        "nomad_war_moon_0",
        "nomad_war_planet_0",
        "orbital_arcology_0",
        "anti_sirens_shield",
        "ehof_sm_forge_phase0",
        "ehof_presphere_dyson",
        "r_square_world_ruined",
        "r_square_world_hub",
        "think_tank_4",
        "psychic_hypersiphon_3_aeternum",
        "giga_hyper_relay_ai_site",
        "crisis_sphere_0",
        "galactic_crucible_0",
        "behemoth_egg",
        "nicoll_beam_ready",
        "nicoll_beam_targetting",
        "nicoll_beam_menu",
        "compound_wormhole_ehof",
        "relic_penrose_sphere",
        "quasi_stellar_obliterator_firing_1",
    ] {
        assert!(!offered(key), "{key}");
    }
    for key in [
        "giga_battleship_restored",
        "giga_titan_restored",
        "giga_juggernaut_restored",
        "giga_colossus_restored",
    ] {
        assert_eq!(mega(gd, key).offer, hidden(HiddenWhy::LeavesFleet), "{key}");
    }
    assert_eq!(
        mega(gd, "asteroid_artillery_1_fake").placement,
        mega(gd, "asteroid_artillery_1").placement,
        "it always becomes asteroid_artillery_1"
    );
    assert_eq!(
        mega(gd, "nicoll_beam_ready").offer,
        hidden(HiddenWhy::State)
    );
    for key in ["star_lifter_0", "star_lifter_3", "maginot_world_1"] {
        assert_eq!(mega(gd, key).offer, Offer::Offered, "{key}");
    }

    let b_classes = |key: &str, scaling: &str| {
        let swaps = &mega(gd, key).swaps;
        assert!(swaps.iter().all(|swap| swap.resolved), "{key}: {swaps:?}");
        let b = swaps
            .iter()
            .find(|swap| swap.into.ends_with("_b_star"))
            .unwrap_or_else(|| panic!("{key} has a B-star swap"));
        assert_eq!(b.flags, [scaling], "{key}");
        b.classes.clone().expect("a class list")
    };
    for (key, scaling) in [
        ("dyson_swarm_3", "giga_dyson_scaling"),
        ("dyson_sphere_0", "giga_dyson_scaling"),
        ("star_lifter_0", "giga_lifter_scaling"),
        ("matrioshka_brain_0_g_star", "giga_matroishka_scaling"),
    ] {
        let classes = b_classes(key, scaling);
        assert!(classes.contains(&"pc_b_star".to_owned()), "{key}");
        assert!(classes.len() > 1, "{key}: the trigger's other classes");
    }
    let basic = mega(gd, "dyson_swarm_3")
        .swaps
        .iter()
        .find(|swap| swap.into == "dyson_swarm_3_basic")
        .expect("the swarm's plain swap");
    assert_eq!(basic.no_flags, ["giga_dyson_scaling"]);
    let o = &mega(gd, "star_lifter_0").swaps[0];
    assert!(o.into.ends_with("_o_star") && o.flags.is_empty() && o.classes.is_some());

    let intos: Vec<&str> = gd
        .megastructures
        .iter()
        .flat_map(|def| def.swaps.iter().map(|swap| swap.into.as_str()))
        .collect();
    let next = |stage: &str, skip: &[&str]| {
        gd.megastructures
            .iter()
            .find(|def| {
                def.upgrade_from.first().map(String::as_str) == Some(stage)
                    && !skip.contains(&def.key.as_str())
                    && !def.key.contains("_ruined")
                    && !def.key.contains("_restored")
            })
            .map(|def| def.key.as_str())
    };
    let mut pairs = 0;
    for def in gd.megastructures.iter() {
        for swap in def
            .swaps
            .iter()
            .filter(|swap| swap.resolved && swap.classes.is_some())
        {
            let mut variant = Some(swap.into.as_str());
            let mut plain = Some(def.key.as_str());
            while let (Some(v), Some(p)) = (variant, plain) {
                assert_eq!(
                    mega(gd, v).placement,
                    mega(gd, p).placement,
                    "{v} is placed as {p}"
                );
                pairs += 1;
                variant = next(v, &[]);
                plain = next(p, &intos);
            }
        }
    }
    println!("{pairs} variant stages placed as their plain stages");
}
