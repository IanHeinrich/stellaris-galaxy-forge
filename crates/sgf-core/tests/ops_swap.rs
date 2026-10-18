//! Two systems trading places, on the 4.5 and 3.4 samples and on the grammar fixture: each
//! place keeps its lanes with their lengths, its height and its spiral arm, each system
//! keeps what it holds, and undo puts back every byte.

use std::collections::BTreeMap;

use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

use crate::common;
use common::diff::snapshot_step;
use common::edit::system_text;
use common::fixture::GRAMMAR;
use common::{SAMPLE_4_5, open, open_3_4, open_4_5, open_edited_sample};

/// What a place holds: where it is, the height and `arm` written there and its lanes as
/// `(to, length, bridge)`, sorted.
#[derive(Debug, PartialEq)]
struct Spot {
    at: (f64, f64),
    height: Option<f64>,
    arm: Option<String>,
    lanes: Vec<(u32, String, bool)>,
}

fn spots(session: &Session) -> BTreeMap<u32, Spot> {
    session
        .graph()
        .systems
        .iter()
        .map(|(&id, system)| {
            let mut lanes: Vec<(u32, String, bool)> = system
                .lanes
                .iter()
                .map(|lane| (lane.to, lane.length.to_string(), lane.bridge))
                .collect();
            lanes.sort();
            let arm = match session.kind() {
                DocumentKind::Save => system_text(session, id)
                    .lines()
                    .find_map(|line| line.strip_prefix("\t\tarm=").map(str::to_owned)),
                DocumentKind::Scenario => None,
            };
            let spot = Spot {
                at: (system.x, system.y),
                height: system.height,
                arm,
                lanes,
            };
            (id, spot)
        })
        .collect()
}

/// Swap `system` and `with` on `session`, round-tripping and snapshotting it as `name`,
/// and assert that each place kept what it holds: the system standing at a place now has
/// the height, arm and lanes the one standing there before had, with the two ids exchanged
/// in its lanes.
fn swapped(mut session: Session, name: &str, system: u32, with: u32) -> Session {
    let before = spots(&session);
    snapshot_step(&mut session, name, Op::SwapSystems { system, with });
    let other = |id: u32| match id {
        id if id == system => with,
        id if id == with => system,
        id => id,
    };
    let expected: BTreeMap<u32, Spot> = before
        .into_iter()
        .map(|(id, spot)| {
            let mut lanes: Vec<(u32, String, bool)> = spot
                .lanes
                .into_iter()
                .map(|(to, length, bridge)| (other(to), length, bridge))
                .collect();
            lanes.sort();
            (other(id), Spot { lanes, ..spot })
        })
        .collect();
    assert_eq!(
        spots(&session),
        expected,
        "{name}: each place keeps what it holds"
    );
    session
}

/// Aspharelle (592) holds a starbase and Taremes (594) none. A lane joins them, and both
/// lead to Laleya (599) and Bax (600), whose blocks name the two at once.
#[test]
fn two_linked_systems_trade_places_and_keep_the_lane_between_them() {
    let session = swapped(open_4_5(), "swap_systems_592_594", 592, 594);
    assert!(session.graph().lane(592, 594).is_some());
}

/// Gaping Maw (4) has three lanes, `arm=0` and the generator's height; Ophala (593),
/// spawned by a script, has no lanes, no `arm` and a height of 5.11847. Each place keeps
/// its block, its `arm` and its height.
#[test]
fn a_system_without_lanes_takes_the_block_arm_and_height_of_the_place_it_moves_to() {
    let session = swapped(open_4_5(), "swap_systems_4_593", 4, 593);
    assert!(session.graph().systems[&4].lanes.is_empty());
    assert_eq!(session.graph().systems[&593].lanes.len(), 3);
    assert_eq!(session.graph().systems[&4].height, Some(5.11847));
}

/// No sample holds a system without a `visual_height` beside ones with it, so Ophala's is
/// taken out: Aspharelle (592) loses its height to Ophala's place and Ophala gets 592's.
#[test]
fn a_height_written_on_one_place_only_stays_with_that_place() {
    let session = open_edited_sample(SAMPLE_4_5, |gamestate, _| {
        let height = "\t\t\tvisual_height=5.11847\n";
        assert_eq!(gamestate.matches(height).count(), 1);
        *gamestate = gamestate.replacen(height, "", 1);
    });
    let session = swapped(session, "swap_systems_without_height", 592, 593);
    assert_eq!(session.graph().systems[&592].height, None);
    assert_eq!(session.graph().systems[&593].height, Some(4.31213));
}

/// Dristmak (0) is a member of the Demon's Eye nebula and Xu Nur (1) of none: the member
/// lists follow the place, and the footprint goes with the membership.
#[test]
fn a_nebula_member_swapped_with_a_system_outside_trades_its_membership() {
    let session = swapped(open_4_5(), "swap_systems_0_1", 0, 1);
    let graph = session.graph();
    assert_eq!(graph.systems[&0].nebula, None);
    assert_eq!(graph.systems[&1].nebula, Some(0));
}

/// A 3.4 save writes no `visual_height` and no `arm`, and opens its blocks on their key's
/// line.
#[test]
fn a_3_4_save_swaps_its_coordinates_and_lane_blocks() {
    swapped(open_3_4(), "swap_systems_3_4", 0, 398);
}

/// Occidan (591), sealed, is the 3.4 sample's one system without lanes: it gets Gianfar's
/// (1) block, opened on its key's line, after its `star_class`.
#[test]
fn a_3_4_system_without_lanes_gets_a_block_in_the_saves_shape() {
    let session = swapped(open_3_4(), "swap_systems_3_4_591_1", 591, 1);
    assert!(session.graph().systems[&1].lanes.is_empty());
}

/// Lonely (9) has only a prevented lane to 1; 16 has two lanes to 1 and one to 111. Each
/// place keeps its statements, prevented or not, and its `position` as written.
#[test]
fn a_scenario_swaps_the_positions_and_the_ends_of_every_lane_statement() {
    swapped(GRAMMAR.open(), "swap_systems_scenario_9_16", 9, 16);
}

#[test]
fn the_same_system_twice_and_an_unknown_system_are_refused() {
    for mut session in [open(), GRAMMAR.open()] {
        let missing = 99_999;
        common::assert_refusals(
            &mut session,
            [
                (
                    Op::SwapSystems { system: 9, with: 9 },
                    "system 9 is listed more than once",
                ),
                (
                    Op::SwapSystems {
                        system: 9,
                        with: missing,
                    },
                    "system 99999 does not exist",
                ),
                (
                    Op::SwapSystems {
                        system: missing,
                        with: 9,
                    },
                    "system 99999 does not exist",
                ),
            ],
        );
    }
}
