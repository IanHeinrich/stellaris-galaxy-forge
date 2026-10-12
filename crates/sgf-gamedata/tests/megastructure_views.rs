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
    let Some(gd) = common::giga() else {
        return;
    };
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

/// The view carries what the habitat layout says of a type, so the dialog adds the restored
/// Habitat Central Complex with `AddHabitat` and its major orbital.
#[test]
fn the_restored_complex_is_a_habitat_with_an_orbital_in_the_view() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.megastructure_views();
    let restored = view(&views, "habitat_central_complex_restored");
    assert_eq!((restored.habitat, restored.habitat_orbital), (true, true));
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

/// The view carries why a ring world's chain lays out no ring.
#[test]
fn a_ring_world_that_lays_out_no_ring_says_why() {
    let (_dir, gd) = common::hand_written(&[
        ("common/scripted_variables/00_fx.txt", ""),
        (
            "common/megastructures/fx.txt",
            "fy_frame = {
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
    assert_eq!(
        view(&views, "fy_section").ring_world_refused.as_deref(),
        Some("no stage of its chain lays out a ring world of 2 quadrants")
    );
}

/// A type's picture is its `portrait` sprite, when the install has the file the sprite names.
/// Its category line is the head of its build tooltip, followed through a tooltip that is only
/// another's, when that head is only upper-case words.
#[test]
fn a_type_shows_its_portrait_and_the_category_its_tooltip_opens_with() {
    let text = |text: &str| text.as_bytes().to_vec();
    let (_dir, gd) = common::hand_written_bytes(&[
        ("common/scripted_variables/00_fx.txt", Vec::new()),
        (
            "common/megastructures/fx.txt",
            text(
                "fx_brain_0 = { portrait = \"GFX_fx_brain\" }
fx_brain_0_b_star = { portrait = \"GFX_fx_gone\" }
fx_plain = { portrait = \"GFX_fx_unknown\" }
fx_named = { }
",
            ),
        ),
        (
            "interface/fx.gfx",
            text(
                "spriteTypes = {
	spriteType = { name = \"GFX_fx_brain\" textureFile = \"gfx/interface/fx/brain.dds\" }
	spriteType = { name = \"GFX_fx_gone\" textureFile = \"gfx/interface/fx/gone.dds\" }
}
",
            ),
        ),
        (
            "gfx/interface/fx/brain.dds",
            common::dds(4, &[vec![[128, 128, 128, 255]; 16]]),
        ),
        (
            "localisation/english/fx_l_english.yml",
            text(
                "l_english:\n\
                  fx_cat_giga:0 \"§SGIGASTRUCTURE§!\"\n\
                  fx_cat_science:0 \"§YSCIENCE PRODUCTION§!\"\n\
                  fx_station:0 \"Station\"\n\
                  fx_brain_0_MEGASTRUCTURE_DETAILS:0 \"£fx£ $fx_cat_giga$ - $fx_cat_science$\\nHarvests a §YStar§!.\"\n\
                  fx_brain_0_b_star_MEGASTRUCTURE_DETAILS:0 \"$fx_brain_0_MEGASTRUCTURE_DETAILS$\"\n\
                  fx_plain_MEGASTRUCTURE_DETAILS:0 \"A §Y$fx_station$§! that does nothing.\"\n\
                  fx_named_MEGASTRUCTURE_DETAILS:0 \"$fx_cat_giga$ - $fx_station$\\nMore.\"\n",
            ),
        ),
    ]);
    let views = gd.megastructure_views();
    let shown = |key: &str| {
        let view = view(&views, key);
        (view.portrait.as_deref(), view.category.as_deref())
    };
    assert_eq!(
        shown("fx_brain_0"),
        (
            Some("sprite:GFX_fx_brain"),
            Some("Gigastructure · Science Production")
        )
    );
    assert_eq!(
        shown("fx_brain_0_b_star"),
        (None, Some("Gigastructure · Science Production")),
        "a sprite whose file is missing shows no picture"
    );
    assert_eq!(
        shown("fx_plain"),
        (None, None),
        "an unknown sprite, and a tooltip that opens with prose"
    );
    assert_eq!(
        shown("fx_named"),
        (None, None),
        "a reference to a name is no category"
    );
}

/// The Dyson Sphere's stages show the game's pictures: the shared construction picture while
/// it is built and its own once finished. The base game opens no build tooltip with a category.
#[test]
fn the_dyson_spheres_portraits_are_files_in_the_install() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.megastructure_views();
    for (key, sprite) in [
        (
            "dyson_sphere_0",
            "GFX_megastructure_construction_background",
        ),
        (
            "dyson_sphere_5",
            "GFX_megastructure_dyson_sphere_background",
        ),
    ] {
        assert_eq!(
            view(&views, key).portrait,
            Some(format!("sprite:{sprite}")),
            "{key}"
        );
        let (file, _) = gd.sprites.resolve(sprite, None).expect(sprite);
        assert!(gd.layout.resolve_file(&file).is_some(), "{file}");
    }
    let with_category: Vec<&str> = views
        .iter()
        .filter(|view| view.category.is_some())
        .map(|view| view.def.key.as_str())
        .collect();
    assert_eq!(with_category, Vec::<&str>::new());
}

/// Gigastructural Engineering opens each build tooltip with the structure's kind and
/// categories, and gives the base game's types one too.
#[test]
fn giga_types_show_the_category_their_tooltip_opens_with() {
    let Some(gd) = common::giga() else {
        return;
    };
    let views = gd.megastructure_views();
    for (key, category) in [
        (
            "asteroid_manufactory_0",
            "Kilostructure · Basic Resource Production · Advanced Resource Production",
        ),
        (
            "dyson_sphere_0",
            "Megastructure · Basic Resource Production",
        ),
        ("think_tank_0", "Megastructure · Science Production"),
    ] {
        assert_eq!(
            view(&views, key).category.as_deref(),
            Some(category),
            "{key}"
        );
    }
}
