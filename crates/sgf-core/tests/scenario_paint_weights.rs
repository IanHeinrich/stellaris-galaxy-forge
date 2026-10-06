//! The plain spawn weight beside Paint a Galaxy's scripts: clearing a scripted
//! system's weight, removing and adding scripted systems, and the plain path on a
//! scenario without scripts.

use sgf_core::export::{self, ScenarioProfile};
use sgf_core::format::scenario::is_painted;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::PaintSpawnKind;

use crate::common;
use common::batch::spawn_weights;
use common::diff::snapshot_step;
use common::fixture::{EXPORTED, GRAMMAR, PAINTED};
use common::paint::{reserved, script, set};

#[test]
fn clearing_the_plain_weight_of_a_scripted_system_removes_its_block() {
    let mut session = PAINTED.open();
    let result = snapshot_step(
        &mut session,
        "clear_weight_2",
        Op::SetSpawnWeight {
            system: 2,
            base: None,
        },
    );
    let system = &session.graph().systems[&2];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);

    // The inverse puts the script back, not a bare weight of 0.
    let inverse = result.inverse.clone();
    assert_eq!(inverse, set(2, script(reserved("a"), 2)));
    session.apply(inverse).expect("apply the inverse");
    assert_eq!(
        session.graph().systems[&2].spawn_script,
        script(reserved("a"), 2)
    );
    assert_eq!(common::current(&session), PAINTED.bytes());

    let mut session = PAINTED.open();
    let result = session
        .apply(Op::SetSpawnWeight {
            system: 10,
            base: None,
        })
        .expect("nothing to clear");
    assert_eq!(
        result.inverse,
        Op::SetSpawnWeight {
            system: 10,
            base: None
        }
    );
}

/// Clearing a scripted seat among plain weights inverts to a batch: the script comes
/// back as a script, the plain base as a base.
#[test]
fn clearing_a_scripted_seat_among_plain_weights_inverts_each_its_own_way() {
    let entries = vec![(2, None), (10, Some(1.0))];
    let mut session = PAINTED.open();
    let result = snapshot_step(
        &mut session,
        "clear_weights_2_and_10",
        spawn_weights(entries),
    );
    assert_eq!(session.graph().systems[&2].spawn_script, None);
    assert_eq!(session.graph().systems[&10].spawn_weight, Some(1.0));
    assert_eq!(
        result.inverse,
        Op::Batch {
            description: "Set the spawn weight of 2 systems".to_owned(),
            ops: vec![
                Op::SetSpawnWeight {
                    system: 10,
                    base: None
                },
                set(2, script(reserved("a"), 2)),
            ],
        }
    );
    session
        .apply(result.inverse.clone())
        .expect("apply the inverse");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

/// 3 is a scripted seat, 7 a wormhole end and 12 a fallen empire zone with a wormhole
/// of its own; all three have lanes.
#[test]
fn removing_painted_systems_inverts_to_their_statements_and_lanes() {
    common::diff::assert_removal_inverts_exactly(PAINTED.open(), &[3, 7, 12]);
}

#[test]
fn a_system_added_with_a_script_is_seated_on_the_basic_initializer() {
    let mut session = PAINTED.open();
    let add = Op::AddSystem {
        system: None,
        x: 60.0,
        y: 10.0,
        name: Some("New Seat".to_owned()),
        initializer: None,
        spawn_weight: None,
        spawn_script: script(PaintSpawnKind::Enabled, 5),
    };
    let result = snapshot_step(&mut session, "add_system_scripted", add);
    let system = &session.graph().systems[&14];
    assert_eq!(system.initializer, "basic_init_03");
    assert_eq!(system.spawn_script, script(PaintSpawnKind::Enabled, 5));
    assert_eq!(system.spawn_weight, Some(0.0));
    assert_eq!(result.details_stale, vec![14]);

    let removed = session
        .apply(Op::RemoveSystem { system: 14 })
        .expect("remove the seat");
    session.apply(removed.inverse).expect("put the seat back");
    assert_eq!(
        session.graph().systems[&14].spawn_script,
        script(PaintSpawnKind::Enabled, 5)
    );
}

/// The plain path is unchanged: on the grammar fixture a weight is still `base = N`,
/// and a script written there takes the shape of the statement it joins.
#[test]
fn the_grammar_fixture_still_takes_a_plain_base_and_a_script_on_its_own_line() {
    let mut session = GRAMMAR.open();
    session
        .apply(Op::SetSpawnWeight {
            system: 1,
            base: Some(2.0),
        })
        .expect("plain weight");
    let text = String::from_utf8(common::current(&session)).expect("utf-8");
    assert!(text.contains("initializer = misc_system_init_01 spawn_weight = { base = 2 } }"));
    assert!(!text.contains("painted_galaxy"));
    assert_eq!(session.graph().systems[&1].spawn_script, None);

    snapshot_step(
        &mut GRAMMAR.open(),
        "grammar_script_3018",
        set(3018, script(PaintSpawnKind::Enabled, 8)),
    );
    snapshot_step(
        &mut GRAMMAR.open(),
        "grammar_script_16",
        set(16, script(reserved("z"), 4)),
    );
}

#[test]
fn a_file_is_painted_by_the_mods_names_or_forges_header_for_it() {
    assert!(is_painted(&PAINTED.bytes()));
    assert!(!is_painted(&EXPORTED.bytes()));

    let empty = |profile| {
        let session = export::new_scenario("sgf_new", 0.0, 0.0, profile).expect("new scenario");
        common::current(&session)
    };
    assert!(is_painted(&empty(ScenarioProfile::PaintAGalaxy)));
    assert!(!is_painted(&empty(ScenarioProfile::Plain)));
}
