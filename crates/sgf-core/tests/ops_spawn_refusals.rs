//! What the spawn ops refuse: a weight that is no number and an unknown system.

use sgf_core::ops::{Op, OpError};

use crate::common;
use common::Refused;
use common::fixture::GRAMMAR;

fn refuses_each(cases: Vec<Refused<Op>>) {
    let mut session = GRAMMAR.open();
    for (op, expected) in cases {
        let label = format!("{op:?}");
        let error = session.apply(op).expect_err(&label);
        assert!(expected(&error), "{label}: {error:?}");
    }
    assert!(!session.is_dirty());
}

fn weight(base: f64) -> Op {
    Op::SetSpawnWeight {
        system: 2,
        base: Some(base),
    }
}

#[test]
fn a_weight_that_is_no_number_is_refused() {
    refuses_each(vec![
        (weight(-1.0), |e| matches!(e, OpError::InvalidWeight { .. })),
        (weight(f64::NAN), |e| matches!(e, OpError::NotFinite)),
        (weight(f64::INFINITY), |e| matches!(e, OpError::NotFinite)),
    ]);
}

#[test]
fn an_unknown_system_is_refused() {
    refuses_each(vec![(
        Op::SetSpawnWeight {
            system: 4242,
            base: Some(1.0),
        },
        |e| matches!(e, OpError::UnknownSystem(4242)),
    )]);
}
