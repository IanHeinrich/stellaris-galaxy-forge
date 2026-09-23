//! One op of every `Op` variant, as the sample save and a scenario each take it: the list
//! the tests of a property of the whole enum run over.
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::ops::{InitializerSet, LaneLength, LanePair, Op, StarBody, SystemMove};
use sgf_core::projections::galaxy::{LGateOutcome, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;

use super::brush::new_system;
use super::fixture::PAINTED;
use super::{NEW_NEBULA, open};

/// One variant's op for each document kind; `None` where that kind refuses the variant.
pub struct Example {
    pub save: Option<Op>,
    pub scenario: Option<Op>,
}

impl Example {
    fn both(op: Op) -> Self {
        Self {
            save: Some(op.clone()),
            scenario: Some(op),
        }
    }

    fn each(save: Op, scenario: Op) -> Self {
        Self {
            save: Some(save),
            scenario: Some(scenario),
        }
    }

    fn save(op: Op) -> Self {
        Self {
            save: Some(op),
            scenario: None,
        }
    }

    fn scenario(op: Op) -> Self {
        Self {
            save: None,
            scenario: Some(op),
        }
    }

    /// The example's op for either kind, the same variant whichever it is.
    pub fn op(&self) -> &Op {
        self.save
            .as_ref()
            .or(self.scenario.as_ref())
            .expect("an op for one kind")
    }

    pub fn name(&self) -> &'static str {
        self.op().name()
    }
}

/// The sample save, which every save example applies to.
pub fn save() -> Session {
    open()
}

/// The painted fixture with a `prevent_hyperlane` added, which every scenario example
/// applies to: it holds every statement some scenario op writes.
pub fn scenario() -> Session {
    let lane = "\tadd_hyperlane = { from = \"4\" to = \"13\" }\n";
    PAINTED.open_edited(&[(
        lane,
        &format!("{lane}\tprevent_hyperlane = {{ from = \"10\" to = \"12\" }}\n"),
    )])
}

/// Every variant once, in declaration order. Fails when a variant has no example.
pub fn one_of_each() -> Vec<Example> {
    let examples = vec![
        Example::both(Op::MoveSystem {
            id: 0,
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
        Example::each(Op::IsolateSystem { id: 0 }, Op::IsolateSystem { id: 3 }),
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
            Op::IsolateSystems { ids: vec![0, 86] },
            Op::IsolateSystems { ids: vec![3, 11] },
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
        Example::both(Op::SetNebulaName {
            index: 0,
            name: "Sgf_Test_Cloud".to_owned(),
        }),
        Example::scenario(Op::AddSystem {
            id: None,
            x: 200.0,
            y: 200.0,
            name: Some("Fresh".to_owned()),
            initializer: Some("basic_init_01".to_owned()),
            spawn_weight: None,
            spawn_script: None,
        }),
        Example::scenario(Op::RemoveSystem { id: 10 }),
        Example::scenario(Op::AddSystems {
            systems: vec![new_system(20, 200.0, 200.0), new_system(21, 210.0, 200.0)],
        }),
        Example::scenario(Op::RemoveSystems { ids: vec![10, 11] }),
        Example::scenario(Op::SetSystemName {
            id: 10,
            name: "Renamed".to_owned(),
        }),
        Example::scenario(Op::SetInitializer {
            id: 10,
            initializer: Some("misc_system_init_01".to_owned()),
        }),
        Example::scenario(Op::SetInitializers {
            entries: vec![
                InitializerSet {
                    id: 10,
                    initializer: Some("misc_system_init_01".to_owned()),
                },
                InitializerSet {
                    id: 11,
                    initializer: Some("misc_system_init_02".to_owned()),
                },
            ],
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
            id: 10,
            base: Some(5.0),
        }),
        Example::scenario(Op::SetSpawnWeights {
            entries: vec![(10, Some(5.0)), (11, Some(2.0))],
        }),
        Example::scenario(Op::SetSpawnScript {
            id: 10,
            script: seat(1),
        }),
        Example::scenario(Op::SetSpawnScripts {
            entries: vec![(10, seat(1)), (11, seat(2))],
        }),
        Example::scenario(Op::SetFeZone { id: 9, zone: None }),
        Example::scenario(Op::SetFeZones {
            entries: vec![(9, None), (12, None)],
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
        Example::scenario(Op::UnpreventLane { a: 10, b: 12 }),
        Example::save(Op::SetLGateOutcome {
            outcome: LGateOutcome::LDrakes,
        }),
        Example::save(Op::SetStarClass {
            id: 1,
            class: "sc_pulsar".to_owned(),
            bodies: vec![StarBody {
                planet: 748,
                class: "pc_pulsar".to_owned(),
            }],
        }),
        Example::each(
            Op::Batch {
                description: "Moved system 0 and cut its lane to 752".to_owned(),
                ops: vec![
                    Op::MoveSystem {
                        id: 0,
                        x: -150.0,
                        y: 60.0,
                    },
                    Op::RemoveLane { a: 0, b: 752 },
                ],
            },
            Op::Batch {
                description: "Moved system 0 and cut its lane to 5".to_owned(),
                ops: vec![
                    Op::MoveSystem {
                        id: 0,
                        x: -150.0,
                        y: 60.0,
                    },
                    Op::RemoveLane { a: 0, b: 5 },
                ],
            },
        ),
    ];
    for example in &examples {
        for op in [&example.save, &example.scenario].into_iter().flatten() {
            assert_eq!(op.name(), example.name(), "one variant per example");
        }
    }
    let positions: Vec<usize> = examples.iter().map(|e| position(e.op())).collect();
    let every: Vec<usize> = (0..variant_names().len()).collect();
    assert_eq!(
        positions, every,
        "one example of each variant, in declaration order"
    );
    examples
}

/// Where `op`'s variant stands in `Op`. Exhaustive: a new variant stops this compiling
/// until it is numbered here, and [`one_of_each`] then fails until it has an example.
fn position(op: &Op) -> usize {
    match op {
        Op::MoveSystem { .. } => 0,
        Op::AddLane { .. } => 1,
        Op::AddLanes { .. } => 2,
        Op::RemoveLane { .. } => 3,
        Op::RemoveLanes { .. } => 4,
        Op::SetLaneLength { .. } => 5,
        Op::IsolateSystem { .. } => 6,
        Op::MoveSystems { .. } => 7,
        Op::AddLanePairs { .. } => 8,
        Op::RemoveLanePairs { .. } => 9,
        Op::IsolateSystems { .. } => 10,
        Op::SetLaneLengths { .. } => 11,
        Op::NormaliseLaneLength { .. } => 12,
        Op::NormaliseLaneLengths { .. } => 13,
        Op::MoveNebula { .. } => 14,
        Op::AddNebula { .. } => 15,
        Op::RemoveNebula { .. } => 16,
        Op::SetNebulaRadius { .. } => 17,
        Op::SetNebulaName { .. } => 18,
        Op::AddSystem { .. } => 19,
        Op::RemoveSystem { .. } => 20,
        Op::AddSystems { .. } => 21,
        Op::RemoveSystems { .. } => 22,
        Op::SetSystemName { .. } => 23,
        Op::SetInitializer { .. } => 24,
        Op::SetInitializers { .. } => 25,
        Op::SetHeaderField { .. } => 26,
        Op::SetHeaderKeys { .. } => 27,
        Op::SetHeaderList { .. } => 28,
        Op::SetSpawnWeight { .. } => 29,
        Op::SetSpawnWeights { .. } => 30,
        Op::SetSpawnScript { .. } => 31,
        Op::SetSpawnScripts { .. } => 32,
        Op::SetFeZone { .. } => 33,
        Op::SetFeZones { .. } => 34,
        Op::SetWormholePair { .. } => 35,
        Op::SetWormholeEnds { .. } => 36,
        Op::SetFeLinks { .. } => 37,
        Op::SetFeLinkFlags { .. } => 38,
        Op::PreventLane { .. } => 39,
        Op::UnpreventLane { .. } => 40,
        Op::SetLGateOutcome { .. } => 41,
        Op::SetStarClass { .. } => 42,
        Op::Batch { .. } => 43,
    }
}

/// Every variant `Op` declares, as its derived deserialiser lists them when refusing an
/// unknown tag.
fn variant_names() -> Vec<String> {
    let error = serde_json::from_str::<Op>(r#"{"type":"?"}"#).expect_err("no such variant");
    let message = error.to_string();
    let (_, listed) = message
        .split_once("expected one of ")
        .unwrap_or_else(|| panic!("{message}"));
    listed
        .split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

fn moved(id: u32, x: f64, y: f64) -> SystemMove {
    SystemMove { id, x, y }
}

fn pair(a: u32, b: u32, bridge: bool) -> LanePair {
    LanePair { a, b, bridge }
}

fn seat(random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Enabled,
        random_value,
        player: false,
    })
}
