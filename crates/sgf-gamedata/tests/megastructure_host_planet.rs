//! A megastructure whose chain removes its planet's moons and spawns a planet round it, its
//! row left standing, added to the 4.5 sample by the join the app and the CLI call, on a
//! hand-written install: the moons deleted or kept, the planet written with the row, what
//! the dialog says of the moons, and undo.

use crate::common;

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{MegastructurePlace, NewPlanet, Op, TimedModifier, VariableStep};
use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{
    AddSpot, HostMoons, HostMoonsFit, Planned, Refusal, megastructure_fits, megastructure_op,
};
use sgf_gamedata::registries::megastructures::{Placement, Unsupported};

/// Alari, owned by country 0, whose gas giant 6 has the moons 7, 8 and 9 and whose molten
/// planet 1 has none.
const ALARI: u32 = 169;
const GAS_GIANT: u32 = 6;
const MOLTEN: u32 = 1;
/// Xu Nur, which no one owns, and its planet 585.
const XU_NUR: u32 = 1;

/// An install whose yard raises its owner's counter at its first stage, removes its planet's
/// moons at its second and spawns a ring round the planet at its third, whose named yard
/// spawns a ring named after its planet, and whose moonless structure removes only the moons
/// that are not colonies.
fn yard_fixture() -> (tempfile::TempDir, GameData) {
    common::hand_written(&[(
        "common/megastructures/fx.txt",
        "fx_yard_0 = {
	on_build_complete = {
		from = { change_variable = { which = fx_yards value = 1 } }
		fromfrom.planet = { set_planet_flag = has_megastructure }
	}
}
fx_yard_1 = {
	upgrade_from = { fx_yard_0 }
	on_build_complete = {
		fromfrom.planet = { every_moon = { remove_planet = yes } }
	}
}
fx_yard_2 = {
	upgrade_from = { fx_yard_1 }
	on_build_complete = {
		spawn_planet = {
			class = \"pc_fx_ring\"
			location = fromfrom.planet
			orbit_location = yes
			orbit_angle_offset = 0
			orbit_distance_offset = 0.00001
			size = 12
			init_effect = {
				set_name = \"Processing Ring\"
				set_planet_entity = { entity = \"planetary_ring_entity\" graphical_culture = root.from }
				set_planet_flag = fx_ring
				set_carrier_flag = megastructure
				add_modifier = { modifier = fx_ring_alloys days = -1 }
				planet_event = { id = fx_ring.1 }
			}
		}
	}
}
fx_named_yard = {
	on_build_complete = {
		spawn_planet = {
			class = \"pc_fx_ring\"
			location = fromfrom.planet
			orbit_location = yes
			orbit_angle_offset = 0
			orbit_distance_offset = 0.00001
			size = 12
			init_effect = {
				set_name = { key = \"NAME_Ring_Of\" variable_string = \"[fromfrom.planet.GetName]\" }
			}
		}
	}
}
fx_moonless = {
	on_build_complete = {
		fromfrom.planet = { every_moon = { limit = { is_colony = no } remove_planet = yes } }
	}
}
",
    )])
}

fn planned(gd: &GameData, system: u32, body: u32, kind: &str, moons: HostMoons) -> Planned {
    let place = MegastructurePlace::Body { body };
    megastructure_op(gd, &common::open_4_5(), system, kind, place, false, moons).expect(kind)
}

fn moons_of(session: &Session, body: u32) -> Vec<u32> {
    get_planet_page(session.doc(), body)
        .expect("the planet")
        .moons
        .iter()
        .map(|moon| moon.id)
        .collect()
}

/// Each stage of the yard goes on a planet. The last, on Alari's gas giant with its moons
/// removed, deletes moons 7, 8 and 9 before the row, which comes with the ring round the gas
/// giant: its name plain, its model in country 0's culture, its flags in the order the spawn
/// sets them, its modifier for ever, and the counter its first stage raises. The planet's
/// event is listed as unwritten. Applied, the gas giant's only moon is the ring, which takes
/// moon 7's slot one generation on, as the game reuses the lowest dead slot, in one undo step
/// that puts the bytes back.
#[test]
fn the_yard_deletes_the_moons_and_adds_its_ring_with_the_row() {
    let (_dir, gd) = yard_fixture();
    for key in ["fx_yard_0", "fx_yard_1", "fx_yard_2"] {
        let def = gd.megastructures.get(key).expect(key);
        assert_eq!(def.placement, Placement::Body { star_only: false }, "{key}");
    }
    let planned = planned(&gd, ALARI, GAS_GIANT, "fx_yard_2", HostMoons::Remove);
    assert_eq!(
        planned.unwritten,
        ["fx_yard_2: planet_event on a spawned planet"]
    );
    assert!(planned.unsure.is_empty(), "{:?}", planned.unsure);
    let Op::Batch { description, ops } = &planned.op else {
        panic!("{:?}", planned.op);
    };
    assert_eq!(
        description,
        "Added the Fx Yard 2 at planet #6, removing its 3 moons"
    );
    let [
        Op::DeleteBody { body: 7 },
        Op::DeleteBody { body: 8 },
        Op::DeleteBody { body: 9 },
        Op::AddMegastructure { system, spec },
    ] = &ops[..]
    else {
        panic!("{ops:?}");
    };
    assert_eq!((*system, spec.owner, spec.left_out), (ALARI, Some(0), 1));
    assert_eq!(
        spec.planet,
        Some(NewPlanet {
            class: "pc_fx_ring".to_owned(),
            size: 12,
            at: OrbitPlacement {
                radius: 0.00001,
                angle: 180.0,
            },
            name: "Processing Ring".to_owned(),
            model: Some("mammalian_01_planetary_ring_entity".to_owned()),
            flags: vec!["fx_ring".to_owned(), "megastructure".to_owned()],
            modifiers: vec![TimedModifier {
                modifier: "fx_ring_alloys".to_owned(),
                days: None,
            }],
        })
    );
    let construction = spec.construction.as_ref().expect("the counter");
    assert_eq!(
        construction.variables,
        [VariableStep {
            variable: "fx_yards".to_owned(),
            by: 1,
        }]
    );

    let mut session = common::open_4_5();
    let result = session.apply(planned.op.clone()).expect("the yard");
    let ring = 7 | 1 << 24;
    assert_eq!(result.created.planets, [ring]);
    assert_eq!(moons_of(&session, GAS_GIANT), [ring]);
    assert_eq!(session.history().undo.len(), 1);
    session.undo().expect("undo").expect("an edit");
    assert_eq!(moons_of(&session, GAS_GIANT), [7, 8, 9]);
    assert!(!session.doc().is_dirty());
}

/// With the moons kept the yard is the row and its ring alone, and the ring joins the gas
/// giant's moons. A stage that removes moons but spawns no ring is the row alone when the
/// moons are kept. In Xu Nur, which no one owns, the ring's model is left to its class and
/// no counter is raised.
#[test]
fn the_moons_stay_when_kept_and_an_unowned_ring_takes_its_class_model() {
    let (_dir, gd) = yard_fixture();
    let kept = planned(&gd, ALARI, GAS_GIANT, "fx_yard_2", HostMoons::Keep).op;
    let Op::AddMegastructure { spec, .. } = &kept else {
        panic!("{kept:?}");
    };
    assert!(spec.planet.is_some());
    let mut session = common::open_4_5();
    let result = session.apply(kept).expect("the yard");
    let [ring] = result.created.planets[..] else {
        panic!("{:?}", result.created.planets);
    };
    assert_eq!(moons_of(&session, GAS_GIANT), [7, 8, 9, ring]);

    let stage = planned(&gd, ALARI, GAS_GIANT, "fx_yard_1", HostMoons::Keep).op;
    let Op::AddMegastructure { spec, .. } = &stage else {
        panic!("{stage:?}");
    };
    assert_eq!(spec.planet, None);
    let stage = planned(&gd, ALARI, GAS_GIANT, "fx_yard_1", HostMoons::Remove).op;
    assert!(
        matches!(&stage, Op::Batch { ops, .. } if ops.len() == 4),
        "{stage:?}"
    );

    let unowned = planned(&gd, XU_NUR, 585, "fx_yard_2", HostMoons::Keep).op;
    let Op::AddMegastructure { spec, .. } = &unowned else {
        panic!("{unowned:?}");
    };
    assert_eq!(spec.owner, None);
    assert_eq!(spec.construction, None);
    assert_eq!(spec.planet.as_ref().and_then(|p| p.model.as_deref()), None);
}

/// The dialog says the yard can delete the gas giant's three moons, and that a planet with
/// no moons and a structure that removes none keep them. A structure whose moon removal has
/// a condition removes none. Once moon 7 holds a megastructure, the moons cannot go, and the
/// reason names moon 7, by its key's words with no localisation in the install.
#[test]
fn the_fits_say_what_happens_to_the_moons() {
    let (_dir, gd) = yard_fixture();
    let mut session = common::open_4_5();
    let moons = |session: &Session, system: u32, body: u32, kind: &str| {
        megastructure_fits(&gd, session, system, AddSpot::Body { body })
            .expect("the fits")
            .into_iter()
            .find(|fit| fit.kind == kind)
            .unwrap_or_else(|| panic!("{kind}"))
            .host_moons
    };
    assert_eq!(
        moons(&session, ALARI, GAS_GIANT, "fx_yard_2"),
        HostMoonsFit::Removable { count: 3 }
    );
    assert_eq!(
        moons(&session, ALARI, GAS_GIANT, "fx_yard_0"),
        HostMoonsFit::Kept
    );
    assert_eq!(
        moons(&session, ALARI, GAS_GIANT, "fx_moonless"),
        HostMoonsFit::Kept
    );
    assert_eq!(
        moons(&session, ALARI, MOLTEN, "fx_yard_2"),
        HostMoonsFit::Kept
    );

    let on_moon = planned(&gd, ALARI, 7, "fx_yard_0", HostMoons::Keep).op;
    session.apply(on_moon).expect("a row on moon 7");
    let HostMoonsFit::Refused { reason } = moons(&session, ALARI, GAS_GIANT, "fx_yard_2") else {
        panic!("moon 7 holds a megastructure");
    };
    assert_eq!(
        reason,
        "HUM1 PLANET MadragonsStronghold has a megastructure."
    );
}

/// A ring named after its planet is one the editor cannot write, so the named yard is part
/// of a larger structure, as the add refuses it. Its row still stays with the ring's planet.
#[test]
fn a_ring_named_after_its_planet_leaves_its_yard_whole() {
    let (_dir, gd) = yard_fixture();
    let def = gd
        .megastructures
        .get("fx_named_yard")
        .expect("the named yard");
    assert_eq!(
        def.placement,
        Placement::Unsupported {
            why: Unsupported::WholeStructure { star_only: false },
        }
    );
    let place = MegastructurePlace::Body { body: MOLTEN };
    let refused = megastructure_op(
        &gd,
        &common::open_4_5(),
        ALARI,
        "fx_named_yard",
        place,
        false,
        HostMoons::Keep,
    );
    assert!(
        matches!(&refused, Err(Refusal::NotAdded { kind, .. }) if kind == "fx_named_yard"),
        "{refused:?}"
    );
    let host_planet = |key: &str| {
        gd.megastructure_views()
            .into_iter()
            .find(|view| view.def.key == key)
            .map(|view| view.host_planet)
    };
    assert_eq!(host_planet("fx_named_yard"), Some(true));
    assert_eq!(host_planet("fx_yard_2"), Some(true));
    assert_eq!(host_planet("fx_yard_1"), Some(false));
}
