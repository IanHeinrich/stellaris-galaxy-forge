//! The nebula ops on the real sample save: the diff each one produces is snapshotted, and
//! the member list each one rewrites is checked against a reload of the saved file.

use sgf_core::ops::{Op, OpError, SystemMove};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;

mod common;
use common::diff::report;
use common::{NEBULA_0_CENTRE, NEW_NEBULA, current, open, reloaded};

#[test]
fn move_system_108_out_of_its_nebula_removes_the_member_line() {
    let mut session = open();
    assert_eq!(session.graph.systems[&108].nebula, Some(0));
    let result = session
        .apply(Op::MoveSystem {
            id: 108,
            x: 200.0,
            y: -50.0,
        })
        .unwrap();
    assert_eq!(session.graph.systems[&108].nebula, None);
    assert!(!session.graph.nebulae[0].systems.contains(&108));
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot("move_system_108_out_of_nebula", &report(&session, &result));

    // The inverse op puts the line back where it was, not just the undo stack.
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.systems[&108].nebula, Some(0));
    assert_eq!(session.graph.nebulae[0].systems[0], 108);
}

#[test]
fn move_system_455_into_a_nebula_adds_the_member_line() {
    let mut session = open();
    assert_eq!(session.graph.systems[&455].nebula, None);
    let (x, y) = NEBULA_0_CENTRE;
    let result = session.apply(Op::MoveSystem { id: 455, x, y }).unwrap();
    assert_eq!(session.graph.systems[&455].nebula, Some(0));
    assert_eq!(
        session.graph.nebulae[0].systems,
        [108, 140, 164, 181, 348, 438, 455, 463, 623]
    );
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot("move_system_455_into_nebula", &report(&session, &result));

    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.systems[&455].nebula, None);
}

#[test]
fn move_systems_across_a_nebula_boundary_names_each_change() {
    let mut session = open();
    let (x, y) = NEBULA_0_CENTRE;
    let result = session
        .apply(Op::MoveSystems {
            moves: vec![
                SystemMove {
                    id: 455,
                    x,
                    y: y + 1.0,
                },
                SystemMove {
                    id: 108,
                    x: 200.0,
                    y: -50.0,
                },
            ],
        })
        .unwrap();
    assert_eq!(session.graph.systems[&108].nebula, None);
    assert_eq!(session.graph.systems[&455].nebula, Some(0));
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot(
        "move_systems_108_out_and_455_into_nebula",
        &report(&session, &result),
    );

    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
}

/// One system's id, position and the length of every lane it lists.
type Placement = (u32, f64, f64, Vec<(u32, f64)>);

/// Every system's position and lane lengths, ascending: what a nebula move must leave
/// exactly as it found it.
fn placements(session: &Session) -> Vec<Placement> {
    let mut out: Vec<Placement> = session
        .graph
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
    let before = session.graph.nebulae[0].clone();
    let placed = placements(&session);
    let (x, y) = NEBULA_0_MOVED_TO;

    let result = session.apply(Op::MoveNebula { index: 0, x, y }).unwrap();

    let after = &session.graph.nebulae[0];
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
        assert_ne!(session.graph.systems[&id].nebula, Some(0), "system {id}");
        assert!(result.touched.contains(&id), "system {id} touched");
    }
    for &id in &gained {
        assert_eq!(session.graph.systems[&id].nebula, Some(0), "system {id}");
        assert!(result.touched.contains(&id), "system {id} touched");
    }
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    assert_eq!(session.graph.nebulae, reloaded(&session).nebulae);
    assert!(
        result
            .issues
            .iter()
            .all(|i| i.code != IssueCode::NebulaMembership),
        "{:?}",
        result.issues
    );
    common::snapshot("move_nebula_0", &report(&session, &result));

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.nebulae[0], before);

    session.redo().unwrap().expect("redo");
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.nebulae[0], before);
}

#[test]
fn add_nebula_takes_the_systems_it_covers_from_their_clouds() {
    let mut session = open();
    let (x, y, radius) = NEW_NEBULA;
    assert_eq!(session.graph.systems[&134].nebula, Some(6));
    let result = session
        .apply(Op::AddNebula {
            x,
            y,
            radius,
            name: Some("SGF_Test_Nebula".to_owned()),
        })
        .unwrap();

    assert_eq!(session.graph.nebulae.len(), 10);
    let added = &session.graph.nebulae[9];
    assert_eq!((added.x, added.y, added.radius), (x, y, radius));
    assert_eq!(added.systems, [113, 134, 600, 688]);
    assert_eq!(session.graph.systems[&134].nebula, Some(9));
    assert!(!session.graph.nebulae[6].systems.contains(&134));
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    assert_eq!(session.graph.nebulae, reloaded(&session).nebulae);
    assert!(
        result
            .issues
            .iter()
            .all(|i| i.code != IssueCode::NebulaMembership),
        "{:?}",
        result.issues
    );
    common::snapshot("add_nebula", &report(&session, &result));
}

#[test]
fn adding_a_nebula_and_removing_it_again_is_byte_identical() {
    let mut session = open();
    let (x, y, radius) = NEW_NEBULA;
    session
        .apply(Op::AddNebula {
            x,
            y,
            radius,
            name: Some("SGF_Test_Nebula".to_owned()),
        })
        .unwrap();
    let removed = session.apply(Op::RemoveNebula { index: 9 }).unwrap();

    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.nebulae.len(), 9);
    assert_eq!(
        session.graph.systems[&134].nebula,
        Some(6),
        "134 goes back to the cloud the new one took it from"
    );
    assert!(
        removed.entry.description.contains("1 joined Demons Eye"),
        "{}",
        removed.entry.description
    );
}

#[test]
fn a_nebula_edited_earlier_can_still_be_removed() {
    let mut session = open();
    session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 45.0,
        })
        .expect("resize");
    let resized = current(&session);
    session
        .apply(Op::RemoveNebula { index: 0 })
        .expect("remove a nebula an earlier op rewrote");
    let edited = current(&session);

    assert_eq!(session.graph.nebulae.len(), 8);
    assert_eq!(session.graph.nebulae[0].name.key, "Jimorban_Dust_Clouds");
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    assert_eq!(session.graph.nebulae, reloaded(&session).nebulae);

    session.undo().unwrap().expect("undo the removal");
    assert_eq!(current(&session), resized);
    session.undo().unwrap().expect("undo the resize");
    assert_eq!(current(&session), session.doc.original());
    session.redo().unwrap().expect("redo the resize");
    session.redo().unwrap().expect("redo the removal");
    assert_eq!(current(&session), edited);
}

#[test]
fn remove_nebula_0_releases_every_member() {
    let mut session = open();
    let before = session.graph.nebulae[0].clone();
    let result = session.apply(Op::RemoveNebula { index: 0 }).unwrap();

    assert_eq!(session.graph.nebulae.len(), 8);
    assert_eq!(session.graph.nebulae[0].name.key, "Jimorban_Dust_Clouds");
    for &id in &before.systems {
        assert_eq!(session.graph.systems[&id].nebula, None, "system {id}");
    }
    assert_eq!(
        result.inverse,
        Op::AddNebula {
            x: before.x,
            y: before.y,
            radius: before.radius,
            name: Some("Phantom_Streak_Miasma".to_owned()),
        }
    );
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot("remove_nebula_0", &report(&session, &result));
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
    assert_eq!(session.graph.nebulae[0].radius, 45.0);
    assert_eq!(
        session.graph.nebulae[0].systems,
        [
            108, 136, 140, 164, 166, 181, 348, 438, 455, 463, 484, 500, 577, 623, 753
        ]
    );
    assert_eq!(session.graph.systems[&455].nebula, Some(0));
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot("set_nebula_radius_45", &report(&session, &grown));

    let mut session = open();
    let shrunk = session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 15.0,
        })
        .unwrap();
    assert_eq!(session.graph.nebulae[0].systems, [438, 623]);
    assert_eq!(session.graph.systems[&108].nebula, None);
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot("set_nebula_radius_15", &report(&session, &shrunk));

    session.apply(shrunk.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn renaming_a_nebula_to_free_text_writes_a_literal_the_game_shows_as_typed() {
    let mut session = open();
    let before = session.graph.nebulae[0].clone();
    let result = session
        .apply(Op::SetNebulaName {
            index: 0,
            name: "Sea of Ghosts".to_owned(),
        })
        .unwrap();

    let after = &session.graph.nebulae[0];
    assert_eq!(after.name.key, "Sea of Ghosts");
    assert!(after.name.literal, "free text is shown as written");
    // The map's label and the inspector's field are the same words, which they are not
    // while a name the user typed is left standing as a localisation key.
    assert_eq!(after.display_name(), after.name.key);
    assert_eq!(after.systems, before.systems);
    assert_eq!(session.graph.nebulae, reloaded(&session).nebulae);
    assert_eq!(
        result.inverse,
        Op::SetNebulaName {
            index: 0,
            name: before.name.key.clone(),
        }
    );
    common::snapshot("set_nebula_name", &report(&session, &result));

    // The inverse is a key again, so the literal line it added goes with it.
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.nebulae[0], before);
}

#[test]
fn renaming_a_nebula_to_a_key_writes_the_key_alone_and_drops_a_literal() {
    let mut session = open();
    session
        .apply(Op::SetNebulaName {
            index: 0,
            name: "Sea of Ghosts".to_owned(),
        })
        .unwrap();
    let result = session
        .apply(Op::SetNebulaName {
            index: 0,
            name: "NAME_N_Maw".to_owned(),
        })
        .unwrap();

    let after = &session.graph.nebulae[0];
    assert_eq!(after.name.key, "NAME_N_Maw");
    assert!(!after.name.literal, "a key is looked up, not shown");
    assert_eq!(after.display_name(), "N Maw");
    assert_eq!(session.graph.nebulae, reloaded(&session).nebulae);
    common::snapshot("set_nebula_name_key", &report(&session, &result));
}

#[test]
fn renaming_a_nebula_refuses_an_empty_name_an_unquotable_one_and_an_unknown_index() {
    let mut session = open();
    assert!(matches!(
        session.apply(Op::SetNebulaName {
            index: 0,
            name: String::new(),
        }),
        Err(OpError::EmptyName)
    ));
    assert!(matches!(
        session.apply(Op::SetNebulaName {
            index: 0,
            name: "a \"quoted\" name".to_owned(),
        }),
        Err(OpError::InvalidName(_))
    ));
    assert!(matches!(
        session.apply(Op::SetNebulaName {
            index: 99,
            name: "Nowhere".to_owned(),
        }),
        Err(OpError::UnknownNebula(99))
    ));
    assert_eq!(current(&session), session.doc.original());
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
        Err(OpError::InvalidName(_))
    ));
    assert_eq!(current(&session), session.doc.original());
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
    assert_eq!(current(&session), session.doc.original());
}
