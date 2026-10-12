//! What finishing a megastructure leaves in its system, replayed from the real install's
//! build chains: the ring world's rows and segments, stage by stage per quadrant, and the
//! habitat a Habitat Central Complex becomes. `megastructure_layouts_added` covers what the
//! editor adds for them.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::construction::layout::{
    Around, IdOf, LaidFlag, LaidPlanet, LaidRow, Orbit, Plan, SectionStage, SystemLayout, lay_out,
};

/// The four quadrants' save angles, A to D, as every ring world row in the saves stands.
const QUADRANTS: [f64; 4] = [180.0, 270.0, 0.0, 90.0];

fn ring_world(gd: &GameData, sections: &[SectionStage]) -> SystemLayout {
    let plan = Plan {
        on_star: true,
        sections: sections.to_vec(),
        culture: None,
        held_flags: Vec::new(),
    };
    lay_out(gd, "ring_world_2_intermediate", &plan).expect("ring_world_2_intermediate")
}

/// A row as type, save angle, distance, name, owned and cultured.
type RowFacts<'a> = (&'a str, f64, f64, Option<&'a str>, bool, bool);
/// A planet as class, save angle, distance, size and name key.
type SegmentFacts<'a> = (&'a str, f64, f64, Option<u32>, Option<&'a str>);

fn row(section: &Option<LaidRow>) -> Option<RowFacts<'_>> {
    section.as_ref().map(|row| {
        assert_eq!(row.at.around, Around::Centre);
        (
            row.kind.as_str(),
            row.at.save_angle(),
            row.at.distance,
            row.name.as_deref(),
            row.owned,
            row.cultured,
        )
    })
}

fn segment(planet: &LaidPlanet) -> SegmentFacts<'_> {
    assert_eq!(planet.at.around, Around::Centre, "{}", planet.class);
    (
        planet.class.as_str(),
        planet.at.save_angle(),
        planet.at.distance,
        planet.size,
        planet.name.as_ref().map(|name| name.key.as_str()),
    )
}

/// A finished quadrant's three segments at save angle `at`: tech 30 degrees on, the seam
/// on the row's point and the habitable section 30 degrees back.
fn finished(at: f64, habitable: &str) -> [SegmentFacts<'_>; 3] {
    [
        (
            "pc_ringworld_tech",
            (at + 30.0) % 360.0,
            45.0,
            Some(10),
            Some("NAME_Ring_Section"),
        ),
        (
            "pc_ringworld_seam",
            at,
            45.0,
            Some(10),
            Some("NAME_Ring_Section"),
        ),
        (
            "pc_ringworld_habitable",
            (at + 330.0) % 360.0,
            45.0,
            Some(10),
            Some(habitable),
        ),
    ]
}

fn plain(flag: &str) -> LaidFlag {
    LaidFlag {
        flag: flag.to_owned(),
        id_of: None,
    }
}

/// Building the frame clears the system and leaves the four quadrant rows at radius 45, on
/// the points Lachium's ruined rows stand on. Finishing every quadrant removes the rows and
/// leaves twelve segments: quadrant A's at save angles 210, 180 and 150, as Delta Pavonis
/// has them, and the habitable sections named A to D in the order they are finished.
#[test]
fn the_ring_world_chain_gives_four_rows_then_twelve_segments() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let frame = ring_world(gd, &[]);
    assert_eq!(frame.row, None, "the frame removes the site row");
    let rows: Vec<_> = frame.sections.iter().map(|s| row(&s.row)).collect();
    let names = ["A", "B", "C", "D"].map(|q| format!("NAME_Ring_Section_{q}"));
    let want: Vec<_> = QUADRANTS
        .iter()
        .zip(&names)
        .map(|(&at, name)| Some(("ring_world_2", at, 45.0, Some(name.as_str()), true, true)))
        .collect();
    assert_eq!(rows, want);
    assert_eq!(
        frame
            .sections
            .iter()
            .map(|s| s.at.angle)
            .collect::<Vec<_>>(),
        [0.0, 90.0, 180.0, 270.0],
        "the game angles the frame spawns its rows at"
    );
    assert!(frame.planets.is_empty());
    assert!(frame.cleared && frame.belts_cleared);
    assert_eq!(frame.system_flags, ["ring_world_built"]);
    assert!(frame.host_flags.is_empty());
    assert!(frame.unfollowed.is_empty(), "{:?}", frame.unfollowed);

    let ring = ring_world(gd, &[SectionStage::Built; 4]);
    assert!(
        ring.sections.iter().all(|s| s.row.is_none()),
        "no rows at all"
    );
    let segments: Vec<_> = ring.planets.iter().map(segment).collect();
    let habitable = ["A", "B", "C", "D"].map(|q| format!("NAME_Habitable_Section_{q}"));
    let want: Vec<_> = QUADRANTS
        .iter()
        .zip(&habitable)
        .flat_map(|(&at, name)| finished(at, name))
        .collect();
    assert_eq!(segments, want);
    assert_eq!(
        ring.planets.iter().map(|p| p.section).collect::<Vec<_>>(),
        [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3].map(Some)
    );
    for planet in &ring.planets {
        let model = planet.model.as_ref().expect("a model");
        let stem = planet.class.trim_start_matches("pc_");
        assert_eq!(model.entity, format!("{stem}_entity_01_entity"));
        assert!(model.cultured, "{}", planet.class);
        assert_eq!(planet.flags, [plain("megastructure")]);
        assert_eq!(
            planet.megastructure_icon,
            planet.class == "pc_ringworld_habitable"
        );
    }
    assert_eq!(
        ring.system_flags,
        ["ring_world_built"],
        "the fourth section takes the counters off"
    );
    assert!(ring.cleared && ring.belts_cleared);
    assert!(ring.unfollowed.is_empty(), "{:?}", ring.unfollowed);
}

/// Each quadrant is taken to its own stage: A finished, B a frame row, C a ruined row and
/// D damaged, which leaves the damaged classes on A's pattern with no name, model or flag.
/// One section finished leaves its counter on the system.
#[test]
fn a_ring_world_takes_each_quadrant_to_its_own_stage() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    use SectionStage::*;
    let ring = ring_world(gd, &[Built, Spawned, Ruined, Damaged]);
    let rows: Vec<_> = ring.sections.iter().map(|s| row(&s.row)).collect();
    assert_eq!(
        rows,
        [
            None,
            Some((
                "ring_world_2",
                270.0,
                45.0,
                Some("NAME_Ring_Section_B"),
                true,
                true
            )),
            Some(("ring_world_ruined", 0.0, 45.0, None, true, false)),
            None,
        ]
    );
    let segments: Vec<_> = ring.planets.iter().map(segment).collect();
    let mut want = finished(180.0, "NAME_Habitable_Section_A").to_vec();
    want.extend([
        ("pc_ringworld_tech_damaged", 120.0, 45.0, Some(10), None),
        ("pc_ringworld_seam_damaged", 90.0, 45.0, Some(10), None),
        ("pc_ringworld_habitable_damaged", 60.0, 45.0, Some(10), None),
    ]);
    assert_eq!(segments, want);
    for damaged in &ring.planets[3..] {
        assert_eq!(damaged.section, Some(3));
        assert!(damaged.model.is_none() && damaged.flags.is_empty());
        assert!(!damaged.megastructure_icon);
    }
    assert_eq!(ring.system_flags, ["ring_world_built", "ring_section_1"]);
    assert!(ring.unfollowed.is_empty(), "{:?}", ring.unfollowed);
}

/// A ruined ring world is four `ring_world_ruined` rows at the frame's points, with no name
/// or culture, as Lachium's rows 10 and 11 stand at save angles 180 and 0. Restoring a
/// ruined quadrant gives it the builder's culture and spawns its segments mirrored: tech 30
/// degrees back and the habitable section 30 degrees on.
#[test]
fn a_ruined_ring_world_stands_on_the_frames_points_and_restores_mirrored() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let ruined = ring_world(gd, &[SectionStage::Ruined; 4]);
    let rows: Vec<_> = ruined.sections.iter().map(|s| row(&s.row)).collect();
    let want: Vec<_> = QUADRANTS
        .iter()
        .map(|&at| Some(("ring_world_ruined", at, 45.0, None, true, false)))
        .collect();
    assert_eq!(rows, want);
    assert!(ruined.planets.is_empty());
    assert!(ruined.unfollowed.is_empty(), "{:?}", ruined.unfollowed);

    let restored = ring_world(gd, &[SectionStage::Restored]);
    let segments: Vec<_> = restored.planets.iter().map(segment).collect();
    assert_eq!(
        segments,
        [
            (
                "pc_ringworld_tech",
                150.0,
                45.0,
                Some(10),
                Some("NAME_Ring_Section")
            ),
            (
                "pc_ringworld_seam",
                180.0,
                45.0,
                Some(10),
                Some("NAME_Ring_Section")
            ),
            (
                "pc_ringworld_habitable",
                210.0,
                45.0,
                Some(10),
                Some("NAME_Habitable_Section_A")
            ),
        ]
    );
    assert!(
        restored
            .planets
            .iter()
            .all(|p| p.model.as_ref().is_some_and(|m| m.cultured))
    );
    assert_eq!(restored.sections[0].row, None);
    assert_eq!(
        restored.unfollowed,
        ["ring_world_restored: every_system_ambient_object on the system"],
        "the debris it destroys"
    );
}

/// A finished Habitat Central Complex is one `pc_habitat` of size 6 orbiting its host at
/// game angle 135 (save angle −45), 19.798 out round a star and 9.899 round anything else,
/// named from the system, drawn in the owner's culture and flagged `megastructure`,
/// `habitat` and `habitat_level_1`. The host gets `habitat` followed by the habitat's id,
/// the system `has_habitat`, and the complex's row is gone.
#[test]
fn a_habitat_central_complex_becomes_one_habitat_beside_its_host() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    for (on_star, distance) in [(true, 19.798), (false, 9.899)] {
        let plan = Plan {
            on_star,
            sections: Vec::new(),
            culture: None,
            held_flags: Vec::new(),
        };
        let habitat =
            lay_out(gd, "habitat_central_complex", &plan).expect("habitat_central_complex");
        assert_eq!(habitat.row, None);
        assert!(habitat.sections.is_empty());
        let [planet] = &habitat.planets[..] else {
            panic!("{:?}", habitat.planets);
        };
        assert_eq!(planet.class, "pc_habitat");
        assert_eq!(planet.size, Some(6));
        assert_eq!(
            planet.at,
            Orbit {
                around: Around::Host,
                angle: 135.0,
                distance,
            }
        );
        assert_eq!(planet.at.save_angle(), 315.0);
        let name = planet.name.as_ref().expect("a name");
        assert_eq!(name.key, "HABITAT_PLANET_NAME");
        assert_eq!(name.variables, ["prev.solar_system.GetName"]);
        let model = planet.model.as_ref().expect("a model");
        assert_eq!(model.entity, "habitat_phase_03_entity");
        assert!(model.cultured);
        assert_eq!(
            planet.flags,
            ["megastructure", "habitat", "habitat_level_1"].map(plain)
        );
        assert_eq!(
            habitat.host_flags,
            [LaidFlag {
                flag: "habitat".to_owned(),
                id_of: Some(IdOf::Planet(0)),
            }]
        );
        assert_eq!(habitat.system_flags, ["has_habitat"]);
        assert!(!habitat.cleared && !habitat.belts_cleared);
        assert!(habitat.unfollowed.is_empty(), "{:?}", habitat.unfollowed);
    }
}

/// A restored Habitat Central Complex picks the ruin's body by its `habitat_build_site`
/// flag, so its habitat stands round the host as the complex's does, and the major orbital
/// it spawns there is tied to the host, owned, in the owner's culture and named from the
/// system. The orbital's own completion flags the host `has_orbital`.
#[test]
fn a_restored_complex_leaves_its_habitat_and_a_major_orbital_at_the_host() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    for on_star in [true, false] {
        let plan = Plan {
            on_star,
            sections: Vec::new(),
            culture: None,
            held_flags: Vec::new(),
        };
        let restored = lay_out(gd, "habitat_central_complex_restored", &plan)
            .expect("habitat_central_complex_restored");
        let complex = lay_out(gd, "habitat_central_complex", &plan).expect("the complex");
        assert_eq!(restored.row, None);
        assert_eq!(restored.planets, complex.planets);
        assert_eq!(restored.host_flags, complex.host_flags);
        assert_eq!(restored.system_flags, ["has_habitat"]);
        let [orbital] = &restored.sections[..] else {
            panic!("{:?}", restored.sections);
        };
        let row = orbital.row.as_ref().expect("the orbital stands");
        assert_eq!(row.kind, "habitat_major_orbital");
        assert_eq!(orbital.at.around, Around::Host);
        assert_eq!(orbital.at.distance, 0.0);
        assert!(row.on_host && row.owned && row.cultured);
        assert_eq!(row.name.as_deref(), Some("TARGET_ORBITAL_NAME"));
        assert_eq!(row.system_name.as_deref(), Some("prevprev.GetName"));

        let own = lay_out(gd, "habitat_major_orbital", &plan).expect("the orbital");
        assert_eq!(
            own.host_flags,
            [LaidFlag {
                flag: "has_orbital".to_owned(),
                id_of: None,
            }]
        );
    }
}

/// The cosmogenesis world comes out of the same walk as one planet beside its host. Its
/// colony is what the walk leaves out.
#[test]
fn a_cosmogenesis_world_becomes_one_planet_and_its_colony_is_left_out() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let world =
        lay_out(gd, "cosmogenesis_world_0", &Plan::default()).expect("cosmogenesis_world_0");
    let [planet] = &world.planets[..] else {
        panic!("{:?}", world.planets);
    };
    assert_eq!(planet.class, "pc_cosmogenesis_world");
    assert_eq!(planet.size, Some(3));
    assert_eq!(
        planet.at,
        Orbit {
            around: Around::Host,
            angle: 45.0,
            distance: 19.799,
        }
    );
    assert_eq!(
        planet.flags,
        [
            plain("megastructure"),
            LaidFlag {
                flag: "cosmogenesis_world_resettle".to_owned(),
                id_of: Some(IdOf::Owner),
            }
        ]
    );
    assert_eq!(
        world.host_flags,
        ["has_megastructure", "has_cosmogenesis_world"].map(plain)
    );
    assert_eq!(world.row, None);
    for left_out in ["set_owner", "create_pop_group", "plane_offset"] {
        assert!(
            world.unfollowed.iter().any(|line| line.contains(left_out)),
            "{left_out}: {:?}",
            world.unfollowed
        );
    }
}

/// A chain asked past the stage that removes the structure's row stops there: the frame's
/// rows stand, and the stages built over the gone row are listed rather than walked against
/// the star.
#[test]
fn a_chain_stops_at_the_stage_that_removes_its_row() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let plan = Plan {
        on_star: true,
        sections: Vec::new(),
        culture: None,
        held_flags: Vec::new(),
    };
    let layout =
        lay_out(gd, "ring_world_3_intermediate", &plan).expect("ring_world_3_intermediate");
    assert_eq!(layout.row, None);
    assert_eq!(layout.sections.len(), 4);
    assert!(layout.sections.iter().all(|s| s.row.is_some()));
    assert!(layout.planets.is_empty(), "{:?}", layout.planets);
    assert!(layout.host_flags.is_empty(), "{:?}", layout.host_flags);
    assert_eq!(layout.system_flags, ["ring_world_built"]);
    assert_eq!(
        layout.unfollowed,
        [
            "ring_world_2, ring_world_3_intermediate: built over a row ring_world_2_intermediate removed"
        ]
    );
}

/// A number that is written but cannot be read, a range, an `@variable` no file defines or
/// a parameter left in, skips its spawn and says so, where a missing one counts as 0.
#[test]
fn a_spawn_with_a_number_the_walk_cannot_read_is_skipped_and_listed() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        "mod_spawner = {
	on_build_complete = {
		spawn_megastructure = { type = mod_row orbit_angle = 0 orbit_distance = { min = 40 max = 50 } }
		spawn_megastructure = { type = mod_row orbit_angle = @mod_undefined orbit_distance = 10 }
		mod_spawn_at = { DISTANCE = 5 }
		spawn_planet = { class = pc_mod location = fromfrom.planet orbit_location = yes size = { min = 2 max = 4 } }
		spawn_megastructure = { type = mod_row orbit_angle = 90 }
	}
}
mod_row = { }
",
    ), (
        "common/scripted_effects/mod.txt",
        "mod_spawn_at = {
	spawn_planet = { class = pc_mod location = fromfrom.planet orbit_location = yes orbit_distance_offset = $DISTANCE$ orbit_angle_offset = $ANGLE|10$ }
}
",
    )]);
    let layout = lay_out(&gd, "mod_spawner", &Plan::default()).expect("mod_spawner");
    let at: Vec<_> = layout
        .sections
        .iter()
        .map(|s| (s.at.angle, s.at.distance))
        .collect();
    assert_eq!(at, [(90.0, 0.0)], "only the spawn with nothing unreadable");
    assert!(layout.planets.is_empty(), "{:?}", layout.planets);
    for unreadable in [
        "orbit_distance = { … }",
        "orbit_angle = @mod_undefined",
        "orbit_angle_offset = $ANGLE|10$",
        "size = { … }",
    ] {
        assert!(
            layout
                .unfollowed
                .iter()
                .any(|line| line.contains(unreadable)),
            "{unreadable}: {:?}",
            layout.unfollowed
        );
    }
}

/// `planet = star` is the game's no-link spawn and passes silently. A row spawned on the
/// structure's own body is tied to it. Any other `planet` is listed, since the row's link is
/// not laid out.
#[test]
fn a_row_spawned_on_a_planet_other_than_the_star_or_the_host_is_listed() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        "mod_anchor = {
	on_build_complete = {
		spawn_megastructure = { type = mod_row orbit_angle = 0 orbit_distance = 30 planet = star }
		spawn_megastructure = { type = mod_row orbit_angle = 90 orbit_distance = 30 planet = fromfrom.planet }
		spawn_megastructure = { type = mod_row orbit_angle = 180 orbit_distance = 30 planet = event_target:elsewhere }
	}
}
mod_row = { }
",
    )]);
    let layout = lay_out(&gd, "mod_anchor", &Plan::default()).expect("mod_anchor");
    let tied: Vec<bool> = layout
        .sections
        .iter()
        .map(|section| section.row.as_ref().is_some_and(|row| row.on_host))
        .collect();
    assert_eq!(tied, [false, true, false]);
    assert_eq!(
        layout.unfollowed,
        ["mod_anchor: spawn_megastructure of mod_row with planet = event_target:elsewhere"]
    );
}

/// What a mod's layout writes that the walk cannot lay out is listed: a flag the save may
/// already hold, an effect on planets the same block removes, a culture that names nothing,
/// an orbit beside `coords_from`, and both an angle and its offset round a location. An
/// owner the owner's own block saved as a target is the owner, whatever its case.
#[test]
fn a_mod_layout_lists_what_the_walk_cannot_lay_out() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        "mod_marked = {
	on_build_complete = {
		from = { save_event_target_as = Builder }
		every_system_planet = {
			limit = { is_star = no }
			remove_planet = yes
			add_modifier = { modifier = mod_scorched days = -1 }
		}
		if = {
			limit = { has_star_flag = mod_from_the_save }
			spawn_megastructure = { type = mod_row orbit_angle = 0 orbit_distance = 10 }
		}
		spawn_megastructure = { type = mod_row orbit_angle = 90 orbit_distance = 20 owner = event_target:builder graphical_culture = event_target:nobody }
		spawn_megastructure = { type = mod_row coords_from = fromfrom orbit_distance = 5 }
		spawn_planet = { class = pc_mod location = fromfrom.planet orbit_location = yes orbit_angle = 10 orbit_angle_offset = 20 orbit_distance_offset = 5 }
	}
}
mod_row = { }
",
    )]);
    let layout = lay_out(&gd, "mod_marked", &Plan::default()).expect("mod_marked");
    assert!(layout.cleared);
    let rows: Vec<_> = layout
        .sections
        .iter()
        .map(|s| {
            let row = s.row.as_ref().expect("a standing row");
            (
                row.at.around,
                row.at.angle,
                row.at.distance,
                row.owned,
                row.cultured,
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (Around::Centre, 90.0, 20.0, true, false),
            (Around::Host, 0.0, 0.0, false, false),
        ]
    );
    let [planet] = &layout.planets[..] else {
        panic!("{:?}", layout.planets);
    };
    assert_eq!(
        planet.at,
        Orbit {
            around: Around::Host,
            angle: 10.0,
            distance: 5.0,
        }
    );
    assert_eq!(
        layout.unfollowed,
        [
            "mod_marked: every_system_planet's add_modifier",
            "mod_marked: a branch behind has_star_flag",
            "mod_marked: spawn_megastructure of mod_row with graphical_culture = event_target:nobody",
            "mod_marked: spawn_megastructure of mod_row: an orbit beside coords_from",
            "mod_marked: spawn_planet of pc_mod with both orbit_angle and orbit_angle_offset round its location",
        ]
    );
}
