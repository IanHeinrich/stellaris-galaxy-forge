//! The nebula ops on the real sample save: the diff each one produces is snapshotted, and
//! the member list each one rewrites is checked against a reload of the saved file.

use sgf_core::ops::{Op, OpError, SystemMove};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;

use crate::common;
use common::diff::section_report;
use common::{NEBULA_0_CENTRE, current, open, reprojected};

#[test]
fn move_system_108_out_of_its_nebula_removes_the_member_line() {
    let mut session = open();
    assert_eq!(session.graph().systems[&108].nebula, Some(0));
    let result = session
        .apply(Op::MoveSystem {
            system: 108,
            x: 200.0,
            y: -50.0,
        })
        .unwrap();
    assert_eq!(session.graph().systems[&108].nebula, None);
    assert!(!session.graph().nebulae[0].systems.contains(&108));
    common::snapshot(
        "move_system_108_out_of_nebula",
        &section_report(&session, &result, "nebula"),
    );

    // The inverse op puts the line back where it was, not just the undo stack.
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().systems[&108].nebula, Some(0));
    assert_eq!(session.graph().nebulae[0].systems[0], 108);
}

#[test]
fn move_system_455_into_a_nebula_adds_the_member_line() {
    let mut session = open();
    assert_eq!(session.graph().systems[&455].nebula, None);
    let (x, y) = NEBULA_0_CENTRE;
    let result = session.apply(Op::MoveSystem { system: 455, x, y }).unwrap();
    assert_eq!(session.graph().systems[&455].nebula, Some(0));
    assert_eq!(
        session.graph().nebulae[0].systems,
        [108, 140, 164, 181, 348, 438, 455, 463, 623]
    );
    common::snapshot(
        "move_system_455_into_nebula",
        &section_report(&session, &result, "nebula"),
    );

    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().systems[&455].nebula, None);
}

#[test]
fn move_systems_across_a_nebula_boundary_names_each_change() {
    let mut session = open();
    let (x, y) = NEBULA_0_CENTRE;
    let result = session
        .apply(Op::MoveSystems {
            moves: vec![
                SystemMove {
                    system: 455,
                    x,
                    y: y + 1.0,
                },
                SystemMove {
                    system: 108,
                    x: 200.0,
                    y: -50.0,
                },
            ],
        })
        .unwrap();
    assert_eq!(session.graph().systems[&108].nebula, None);
    assert_eq!(session.graph().systems[&455].nebula, Some(0));
    assert_eq!(session.graph().systems, reprojected(&session).systems);
    common::snapshot(
        "move_systems_108_out_and_455_into_nebula",
        &section_report(&session, &result, "nebula"),
    );

    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
}

/// One system's id, position and the length of every lane it lists.
type Placement = (u32, f64, f64, Vec<(u32, f64)>);

/// Every system's position and lane lengths, ascending: what a nebula move must leave
/// exactly as it found it.
fn placements(session: &Session) -> Vec<Placement> {
    let mut out: Vec<Placement> = session
        .graph()
        .systems
        .values()
        .map(|s| {
            (
                s.id,
                s.x,
                s.y,
                s.lanes.iter().map(|l| (l.to, l.length)).collect(),
            )
        })
        .collect();
    out.sort_by_key(|(id, ..)| *id);
    out
}

/// Nebula 0 nudged north-east: its trailing edge lets systems go and its leading edge
/// takes others in, while every system stays where it is.
const NEBULA_0_MOVED_TO: (f64, f64) = (76.15, -126.85);

#[test]
fn move_nebula_0_moves_the_cloud_alone_and_rewrites_its_member_list() {
    let mut session = open();
    let before = session.graph().nebulae[0].clone();
    let placed = placements(&session);
    let (x, y) = NEBULA_0_MOVED_TO;

    let result = session.apply(Op::MoveNebula { index: 0, x, y }).unwrap();

    let after = &session.graph().nebulae[0];
    assert_eq!((after.x, after.y), (x, y));
    assert_eq!(after.radius, before.radius);
    assert_eq!(
        placements(&session),
        placed,
        "a nebula move leaves every system and lane length alone"
    );

    let dropped: Vec<u32> = (before.systems.iter())
        .copied()
        .filter(|id| !after.systems.contains(id))
        .collect();
    let gained: Vec<u32> = (after.systems.iter())
        .copied()
        .filter(|id| !before.systems.contains(id))
        .collect();
    println!(
        "nebula 0 covered {} systems, now {}: dropped {dropped:?}, gained {gained:?}",
        before.systems.len(),
        after.systems.len()
    );
    assert!(!dropped.is_empty(), "the move drops no member");
    assert!(!gained.is_empty(), "the move gains no member");
    for &id in &dropped {
        assert_ne!(session.graph().systems[&id].nebula, Some(0), "system {id}");
        assert!(result.touched.contains(&id), "system {id} touched");
    }
    for &id in &gained {
        assert_eq!(session.graph().systems[&id].nebula, Some(0), "system {id}");
        assert!(result.touched.contains(&id), "system {id} touched");
    }
    let fresh = reprojected(&session);
    assert_eq!(session.graph().systems, fresh.systems);
    assert_eq!(session.graph().nebulae, fresh.nebulae);
    assert!(
        result
            .issues
            .iter()
            .all(|i| i.code != IssueCode::NebulaMembership),
        "{:?}",
        result.issues
    );
    common::snapshot(
        "move_nebula_0",
        &section_report(&session, &result, "nebula"),
    );

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);

    session.redo().unwrap().expect("redo");
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);
}

#[test]
fn growing_a_radius_takes_systems_in_and_shrinking_lets_them_go() {
    let mut session = open();
    let grown = session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 45.0,
        })
        .unwrap();
    assert_eq!(session.graph().nebulae[0].radius, 45.0);
    assert_eq!(
        session.graph().nebulae[0].systems,
        [
            108, 136, 140, 164, 166, 181, 348, 438, 455, 463, 484, 500, 577, 623, 753
        ]
    );
    assert_eq!(session.graph().systems[&455].nebula, Some(0));
    common::snapshot(
        "set_nebula_radius_45",
        &section_report(&session, &grown, "nebula"),
    );

    let mut session = open();
    let shrunk = session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 15.0,
        })
        .unwrap();
    assert_eq!(session.graph().nebulae[0].systems, [438, 623]);
    assert_eq!(session.graph().systems[&108].nebula, None);
    common::snapshot(
        "set_nebula_radius_15",
        &section_report(&session, &shrunk, "nebula"),
    );

    session.apply(shrunk.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn renaming_a_nebula_to_free_text_writes_a_literal_the_game_shows_as_typed() {
    let mut session = open();
    let before = session.graph().nebulae[0].clone();
    let result = session
        .apply(Op::RenameNebula {
            index: 0,
            name: "Sea of Ghosts".to_owned(),
        })
        .unwrap();

    let after = &session.graph().nebulae[0];
    assert_eq!(after.name.key, "Sea of Ghosts");
    assert!(after.name.literal, "free text is shown as written");
    // The map's label and the inspector's field are the same words, which they are not
    // while a name the user typed is left standing as a localisation key.
    assert_eq!(after.display_name(), after.name.key);
    assert_eq!(after.systems, before.systems);
    assert_eq!(session.graph().nebulae, reprojected(&session).nebulae);
    assert_eq!(
        result.inverse,
        Op::RenameNebula {
            index: 0,
            name: before.name.key.clone(),
        }
    );
    common::snapshot(
        "set_nebula_name",
        &section_report(&session, &result, "nebula"),
    );

    // The inverse is a key again, so the literal line it added goes with it.
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);
}

#[test]
fn renaming_a_nebula_to_a_key_writes_the_key_alone_and_drops_a_literal() {
    let mut session = open();
    session
        .apply(Op::RenameNebula {
            index: 0,
            name: "Sea of Ghosts".to_owned(),
        })
        .unwrap();
    let result = session
        .apply(Op::RenameNebula {
            index: 0,
            name: "NAME_N_Maw".to_owned(),
        })
        .unwrap();

    let after = &session.graph().nebulae[0];
    assert_eq!(after.name.key, "NAME_N_Maw");
    assert!(!after.name.literal, "a key is looked up, not shown");
    assert_eq!(after.display_name(), "N Maw");
    assert_eq!(session.graph().nebulae, reprojected(&session).nebulae);
    common::snapshot(
        "set_nebula_name_key",
        &section_report(&session, &result, "nebula"),
    );
}

#[test]
fn renaming_a_nebula_refuses_an_empty_name_an_unquotable_one_and_an_unknown_index() {
    let mut session = open();
    assert!(matches!(
        session.apply(Op::RenameNebula {
            index: 0,
            name: String::new(),
        }),
        Err(OpError::EmptyText { what: "a name" })
    ));
    assert!(matches!(
        session.apply(Op::RenameNebula {
            index: 0,
            name: "a \"quoted\" name".to_owned(),
        }),
        Err(OpError::InvalidText { what: "a name", .. })
    ));
    assert!(matches!(
        session.apply(Op::RenameNebula {
            index: 99,
            name: "Nowhere".to_owned(),
        }),
        Err(OpError::UnknownNebula(99))
    ));
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn the_nebula_ops_refuse_an_impossible_radius_or_index() {
    let mut session = open();
    for radius in [0.0, -10.0, 2000.0] {
        let error = session
            .apply(Op::SetNebulaRadius { index: 0, radius })
            .expect_err("refused");
        assert!(
            matches!(error, OpError::InvalidRadius { .. }),
            "{radius}: {error:?}"
        );
        let error = session
            .apply(Op::AddNebula {
                x: 0.0,
                y: 0.0,
                radius,
                name: None,
            })
            .expect_err("refused");
        assert!(
            matches!(error, OpError::InvalidRadius { .. }),
            "{radius}: {error:?}"
        );
    }
    assert_eq!(
        session
            .apply(Op::SetNebulaRadius {
                index: 0,
                radius: 0.0,
            })
            .unwrap_err()
            .to_string(),
        "radius 0 is invalid: a nebula's radius must be greater than zero"
    );
    assert_eq!(
        session
            .apply(Op::SetNebulaRadius {
                index: 0,
                radius: 2000.0,
            })
            .unwrap_err()
            .to_string(),
        "radius 2000 is invalid: a nebula's radius may not exceed 1000"
    );
    for op in [
        Op::RemoveNebula { index: 99 },
        Op::SetNebulaRadius {
            index: 99,
            radius: 30.0,
        },
    ] {
        let name = op.name();
        let error = session.apply(op).expect_err("refused");
        assert!(
            matches!(error, OpError::UnknownNebula(99)),
            "{name}: {error:?}"
        );
    }
    assert!(matches!(
        session.apply(Op::AddNebula {
            x: f64::NAN,
            y: 0.0,
            radius: 30.0,
            name: None,
        }),
        Err(OpError::NotFinite)
    ));
    assert!(matches!(
        session.apply(Op::AddNebula {
            x: 0.0,
            y: 0.0,
            radius: 30.0,
            name: Some("a \"quoted\" name".to_owned()),
        }),
        Err(OpError::InvalidText { what: "a name", .. })
    ));
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn move_nebula_refuses_an_unknown_index() {
    let mut session = open();
    assert!(matches!(
        session.apply(Op::MoveNebula {
            index: 99,
            x: 0.0,
            y: 0.0,
        }),
        Err(OpError::UnknownNebula(99))
    ));
    assert_eq!(current(&session), session.doc().original());
}

/// `point` turned a quarter circle anticlockwise about `pivot`, to the two decimals the
/// app sends.
pub fn quarter_turn(point: (f64, f64), pivot: (f64, f64)) -> (f64, f64) {
    let round = |v: f64| (v * 100.0).round() / 100.0;
    let (dx, dy) = (point.0 - pivot.0, point.1 - pivot.1);
    (round(pivot.0 - dy), round(pivot.1 + dx))
}

/// What the app sends to rotate a selection by 90° about `pivot`: one `MoveSystems` for
/// the systems, then a `MoveNebula` for each cloud, all as one undo step.
pub fn rotation(session: &Session, pivot: (f64, f64), systems: &[u32], nebulae: &[usize]) -> Op {
    let graph = session.graph();
    let moves = systems
        .iter()
        .map(|&system| {
            let s = &graph.systems[&system];
            let (x, y) = quarter_turn((s.x, s.y), pivot);
            SystemMove { system, x, y }
        })
        .collect();
    let mut ops = vec![Op::MoveSystems { moves }];
    ops.extend(nebulae.iter().map(|&index| {
        let n = &graph.nebulae[index];
        let (x, y) = quarter_turn((n.x, n.y), pivot);
        Op::MoveNebula { index, x, y }
    }));
    Op::Batch {
        description: format!(
            "Rotated {} systems and {} nebula by 90°",
            systems.len(),
            nebulae.len()
        ),
        ops,
    }
}

/// The ids of the systems that lie inside the `index`th cloud's circle, ascending.
pub fn inside(session: &Session, index: usize) -> Vec<u32> {
    let graph = session.graph();
    let n = &graph.nebulae[index];
    let mut ids: Vec<u32> = (graph.systems.values())
        .filter(|s| (s.x - n.x).hypot(s.y - n.y) <= n.radius)
        .map(|s| s.id)
        .collect();
    ids.sort_unstable();
    ids
}

/// Four members of nebula 0 and Mihil (455), which sits just outside it, turned about
/// their centre together with the cloud.
#[test]
fn rotating_a_selection_and_a_nebula_in_one_batch_decides_membership_on_the_moved_systems() {
    let mut session = open();
    let selection = [438, 623, 164, 108, 455];
    let graph = session.graph();
    let pivot = {
        let n = selection.len() as f64;
        let sum = selection.iter().fold((0.0, 0.0), |acc, id| {
            (acc.0 + graph.systems[id].x, acc.1 + graph.systems[id].y)
        });
        (
            (sum.0 / n * 100.0).round() / 100.0,
            (sum.1 / n * 100.0).round() / 100.0,
        )
    };
    let before = graph.nebulae[0].clone();
    let stay: Vec<(u32, f64, f64)> = (graph.systems.values())
        .filter(|s| !selection.contains(&s.id))
        .map(|s| (s.id, s.x, s.y))
        .collect();
    let op = rotation(&session, pivot, &selection, &[0]);

    let result = session.apply(op).unwrap();

    assert_eq!(
        result.entry.description,
        "Rotated 5 systems and 1 nebula by 90°"
    );
    let graph = session.graph();
    for (id, x, y) in stay {
        assert_eq!((graph.systems[&id].x, graph.systems[&id].y), (x, y), "{id}");
    }
    assert_eq!(
        (graph.nebulae[0].x, graph.nebulae[0].y),
        quarter_turn((before.x, before.y), pivot)
    );
    assert_eq!(graph.nebulae[0].radius, before.radius);

    // The members are the systems inside the rotated circle at their rotated positions.
    let members = inside(&session, 0);
    let mut listed = graph.nebulae[0].systems.clone();
    listed.sort_unstable();
    assert_eq!(listed, members);
    for system in graph.systems.values() {
        assert_eq!(
            system.nebula == Some(0),
            members.contains(&system.id),
            "system {}",
            system.id
        );
    }
    let fresh = reprojected(&session);
    assert_eq!(session.graph().systems, fresh.systems);
    assert_eq!(session.graph().nebulae, fresh.nebulae);
    common::snapshot(
        "rotate_selection_and_nebula_0",
        &common::diff::report(&session, &result),
    );

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);

    session.redo().unwrap().expect("redo");
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);
}
