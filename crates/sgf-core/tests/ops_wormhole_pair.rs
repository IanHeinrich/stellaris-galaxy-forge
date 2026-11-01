//! Adding and removing a save's natural wormhole pairs on the 4.x samples: the diff,
//! byte-exact undo, what the galaxy and the details read back, and what is refused.

use sgf_core::ops::Op;
use sgf_core::projections::galaxy::{BypassLink, GalaxyGraph};
use sgf_core::session::Session;

use crate::common;
use crate::ops_add_megastructure::{add as add_megastructure, at_point};
use common::diff::{round_trip, snapshot_step};
use common::edit::open_4_5_edited;
use common::examples::save_with_added;
use common::{current, open, open_4_5, wormhole, wormholes};

fn add(a: u32, b: u32) -> Op {
    Op::AddWormholePair { a, b, at: None }
}

fn remove(a: u32, b: u32) -> Op {
    Op::RemoveWormholePair { a, b }
}

fn linked(graph: &GalaxyGraph, a: u32, b: u32) -> bool {
    graph.bypasses.iter().any(|link| {
        matches!(*link, BypassLink::Wormhole { a: x, b: y } if (x, y) == (a, b) || (x, y) == (b, a))
    })
}

/// The 4.5 sample's natural wormholes run to row 14 and its bypasses to 22, so the pair
/// takes rows 15 and 16 and bypasses 23 and 24.
#[test]
fn a_wormhole_pair_added_between_two_systems() {
    let mut session = open_4_5();
    assert!(wormholes(&session, 1).is_empty() && wormholes(&session, 140).is_empty());
    let result = snapshot_step(&mut session, "wormhole_pair_added", add(1, 140));
    assert_eq!(result.inverse, remove(1, 140));
    assert_eq!(result.details_stale, [1, 140]);
    assert!(linked(session.graph(), 1, 140));
    let one = wormholes(&session, 1);
    let other = wormholes(&session, 140);
    assert_eq!((one.len(), other.len()), (1, 1));
    assert_eq!((one[0].id, one[0].bypass), (15, 23));
    assert_eq!(one[0].partner, Some(140));
    assert_eq!((other[0].id, other[0].bypass), (16, 24));
    assert_eq!(other[0].partner, Some(1));
    assert!(one[0].x < 0.0 && one[0].y == 0.0, "{:?}", one[0]);
    assert!(other[0].x == 0.0 && other[0].y > 0.0, "{:?}", other[0]);

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("wormhole-pair.sav");
    session.save_as(&path).expect("save_as");
    let reopened = Session::open(&path).expect("reopen");
    assert!(linked(reopened.graph(), 1, 140));
    assert_eq!(wormholes(&reopened, 1), one);
    assert_eq!(wormholes(&reopened, 140), other);
}

#[test]
fn the_edit_result_reports_the_bypass_links_only_when_they_change() {
    let mut session = open_4_5();
    let moved = session
        .apply(Op::MoveSystem {
            system: 1,
            x: -150.0,
            y: 60.0,
        })
        .expect("move a system");
    assert_eq!(session.edit_result(moved).delta.bypasses, None);

    let added = session.apply(add(1, 140)).expect("the add");
    let links = session
        .edit_result(added)
        .delta
        .bypasses
        .expect("the links");
    assert_eq!(links, session.graph().bypasses);
    assert!(links.contains(&BypassLink::Wormhole { a: 1, b: 140 }));

    let undone = session.undo().expect("undo").expect("an op to undo");
    let links = session
        .edit_result(undone)
        .delta
        .bypasses
        .expect("the links");
    assert!(!links.contains(&BypassLink::Wormhole { a: 1, b: 140 }));
}

#[test]
fn an_added_pair_removed_gives_back_the_bytes_as_opened() {
    let mut session = open_4_5();
    session.apply(add(1, 140)).expect("the add");
    let removed = session.apply(remove(140, 1)).expect("the removal");
    assert_eq!(current(&session), session.doc().original());
    assert!(!linked(session.graph(), 1, 140));
    assert!(wormholes(&session, 1).is_empty() && wormholes(&session, 140).is_empty());
    assert!(matches!(
        removed.inverse,
        Op::AddWormholePair {
            a: 140,
            b: 1,
            at: Some(_)
        }
    ));
}

/// Wormhole 1 of the 4.5 sample stands in Ferragon (489), linked to Aulderaan (152).
#[test]
fn a_wormhole_pair_the_game_wrote_removed() {
    let mut session = open_4_5();
    assert!(linked(session.graph(), 489, 152));
    let result = snapshot_step(&mut session, "wormhole_pair_removed", remove(152, 489));
    assert_eq!(result.details_stale, [152, 489]);
    assert!(!linked(session.graph(), 489, 152));
    assert!(wormholes(&session, 489).is_empty() && wormholes(&session, 152).is_empty());

    session.apply(result.inverse).expect("add it back");
    assert!(linked(session.graph(), 489, 152));
    assert_eq!(
        wormholes(&session, 152),
        [wormhole(15, 23, 489, 57.61222, 347.70984)],
        "back where it stood, numbered as a new pair"
    );
    assert_eq!(
        wormholes(&session, 489),
        [wormhole(16, 24, 152, 4.20498, 459.52851)]
    );
}

#[test]
fn wormhole_pairs_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (add(1, 1), "system 1 cannot be paired with itself"),
        (add(1, 99_999), "system 99999 does not exist"),
        (
            add(1, 489),
            "system 489 already has a natural wormhole of bypass type \"wormhole\", and a system holds one at most",
        ),
        (
            add(24, 1),
            "system 24 already has a natural wormhole of bypass type \"shroud_tunnel\", and a system holds one at most",
        ),
        (
            remove(1, 140),
            "systems 1 and 140 are not the two ends of a wormhole",
        ),
        (
            remove(489, 163),
            "systems 489 and 163 are not the two ends of a wormhole",
        ),
        (
            remove(24, 1),
            "systems 24 and 1 are not the two ends of a wormhole",
        ),
        (remove(99_999, 1), "system 99999 does not exist"),
    ];
    common::assert_refusals(&mut session, refusals);
}

/// The 4.4 sample writes its wormholes as 4.5 does: wormhole 1 stands in system 52,
/// linked to 449.
#[test]
fn wormhole_pairs_in_a_4_4_save() {
    round_trip(open(), add(0, 752));
    round_trip(open(), remove(52, 449));
    let mut session = open();
    session.apply(add(0, 752)).expect("the add");
    assert!(linked(session.graph(), 0, 752));
    session.apply(remove(752, 0)).expect("the removal");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn an_added_system_with_a_wormhole_is_not_removed() {
    let mut session = save_with_added();
    session.apply(add(791, 0)).expect("the add");
    let error = session
        .apply(Op::RemoveSystem { system: 791 })
        .expect_err("a wormhole in the way");
    assert_eq!(
        error.to_string(),
        "system 791 has a wormhole: remove the wormhole pair first"
    );
    session.apply(remove(0, 791)).expect("the removal");
    session
        .apply(Op::RemoveSystem { system: 791 })
        .expect("then the system goes");
}

/// The keys of the `bypasses` table as it stands.
fn bypass_ids(session: &Session) -> Vec<u32> {
    let text = String::from_utf8(current(session)).expect("utf-8");
    let start = text.find("\nbypasses=\n{\n").expect("a bypasses table");
    let table = &text[start..];
    let table = &table[..table.find("\n}\n").expect("its end")];
    table
        .lines()
        .filter_map(|line| line.strip_prefix('\t'))
        .filter_map(|line| line.split_once('=')?.0.parse().ok())
        .collect()
}

/// A 4.5.2 save had reused bypass slot 1 one generation on, as `16777217`, among slots up
/// to 532. New bypasses go past the highest slot at generation 0, not past the highest id,
/// which would be slots 2 and 3 one generation on: the game crashes on those.
#[test]
fn new_bypasses_take_the_slot_past_the_highest() {
    const SLOT_MASK: u32 = (1 << 24) - 1;
    let mut session = open_4_5_edited(|gamestate| {
        let table = gamestate
            .find("\nbypasses=\n{\n")
            .expect("a bypasses table");
        let key = "\n\t1=\n\t{\n\t\ttype=\"shroud_tunnel\"";
        let at = table + gamestate[table..].find(key).expect("bypass 1");
        gamestate.replace_range(at..at + "\n\t1=".len(), "\n\t16777217=");
    });
    let loaded = bypass_ids(&session);
    assert!(loaded.contains(&16_777_217) && !loaded.contains(&1));
    let slots: Vec<u32> = loaded.iter().map(|id| id & SLOT_MASK).collect();
    assert_eq!(slots.iter().max(), Some(&22));

    session
        .apply(add_megastructure(
            0,
            at_point("gateway_final", "gateway", true),
        ))
        .expect("a gateway in Dristmak");
    session.apply(add(1, 140)).expect("the pair");
    let added: Vec<u32> = bypass_ids(&session)
        .into_iter()
        .filter(|id| !loaded.contains(id))
        .collect();
    assert_eq!(added, [23, 24, 25]);
    assert!(added.iter().all(|id| !slots.contains(&(id & SLOT_MASK))));
    assert_eq!(wormholes(&session, 1)[0].bypass, 24);
    assert_eq!(wormholes(&session, 140)[0].bypass, 25);
}

/// The 4.4 sample's highest pair joins 788 and 789 at rows 11 and 12, bypasses 25 and 26.
/// A fleet's path may name a removed bypass, so a pair added after it takes the next ids.
#[test]
fn a_pair_added_after_a_removal_takes_new_ids() {
    let mut session = open();
    session.apply(remove(788, 789)).expect("the removal");
    session.apply(add(278, 0)).expect("the add");
    let one = wormholes(&session, 278);
    let other = wormholes(&session, 0);
    assert_eq!((one[0].id, one[0].bypass), (13, 27));
    assert_eq!((other[0].id, other[0].bypass), (14, 28));
}
