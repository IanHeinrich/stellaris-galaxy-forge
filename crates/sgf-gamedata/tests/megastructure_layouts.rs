//! What finishing a megastructure leaves in its system, replayed from the real install's
//! build chains: the ring world's rows and segments, stage by stage per quadrant, and the
//! habitat a Habitat Central Complex becomes and the one the editor adds for it, and the ring
//! world the editor adds quadrant by quadrant.

use crate::common;

use sgf_core::ops::{HabitatOrbital, NewHabitat, RingModifier, RingQuadrant, RingRow};
use sgf_core::views::OrbitPlacement;
use sgf_gamedata::GameData;
use sgf_gamedata::construction::habitat::habitat;
use sgf_gamedata::construction::layout::{
    Around, IdOf, LaidFlag, LaidPlanet, LaidRow, Orbit, Plan, SectionStage, SystemLayout, lay_out,
};
use sgf_gamedata::construction::ring_world::{self as added, RingStage};
use sgf_gamedata::registries::megastructures::{Placement, Unsupported};

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

/// The Habitat Central Complex and its restored version are added as the habitat their
/// completion leaves, the model in the owner's culture. The restored version also leaves a
/// major orbital at the habitat's body, named from the system. The ruin stays a row, and the
/// cosmogenesis world, which ties no habitat flag to its host, is no habitat.
#[test]
fn the_complex_and_its_restored_version_are_added_as_a_habitat() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let major = HabitatOrbital {
        kind: "habitat_major_orbital".to_owned(),
        owner: None,
        name: Some("TARGET_ORBITAL_NAME".to_owned()),
        system_name: Some("prevprev.GetName".to_owned()),
    };
    for (key, orbital) in [
        ("habitat_central_complex", None),
        ("habitat_central_complex_restored", Some(major)),
    ] {
        for (on_star, radius) in [(true, 19.798), (false, 9.899)] {
            let found = habitat(gd, key, on_star, Some("avian_01")).expect(key);
            assert_eq!(
                found,
                NewHabitat {
                    class: "pc_habitat".to_owned(),
                    size: 6,
                    at: OrbitPlacement {
                        radius,
                        angle: 315.0,
                    },
                    name: "HABITAT_PLANET_NAME".to_owned(),
                    system_name: Some("prev.solar_system.GetName".to_owned()),
                    model: Some("avian_01_habitat_phase_03_entity".to_owned()),
                    flags: ["megastructure", "habitat", "habitat_level_1"]
                        .map(str::to_owned)
                        .to_vec(),
                    orbital: orbital.clone(),
                },
                "{key}"
            );
        }
        let unowned = habitat(gd, key, true, None).expect(key);
        assert_eq!(unowned.model, None, "{key}: the class's own model");
    }
    for key in ["habitat_central_complex_ruined", "cosmogenesis_world_0"] {
        assert_eq!(habitat(gd, key, false, None), None, "{key}");
    }
}

/// The ring world the editor adds, quadrant by quadrant: A finished in the owner's culture,
/// B a frame row named and owned, C a ruined row with no name or culture and D damaged,
/// named as the game's initializers name a damaged segment. The flags the chain leaves are
/// the system's.
#[test]
fn the_ring_world_is_added_with_each_quadrant_at_its_stage() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    use RingStage::*;
    let stages = [Finished, Frame, Ruined, Damaged];
    let ring = added::ring_world(
        gd,
        "ring_world_2_intermediate",
        &stages,
        Some("avian_01"),
        &[],
    )
    .expect("the vanilla ring world");
    assert_eq!(ring.system_flags, ["ring_world_built", "ring_section_1"]);
    let [a, b, c, d] = &ring.quadrants[..] else {
        panic!("{:?}", ring.quadrants);
    };
    let RingQuadrant::Finished { segments } = a else {
        panic!("{a:?}");
    };
    let shown: Vec<_> = segments
        .iter()
        .map(|s| {
            (
                s.class.as_str(),
                s.at.angle,
                s.at.radius,
                s.name.as_str(),
                s.model.as_deref(),
                s.megastructure_icon,
            )
        })
        .collect();
    assert_eq!(
        shown,
        [
            (
                "pc_ringworld_tech",
                210.0,
                45.0,
                "NAME_Ring_Section",
                Some("avian_01_ringworld_tech_entity_01_entity"),
                false
            ),
            (
                "pc_ringworld_seam",
                180.0,
                45.0,
                "NAME_Ring_Section",
                Some("avian_01_ringworld_seam_entity_01_entity"),
                false
            ),
            (
                "pc_ringworld_habitable",
                150.0,
                45.0,
                "NAME_Habitable_Section_A",
                Some("avian_01_ringworld_habitable_entity_01_entity"),
                true
            ),
        ]
    );
    assert!(
        segments
            .iter()
            .all(|s| s.size == 10 && s.flags == ["megastructure"])
    );
    let row = |kind: &str, angle: f64, name: Option<&str>, culture: Option<&str>| RingRow {
        kind: kind.to_owned(),
        at: OrbitPlacement {
            radius: 45.0,
            angle,
        },
        name: name.map(str::to_owned),
        owned: true,
        culture: culture.map(str::to_owned),
    };
    assert_eq!(
        b,
        &RingQuadrant::Frame {
            row: row(
                "ring_world_2",
                270.0,
                Some("NAME_Ring_Section_B"),
                Some("avian_01")
            )
        }
    );
    assert_eq!(
        c,
        &RingQuadrant::Ruined {
            row: row("ring_world_ruined", 0.0, None, None)
        }
    );
    let RingQuadrant::Damaged { segments } = d else {
        panic!("{d:?}");
    };
    assert!(
        segments
            .iter()
            .all(|s| s.name == "NAME_Ring_Section" && s.model.is_none() && s.flags.is_empty()),
        "{segments:?}"
    );

    let unowned = added::ring_world(gd, "ring_world_2_intermediate", &[Finished; 4], None, &[])
        .expect("ring");
    assert!(unowned.quadrants.iter().all(|q| match q {
        RingQuadrant::Finished { segments } => segments.iter().all(|s| s.model.is_none()),
        _ => false,
    }));
    assert_eq!(unowned.system_flags, ["ring_world_built"]);
    assert!(
        unowned.star_flags.is_empty(),
        "the base game's chain flags no star"
    );
    for (key, stages) in [
        ("ring_world_2_intermediate", &[Finished; 3][..]),
        ("habitat_central_complex", &[Finished][..]),
    ] {
        assert_eq!(
            added::ring_world(gd, key, stages, None, &[]),
            Err(format!(
                "no stage of its chain lays out a ring world of {} quadrants",
                stages.len()
            )),
            "{key}"
        );
    }
}

/// A segment whose model hangs on a branch the walk cannot judge, here on a country flag of
/// the owner, is refused with what was left out, rather than written with no model. A plain
/// word that names no culture the install defines is no culture, a quoted one is, and `from`
/// after a link other than `root` or `prev` names nothing the walk knows.
#[test]
fn a_ring_the_walk_cannot_follow_is_refused_with_the_reason() {
    use RingStage::*;
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        "mod_ring_frame = {
	on_build_complete = {
		spawn_megastructure = { type = mod_ring_2 orbit_angle = 0 orbit_distance = 50 owner = from graphical_culture = from init_effect = { set_graphical_culture = owner } }
		spawn_megastructure = { type = mod_ring_2 orbit_angle = 180 orbit_distance = 50 owner = fromfrom.from init_effect = { set_graphical_culture = \"mod_culture\" } }
		remove_megastructure = fromfrom
	}
}
mod_ring_2 = { }
mod_ring_3 = {
	upgrade_from = { mod_ring_2 }
	on_build_complete = {
		spawn_planet = {
			class = pc_mod_segment
			location = fromfrom
			size = 10
			init_effect = {
				save_event_target_as = mod_segment
				prev.from = {
					if = {
						limit = { has_country_flag = mod_shipset }
						event_target:mod_segment = { set_planet_entity = { entity = mod_a_entity } }
					}
					else = { event_target:mod_segment = { set_planet_entity = { entity = mod_b_entity } } }
				}
			}
		}
		remove_megastructure = fromfrom
	}
}
",
    )]);
    let frame = added::ring_world(
        &gd,
        "mod_ring_frame",
        &[Frame, Frame],
        Some("mod_owner"),
        &[],
    )
    .expect("two frame rows");
    let cultures: Vec<_> = frame
        .quadrants
        .iter()
        .map(|q| match q {
            RingQuadrant::Frame { row } => (row.owned, row.culture.clone()),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        cultures,
        [
            (true, Some("mod_owner".to_owned())),
            (false, Some("mod_culture".to_owned()))
        ]
    );
    let plan = Plan {
        on_star: true,
        sections: Vec::new(),
        culture: None,
        held_flags: Vec::new(),
    };
    let laid = lay_out(&gd, "mod_ring_frame", &plan).expect("mod_ring_frame");
    for unfollowed in [
        "set_graphical_culture = owner",
        "with owner = fromfrom.from",
    ] {
        assert!(
            laid.unfollowed.iter().any(|line| line.contains(unfollowed)),
            "{unfollowed}: {:?}",
            laid.unfollowed
        );
    }

    let refused = added::ring_world(
        &gd,
        "mod_ring_2",
        &[Finished, Finished],
        Some("mod_owner"),
        &[],
    )
    .expect_err("a model behind a country flag");
    assert!(
        refused.starts_with("the model of its pc_mod_segment hangs on what Galaxy Forge cannot follow: mod_ring_3: a branch behind has_country_flag"),
        "{refused}"
    );
}

/// With Gigastructural Engineering enabled, its own ring world chain is added as it built
/// Acahuabene in a 4.5.2 save: rows named "Ring Section A" to "D" in `mammalian_01`, which
/// Giga gives a ring of any culture outside its ten, segments drawn in the owner's
/// `biogenesis_01` from Giga's own models, its flags, `ring_world_built` with the fourth
/// section and the section count `ring_segments`. A culture Giga has no model for takes the
/// base game's. Runs with `SGF_PLAYSET=1` when the enabled mods include Giga.
#[test]
fn gigas_ring_world_is_added_as_it_builds_one() {
    if std::env::var_os("SGF_PLAYSET").is_none_or(|v| v != "1") {
        eprintln!("skipped: SGF_PLAYSET=1 reads the enabled mods");
        return;
    }
    let gd = sgf_gamedata::load(&sgf_gamedata::LoadOptions::default(), &mut |_| {})
        .expect("SGF_PLAYSET needs an install");
    let giga = gd
        .megastructures
        .get("ring_world_2_intermediate")
        .and_then(|def| def.source.as_deref())
        .is_some_and(|source| source.starts_with("Gigastructural"));
    if !giga {
        eprintln!("skipped: Gigastructural Engineering is not enabled");
        return;
    }
    use RingStage::*;
    let culture = Some("biogenesis_01");
    let ring = added::ring_world(&gd, "ring_world_1", &[Finished; 4], culture, &[]).expect("ring");
    assert_eq!(ring.star_flags, ["has_megastructure"]);
    assert_eq!(
        ring.system_flags,
        [
            "giga_forbid_planet_dismantlement",
            "ring_01",
            "ring_02",
            "ring_03",
            "ring_world_built",
            "ring_04"
        ]
    );
    assert_eq!(
        ring.system_variables
            .iter()
            .map(|v| (v.name.as_str(), v.value))
            .collect::<Vec<_>>(),
        [("ring_segments", 0.0)]
    );
    let RingQuadrant::Finished { segments } = &ring.quadrants[0] else {
        panic!("{:?}", ring.quadrants[0]);
    };
    let shown: Vec<_> = segments
        .iter()
        .map(|s| {
            (
                s.at.angle,
                s.name.as_str(),
                s.model.as_deref(),
                s.flags.iter().map(String::as_str).collect::<Vec<_>>(),
                s.megastructure_icon,
            )
        })
        .collect();
    assert_eq!(
        shown,
        [
            (
                210.0,
                "Ring Section",
                Some("biogenesis_01_vanilla_tech_entity"),
                vec![
                    "forbid_guillis_planet_modifiers",
                    "megastructure",
                    "colony_event"
                ],
                false
            ),
            (
                180.0,
                "Ring Section",
                Some("biogenesis_01_vanilla_seam_entity"),
                vec!["forbid_guillis_planet_modifiers", "megastructure"],
                false
            ),
            (
                150.0,
                "Habitable Section A",
                Some("biogenesis_01_vanilla_gaia_habitable_entity"),
                vec![
                    "forbid_guillis_planet_modifiers",
                    "megastructure",
                    "colony_event",
                    "giga_ringworld_van"
                ],
                true
            ),
        ]
    );

    let begun = added::ring_world(
        &gd,
        "ring_world_2",
        &[Finished, Frame, Frame, Frame],
        culture,
        &[],
    )
    .expect("one section finished");
    assert_eq!(
        begun.system_flags,
        ["giga_forbid_planet_dismantlement", "ring_01"]
    );
    assert_eq!(begun.system_variables[0].value, 1.0);
    let RingQuadrant::Frame { row } = &begun.quadrants[1] else {
        panic!("{:?}", begun.quadrants[1]);
    };
    assert_eq!(row.kind, "ring_world_2");
    assert_eq!(row.name.as_deref(), Some("Ring Section B"));
    assert_eq!(row.culture.as_deref(), Some("mammalian_01"));
    assert_eq!(row.at.angle, 270.0);

    let other = added::ring_world(&gd, "ring_world_2", &[Finished; 4], Some("nowhere_01"), &[])
        .expect("a culture Giga lists no model for");
    let RingQuadrant::Finished { segments } = &other.quadrants[0] else {
        panic!("{:?}", other.quadrants[0]);
    };
    assert_eq!(
        segments[0].model.as_deref(),
        Some("nowhere_01_tech_entity_01_entity")
    );
}

/// A mod's restored complex that picks the ruin's body by a carrier flag and spawns its
/// habitat without tying it to the host is still added as a habitat: the one its working
/// type leaves, with the orbital it spawns at the host.
#[test]
fn a_mod_restored_complex_falls_back_to_its_working_types_habitat() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        r#"mod_complex = {
	on_build_complete = {
		spawn_planet = {
			class = pc_habitat location = fromfrom.planet orbit_location = yes
			orbit_angle_offset = 135 orbit_distance_offset = 9.899 size = 6
			init_effect = {
				set_name = { key = HABITAT_PLANET_NAME variable_string = "\[prev.solar_system.GetName]" }
				set_planet_flag = habitat
				fromfrom.planet = { set_planet_flag = habitat@PREV }
			}
		}
		fromfrom.solar_system = { set_star_flag = has_habitat }
		remove_megastructure = fromfrom
	}
}
mod_complex_ruined = { }
mod_complex_restored = {
	upgrade_from = { mod_complex_ruined }
	on_build_complete = {
		solar_system = {
			random_system_planet = {
				limit = { has_carrier_flag = mod_build_site }
				save_event_target_as = target_planet
			}
		}
		spawn_planet = {
			class = pc_habitat location = event_target:target_planet orbit_location = yes
			orbit_angle_offset = 135 orbit_distance_offset = 9.899 size = 6
			init_effect = {
				set_name = { key = HABITAT_PLANET_NAME variable_string = "\[prev.solar_system.GetName]" }
				set_planet_flag = habitat
			}
		}
		spawn_megastructure = {
			type = mod_orbital
			owner = from
			graphical_culture = from
			planet = event_target:target_planet
			coords_from = event_target:target_planet
		}
		fromfrom.solar_system = { set_star_flag = has_habitat }
		remove_megastructure = fromfrom
	}
}
mod_orbital = {
	on_build_complete = {
		fromfrom.planet = { set_carrier_flag = has_orbital }
	}
}
"#,
    )]);
    let complex = habitat(&gd, "mod_complex", false, None).expect("mod_complex");
    assert_eq!(complex.orbital, None);
    let restored = habitat(&gd, "mod_complex_restored", false, None).expect("the restored type");
    assert_eq!(
        restored,
        NewHabitat {
            orbital: Some(HabitatOrbital {
                kind: "mod_orbital".to_owned(),
                owner: None,
                name: None,
                system_name: None,
            }),
            ..complex
        }
    );
}

/// A ring world is told by what its chain spawns, not by its keys: a frame that spawns rows
/// a stage builds into ring world segments. Its site is added as a row and every other stage
/// whole, and a ruin whose key reads as the chain's without its underscores joins it. The
/// habitable sections are named on from the ladder flags the system holds, the frame rows
/// take the culture the spawn writes out, and a habitable section keeps its timed modifier.
/// A chain with no ruined type refuses a ruined quadrant, and one the install's ruin effect
/// leaves alone refuses a damaged one.
#[test]
fn a_ring_is_told_by_what_its_chain_spawns_and_names_on_from_the_systems_ladder() {
    use RingStage::*;
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        r#"fxring_0 = { }
fxring_1 = {
	upgrade_from = { fxring_0 }
	on_build_complete = {
		spawn_megastructure = { name = "Ring Section E" type = fxring_section orbit_angle = 0 orbit_distance = 60 owner = from graphical_culture = "fx_culture" }
		spawn_megastructure = { name = "Ring Section F" type = fxring_section orbit_angle = 180 orbit_distance = 60 owner = from graphical_culture = "fx_culture" }
		remove_megastructure = fromfrom
	}
}
fxring_section = { upgrade_from = { fxring_1 } }
fxring_2 = {
	upgrade_from = { fxring_section }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 init_effect = { set_name = "Ring Section" } }
		spawn_planet = {
			class = pc_ringworld_habitable location = fromfrom orbit_angle_offset = -30 size = 20
			init_effect = {
				save_event_target_as = ring_section
				add_modifier = { modifier = "fx_housing" days = -1 }
			}
		}
		if = { limit = { NOT = { has_star_flag = ring_01 } } set_star_flag = ring_01 event_target:ring_section = { set_name = "Habitable Section A" } }
		else_if = { limit = { NOT = { has_star_flag = ring_02 } } set_star_flag = ring_02 event_target:ring_section = { set_name = "Habitable Section B" } }
		else_if = { limit = { NOT = { has_star_flag = ring_03 } } set_star_flag = ring_03 event_target:ring_section = { set_name = "Habitable Section C" } }
		else_if = { limit = { NOT = { has_star_flag = ring_04 } } set_star_flag = ring_04 event_target:ring_section = { set_name = "Habitable Section D" } }
		remove_megastructure = fromfrom
	}
}
fx_ring_ruined = { }
fx_ring_restored = { upgrade_from = { fx_ring_ruined } }
fy_frame = {
	on_build_complete = {
		spawn_megastructure = { type = fy_section orbit_angle = 0 orbit_distance = 60 }
		spawn_megastructure = { type = fy_section orbit_angle = 180 orbit_distance = 60 }
		remove_megastructure = fromfrom
	}
}
fy_section = { upgrade_from = { fy_frame } }
fy_built = {
	upgrade_from = { fy_section }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 init_effect = { set_name = "Ring Section" } }
		remove_megastructure = fromfrom
	}
}
fz_frame = {
	on_build_complete = {
		spawn_megastructure = { type = fz_section orbit_angle = 0 orbit_distance = 60 }
		spawn_megastructure = { type = fz_section orbit_angle = 180 orbit_distance = 60 }
		remove_megastructure = fromfrom
	}
}
fz_section = { upgrade_from = { fz_frame } }
fz_built = {
	upgrade_from = { fz_section }
	on_build_complete = {
		spawn_planet = { class = pc_alderson_slice location = fromfrom size = 10 }
		remove_megastructure = fromfrom
	}
}
"#,
    )]);
    let placement = |key: &str| gd.megastructures.get(key).expect(key).placement.clone();
    assert_eq!(placement("fxring_0"), Placement::Body { star_only: false });
    for key in [
        "fxring_1",
        "fxring_section",
        "fxring_2",
        "fx_ring_ruined",
        "fx_ring_restored",
    ] {
        assert_eq!(
            placement(key),
            Placement::Unsupported {
                why: Unsupported::RingWorld
            },
            "{key}"
        );
    }
    assert!(
        matches!(
            placement("fz_section"),
            Placement::Unsupported {
                why: Unsupported::WholeStructure { .. }
            }
        ),
        "a chain whose planets are no ring world segments stays a whole structure"
    );
    assert_eq!(
        gd.megastructures
            .get("fx_ring_ruined")
            .expect("the ruin")
            .variant_of
            .as_deref(),
        Some("fxring_0")
    );
    assert_eq!(added::quadrants(&gd, "fxring_section"), Some(2));

    let held = ["ring_01", "ring_02"].map(str::to_owned);
    let ring = added::ring_world(&gd, "fxring_0", &[Finished, Finished], None, &held)
        .expect("two finished quadrants");
    let habitable: Vec<_> = ring
        .quadrants
        .iter()
        .map(|q| match q {
            RingQuadrant::Finished { segments } => {
                let section = &segments[1];
                (
                    section.name.as_str(),
                    section.size,
                    section.modifiers.clone(),
                )
            }
            other => panic!("{other:?}"),
        })
        .collect();
    let housing = vec![RingModifier {
        modifier: "fx_housing".to_owned(),
        days: -1,
    }];
    assert_eq!(
        habitable,
        [
            ("Habitable Section C", 20, housing.clone()),
            ("Habitable Section D", 20, housing)
        ]
    );
    assert_eq!(ring.system_flags, ["ring_03", "ring_04"]);

    let begun = added::ring_world(&gd, "fxring_0", &[Frame, Ruined], Some("avian_01"), &[])
        .expect("a frame and a ruin");
    let rows: Vec<_> = begun
        .quadrants
        .iter()
        .map(|q| match q {
            RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => (
                row.kind.as_str(),
                row.name.as_deref(),
                row.culture.as_deref(),
            ),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("fxring_section", Some("Ring Section E"), Some("fx_culture")),
            ("fx_ring_ruined", None, None)
        ]
    );
    assert_eq!(
        added::ring_world(&gd, "fy_frame", &[Finished, Ruined], None, &[]),
        Err("its chain has no ruined type to stand in place of its fy_section row".to_owned())
    );
    assert_eq!(
        added::ring_world(&gd, "fxring_0", &[Damaged, Frame], None, &[]),
        Err(
            "the game's set_ruined_megastructure leaves its fxring_section row as it is".to_owned()
        )
    );
}

/// With Gigastructural Engineering enabled, its titanic, behemoth and gargantuan rings are
/// ring worlds the editor adds whole, as the chain builds them: radius 90, 134 and 179,
/// habitable sections of size 20, 30 and 40 with the family's housing modifier, Giga's
/// `_sector_entity` models, frame rows named from Ring Section E, I and M in `mammalian_01`, and
/// the flags each leaves. Beside a base game ring holding `ring_01` to `ring_04`, the
/// habitable sections are named E to H. A damaged quadrant is refused: the game's ruin
/// effect knows no row of theirs. Runs with `SGF_PLAYSET=1` when the enabled mods include
/// Giga.
#[test]
fn gigas_larger_rings_are_added_whole() {
    if std::env::var_os("SGF_PLAYSET").is_none_or(|v| v != "1") {
        eprintln!("skipped: SGF_PLAYSET=1 reads the enabled mods");
        return;
    }
    let gd = sgf_gamedata::load(&sgf_gamedata::LoadOptions::default(), &mut |_| {})
        .expect("SGF_PLAYSET needs an install");
    if gd.megastructures.get("ringworld_titanic_0").is_none() {
        eprintln!("skipped: Gigastructural Engineering is not enabled");
        return;
    }
    use RingStage::*;
    let held = ["ring_01", "ring_02", "ring_03", "ring_04"].map(str::to_owned);
    let culture = Some("biogenesis_01");
    let views = gd.megastructure_views();
    for (size, short, letter, radius, habitable, built) in [
        ("titanic", "tit", "E", 90.0, 20, "ring_world_built_one"),
        ("behemoth", "beh", "I", 134.0, 30, "ring_world_built_two"),
        (
            "gargantuan",
            "gar",
            "M",
            179.0,
            40,
            "ring_world_built_three",
        ),
    ] {
        let site = format!("ringworld_{size}_0");
        let frame = format!("ringworld_{}_3x_segment", &size[..1]);
        let mega = |key: &str| gd.megastructures.get(key).expect(key);
        assert_eq!(mega(&site).placement, Placement::Body { star_only: true });
        for key in [
            format!("ringworld_{size}_1"),
            frame.clone(),
            format!("ringworld_{size}_2"),
            format!("ring_world_{size}_ruined"),
            format!("ring_world_{size}_restored"),
        ] {
            assert_eq!(
                mega(&key).placement,
                Placement::Unsupported {
                    why: Unsupported::RingWorld
                },
                "{key}"
            );
            let view = views.iter().find(|v| v.def.key == key).expect("its view");
            assert_eq!(view.ring_world_refused, None, "{key}");
        }
        assert_eq!(
            mega(&format!("ring_world_{size}_ruined"))
                .variant_of
                .as_deref(),
            Some(site.as_str())
        );

        let ring = added::ring_world(&gd, &site, &[Finished; 4], culture, &held).expect(&site);
        assert_eq!(ring.star_flags, ["has_megastructure"], "{size}");
        assert_eq!(
            ring.system_flags,
            [
                format!("giga_has_{size}_ring"),
                "ring_05".to_owned(),
                "ring_06".to_owned(),
                "ring_07".to_owned(),
                built.to_owned(),
                "ring_08".to_owned(),
            ],
            "{size}"
        );
        let names: Vec<&str> = ring
            .quadrants
            .iter()
            .map(|q| match q {
                RingQuadrant::Finished { segments } => segments[2].name.as_str(),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(
            names,
            [
                "Habitable Section E",
                "Habitable Section F",
                "Habitable Section G",
                "Habitable Section H"
            ]
        );
        let RingQuadrant::Finished { segments } = &ring.quadrants[0] else {
            panic!("{:?}", ring.quadrants[0]);
        };
        let shown: Vec<_> = segments
            .iter()
            .map(|s| {
                (
                    s.class.as_str(),
                    s.size,
                    s.at.radius,
                    s.model.clone(),
                    s.modifiers
                        .iter()
                        .map(|m| (m.modifier.clone(), m.days))
                        .collect::<Vec<_>>(),
                )
            })
            .collect();
        let model = |part: &str| Some(format!("biogenesis_01_{size}_{part}_sector_entity"));
        assert_eq!(
            shown,
            [
                ("pc_ringworld_tech", 10, radius, model("tech"), vec![]),
                ("pc_ringworld_seam", 10, radius, model("seam"), vec![]),
                (
                    "pc_ringworld_habitable",
                    habitable,
                    radius,
                    model("gaia_habitable"),
                    vec![(format!("giga_{size}_housing"), -1)]
                ),
            ],
            "{size}"
        );
        assert!(
            segments[2]
                .flags
                .contains(&format!("giga_ringworld_{short}")),
            "{:?}",
            segments[2].flags
        );

        let begun = added::ring_world(&gd, &site, &[Frame, Ruined, Frame, Frame], culture, &[])
            .expect("frames and a ruin");
        let RingQuadrant::Frame { row } = &begun.quadrants[0] else {
            panic!("{:?}", begun.quadrants[0]);
        };
        assert_eq!(
            (
                row.kind.as_str(),
                row.name.as_deref(),
                row.culture.as_deref(),
                row.at.radius
            ),
            (
                frame.as_str(),
                Some(format!("Ring Section {letter}").as_str()),
                Some("mammalian_01"),
                radius
            )
        );
        let RingQuadrant::Ruined { row } = &begun.quadrants[1] else {
            panic!("{:?}", begun.quadrants[1]);
        };
        assert_eq!(row.kind, format!("ring_world_{size}_ruined"));
        assert_eq!(
            added::ring_world(&gd, &site, &[Damaged; 4], culture, &[]),
            Err(format!(
                "the game's set_ruined_megastructure leaves its {frame} row as it is"
            ))
        );
    }
}
