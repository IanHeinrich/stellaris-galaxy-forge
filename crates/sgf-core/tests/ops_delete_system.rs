//! Deleting a system a 4.6 save held: the four writes the game's own removal leaves, the ids
//! the save takes afterwards, and byte-exact undo.

use sgf_core::ops::{NewBody, Op, OpError, SavedTable};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_core::views::OrbitPlacement;

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::edit::{insert_after, replace_once};
use common::spec::{SAMPLES, small};
use common::{
    SAMPLE_4_6, assert_refusals, current, findings, free_spots, open_4_6, open_edited_sample,
    planet_ids, reopened,
};

/// A system of one lane, to [`BESIDE`], in no nebula and on no rim.
pub(crate) const OCCIDAN: u32 = 516;
/// Its neighbour, of one lane more.
pub(crate) const BESIDE: u32 = 562;
/// A system of five lanes, in no nebula and on no rim.
pub(crate) const CROSSROADS: u32 = 533;
/// A member of the second nebula of one lane.
pub(crate) const IN_NEBULA: u32 = 547;
/// A pre-FTL country's homeworld.
pub(crate) const HOMEWORLD: u32 = 86;
/// A system with two starbases, their defence platforms and stations.
pub(crate) const TWO_STARBASES: u32 = 67;
/// The id a system added to the sample takes.
pub(crate) const NEXT: u32 = 600;

pub(crate) fn delete(system: u32) -> Op {
    Op::DeleteSystem { system }
}

pub(crate) fn open_4_6_edited(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE_4_6, |gamestate, _| edit(gamestate))
}

/// Entry `id` of the table at `section`, indented with `indent`, made its tombstone.
#[track_caller]
fn tombstone(text: &mut String, section: &str, indent: &str, id: u32) {
    let start = text
        .find(&format!("\n{section}=\n{{\n"))
        .expect("the section");
    let key = format!("\n{indent}{id}=\n{indent}{{\n");
    let at = start + text[start..].find(&key).expect("the entry");
    let close = format!("\n{indent}}}\n");
    let end = at + text[at..].find(&close).expect("its end") + close.len();
    text.replace_range(at..end, &format!("\n{indent}{id}=none\n"));
}

/// The sample with [`OCCIDAN`] deleted by hand, as the game's `remove_system` leaves one: its
/// entry and its planets' made tombstones, its lane gone from the other end and its id from
/// the clusters.
fn delete_occidan(text: &mut String) {
    tombstone(text, "galactic_object", "\t", OCCIDAN);
    for planet in 5439..=5448 {
        tombstone(text, "planets", "\t\t", planet);
    }
    replace_once(
        text,
        "\t\t\t{\n\t\t\t\tto=516\n\t\t\t\tlength=19\n\t\t\t}\n \n",
        "",
    );
    replace_once(text, " 494 503 516 519 ", " 494 503 519 ");
}

/// A small system added at the `spot`th free place, linked to `lane`.
fn add(session: &Session, name: &str, spot: usize, lane: u32) -> Op {
    let place = free_spots(session, spot + 1, 15.0)[spot];
    Op::AddSystemFromSpec {
        spec: small(name, place, vec![lane]),
    }
}

fn nebulae(session: &Session) -> Vec<Vec<u32>> {
    let nebulae = session.graph().nebulae.iter();
    nebulae.map(|nebula| nebula.systems.clone()).collect()
}

/// A save the game wrote after a removal: a system added to it takes the id past the last,
/// not the gap, and comes out again with the ids still dense.
#[test]
fn a_save_holding_a_removed_system_takes_and_gives_back_added_ones() {
    let mut session = open_4_6_edited(delete_occidan);
    assert!(session.system(OCCIDAN).is_none());
    assert_eq!(session.next_system_ids(2).expect("ids"), [NEXT, NEXT + 1]);
    let first = add(&session, "Sgf_First", 0, BESIDE);
    let second = add(&session, "Sgf_Second", 1, 238);
    round_trip(session.clone(), first.clone());

    round_trip_step(&mut session, "first", first);
    assert!(session.system(NEXT).is_some());
    round_trip_step(&mut session, "second", second);
    assert_eq!(session.graph().order.last(), Some(&(NEXT + 1)));
    let both = current(&session);

    let remove = Op::RemoveSystem { system: NEXT };
    let removed = round_trip_step(&mut session, "remove the first", remove);
    assert_eq!(removed.renumbered, [(NEXT, None), (NEXT + 1, Some(NEXT))]);
    let back = session
        .apply_inverse(removed.inverse)
        .expect("add the first again");
    assert_eq!(back.created.systems, [NEXT + 1]);
    session.undo().expect("undo").expect("the re-add");
    session.undo().expect("undo").expect("the removal");
    assert_eq!(current(&session), both);

    let remove = Op::RemoveSystems {
        systems: vec![NEXT, NEXT + 1],
    };
    round_trip_step(&mut session, "remove both", remove);
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_save_with_a_gap_in_its_system_ids_still_takes_none() {
    let mut session = open_4_6_edited(|text| {
        delete_occidan(text);
        replace_once(text, "\n\t516=none\n\t517=", "\n\t517=");
    });
    let op = add(&session, "Sgf_First", 0, BESIDE);
    let error = session.apply(op).expect_err("a gap");
    assert!(
        matches!(
            error,
            OpError::SystemIdsNotDense {
                last: 599,
                count: 599
            }
        ),
        "{error}"
    );
}

/// A nebula still listing a system the game removed leaves it out of its members, and its
/// other members take the edits the nebula does.
#[test]
fn a_nebula_drops_a_removed_member() {
    let mut session = open_4_6_edited(|text| tombstone(text, "galactic_object", "\t", IN_NEBULA));
    assert_eq!(nebulae(&session)[1], [136, 488, 502]);
    round_trip_step(
        &mut session,
        "turbulent",
        Op::SetNebulaTurbulent {
            nebula: 1,
            turbulent: true,
        },
    );
}

/// The deletion writes the four things the game's own removal leaves and nothing else, the
/// map and the details drop the system, and the app is told it went under its own id.
#[test]
fn a_deleted_system_is_left_as_the_game_leaves_one() {
    let mut session = common::warm(open_4_6());
    let before = findings(&session);
    let result = snapshot_step(&mut session, "one_lane", delete(OCCIDAN));
    let mut by_hand = String::from_utf8(session.doc().original().to_vec()).expect("utf-8");
    delete_occidan(&mut by_hand);
    assert_eq!(common::text(&session), by_hand);

    assert_eq!(result.renumbered, [(OCCIDAN, None)]);
    assert_eq!(result.details_stale, [OCCIDAN]);
    let edit = session.edit_result(result);
    assert_eq!(edit.delta.removed, [OCCIDAN]);
    assert_eq!(edit.delta.renumbered, [(OCCIDAN, None)]);
    let sent: Vec<u32> = edit.delta.systems.iter().map(|s| s.id).collect();
    assert_eq!(sent, [BESIDE]);
    assert_eq!(edit.delta.nebulae, None);

    assert!(session.system(OCCIDAN).is_none());
    assert!(session.graph().lane(BESIDE, OCCIDAN).is_none());
    assert!(session.details().expect("details").raw(OCCIDAN).is_none());
    assert!(findings(&session).is_subset(&before));

    let undone = session.undo().expect("undo").expect("the deletion");
    let edit = session.edit_result(undone);
    assert!(edit.delta.removed.is_empty() && edit.delta.renumbered.is_empty());
    let sent: Vec<u32> = edit.delta.systems.iter().map(|s| s.id).collect();
    assert_eq!(sent, [OCCIDAN, BESIDE]);
    assert_eq!(planet_ids(&session, OCCIDAN), Vec::from_iter(5439..=5448));
    assert_eq!(findings(&session), before);
}

#[test]
fn a_crossroads_leaves_every_neighbour() {
    let mut session = open_4_6();
    let before = findings(&session);
    let neighbours: Vec<u32> = session.graph().systems[&CROSSROADS]
        .lanes
        .iter()
        .map(|lane| lane.to)
        .collect();
    assert_eq!(neighbours.len(), 5);
    let result = round_trip_step(&mut session, "five lanes", delete(CROSSROADS));
    assert_eq!(result.entry.description, "Deleted Witzen #533 and 5 lanes");
    for neighbour in neighbours {
        assert!(result.touched.contains(&neighbour));
        assert!(session.graph().lane(neighbour, CROSSROADS).is_none());
    }
    let text = common::text(&session);
    let clusters = text.split_once("\nclusters=").expect("the clusters").1;
    let clusters = &clusters[..clusters.find("\n}\n").expect("their end")];
    assert!(clusters.split_whitespace().all(|id| id != "533"));
    assert!(findings(&session).is_subset(&before));
}

/// A neighbour whose only lane went is isolated, which the validator says of it.
#[test]
fn a_neighbour_left_with_no_lane_is_isolated() {
    let mut session = open_4_6();
    let result = round_trip_step(&mut session, "delete", delete(BESIDE));
    let isolated = common::coded(&result.issues, IssueCode::SystemIsolated);
    assert!(isolated.iter().any(|issue| issue.systems == [OCCIDAN]));
    let text = common::edit::system_text(&session, OCCIDAN);
    assert!(!text.contains("hyperlane="), "{text}");
}

/// A deleted nebula member stays in the nebula's lines and leaves its members, so the rest of
/// the nebula can still be edited; undo and the inverse put it back among them.
#[test]
fn a_deleted_nebula_member_leaves_and_comes_back() {
    let mut session = open_4_6();
    let before = nebulae(&session);
    let nebula = session.graph().systems[&IN_NEBULA].nebula;
    assert_eq!(nebula, Some(1));
    let deleted = round_trip_step(&mut session, "delete", delete(IN_NEBULA));
    assert_eq!(nebulae(&session)[1], [136, 488, 502]);
    assert!(common::text(&session).contains("\tgalactic_object=547\n"));
    let edit = session.edit_result(deleted.clone());
    let sent = edit.delta.nebulae.expect("the nebulae");
    assert_eq!(sent[1].systems, [136, 488, 502]);

    let turbulent = Op::SetNebulaTurbulent {
        nebula: 1,
        turbulent: true,
    };
    round_trip_step(&mut session, "turbulent", turbulent);
    session.undo().expect("undo").expect("the turbulence");
    round_trip_step(&mut session, "remove", Op::RemoveNebula { index: 1 });
    session.undo().expect("undo").expect("the removal");

    let undone = session.undo().expect("undo").expect("the deletion");
    assert_eq!(nebulae(&session), before);
    let edit = session.edit_result(undone);
    assert_eq!(
        edit.delta.nebulae.expect("the nebulae")[1].systems,
        before[1]
    );
    session.redo().expect("redo").expect("the deletion");

    let back = session.apply_inverse(deleted.inverse).expect("the inverse");
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(nebulae(&session), before);
    assert_eq!(session.graph().systems[&IN_NEBULA].nebula, nebula);
    let edit = session.edit_result(back);
    assert_eq!(
        edit.delta.nebulae.expect("the nebulae")[1].systems,
        before[1]
    );
}

/// A cluster left with no systems loses its `objects`, as the game writes an empty one.
#[test]
fn a_clusters_only_system_takes_its_list_with_it() {
    let cluster = "\t\tid=\"fe4_cluster\"\n";
    let listed = "\t\tobjects=\n\t\t{\n\t\t\t516 \n\t\t}\n";
    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nclusters=\n", cluster, "\t\tradius=100\n"],
            listed,
        );
    });
    round_trip(session.clone(), delete(OCCIDAN));
    session.apply(delete(OCCIDAN)).expect("delete");
    assert!(!common::text(&session).contains(listed));
}

#[test]
fn a_deleted_system_is_gone_for_the_next_edit() {
    let mut session = open_4_6();
    session.apply(delete(OCCIDAN)).expect("delete");
    let gone = "system 516 does not exist";
    let lane = Op::AddLane {
        a: OCCIDAN,
        b: BESIDE,
        bridge: false,
    };
    assert_refusals(&mut session, [(delete(OCCIDAN), gone), (lane, gone)]);

    let mut reopened = reopened(&mut session);
    assert!(!reopened.is_dirty());
    assert!(reopened.system(OCCIDAN).is_none());
    assert_refusals(&mut reopened, [(delete(OCCIDAN), gone)]);
    assert_eq!(reopened.next_system_ids(1).expect("an id"), [NEXT]);
    round_trip(reopened, delete(BESIDE));
}

#[test]
fn two_deletions_undo_one_at_a_time() {
    let mut session = open_4_6();
    round_trip_step(&mut session, "first", delete(OCCIDAN));
    let one = current(&session);
    round_trip_step(&mut session, "second", delete(BESIDE));
    session.undo().expect("undo").expect("the second");
    assert_eq!(current(&session), one);
    assert!(session.system(BESIDE).is_some() && session.system(OCCIDAN).is_none());
    session.undo().expect("undo").expect("the first");
    assert_eq!(current(&session), session.doc().original());
    round_trip(
        session,
        Op::Batch {
            description: "Deleted two systems".to_owned(),
            ops: vec![delete(OCCIDAN), delete(BESIDE)],
        },
    );
}

/// A system added after a deletion takes the id past the last and the planet slots the
/// deletion freed, and gives both back.
#[test]
fn an_add_after_a_deletion_takes_the_id_past_the_last() {
    let mut session = open_4_6();
    session.apply(delete(OCCIDAN)).expect("delete");
    let deleted = current(&session);
    let op = add(&session, "Sgf_First", 0, BESIDE);
    round_trip_step(&mut session, "add", op);
    assert!(session.system(NEXT).is_some() && session.system(OCCIDAN).is_none());
    assert_eq!(
        planet_ids(&session, NEXT),
        [(1 << 24) | 5439, (1 << 24) | 5440]
    );

    let remove = Op::RemoveSystem { system: NEXT };
    round_trip_step(&mut session, "remove", remove);
    assert_eq!(current(&session), deleted);
    while session.undo().expect("undo").is_some() {}
    assert_eq!(current(&session), session.doc().original());
    assert!(!session.doc().is_dirty());
}

/// A planet added to the system since the file was opened goes with it.
#[test]
fn a_body_added_this_session_goes_with_its_system() {
    let mut session = open_4_6();
    let spec = NewBody {
        class: "pc_barren".to_owned(),
        size: 10,
        deposits: vec!["d_minerals_2".to_owned()],
        ..NewBody::default()
    };
    let at = OrbitPlacement {
        radius: 45.0,
        angle: 300.0,
    };
    let added = session
        .apply(Op::AddBody {
            system: OCCIDAN,
            spec,
            at,
        })
        .expect("add a body");
    let body = added.created.planets[0];
    assert!(planet_ids(&session, OCCIDAN).contains(&body));
    let with_body = current(&session);
    let deleted = round_trip_step(&mut session, "delete", delete(OCCIDAN));
    assert!(common::text(&session).contains(&format!("\n\t\t{body}=none\n")));
    session.apply_inverse(deleted.inverse).expect("the inverse");
    assert_eq!(current(&session), with_body);
    assert!(planet_ids(&session, OCCIDAN).contains(&body));
}

/// A system added since the file was opened goes as its removal takes it, on a save of any
/// version that takes an add.
#[test]
fn an_added_system_is_removed() {
    for sample in &SAMPLES {
        let mut session = (sample.open)();
        let spec = (sample.spike)();
        session
            .apply(Op::AddSystemFromSpec { spec })
            .expect("add the spike");
        let removed = session.check_op(&Op::RemoveSystem { system: sample.id });
        assert_eq!(removed, None);
        round_trip_step(&mut session, sample.label, delete(sample.id));
        assert_eq!(current(&session), session.doc().original());
    }
}

/// The inverse keeps what it rewrote and no more: the system, its neighbour, its planets and
/// the clusters.
#[test]
fn the_inverse_writes_back_only_what_the_deletion_rewrote() {
    let mut session = open_4_6();
    let result = session.apply(delete(OCCIDAN)).expect("delete");
    let Op::RestoreEntities { entities, .. } = result.inverse else {
        panic!("{:?}", result.inverse);
    };
    let kept: Vec<(SavedTable, u32)> = entities.iter().map(|e| (e.table, e.id)).collect();
    let mut expected = vec![(SavedTable::System, OCCIDAN), (SavedTable::System, BESIDE)];
    expected.extend((5439..=5448).map(|planet| (SavedTable::Planet, planet)));
    expected.push((SavedTable::Clusters, 0));
    assert_eq!(kept, expected);
}
