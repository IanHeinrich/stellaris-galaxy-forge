//! The validator's rules on a mutated copy of the sample's galaxy, and the L-Cluster
//! warning and the note on systems the game rolls beside a seat on scenarios.
use std::sync::LazyLock;

use sgf_core::guides::Guide;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::{BypassLink, GalaxyGraph, Lane};
use sgf_core::validate::{IssueCode, Severity, validate};

use crate::common;
use common::coded;
use common::fixture::{EXPORTED, GRAMMAR, PAINTED};

/// The 4.4 sample's galaxy, built once, for each test to mutate a copy of.
static GRAPH: LazyLock<GalaxyGraph> =
    LazyLock::new(|| GalaxyGraph::build(&common::load()).expect("build galaxy"));

#[test]
fn validator_reports_every_rule_on_a_mutated_graph() {
    let mut g = GRAPH.clone();

    // 752 still lists 0, but 0 no longer lists 752.
    g.systems.get_mut(&0).unwrap().lanes.retain(|l| l.to != 752);
    g.systems.get_mut(&1).unwrap().lanes.push(Lane {
        to: 1,
        length: 0.0,
        bridge: false,
        stale: false,
    });
    g.systems.get_mut(&3).unwrap().lanes.push(Lane {
        to: 9999,
        length: 1.0,
        bridge: false,
        stale: false,
    });
    g.systems.get_mut(&2).unwrap().x = 600.0;
    // Cut system 5 out of the graph on both ends of each of its lanes.
    let neighbours: Vec<u32> = g.systems[&5].lanes.iter().map(|l| l.to).collect();
    for n in neighbours {
        g.systems.get_mut(&n).unwrap().lanes.retain(|l| l.to != 5);
    }
    g.systems.get_mut(&5).unwrap().lanes.clear();
    // 108 stays listed in the first nebula but sits far from it; 455 sits at that
    // nebula's centre without being listed anywhere.
    let member = g.systems.get_mut(&108).unwrap();
    (member.x, member.y) = (200.0, -50.0);
    let (cx, cy) = (g.nebulae[0].x, g.nebulae[0].y);
    let stray = g.systems.get_mut(&455).unwrap();
    (stray.x, stray.y) = (cx, cy);

    let issues = validate(&g);
    let summary: Vec<(Severity, IssueCode, &[u32])> = issues
        .iter()
        .map(|i| (i.severity, i.code, i.systems.as_slice()))
        .collect();
    assert_eq!(
        summary,
        [
            (Severity::Error, IssueCode::LaneAsymmetric, &[752u32, 0][..]),
            (Severity::Error, IssueCode::LaneEndpointMissing, &[3, 9999]),
            (Severity::Error, IssueCode::LaneSelf, &[1]),
            (Severity::Info, IssueCode::LaneDuplicate, &[154, 708]),
            (Severity::Info, IssueCode::LaneDuplicate, &[401, 521]),
            (Severity::Warning, IssueCode::SystemIsolated, &[5]),
            (Severity::Warning, IssueCode::SystemIsolated, &[790]),
            (Severity::Warning, IssueCode::OutOfBounds, &[2]),
            (Severity::Warning, IssueCode::Disconnected, &[5]),
            (Severity::Warning, IssueCode::NebulaMembership, &[108]),
            (Severity::Warning, IssueCode::NebulaMembership, &[455]),
        ],
        "{issues:#?}"
    );
    let disconnected = issues
        .iter()
        .find(|i| i.code == IssueCode::Disconnected)
        .unwrap();
    assert!(
        disconnected.message.ends_with("newly separated: 5"),
        "{}",
        disconnected.message
    );
    let membership: Vec<&str> = issues
        .iter()
        .filter(|i| i.code == IssueCode::NebulaMembership)
        .map(|i| i.message.as_str())
        .collect();
    assert_eq!(
        membership,
        [
            "system 108 (Ascensions End) is listed in nebula Phantom Streak Miasma but lies 159.56 from its centre, beyond its radius 30",
            "system 455 (Mihil) lies 0.00 from the centre of nebula Phantom Streak Miasma (radius 30) but no nebula lists it",
        ]
    );
}

#[test]
fn a_lane_less_l_gate_system_is_reported_as_a_note() {
    let mut g = GRAPH.clone();
    assert!(g.bypasses.contains(&BypassLink::LGate { system: 208 }));
    let neighbours: Vec<u32> = g.systems[&208].lanes.iter().map(|l| l.to).collect();
    for n in neighbours {
        g.systems.get_mut(&n).unwrap().lanes.retain(|l| l.to != 208);
    }
    g.systems.get_mut(&208).unwrap().lanes.clear();

    let issue = validate(&g)
        .into_iter()
        .find(|i| i.code == IssueCode::SystemIsolated && i.systems == [208])
        .expect("208 is still reported");
    assert_eq!(issue.severity, Severity::Info);
    assert!(issue.message.contains("L-Gate"), "{}", issue.message);
}

#[test]
fn a_system_moved_into_the_l_cluster_is_reported_on_any_scenario() {
    let guide = Guide::l_cluster();
    assert!(guide.contains(-392.0, -392.0));
    assert!(guide.contains(-330.0, -330.0));
    assert!(!guide.contains(-300.0, -300.0));

    let mut session = PAINTED.open();
    let result = session
        .apply(Op::MoveSystem {
            system: 10,
            x: -392.0,
            y: -392.0,
        })
        .expect("move Void into the circle");
    let l_cluster = coded(&result.issues, IssueCode::LClusterSystem);
    assert_eq!(l_cluster.len(), 1, "{:?}", result.issues);
    assert_eq!(
        l_cluster[0].message,
        "Void sits where the game places the L-Cluster."
    );
    assert_eq!(l_cluster[0].systems, [10]);
    session.undo().expect("undo").expect("an op to undo");
    assert!(coded(&session.validate(), IssueCode::LClusterSystem).is_empty());

    let mut plain = GRAMMAR.open();
    let id = plain.graph().order[0];
    let result = plain
        .apply(Op::MoveSystem {
            system: id,
            x: -400.0,
            y: -380.0,
        })
        .expect("move a plain scenario's system there");
    assert_eq!(
        coded(&result.issues, IssueCode::LClusterSystem).len(),
        1,
        "{:?}",
        result.issues
    );

    let mut save = common::open();
    let id = save.graph().order[0];
    let result = save
        .apply(Op::MoveSystem {
            system: id,
            x: -392.0,
            y: -392.0,
        })
        .expect("move a save's system there");
    assert!(
        coded(&result.issues, IssueCode::LClusterSystem).is_empty(),
        "a save is the galaxy the game already built"
    );
}

/// The painted fixture seats empires on Alpha, Beta, Gamma and Sol. Ingress, Void, Old
/// Seat and #11 lie one lane from a seat and Egress two, all with no initializer; Low
/// Seat lies three lanes out.
#[test]
fn systems_the_game_rolls_beside_a_seat_are_noted_once() {
    let mut session = PAINTED.open();
    let issues = session.validate();
    let rolled = coded(&issues, IssueCode::RolledNearSeat);
    assert_eq!(rolled.len(), 1, "{issues:?}");
    assert_eq!(
        rolled[0].message,
        "Within 2 hyperlane jumps of a seat, the game fills Ingress, Egress, Old Seat, Void and #11 at random. Nothing keeps leviathans, marauder homes or L-Gates away from a capital."
    );
    assert_eq!(rolled[0].severity, Severity::Info);
    assert!(!rolled[0].note);
    assert_eq!(rolled[0].systems, [7, 8, 9, 10, 11]);

    let result = session
        .apply(Op::SetInitializer {
            system: 10,
            initializer: Some("painted_galaxy_rl_basic".to_owned()),
        })
        .expect("give Void an initializer");
    let rolled = coded(&result.issues, IssueCode::RolledNearSeat);
    assert_eq!(rolled.len(), 1, "{:?}", result.issues);
    assert_eq!(rolled[0].systems, [7, 8, 9, 11]);
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(
        coded(&session.validate(), IssueCode::RolledNearSeat)[0].systems,
        [7, 8, 9, 10, 11]
    );

    let exported = EXPORTED.open().validate();
    assert!(
        coded(&exported, IssueCode::RolledNearSeat).is_empty(),
        "every system of the exported sample has an initializer"
    );
}
