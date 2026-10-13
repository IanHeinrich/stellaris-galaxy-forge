//! Megastructure types read through the inline scripts they call: nested scripts with their
//! parameters on the fixture install, and Gigastructural Engineering's types on the playset.

use crate::common;

use sgf_gamedata::construction::PlanetChange;
use sgf_gamedata::registries::megastructures::{BuildType, Placement, Unsupported};

const SCRIPTED: &str = "fx_sphere_0 = { entity = \"fx_site_entity\" }
fx_sphere_1_a_star = {
	inline_script = {
		script = fx/sphere_stage
		class = a
		entity = \"fx_phase_01_entity\"
	}
}
fx_sphere_1_b_star = {
	inline_script = { script = fx/sphere_stage class = b }
}
fx_loop = { inline_script = fx/loop }
";

const SPHERE_STAGE: &str = "inline_script = {
	script = fx/sphere_template
	class = $class$
	entity = $entity|fx_default_entity$
	produces = \"energy = 10\"
}
";

const SPHERE_TEMPLATE: &str = "entity = $entity$
build_type = $build|outside_gravity_well$
upgrade_from = { fx_sphere_0 $upgrade_from|$ }
resources = { produces = { $produces$ } }
[[star] potential = { always = no } ]
";

const LOOP: &str = "entity = fx_loop_entity
inline_script = fx/loop
";

/// A type defined through an `inline_script` is read with the script's text in place of the
/// call, the scripts it calls in turn, each with its parameters and their defaults put in.
#[test]
fn a_type_defined_through_nested_inline_scripts_reads_their_text() {
    let (_dir, gd) = common::hand_written(&[
        ("common/megastructures/00_fx.txt", SCRIPTED),
        ("common/inline_scripts/fx/sphere_stage.txt", SPHERE_STAGE),
        (
            "common/inline_scripts/fx/sphere_template.txt",
            SPHERE_TEMPLATE,
        ),
        ("common/inline_scripts/fx/loop.txt", LOOP),
    ]);
    let given = gd.megastructures.get("fx_sphere_1_a_star").expect("a star");
    assert_eq!(given.entity.as_deref(), Some("fx_phase_01_entity"));
    assert_eq!(
        given.upgrade_from,
        ["fx_sphere_0"],
        "an empty default adds no item"
    );
    assert_eq!(
        given.build_type,
        BuildType::OutsideGravityWell,
        "the default"
    );
    assert_eq!(
        given.produces,
        [("energy".to_owned(), 10.0)],
        "a quoted value goes in as script"
    );
    assert!(!given.script_only, "STAR is not given");
    let defaulted = gd.megastructures.get("fx_sphere_1_b_star").expect("b star");
    assert_eq!(defaulted.entity.as_deref(), Some("fx_default_entity"));
    let looped = gd
        .megastructures
        .get("fx_loop")
        .expect("a script that calls itself");
    assert_eq!(looped.entity.as_deref(), Some("fx_loop_entity"));
}

/// Gigastructural Engineering defines most of its types through inline scripts. Read in place,
/// they give its star-class Dyson Spheres their models and chains, its Star Lifter the types it
/// turns into by star class, and mark what the editor cannot add yet. Runs with
/// `SGF_PLAYSET=1` when the enabled mods include Giga.
#[test]
fn gigas_types_read_through_their_inline_scripts() {
    let Some(gd) = common::giga() else {
        return;
    };
    let giga = |def: &&sgf_gamedata::registries::megastructures::MegastructureDef| {
        def.source
            .as_deref()
            .is_some_and(|s| s.starts_with("Gigastructural"))
    };
    let types: Vec<_> = gd.megastructures.iter().filter(giga).collect();
    let no_model = types.iter().filter(|def| def.entity.is_none()).count();
    println!("{} Giga types, {no_model} with no model", types.len());
    assert!(no_model < 250, "{no_model} Giga types with no model");

    let mega = |key: &str| gd.megastructures.get(key).expect(key);
    let stage = mega("dyson_sphere_1_a_star");
    assert_eq!(
        stage.entity.as_deref(),
        Some("dyson_sphere_phase_01_entity")
    );
    assert_eq!(stage.upgrade_from, ["dyson_sphere_0_a_star"]);
    assert_eq!(
        mega("dyson_sphere_0_a_star").upgrade_from,
        ["dyson_sphere_0"]
    );
    assert_eq!(
        mega("dyson_sphere_restored_a_star").upgrade_from,
        ["dyson_sphere_ruined_a_star"]
    );
    for (key, energy) in [
        ("dyson_sphere_5_g_star", 4000.0),
        ("dyson_sphere_5_k_star", 3000.0),
    ] {
        assert_eq!(
            mega(key).produces,
            [("energy".to_owned(), energy)],
            "{key}: inline maths over the star class's production multiplier"
        );
    }
    assert_eq!(
        mega("dyson_sphere_5").placement,
        Placement::Body { star_only: true },
        "a Dyson Sphere changes its star, which the editor leaves to the game"
    );
    assert!(mega("think_tank_4").script_only, "the Groik Nexus");
    assert!(
        mega("star_lifter_0")
            .turns_into
            .iter()
            .any(|key| key == "star_lifter_0_o_star")
    );
    for (key, class) in [
        ("automated_stripmine_1", "pc_strip_mined"),
        ("crystal_megabore_1", "pc_melted_frozen"),
        ("succ_1", "pc_metallic_hydrogen"),
        ("planetary_seeder_nexus_3", "pc_food_giant"),
        ("yggdrasil_orchid_3", "pc_food_giant"),
        ("yggdrasil_orchid_restored", "pc_food_giant"),
    ] {
        assert_eq!(
            mega(key).placement,
            Placement::Body { star_only: false },
            "{key}"
        );
        assert_eq!(
            mega(key).planet_change,
            Some(PlanetChange {
                class: Some(class.to_owned()),
                size: None
            }),
            "{key}"
        );
    }
    assert_eq!(
        mega("yggdrasil_orchid_2").planet_change,
        None,
        "the Orchid's planet changes only when the last stage is finished"
    );
    assert_eq!(
        mega("kaiser_moon_1").planet_change,
        Some(PlanetChange {
            class: None,
            size: Some(6)
        })
    );
    for key in [
        "asteroid_artillery_1",
        "lunar_disco_ball_2",
        "maginot_world_2",
        "stellar_ring_habitat_3",
    ] {
        assert_eq!(
            mega(key).placement,
            Placement::Unsupported {
                why: Unsupported::ChangesBody
            },
            "{key}: the change runs on a condition or names no plain class or size"
        );
    }
    assert_eq!(
        mega("planetary_computer_2").placement,
        Placement::Unsupported {
            why: Unsupported::FixedClass {
                class: "pc_giga_planetary_computer".to_owned()
            }
        }
    );
    for key in [
        "alderson_disk_0",
        "alderson_disk_2_gaia",
        "alderson_disk_ruined_left",
        "birch_world_3",
        "r_square_world_ruined",
    ] {
        assert!(
            matches!(
                mega(key).placement,
                Placement::Unsupported {
                    why: Unsupported::WholeStructure { .. }
                }
            ),
            "{key}: {:?}",
            mega(key).placement
        );
    }
}
