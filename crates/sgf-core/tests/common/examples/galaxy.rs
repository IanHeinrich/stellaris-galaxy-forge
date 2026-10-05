//! The examples of the ops on lanes, nebulae, systems and the scenario alone.
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::ops::{LaneLength, Op};

use super::{Example, moved, pair, seat};
use crate::common::NEW_NEBULA;
use crate::common::brush::new_system;

pub(super) fn examples() -> Vec<Example> {
    vec![
        Example::both(Op::MoveSystem {
            system: 0,
            x: -150.0,
            y: 60.0,
        }),
        Example::each(
            Op::AddLane {
                a: 0,
                b: 1,
                bridge: true,
            },
            Op::AddLane {
                a: 0,
                b: 1,
                bridge: false,
            },
        ),
        Example::each(
            Op::AddLanes {
                from: 789,
                to: vec![(790, false), (0, true)],
            },
            Op::AddLanes {
                from: 0,
                to: vec![(1, false), (2, false)],
            },
        ),
        Example::each(
            Op::RemoveLane { a: 0, b: 752 },
            Op::RemoveLane { a: 0, b: 5 },
        ),
        Example::each(
            Op::RemoveLanes {
                from: 0,
                to: vec![752, 200],
            },
            Op::RemoveLanes {
                from: 0,
                to: vec![5, 6],
            },
        ),
        Example::save(Op::SetLaneLength {
            a: 788,
            b: 760,
            length: 21.5,
        }),
        Example::each(
            Op::IsolateSystem { system: 0 },
            Op::IsolateSystem { system: 3 },
        ),
        Example::each(
            Op::MoveSystems {
                moves: vec![moved(0, -134.22, 67.36), moved(86, -143.47, 40.99)],
            },
            Op::MoveSystems {
                moves: vec![moved(0, 5.0, 125.0), moved(1, 115.0, 45.0)],
            },
        ),
        Example::each(
            Op::AddLanePairs {
                lanes: vec![
                    pair(789, 790, false),
                    pair(789, 0, true),
                    pair(1, 790, false),
                ],
            },
            Op::AddLanePairs {
                lanes: vec![pair(0, 1, false), pair(2, 3, false)],
            },
        ),
        Example::each(
            Op::RemoveLanePairs {
                lanes: vec![(0, 752), (86, 112)],
            },
            Op::RemoveLanePairs {
                lanes: vec![(0, 5), (3, 9)],
            },
        ),
        Example::each(
            Op::IsolateSystems {
                systems: vec![0, 86],
            },
            Op::IsolateSystems {
                systems: vec![3, 11],
            },
        ),
        Example::save(Op::SetLaneLengths {
            lanes: vec![
                LaneLength {
                    a: 0,
                    b: 752,
                    length: 40.0,
                },
                LaneLength {
                    a: 788,
                    b: 760,
                    length: 21.5,
                },
            ],
        }),
        Example::save(Op::NormaliseLaneLength { a: 788, b: 760 }),
        Example::save(Op::NormaliseLaneLengths { systems: vec![786] }),
        Example::each(
            Op::MoveNebula {
                index: 0,
                x: 0.0,
                y: 0.0,
            },
            Op::MoveNebula {
                index: 0,
                x: 20.0,
                y: 100.0,
            },
        ),
        Example::each(
            Op::AddNebula {
                x: NEW_NEBULA.0,
                y: NEW_NEBULA.1,
                radius: NEW_NEBULA.2,
                name: Some("SGF_Test_Nebula".to_owned()),
            },
            Op::AddNebula {
                x: 150.0,
                y: -30.0,
                radius: 20.0,
                name: Some("Test Cloud".to_owned()),
            },
        ),
        Example::both(Op::RemoveNebula { index: 0 }),
        Example::both(Op::SetNebulaRadius {
            index: 0,
            radius: 45.0,
        }),
        Example::both(Op::RenameNebula {
            index: 0,
            name: "Sgf_Test_Cloud".to_owned(),
        }),
        Example::scenario(Op::AddSystem {
            system: None,
            x: 200.0,
            y: 200.0,
            name: Some("Fresh".to_owned()),
            initializer: Some("basic_init_01".to_owned()),
            spawn_weight: None,
            spawn_script: None,
        }),
        Example::each_added(
            Op::RemoveSystem { system: 791 },
            Op::RemoveSystem { system: 10 },
        ),
        Example::scenario(Op::AddSystems {
            systems: vec![new_system(20, 200.0, 200.0), new_system(21, 210.0, 200.0)],
        }),
        Example::each_added(
            Op::RemoveSystems { systems: vec![791] },
            Op::RemoveSystems {
                systems: vec![10, 11],
            },
        ),
        Example::each_added(
            Op::RenameSystem {
                system: 791,
                name: "Sgf_Renamed".to_owned(),
            },
            Op::RenameSystem {
                system: 10,
                name: "Renamed".to_owned(),
            },
        ),
        Example::scenario(Op::SetInitializer {
            system: 10,
            initializer: Some("misc_system_init_01".to_owned()),
        }),
        Example::scenario(Op::SetHeaderField {
            key: "name".to_owned(),
            value: Some("\"Renamed Reach\"".to_owned()),
        }),
        Example::scenario(Op::SetHeaderKeys {
            entries: vec![
                ("priority".to_owned(), "11".to_owned()),
                ("crisis_strength".to_owned(), "1.5".to_owned()),
            ],
        }),
        Example::scenario(Op::SetHeaderList {
            key: "supports_shape".to_owned(),
            values: vec!["elliptical".to_owned(), "ring".to_owned()],
        }),
        Example::scenario(Op::SetSpawnWeight {
            system: 10,
            base: Some(5.0),
        }),
        Example::scenario(Op::SetSpawnScript {
            system: 10,
            script: seat(1),
        }),
        Example::scenario(Op::SetFeZone {
            system: 9,
            zone: None,
        }),
        Example::scenario(Op::SetWormholePair {
            a: 10,
            b: 11,
            pair: Some(3),
        }),
        Example::scenario(Op::SetWormholeEnds {
            entries: vec![(7, None)],
        }),
        Example::scenario(Op::SetFeLinks {
            anchor: 9,
            linked: vec![10],
        }),
        Example::scenario(Op::SetFeLinkFlags {
            entries: vec![(
                10,
                FeLinkFlags {
                    custom: true,
                    id: Some(5),
                    to: vec![],
                },
            )],
        }),
        Example::scenario(Op::PreventLane { a: 0, b: 1 }),
        Example::scenario(Op::AllowLane { a: 10, b: 12 }),
    ]
}
