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
