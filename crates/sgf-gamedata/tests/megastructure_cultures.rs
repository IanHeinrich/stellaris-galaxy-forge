//! The graphical culture an added row names when nobody owns it: the one a model only defined
//! per culture needs, on the real install and on a hand-written one, whichever op adds the row.

use crate::common;

use sgf_core::ops::{MegastructurePlace, Op, RingQuadrant};
use sgf_gamedata::GameData;
use sgf_gamedata::construction::ring_world::RingStage;
use sgf_gamedata::generate::{HostMoons, habitat_op, megastructure_op, ring_world_op, special_op};

use common::layouts::FILES;
use common::prepare::current;
use common::{SPOT, hand_written, members, open_4_5, written};

/// Xu Nur, which nobody owns, with planet 585 round star 584.
const XU_NUR: u32 = 1;
const PLANET: MegastructurePlace = MegastructurePlace::Body { body: 585 };
const STAR: MegastructurePlace = MegastructurePlace::Body { body: 584 };
const POINT: MegastructurePlace = MegastructurePlace::Free { x: 0.0, y: -10.0 };
/// Alari, which country 0 owns, whose culture is `mammalian_01`, with gas giant 6.
const ALARI: u32 = 169;
const GAS_GIANT: MegastructurePlace = MegastructurePlace::Body { body: 6 };

fn add(gd: &GameData, system: u32, kind: &str, place: MegastructurePlace) -> Op {
    megastructure_op(gd, &open_4_5(), system, kind, place, false, HostMoons::Keep)
        .unwrap_or_else(|e| panic!("{kind}: {e}"))
        .op
}

/// The culture `op`, an `AddMegastructure`, gives its row.
fn culture(op: &Op) -> Option<&str> {
    match op {
        Op::AddMegastructure { spec, .. } => spec.culture.as_deref(),
        other => panic!("{other:?}"),
    }
}

/// What `op` writes into the 4.5 sample, once undo and redo have put the same bytes back.
fn round_trip(op: Op) -> String {
    let mut session = open_4_5();
    session.apply(op).expect("the add");
    let added = written(&session);
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(&session), session.doc().original());
    session.redo().expect("redo").expect("the add");
    assert_eq!(written(&session), added);
    added
}

/// The lines of the row of type `kind` in `added`, up to its build queue.
fn row<'t>(added: &'t str, kind: &str) -> &'t str {
    let start = added
        .find(&format!("type=\"{kind}\""))
        .unwrap_or_else(|| panic!("{kind}: {added}"));
    let end = start + added[start..].find("build_queue=").expect("the row's end");
    &added[start..end]
}

/// On the real install, a row of a type whose model has only its cultures' entities names
/// `mammalian_01` and no owner, and one whose model has an entity of its own, as every ruin's
/// and the L-Gate's has, names neither. In a system somebody owns the row is its owner's.
#[test]
fn an_unowned_row_names_a_culture_when_its_model_needs_one() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    for (kind, place, culture) in [
        ("think_tank_3", PLANET, Some("mammalian_01")),
        ("dyson_sphere_5", STAR, Some("mammalian_01")),
        ("gateway_final", POINT, Some("mammalian_01")),
        ("hyper_relay", POINT, Some("mammalian_01")),
        ("think_tank_ruined", PLANET, None),
        ("gateway_ruined", POINT, None),
        ("lgate_base", POINT, None),
    ] {
        let added = round_trip(add(gd, XU_NUR, kind, place));
        let row = row(&added, kind);
        assert!(!row.contains("owner="), "{row}");
        match culture {
            Some(culture) => assert!(
                row.contains(&format!("graphical_culture=\"{culture}\"\n")),
                "{row}"
            ),
            None => assert!(!row.contains("graphical_culture"), "{row}"),
        }
    }
    let op = add(gd, ALARI, "think_tank_3", GAS_GIANT);
    assert_eq!(culture(&op), None);
    let added = round_trip(op);
    assert!(
        row(&added, "think_tank_3").contains("owner=0\n+\t\tgraphical_culture=\"mammalian_01\"\n"),
        "{added}"
    );
}

/// On the real install, the orbital a restored Habitat Central Complex leaves names a culture
/// where nobody owns it, and the ring world's frame row, whose model has an entity of its own,
/// names none.
#[test]
fn an_unowned_orbital_names_a_culture_and_a_ring_frame_none() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let orbital = |system, body| {
        let op = habitat_op(
            gd,
            &open_4_5(),
            system,
            body,
            "habitat_central_complex_restored",
        )
        .expect("the habitat")
        .op;
        let Op::AddHabitat { habitat, .. } = &op else {
            panic!("{op:?}");
        };
        let orbital = habitat.orbital.clone().expect("the major orbital");
        (orbital.owner, orbital.culture, round_trip(op))
    };
    let (owner, culture, added) = orbital(XU_NUR, 585);
    assert_eq!(
        (owner, culture.as_deref()),
        (None, Some("mammalian_01")),
        "{added}"
    );
    let orbital_row = row(&added, "habitat_major_orbital");
    assert!(
        orbital_row.contains("graphical_culture=\"mammalian_01\"\n")
            && !orbital_row.contains("owner="),
        "{orbital_row}"
    );
    let (owner, culture, _) = orbital(ALARI, 6);
    assert_eq!((owner, culture), (Some(0), None));

    let stages = [RingStage::Frame; 4];
    let ring = ring_world_op(
        gd,
        &open_4_5(),
        XU_NUR,
        "ring_world_2_intermediate",
        &stages,
        false,
    )
    .expect("the ring");
    assert_eq!(ring_cultures(&ring.op), [None; 4]);
}

/// The culture of each row of the ring world `op` adds.
fn ring_cultures(op: &Op) -> Vec<Option<&str>> {
    let ring = members(op)
        .into_iter()
        .find_map(|op| match op {
            Op::AddRingWorld { ring, .. } => Some(ring),
            _ => None,
        })
        .expect("a ring world");
    ring.quadrants
        .iter()
        .filter_map(|quadrant| match quadrant {
            RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => {
                Some(row.culture.as_deref())
            }
            _ => None,
        })
        .collect()
}

const CULTURES: (&str, &str) = (
    "common/graphical_culture/fx.txt",
    "mammalian_01 = { }\nfx_zinc = { }\nfx_iron = { }\nfx_none = { }\n",
);
const ENTITIES: (&str, &str) = (
    "gfx/models/fx/fx.asset",
    "entity = { name = \"fx_iron_all_entity\" }
entity = { name = \"mammalian_01_all_entity\" }
entity = { name = \"fx_zinc_styled_entity\" }
entity = { name = \"fx_iron_styled_entity\" }
entity = { name = \"fx_iron_bare_entity\" }
entity = { name = \"mammalian_01_bare_entity\" }
entity = { name = \"bare_entity\" }
entity = { name = \"fx_unlisted_other_entity\" }
",
);

/// A mod's type takes `mammalian_01` when its model has an entity in it, else the first culture
/// by key its model has one in. A model with an entity of its own, one whose only prefix is no
/// culture's, one nothing defines and a type with no model name none.
#[test]
fn a_mods_row_takes_a_culture_its_model_is_defined_in() {
    let (_dir, gd) = hand_written(&[
        CULTURES,
        ENTITIES,
        (
            "common/megastructures/fx.txt",
            "fx_all = { entity = all_entity }
fx_styled = { entity = styled_entity }
fx_bare = { entity = bare_entity }
fx_other = { entity = other_entity }
fx_missing = { entity = missing_entity }
fx_plain = { entity = \"\" }
",
        ),
    ]);
    for (kind, expected) in [
        ("fx_all", Some("mammalian_01")),
        ("fx_styled", Some("fx_iron")),
        ("fx_bare", None),
        ("fx_other", None),
        ("fx_missing", None),
        ("fx_plain", None),
    ] {
        assert_eq!(culture(&add(&gd, XU_NUR, kind, PLANET)), expected, "{kind}");
        let owned = add(&gd, ALARI, kind, GAS_GIANT);
        assert_eq!(culture(&owned), None, "{kind}: its owner's");
    }
}

/// A ring world's row nobody owns names the culture its spawn writes out, or one its model has
/// an entity in, only when its model needs one.
#[test]
fn an_unowned_rings_rows_take_the_culture_their_spawns_name() {
    let (_dir, gd) = hand_written(&[
        CULTURES,
        ENTITIES,
        (
            "common/megastructures/fx.txt",
            "fxring_frame = {
	on_build_complete = {
		spawn_megastructure = { type = fxring_styled orbit_angle = 0 orbit_distance = 60 owner = from graphical_culture = \"fx_zinc\" }
		spawn_megastructure = { type = fxring_styled orbit_angle = 120 orbit_distance = 60 owner = from graphical_culture = from }
		spawn_megastructure = { type = fxring_bare orbit_angle = 240 orbit_distance = 60 owner = from graphical_culture = \"fx_zinc\" }
		remove_megastructure = fromfrom
	}
}
fxring_styled = { entity = styled_entity upgrade_from = { fxring_frame } }
fxring_bare = { entity = bare_entity upgrade_from = { fxring_frame } }
fxring_built = {
	upgrade_from = { fxring_styled }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 init_effect = { set_name = \"Ring Section\" } }
		remove_megastructure = fromfrom
	}
}
",
        ),
    ]);
    let ring = |system| {
        let stages = [RingStage::Frame; 3];
        ring_world_op(&gd, &open_4_5(), system, "fxring_frame", &stages, false)
            .expect("the ring")
            .op
    };
    let unowned = ring(XU_NUR);
    assert_eq!(
        ring_cultures(&unowned),
        [Some("fx_zinc"), Some("fx_iron"), None]
    );
    let added = round_trip(unowned);
    assert_eq!(added.matches("graphical_culture").count(), 2, "{added}");
    assert_eq!(
        ring_cultures(&ring(ALARI)),
        [Some("fx_zinc"), Some("mammalian_01"), Some("fx_zinc")],
        "an owned ring's rows are as its chain leaves them"
    );
}

/// A row a layout's script spawns, which is added with no owner, names the culture the spawn
/// names, or one its model has an entity in, only when its model needs one.
#[test]
fn a_layouts_row_takes_the_culture_its_spawn_names() {
    let mut files = FILES.to_vec();
    files.extend([
        CULTURES,
        ENTITIES,
        (
            "common/megastructures/fx.txt",
            "fx_styled = { entity = styled_entity }\nfx_bare = { entity = bare_entity }\n",
        ),
        (
            "common/solar_system_initializers/01_fx.txt",
            "fx_structures = {
	class = rl_single
	usage = misc_system_init
	usage_odds = 5
	max_instances = 1
	planet = { count = 1 class = star orbit_distance = 0 }
	init_effect = {
		spawn_megastructure = { type = fx_styled graphical_culture = \"fx_zinc\" }
		spawn_megastructure = { type = fx_styled }
		spawn_megastructure = { type = fx_bare graphical_culture = \"fx_zinc\" }
	}
}
",
        ),
    ]);
    let (_dir, gd) = hand_written(&files);
    let op = special_op(&gd, &open_4_5(), 1, SPOT, "fx_structures", true, &[]).expect("the op");
    let cultures: Vec<_> = members(&op)
        .into_iter()
        .filter(|op| op.name() == "AddMegastructure")
        .map(culture)
        .collect();
    assert_eq!(cultures, [Some("fx_zinc"), Some("fx_iron"), None]);
    let added = round_trip(op);
    assert_eq!(added.matches("graphical_culture").count(), 2, "{added}");
}
