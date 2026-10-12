//! The megastructure views the add dialog reads, and the rich text it shows: on hand-written
//! types, on the real install, and on Gigastructural Engineering when the enabled playset
//! has it.

use crate::common;

use sgf_gamedata::construction::{SummaryKind, SummaryOn};
use sgf_gamedata::megastructure_views::MegastructureView;

fn view<'g>(views: &'g [MegastructureView], key: &str) -> &'g MegastructureView {
    views
        .iter()
        .find(|view| view.def.key == key)
        .unwrap_or_else(|| panic!("{key}"))
}

#[test]
fn rich_text_keeps_the_games_markup_and_fills_the_rest() {
    let (_dir, gd) = common::hand_written(&[
        ("common/scripted_variables/00_fx.txt", ""),
        (
            "localisation/english/fx_l_english.yml",
            "l_english:\n\
             fx_rich:0 \"Gives £energy£ §Y$fx_amount$§! to [This.GetName].\"\n\
             fx_amount:0 \"$fx_number$ a month\"\n\
             fx_number:0 \"+3\"\n\
             fx_plain:0 \"Nothing to keep\"\n\
             fx_loop:0 \"$fx_loop$ again\"\n",
        ),
    ]);
    assert_eq!(
        gd.loc.rich("fx_rich").as_deref(),
        Some("Gives £energy£ §Y+3 a month§! to it."),
        "the icon and the colour stay, two references deep, and the scope reads as it does in a description"
    );
    assert_eq!(gd.loc.rich("fx_plain").as_deref(), Some("Nothing to keep"));
    assert_eq!(gd.loc.rich("fx_loop").as_deref(), Some("$fx_loop$ again"));
    assert_eq!(gd.loc.rich("fx_missing"), None);
}

/// The type registry holds no localised line, so the view call fills them in.
#[test]
fn the_registry_leaves_the_named_lines_to_the_view() {
    let (_dir, gd) = common::hand_written(&[
        ("common/scripted_variables/00_fx.txt", ""),
        (
            "common/megastructures/fx.txt",
            "fx_station = {
	country_modifier = {
		fx_research = 0.1
		fx_research = 0.05
		fx_unity = 2
	}
	on_build_complete = {
		fromfrom.planet = {
			add_modifier = { modifier = fx_glow days = -1 }
			add_modifier = { modifier = fx_brief days = 360 }
			add_deposit = d_fx_ore
			add_deposit = d_fx_gone
			remove_deposit = d_fx_gone
		}
		from = { change_variable = { which = fx_count value = 1 } }
	}
}
",
        ),
        (
            "localisation/english/fx_l_english.yml",
            "l_english:\n\
             mod_fx_research:0 \"Research Speed\"\n\
             mod_fx_unity:0 \"Unity Output\"\n\
             fx_glow:0 \"Afterglow\"\n\
             d_fx_ore:0 \"Fixture Ore\"\n",
        ),
    ]);

    let views = gd.megastructure_views();
    let station = view(&views, "fx_station");
    let effects: Vec<(&str, &str)> = station
        .country_effects
        .iter()
        .map(|line| (line.key.as_str(), line.text.as_str()))
        .collect();
    assert_eq!(
        effects,
        [
            ("fx_research", "+0.15 Research Speed"),
            ("fx_unity", "+2 Unity Output")
        ]
    );
    let lines: Vec<_> = station
        .construction_summary
        .iter()
        .map(|line| {
            (
                line.on,
                line.kind,
                line.key.as_str(),
                line.name.as_str(),
                line.permanent,
                line.conditional,
            )
        })
        .collect();
    assert_eq!(
        lines,
        [
            (
                SummaryOn::Body,
                SummaryKind::Modifier,
                "fx_glow",
                "Afterglow",
                true,
                false
            ),
            (
                SummaryOn::Body,
                SummaryKind::Modifier,
                "fx_brief",
                "Fx Brief",
                false,
                false
            ),
            (
                SummaryOn::Body,
                SummaryKind::Deposit,
                "d_fx_ore",
                "Fixture Ore",
                true,
                false
            ),
        ],
        "a deposit the chain removes again, the removal and the owner variable are left out"
    );
}

fn texts(views: &[MegastructureView], key: &str) -> Vec<String> {
    view(views, key)
        .country_effects
        .iter()
        .map(|line| line.text.clone())
        .collect()
}

#[test]
fn a_think_tank_names_what_it_gives_its_owner() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.megastructure_views();
    assert_eq!(
        texts(&views, "think_tank_3"),
        ["+15% all technology research speed".to_owned()]
    );
}

#[test]
fn an_arc_furnace_lists_the_modifier_and_deposit_it_writes() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.megastructure_views();
    let lines: Vec<_> = view(&views, "orbital_arc_furnace_4")
        .construction_summary
        .iter()
        .map(|line| {
            (
                line.on,
                line.kind,
                line.key.as_str(),
                line.name.as_str(),
                line.permanent,
                line.conditional,
            )
        })
        .collect();
    assert_eq!(
        lines,
        [
            (
                SummaryOn::Planets,
                SummaryKind::Deposit,
                "d_arc_furnace_4",
                "Arc Furnace",
                true,
                true
            ),
            (
                SummaryOn::Planets,
                SummaryKind::Modifier,
                "orbital_arc_furnace_4_mod",
                "Arc Furnace",
                true,
                true
            ),
        ],
        "the earlier stages' deposits and modifiers are taken off again by the last"
    );
}

#[test]
fn a_giga_category_text_resolves() {
    if std::env::var_os("SGF_PLAYSET").is_none_or(|v| v != "1") {
        eprintln!("skipped: SGF_PLAYSET=1 reads the enabled mods");
        return;
    }
    let gd = sgf_gamedata::load(&sgf_gamedata::LoadOptions::default(), &mut |_| {})
        .expect("SGF_PLAYSET needs an install");
    if gd.loc.raw("giga_list_category_kilostructure").is_none() {
        eprintln!("skipped: Gigastructural Engineering is not enabled");
        return;
    }
    let text = gd
        .loc
        .rich("asteroid_manufactory_0_MEGASTRUCTURE_DETAILS")
        .expect("the manufactory's details text");
    assert!(
        text.starts_with("§BKILOSTRUCTURE§! - "),
        "the category keeps its colour: {text}"
    );
    assert!(!text.contains('$'), "every reference resolves: {text}");
}

/// The Habitat Central Complex and its restored version are offered as habitats, so the
/// dialog adds them with `AddHabitat`. The ruin is a row.
#[test]
fn the_complex_and_its_restored_version_are_habitats_in_the_view() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.megastructure_views();
    for (key, habitat, orbital) in [
        ("habitat_central_complex", true, false),
        ("habitat_central_complex_restored", true, true),
        ("habitat_central_complex_ruined", false, false),
    ] {
        assert_eq!(view(&views, key).habitat, habitat, "{key}");
        assert_eq!(view(&views, key).habitat_orbital, orbital, "{key} orbital");
    }
}

/// The base game's ring world past its site is added whole, so no stage of it says why not.
/// The site is a row, and a type of another chain is no ring world.
#[test]
fn the_ring_worlds_stages_are_added_whole_in_the_view() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.megastructure_views();
    for key in [
        "ring_world_1",
        "ring_world_2_intermediate",
        "ring_world_2",
        "ring_world_3_intermediate",
        "ring_world_ruined",
        "ring_world_restored",
        "dyson_sphere_5",
    ] {
        assert_eq!(view(&views, key).ring_world_refused, None, "{key}");
    }
}

/// A ring world is a chain whose frame spawns rows that a stage builds into ring world
/// segments, whatever its keys. Its view asks for as many finished quadrants as the frame
/// spawns rows, and says why when its chain lays out no ring of that many.
#[test]
fn a_ring_world_that_lays_out_no_ring_says_why() {
    let (_dir, gd) = common::hand_written(&[
        ("common/scripted_variables/00_fx.txt", ""),
        (
            "common/megastructures/fx.txt",
            "fx_site = {
}
fx_frame = {
	upgrade_from = { fx_site }
	on_build_complete = {
		spawn_megastructure = { type = fx_section orbit_angle = 0 orbit_distance = 60 }
		spawn_megastructure = { type = fx_section orbit_angle = 180 orbit_distance = 60 }
		remove_megastructure = fromfrom
	}
}
fx_section = { upgrade_from = { fx_frame } }
fx_built = {
	upgrade_from = { fx_section }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 init_effect = { set_name = NAME_Fx } }
		remove_megastructure = fromfrom
	}
}
fy_frame = {
	on_build_complete = {
		spawn_megastructure = { type = fy_section orbit_angle = 0 orbit_distance = @nowhere }
		spawn_megastructure = { type = fy_section orbit_angle = 180 orbit_distance = @nowhere }
		remove_megastructure = fromfrom
	}
}
fy_section = { upgrade_from = { fy_frame } }
fy_built = {
	upgrade_from = { fy_section }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 }
	}
}
",
        ),
    ]);
    let views = gd.megastructure_views();
    for key in ["fx_site", "fx_frame", "fx_section", "fx_built"] {
        assert_eq!(view(&views, key).ring_world_refused, None, "{key}");
    }
    assert_eq!(
        view(&views, "fy_section").ring_world_refused.as_deref(),
        Some("no stage of its chain lays out a ring world of 2 quadrants")
    );
}
