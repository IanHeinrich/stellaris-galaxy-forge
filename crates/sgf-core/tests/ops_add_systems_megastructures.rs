//! The megastructures a new system's layout script spawns, added with it as one batch on the
//! 4.5 sample: a row on a body names the id the body takes, a row at a point of its own and a
//! ruined ring world are written beside it, all of it undoes byte for byte, and none of it goes
//! in unless asked for.

use sgf_core::ops::{
    NewMegastructurePlace, NewRingWorld, Op, RingQuadrant, RingRow, SpecBody, SpecMegastructure,
    SpecMegastructurePlace, SystemAdd, SystemExtras,
};
use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;

use crate::common;
use common::diff::round_trip_step;
use common::spec::{SAMPLE_4_5, body, small};
use common::{current, open_4_5, planet_ids};

/// A row on the spec's `at`, as a script's `spawn_megastructure = { planet = … }` leaves one.
fn on(at: SpecBody, kind: &str) -> SpecMegastructure {
    SpecMegastructure {
        kind: kind.to_owned(),
        at: SpecMegastructurePlace::Body {
            body: at,
            body_flags: Vec::new(),
            star_only: false,
        },
    }
}

/// Four ruined quadrants at the frame's points, 45 from the centre.
fn ruined_ring() -> NewRingWorld {
    NewRingWorld {
        quadrants: [180.0, 270.0, 0.0, 90.0]
            .into_iter()
            .map(|angle| RingQuadrant::Ruined {
                row: RingRow {
                    kind: "ring_world_ruined".to_owned(),
                    at: OrbitPlacement {
                        radius: 45.0,
                        angle,
                    },
                    name: None,
                    owned: true,
                    culture: None,
                },
            })
            .collect(),
        system_flags: Vec::new(),
        system_variables: Vec::new(),
        star_flags: Vec::new(),
    }
}

/// A star and one planet past the ring, with a ruined shipyard on the star, a ruined think
/// tank on the planet, a ruined Dyson sphere at the centre and a ruined ring world.
fn with_rows() -> SystemAdd {
    let mut spec = small("Rows", SAMPLE_4_5.spots[0], Vec::new());
    spec.planets = vec![body("pc_gas_giant", 20, 80.0, 120.0, 0)];
    let dyson = SpecMegastructure {
        kind: "dyson_sphere_ruined".to_owned(),
        at: SpecMegastructurePlace::Free { x: 0.0, y: 0.0 },
    };
    SystemAdd {
        spec,
        extras: SystemExtras {
            megastructures: vec![
                on(SpecBody::Star, "mega_shipyard_ruined"),
                on(SpecBody::Planet { index: 0 }, "think_tank_ruined"),
                dyson,
            ],
            ring_world: Some(ruined_ring()),
            ..SystemExtras::default()
        },
    }
}

fn built(session: &Session, add: SystemAdd, extras: bool) -> Result<Op, sgf_core::ops::OpError> {
    session
        .save("adding systems")
        .expect("a 4.5 save")
        .add_systems_op(vec![add], &[], extras, None)
}

/// A row on a body the spec lacks is refused before any op is built, naming the system and
/// the body.
#[test]
fn a_row_on_a_missing_body_is_refused() {
    let session = open_4_5();
    let mut add = with_rows();
    add.extras.megastructures[1].at = SpecMegastructurePlace::Body {
        body: SpecBody::Planet { index: 2 },
        body_flags: Vec::new(),
        star_only: false,
    };
    let error = built(&session, add, true).expect_err("refused");
    assert_eq!(
        error.to_string(),
        "Rows #601 has no planet 3 for what its layout plants there"
    );
    assert!(!session.doc().is_dirty());
}

/// Without extras the system goes in alone, its rows and ring left out.
#[test]
fn without_extras_no_megastructure_is_written() {
    let session = open_4_5();
    let op = built(&session, with_rows(), false).expect("the op");
    assert!(matches!(op, Op::AddSystemFromSpec { .. }), "{}", op.name());
}

/// Each row on a body names the id the add gives that body, the batch undoes byte for byte,
/// and redo writes the same bytes again.
#[test]
fn the_rows_name_the_new_bodies_and_undo_restores_the_save() {
    let mut session = open_4_5();
    let original = current(&session);
    let op = built(&session, with_rows(), true).expect("the op");
    let Op::Batch { ops, .. } = &op else {
        panic!("a batch, not {}", op.name());
    };
    let names: Vec<&str> = ops.iter().map(Op::name).collect();
    assert_eq!(
        names,
        [
            "AddSystemFromSpec",
            "AddMegastructure",
            "AddMegastructure",
            "AddMegastructure",
            "AddRingWorld"
        ]
    );
    let hosts: Vec<Option<u32>> = ops
        .iter()
        .filter_map(|op| match op {
            Op::AddMegastructure { system, spec } => {
                assert_eq!(*system, SAMPLE_4_5.id);
                Some(match spec.at {
                    NewMegastructurePlace::Body { body, .. } => Some(body),
                    _ => None,
                })
            }
            _ => None,
        })
        .collect();
    let result = round_trip_step(&mut session, "rows", op);
    assert_eq!(
        result.entry.description,
        "Added Rows #601 with its 3 megastructures and ring world"
    );
    let bodies = planet_ids(&session, SAMPLE_4_5.id);
    assert_eq!(hosts, [Some(bodies[0]), Some(bodies[1]), None]);

    session.undo().expect("undo").expect("the add");
    assert_eq!(current(&session), original);
}
