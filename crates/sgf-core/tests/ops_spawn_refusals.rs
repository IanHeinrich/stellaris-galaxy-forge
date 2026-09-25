//! What the spawn ops refuse: a weight that is no number, an unknown system, a repeated
//! id, and a save, which has no spawn weights at all.

use sgf_core::ops::{Op, OpError};
use sgf_core::views::DocumentKind;

use crate::common;
use common::fixture::GRAMMAR;

#[test]
fn a_weight_that_is_no_number_is_refused() {
    let mut session = GRAMMAR.open();
    for base in [-1.0, f64::NAN, f64::INFINITY] {
        let error = session
            .apply(Op::SetSpawnWeight {
                id: 2,
                base: Some(base),
            })
            .expect_err("refused");
        assert!(
            matches!(error, OpError::NotFinite | OpError::InvalidWeight { .. }),
            "{base}: {error}"
        );
    }
    assert!(!session.is_dirty());
}

#[test]
fn an_unknown_system_an_empty_list_and_a_repeated_id_are_refused() {
    let mut session = GRAMMAR.open();
    for op in [
        Op::SetSpawnWeight {
            id: 4242,
            base: Some(1.0),
        },
        Op::SetSpawnWeights { entries: vec![] },
        Op::SetSpawnWeights {
            entries: vec![(2, Some(1.0)), (2, None)],
        },
    ] {
        let name = op.name();
        session.apply(op).expect_err(name);
    }
    assert!(!session.is_dirty());
}

#[test]
fn a_save_has_no_spawn_weights_to_write() {
    let mut session = common::open();
    for op in [
        Op::SetSpawnWeight {
            id: 0,
            base: Some(1.0),
        },
        Op::SetSpawnWeights {
            entries: vec![(0, Some(1.0))],
        },
    ] {
        let name = op.name();
        let error = session.apply(op).expect_err("a save has no such op");
        assert!(
            matches!(
                error,
                OpError::Unsupported {
                    kind: DocumentKind::Save,
                    ..
                }
            ),
            "{name}: {error:?}"
        );
    }
    assert!(!session.doc.is_dirty());
}
