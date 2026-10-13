//! The op a megastructure add applies to the 4.5 sample, built by the join the app and the
//! CLI call: where the row stands, who owns it, its bypass and the planet change its build
//! makes, on a hand-written install and on Gigastructural Engineering's Orchid.

use crate::common;

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{
    ClassChange, MegastructurePlace, NewBypass, NewMegastructurePlace, Op, PlanetClassRule,
};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::construction::ring_world::RingStage;
use sgf_gamedata::generate::{Planned, megastructure_op, ring_world_op};

/// Alari, owned by country 0, whose planet 6 is a gas giant.
const ALARI: u32 = 169;

/// An install whose orchid makes its planet a food giant as it finishes, and whose relay and
/// gates stand at a point of their own: the relay for a relay bypass, which is always open,
/// and the gates for a gateway, which is open only once something opens it.
fn join_fixture() -> (tempfile::TempDir, GameData) {
    common::hand_written(&[
        (
            "common/bypass/fx.txt",
            "relay_bypass = { always_active = yes }
gateway = { always_active = no }
",
        ),
        (
            "common/planet_classes/fx.txt",
            "pc_gas_giant = { entity = \"gas_giant\" }
pc_food_giant = { entity = \"food_giant\" }
",
        ),
        (
            "common/megastructures/fx.txt",
            "fx_orchid = {
	on_build_complete = {
		fromfrom.planet = { change_pc = pc_food_giant }
	}
}
fx_relay = {
	build_outside_gravity_well = yes
	bypass_type = relay_bypass
}
fx_gate = {
	build_outside_gravity_well = yes
	bypass_type = gateway
}
fx_gate_opened = {
	build_outside_gravity_well = yes
	bypass_type = gateway
	on_build_complete = { activate_gateway = yes }
}
",
        ),
    ])
}

fn planned(gd: &GameData, kind: &str, place: MegastructurePlace, keep_planet: bool) -> Planned {
    megastructure_op(gd, &common::open_4_5(), ALARI, kind, place, keep_planet).expect(kind)
}

/// The orchid on gas giant 6 makes it a food giant in the same edit, the class first, and the
/// row goes to the system's owner. Applied, the planet changes and the row takes slot 16 in
/// one undo step. With `keep_planet` the add is the row alone.
#[test]
fn the_join_changes_the_planet_first_unless_it_is_kept() {
    let (_dir, gd) = join_fixture();
    let on_6 = MegastructurePlace::Body { body: 6 };
    let Op::Batch { description, ops } = planned(&gd, "fx_orchid", on_6, false).op else {
        panic!("a batch");
    };
    assert_eq!(
        description, "Added the Fx Orchid at planet #6 and made it a Pc Food Giant",
        "the fixture names neither type nor class"
    );
    let [
        Op::SetBodyClass { body, from, to, .. },
        Op::AddMegastructure { system, spec },
    ] = &ops[..]
    else {
        panic!("{ops:?}");
    };
    assert_eq!(
        (*body, from.class.as_str(), to.class.as_str()),
        (6, "pc_gas_giant", "pc_food_giant")
    );
    assert_eq!(
        (*system, spec.kind.as_str(), spec.owner),
        (ALARI, "fx_orchid", Some(0))
    );

    let mut session = common::open_4_5();
    let result = session
        .apply(Op::Batch {
            description: description.clone(),
            ops: ops.clone(),
        })
        .expect("the orchid and its food giant");
    assert_eq!(result.created.megastructures, [16]);
    let class = |session: &Session| get_planet_page(session.doc(), 6).expect("planet 6").class;
    assert_eq!(class(&session), "pc_food_giant");
    assert_eq!(session.history().undo.len(), 1);
    session.undo().expect("undo").expect("an edit");
    assert_eq!(class(&session), "pc_gas_giant");
    assert!(!session.doc().is_dirty());

    let kept = planned(&gd, "fx_orchid", on_6, true).op;
    assert!(matches!(kept, Op::AddMegastructure { .. }), "{kept:?}");
}

/// A relay at a point of its own stands for an open relay bypass. A gate stands for a closed
/// gateway, and for an open one when its build opens it. On a body a relay is refused, and so
/// is a type the install does not define.
#[test]
fn the_join_places_a_relay_and_refuses_what_it_does_not_add() {
    let (_dir, gd) = join_fixture();
    let free = MegastructurePlace::Free { x: 0.0, y: -260.0 };
    let Op::AddMegastructure { spec, .. } = planned(&gd, "fx_relay", free, false).op else {
        panic!("a row");
    };
    assert_eq!(spec.at, NewMegastructurePlace::Free { x: 0.0, y: -260.0 });
    assert_eq!(
        spec.bypass,
        Some(NewBypass {
            kind: "relay_bypass".to_owned(),
            active: true,
        })
    );
    let bypass_of = |kind: &str| {
        let Op::AddMegastructure { spec, .. } = planned(&gd, kind, free, false).op else {
            panic!("{kind}: a row");
        };
        spec.bypass
    };
    let gateway = |active| {
        Some(NewBypass {
            kind: "gateway".to_owned(),
            active,
        })
    };
    assert_eq!(bypass_of("fx_gate"), gateway(false));
    assert_eq!(bypass_of("fx_gate_opened"), gateway(true));
    let refused = |kind: &str, place| {
        megastructure_op(&gd, &common::open_4_5(), ALARI, kind, place, false)
            .expect_err(kind)
            .to_string()
    };
    assert_eq!(
        refused("fx_relay", MegastructurePlace::Body { body: 6 }),
        "a fx_relay cannot be added: it stands at a point of its own"
    );
    assert_eq!(
        refused("fx_none", free),
        "the install and its mods define no megastructure fx_none"
    );
}

/// Gigastructural Engineering's Yggdrasil Orchid, on the playset, builds the batch the core's
/// planet change test applies: the gas giant's five models and the food giant's one, both
/// changed only uncolonised.
#[test]
fn the_join_builds_the_orchids_batch_from_the_playset() {
    let Some(gd) = common::PLAYSET.as_ref() else {
        return;
    };
    let on_6 = MegastructurePlace::Body { body: 6 };
    let Op::Batch { description, ops } = planned(gd, "yggdrasil_orchid_3", on_6, false).op else {
        panic!("a batch");
    };
    assert_eq!(
        description,
        "Added the Yggdrasil Orchid Complex at planet #6 and made it a Yggdrasil Orchid",
        "the type and the class as the playset names them"
    );
    assert_eq!(ops.len(), 2, "{ops:?}");
    let rule = |class: &str, models| PlanetClassRule {
        class: class.to_owned(),
        change: ClassChange::Uncolonised,
        models,
    };
    assert_eq!(
        ops[0],
        Op::SetBodyClass {
            body: 6,
            from: rule("pc_gas_giant", 5),
            to: rule("pc_food_giant", 1),
            look: None,
        }
    );
    assert!(
        matches!(ops[1], Op::AddMegastructure { .. }),
        "{:?}",
        ops[1]
    );
}

/// A ring world added to Habraq goes to country 19, which owns the system.
#[test]
fn the_join_gives_a_ring_world_to_the_systems_owner() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let stages = [RingStage::Finished; 4];
    let op = ring_world_op(
        gd,
        &common::open_4_5(),
        159,
        "ring_world_2_intermediate",
        &stages,
        false,
    )
    .expect("a finished ring")
    .op;
    let Op::AddRingWorld { system, owner, .. } = op else {
        panic!("{op:?}");
    };
    assert_eq!((system, owner), (159, Some(19)));
}
