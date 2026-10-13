//! The type a finished row becomes where it stands: the swap that holds at the star's class
//! with the save's global flags, followed along the chain it starts.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::registries::megastructure_swaps::made_at;

const BUILT: &str = "resources = { cost = { alloys = 100 } }\n\tprerequisites = { tech_fx }";

/// An orb whose site swaps to a blue chain round a blue star, else to a red chain under the
/// `fx_red_orbs` flag. The red chain stops a stage short of the plain one.
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
