//! What the nebula ops leave on the member systems of the real 4.5 sample: the modifiers
//! and the cloud each system gains when it enters its first nebula and loses when it
//! leaves its last, and the turbulence a nebula's members are switched to. Each op's diff
//! is snapshotted, undo and redo put back the bytes, and the op's inverse, applied as an
//! op, puts back the clouds its members had rather than new ones. A 3.4 save gets none.

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::ops::{NebulaCloud, NebulaFootprint, Op, OpError, SystemMove};
use sgf_core::projections::galaxy::Turbulence;
use sgf_core::session::Session;

use crate::common;
use common::diff::{report, round_trip_step};
use common::spec::{body, mura, rerolled};
use common::{SAMPLE_3_4, SAMPLE_4_5, current};

const DEMONS_EYE: usize = 0;
const NYTHRAN_EXPANSE: usize = 5;
const BOK_GLOBULE_BADLANDS: usize = 6;
/// The id Mura takes when it is added to the 4.5 sample.
const MURA: u32 = 601;
/// A clear patch one jump from the player's capital: radius 30 reaches four systems in no
/// nebula.
const NEAR_THE_CAPITAL: (f64, f64, f64) = (-362.33, -136.56, 30.0);

fn open_4_5() -> Session {
    Session::open(SAMPLE_4_5).expect("open the 4.5 sample")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// The first `nebula` section of the text as the file writes it.
fn first_nebula(text: &str) -> &str {
    let start = text.find("\nnebula=\n{\n").expect("a nebula") + 1;
    let end = start + text[start..].find("\n}\n").expect("its end") + 3;
    &text[start..end]
}

#[test]
fn nebula_ops_dress_the_systems_they_take_in_and_undress_the_ones_they_let_go() {
    let (x, y, radius) = NEAR_THE_CAPITAL;
    let cases = [
        (
            "footprint_add",
            Op::AddNebula {
                x,
                y,
                radius,
                name: None,
            },
        ),
        (
            "footprint_remove_game_nebula",
            Op::RemoveNebula { index: DEMONS_EYE },
        ),
        (
            "footprint_radius_grow",
            Op::SetNebulaRadius {
                index: NYTHRAN_EXPANSE,
                radius: 45.0,
            },
        ),
        (
            "footprint_radius_shrink",
            Op::SetNebulaRadius {
                index: DEMONS_EYE,
                radius: 15.0,
            },
        ),
        (
            "footprint_move_nebula",
            Op::MoveNebula {
                index: NYTHRAN_EXPANSE,
                x: -328.98,
                y: -56.62,
            },
        ),
        (
            "footprint_move_systems",
            Op::MoveSystems {
                moves: vec![
                    SystemMove {
                        id: 171,
                        x: -250.0,
                        y: -20.0,
                    },
                    SystemMove {
                        id: 64,
                        x: -340.0,
                        y: -60.0,
                    },
                ],
            },
        ),
    ];
    for (name, op) in cases {
        let mut session = open_4_5();
        let original = session.doc.original().to_vec();
        let result = round_trip_step(&mut session, name, op);
        common::snapshot(name, &report(&session, &result));

        session.apply(result.inverse).expect("apply the inverse");
        let (now, then) = (text(&current(&session)), text(&original));
        if name == "footprint_remove_game_nebula" {
            // The nebula comes back last, not where it stood; its members come back whole.
            let section = first_nebula(&then);
            assert!(now.contains(section), "{name}: the section");
            assert_eq!(
                now.replacen(section, "", 1),
                then.replacen(section, "", 1),
                "{name}: the inverse put back other clouds than the members had"
            );
        } else {
            assert!(now == then, "{name}: the inverse is not byte-identical");
        }
    }
}

#[test]
fn a_nebula_is_made_turbulent_and_calm_again_member_by_member() {
    let mut session = open_4_5();
    let original = session.doc.original().to_vec();
    assert_eq!(
        session.graph.nebulae[DEMONS_EYE].turbulence,
        Some(Turbulence::Some)
    );
    assert!(session.graph.systems[&0].turbulent);

    let result = round_trip_step(
        &mut session,
        "turbulent",
        Op::SetNebulaTurbulent {
            nebula: DEMONS_EYE,
            turbulent: true,
        },
    );
    common::snapshot("footprint_turbulent", &report(&session, &result));
    assert_eq!(
        session.graph.nebulae[DEMONS_EYE].turbulence,
        Some(Turbulence::All)
    );
    assert!(
        session.edit_result(result.clone()).delta.nebulae.is_some(),
        "the map is sent the nebulae again"
    );
    session.apply(result.inverse).expect("apply the inverse");
    assert!(
        current(&session) == original,
        "the inverse is not byte-identical"
    );

    let mut session = open_4_5();
    let result = round_trip_step(
        &mut session,
        "calm",
        Op::SetNebulaTurbulent {
            nebula: DEMONS_EYE,
            turbulent: false,
        },
    );
    common::snapshot("footprint_calm", &report(&session, &result));
    assert_eq!(
        session.graph.nebulae[DEMONS_EYE].turbulence,
        Some(Turbulence::None)
    );
    assert!(!session.graph.systems[&0].turbulent);
    assert!(matches!(
        session.apply(Op::SetNebulaTurbulent {
            nebula: DEMONS_EYE,
            turbulent: false,
        }),
        Err(OpError::TurbulenceUnchanged { .. })
    ));
    session.apply(result.inverse).expect("apply the inverse");
    assert!(
        current(&session) == original,
        "the inverse is not byte-identical"
    );

    let mut session = open_4_5();
    let result = session
        .apply(Op::SetNebulaTurbulent {
            nebula: BOK_GLOBULE_BADLANDS,
            turbulent: true,
        })
        .expect("a home system is made turbulent too");
    assert!(
        result.entry.description.contains("home system"),
        "{}",
        result.entry.description
    );
}

#[test]
fn a_save_without_first_contact_gets_clouds_and_no_cloaking() {
    let raw = archive::read_sav(SAMPLE_4_5).expect("read the 4.5 sample");
    let meta = text(&raw.meta).replace("\t\"First Contact Story Pack\"\n", "");
    let doc = Document::from_bytes(raw.gamestate, meta.into_bytes()).expect("index it");
    let mut session = Session::from_document(None, doc).expect("project it");
    let (x, y, radius) = NEAR_THE_CAPITAL;
    session
        .apply(Op::AddNebula {
            x,
            y,
            radius,
            name: None,
        })
        .expect("add a nebula");
    let added = common::diff::unified_diff(&session, None);
    assert_eq!(added.matches("\tdata=\"nebula_").count(), 4, "{added}");
    assert!(!added.contains("nebula_cloaking"), "{added}");
}

/// Two ops, then the first one's inverse: a cloud written back into the tombstone a later
/// op left in an appended slot, a fresh cloud given back at the table's end, and a cloud
/// the file held written back with its own bytes after another nebula took slots.
#[test]
fn an_inverse_applied_after_a_later_op_puts_back_the_clouds_it_took() {
    let (x, y, radius) = NEAR_THE_CAPITAL;
    let add = Op::AddNebula {
        x,
        y,
        radius,
        name: None,
    };
    let out = |id: u32| Op::MoveSystem {
        id,
        x: -420.0,
        y: -200.0,
    };

    // System 20 takes the add's first cloud, 361, which its move out leaves a tombstone.
    let mut session = open_4_5();
    round_trip_step(&mut session, "add", add.clone());
    let added = current(&session);
    let moved = round_trip_step(&mut session, "move 20 out", out(20));
    assert!(text(&current(&session)).contains("\t361=none\n"));
    let taken = session.apply(Op::SetNebulaFootprints {
        footprints: vec![NebulaFootprint {
            system: 20,
            cloud: Some(NebulaCloud {
                id: 318,
                kind: "nebula_1".to_owned(),
            }),
            cloaking: true,
            turbulent: false,
        }],
    });
    assert!(
        matches!(taken, Err(OpError::AmbientSlotTaken(318))),
        "{taken:?}"
    );
    session
        .apply(moved.inverse)
        .expect("apply the move's inverse");
    assert!(
        current(&session) == added,
        "361 is not written back as it was"
    );

    // Phargis leaves Nythran Expanse, a nebula is added elsewhere, then Phargis goes back.
    let mut session = open_4_5();
    let left = round_trip_step(&mut session, "move 171 out", out(171));
    round_trip_step(&mut session, "add", add.clone());
    session
        .apply(left.inverse)
        .expect("apply the move's inverse");
    let mut only_added = open_4_5();
    only_added.apply(add).expect("add alone");
    assert!(
        current(&session) == current(&only_added),
        "Phargis did not get its own cloud back"
    );
}

/// A cloud the file held comes back as the file held it, though the star it was placed
/// by has since changed size.
#[test]
fn a_game_cloud_comes_back_as_the_file_held_it_after_its_star_changed() {
    let mut session = open_4_5();
    round_trip_step(
        &mut session,
        "resize Dristmak's star",
        Op::SetPlanetSize { id: 571, size: 20 },
    );
    let resized = text(&current(&session));
    let removed = round_trip_step(
        &mut session,
        "remove Demon's Eye",
        Op::RemoveNebula { index: DEMONS_EYE },
    );
    session
        .apply(removed.inverse)
        .expect("apply the removal's inverse");
    let now = text(&current(&session));
    let section = first_nebula(&resized);
    assert_eq!(
        now.replacen(section, "", 1),
        resized.replacen(section, "", 1)
    );
}

/// A system added in the session, taken into a nebula and rolled again keeps its cloud,
/// moved beside the new star and retyped for its class, and gives it back when removed.
#[test]
fn a_rerolled_member_keeps_its_cloud_until_it_is_removed() {
    let mut session = open_4_5();
    let original = session.doc.original().to_vec();
    round_trip_step(&mut session, "add Mura", Op::AddSaveSystem { spec: mura() });
    round_trip_step(
        &mut session,
        "move Mura into Nythran Expanse",
        Op::MoveSystem {
            id: MURA,
            x: -330.0,
            y: -75.0,
        },
    );
    let mut spec = rerolled(mura());
    spec.star_class = "sc_b".to_owned();
    spec.star = body("pc_b_star", 30, 0.0, 0.0, 0);
    let rolled = round_trip_step(
        &mut session,
        "reroll Mura",
        Op::ReplaceSaveSystem { system: MURA, spec },
    );
    common::snapshot("footprint_reroll", &report(&session, &rolled));
    round_trip_step(&mut session, "remove Mura", Op::RemoveSystem { id: MURA });
    assert!(
        current(&session) == original,
        "removing Mura left something behind"
    );
}

/// A Stellaris 3.4.5 save keeps to the member lines: its ambient objects are written in
/// another shape, so no cloud or modifier is written, and turbulence is refused.
#[test]
fn a_3_4_save_moves_members_and_writes_no_clouds() {
    let mut session = Session::open(SAMPLE_3_4).expect("open the 3.4.5 sample");
    let nebula = session.graph.nebulae[0].clone();
    let outsider = (session.graph.systems.values())
        .filter(|s| s.nebula.is_none())
        .map(|s| s.id)
        .min()
        .expect("a system in no nebula");
    round_trip_step(
        &mut session,
        "shrink",
        Op::SetNebulaRadius {
            index: 0,
            radius: 1.0,
        },
    );
    round_trip_step(
        &mut session,
        "move in",
        Op::MoveSystem {
            id: outsider,
            x: nebula.x,
            y: nebula.y,
        },
    );
    let members = &session.graph.nebulae[0].systems;
    assert!(members.contains(&outsider), "{members:?}");
    assert!(members.len() < nebula.systems.len(), "{members:?}");
    let diff = common::diff::unified_diff(&session, None);
    for written in ["ambient_object", "timed_modifier", "data=", "=none"] {
        assert!(!diff.contains(written), "{written} in {diff}");
    }
    assert!(matches!(
        session.apply(Op::SetNebulaTurbulent {
            nebula: 0,
            turbulent: true,
        }),
        Err(OpError::SaveTooOld(_))
    ));
}
