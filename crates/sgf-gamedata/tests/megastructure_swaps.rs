//! The type a finished row becomes where it stands: the swap that holds at the star's class
//! with the save's global flags, followed along the chain it starts.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::registries::megastructure_swaps::{Swap, made_at};

const BUILT: &str = "resources = { cost = { alloys = 100 } }\n\tprerequisites = { tech_fx }";

/// An orb whose site swaps to a blue chain round a blue star, else to a red chain under the
/// `fx_red_orbs` flag. The red chain stops a stage short of the plain one. A cannon's wreck is
/// repaired straight into its working stage.
fn types() -> String {
    let scripted = "potential = { always = no }";
    format!(
        "fx_orb_0 = {{
	{BUILT}
	on_build_complete = {{
		if = {{
			limit = {{ fromfrom.planet = {{ is_planet_class = pc_fx_blue }} }}
			fromfrom = {{ upgrade_megastructure_to = fx_orb_0_blue }}
		}}
		else_if = {{
			limit = {{ has_global_flag = fx_red_orbs }}
			fromfrom = {{ upgrade_megastructure_to = fx_orb_0_red }}
		}}
	}}
}}
fx_orb_1 = {{ upgrade_from = {{ fx_orb_0 }} {BUILT} }}
fx_orb_2 = {{ upgrade_from = {{ fx_orb_1 }} {BUILT} }}
fx_orb_0_blue = {{ {scripted} }}
fx_orb_1_blue = {{ upgrade_from = {{ fx_orb_0_blue }} {scripted} }}
fx_orb_2_blue = {{ upgrade_from = {{ fx_orb_1_blue }} {scripted} }}
fx_orb_0_red = {{ {scripted} }}
fx_orb_1_red = {{ upgrade_from = {{ fx_orb_0_red }} {scripted} }}
fx_cannon_0 = {{ {BUILT} }}
fx_cannon_1 = {{ upgrade_from = {{ fx_cannon_0 }} {scripted} }}
fx_cannon_ruined = {{ {scripted} }}
fx_cannon_repaired = {{
	upgrade_from = {{ fx_cannon_ruined }}
	{BUILT}
	on_build_complete = {{
		fromfrom = {{ upgrade_megastructure_to = fx_cannon_1 }}
	}}
}}
"
    )
}

fn fixture() -> (tempfile::TempDir, GameData) {
    common::hand_written(&[("common/megastructures/fx.txt", &types())])
}

const ORB: [&str; 3] = ["fx_orb_0", "fx_orb_1", "fx_orb_2"];

/// What a finished row of each stage of the orb becomes round a star of `class`.
fn made(gd: &GameData, class: Option<&str>, flags: &[&str]) -> Vec<String> {
    let flags: Vec<String> = flags.iter().map(|flag| (*flag).to_owned()).collect();
    ORB.iter()
        .map(|kind| made_at(&gd.megastructures, kind, class, &flags))
        .collect()
}

#[test]
fn a_stage_becomes_the_stage_of_the_chain_its_site_swaps_to() {
    let (_dir, gd) = fixture();
    let blue = ["fx_orb_0_blue", "fx_orb_1_blue", "fx_orb_2_blue"];
    assert_eq!(made(&gd, Some("pc_fx_blue"), &[]), blue);
    assert_eq!(made(&gd, Some("pc_fx_blue"), &["fx_red_orbs"]), blue);
    assert_eq!(
        made(&gd, Some("pc_fx_green"), &["fx_red_orbs"]),
        ["fx_orb_0_red", "fx_orb_1_red", "fx_orb_2"],
        "past the end of a chain that is too short, the plain stage"
    );
    assert_eq!(made(&gd, None, &["fx_red_orbs"])[0], "fx_orb_0_red");
    assert_eq!(made(&gd, Some("pc_fx_green"), &[]), ORB);
    assert_eq!(made(&gd, None, &[]), ORB);
}

#[test]
fn a_repair_makes_the_working_stage_it_swaps_to() {
    let (_dir, gd) = fixture();
    let made = |kind: &str| made_at(&gd.megastructures, kind, None, &[]);
    assert_eq!(made("fx_cannon_repaired"), "fx_cannon_1");
    assert_eq!(made("fx_cannon_ruined"), "fx_cannon_ruined");
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

/// A swap the files leave unresolved never holds. One kept off a class does not hold on it, and
/// holds in empty space; one asking for a class never holds in empty space.
#[test]
fn a_swap_holds_only_where_every_condition_does() {
    let unresolved = Swap {
        resolved: false,
        ..swap("fx_lifter_b")
    };
    assert!(!unresolved.holds(Some("pc_b_star"), &[]));
    let not_black_hole = Swap {
        not_classes: vec!["pc_black_hole".to_owned()],
        ..swap("fx_swarm_scaled")
    };
    assert!(!not_black_hole.holds(Some("pc_black_hole"), &[]));
    assert!(not_black_hole.holds(Some("pc_b_star"), &[]));
    assert!(not_black_hole.holds(None, &[]));
    let blue = Swap {
        classes: Some(vec!["pc_b_star".to_owned()]),
        flags: vec!["fx_scaling".to_owned()],
        ..swap("fx_swarm_b")
    };
    assert!(blue.holds(Some("pc_b_star"), &["fx_scaling".to_owned()]));
    assert!(!blue.holds(Some("pc_b_star"), &[]));
    assert!(!blue.holds(None, &["fx_scaling".to_owned()]));
}

/// The base game's Ring World swaps its intermediate stage for the finished ring, which stays
/// itself, and a hatched behemoth egg leaves a ruined one.
#[test]
fn the_installs_swaps_make_the_types_they_name() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let made = |kind: &str| made_at(&gd.megastructures, kind, Some("pc_g_star"), &[]);
    assert_eq!(made("ring_world_2_intermediate"), "ring_world_2");
    assert_eq!(
        made("ring_world_2"),
        "ring_world_2",
        "made only by the swap"
    );
    assert_eq!(made("behemoth_egg_hatch"), "behemoth_egg_ruined");
    assert_eq!(made("dyson_sphere_5"), "dyson_sphere_5");
}
