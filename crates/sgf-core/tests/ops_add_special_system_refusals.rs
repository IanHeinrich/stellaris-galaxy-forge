//! What adding or replacing with a special layout refuses: a layout added both capped and
//! uncapped, the fixed names, modifiers, entity names and rings the spec may not carry,
//! and a capped layout in a save without a counter.

use std::collections::BTreeMap;

use sgf_core::ops::{Op, OpError, SystemSpec, initializer_counts};

use crate::common;
use crate::ops_add_special_system::{add, black_hole, free_spots, larionessi, opened, trappist};
use common::Refused;
use common::current;
use common::diff::round_trip;
use common::open;
use common::spec::{SAMPLES, dorellion};

#[test]
fn a_layout_added_capped_and_uncapped_in_one_session_is_refused() {
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        let spots = free_spots(&session, &at, 2);
        let at_spot = |spec: SystemSpec, (x, y): (f64, f64), name: &str| SystemSpec {
            name: name.to_owned(),
            x,
            y,
            ..spec
        };
        session
            .apply(add(trappist(&at)))
            .expect("add a capped Trappist");
        let written = current(&session);
        let uncapped = SystemSpec {
            capped: false,
            ..at_spot(trappist(&at), spots[1], "Sgf_Uncapped")
        };
        let refused = |error: &OpError| {
            matches!(error, OpError::CappedMismatch { initializer, other, capped: true }
                if initializer == "trappist_initializer" && *other == id)
        };
        let error = session.apply(add(uncapped.clone())).expect_err("refused");
        assert!(refused(&error), "{error:?}");
        assert_eq!(current(&session), written, "a refusal writes nothing");

        session
            .apply(add(at_spot(black_hole(&at), spots[1], "Sgf_Plain")))
            .expect("add another layout");
        let written = current(&session);
        let error = session
            .apply(Op::ReplaceSystemFromSpec {
                system: id + 1,
                spec: SystemSpec {
                    name: "Sgf_Plain".to_owned(),
                    ..uncapped
                },
            })
            .expect_err("refused");
        assert!(refused(&error), "{error:?}");
        assert_eq!(current(&session), written, "a refusal writes nothing");

        session
            .apply(Op::ReplaceSystemFromSpec {
                system: id,
                spec: SystemSpec {
                    capped: false,
                    ..black_hole(&at)
                },
            })
            .expect("the only Trappist may become another layout");
    }
}

/// A change to the spec, and whether an error is the refusal it should meet.
type Case = Refused<fn(&mut SystemSpec)>;

#[test]
fn what_the_op_refuses_of_the_new_fields() {
    let cases: Vec<Case> = vec![
        (
            |s| s.star.name = Some("NAME_Star".to_owned()),
            |e| matches!(e, OpError::FixedNameNotAllowed("the star")),
        ),
        (
            |s| s.planets[1].name = Some("NAME_Rock".to_owned()),
            |e| matches!(e, OpError::FixedNameNotAllowed(_)),
        ),
        (
            |s| s.planets[0].name = Some(String::new()),
            |e| matches!(e, OpError::EmptyText { what: "a name" }),
        ),
        (
            |s| s.planets[0].modifiers = vec![String::new()],
            |e| matches!(e, OpError::EmptyText { what: "a modifier" }),
        ),
        (
            |s| s.planets[0].modifiers = vec!["a\"b".to_owned()],
            |e| matches!(e, OpError::InvalidText { .. }),
        ),
        (
            |s| s.planets[3].moons[0].entity_name = Some(String::new()),
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "an entity name"
                    }
                )
            },
        ),
        (
            |s| s.planets[3].moons[1].ring = true,
            |e| matches!(e, OpError::RingNotAllowed("a moon")),
        ),
    ];
    for (edit, expected) in cases {
        let mut spec = larionessi(&dorellion());
        edit(&mut spec);
        let mut session = open();
        let error = session.apply(add(spec.clone())).expect_err("refused");
        assert!(!session.doc().is_dirty(), "{error}");
        assert!(expected(&error), "{spec:?}: {error:?}");
    }
}

/// A save without `system_initializer_counter` takes an uncapped layout and refuses a
/// capped one.
#[test]
fn a_save_without_a_counter_refuses_only_a_capped_layout() {
    let without = || {
        common::open_edited(|text| {
            let start = text
                .find("\nsystem_initializer_counter=")
                .expect("the counter")
                + 1;
            let end = start + text[start..].find("\n}\n").expect("its end") + 3;
            text.replace_range(start..end, "");
        })
    };
    let at = dorellion();
    round_trip(without(), add(black_hole(&at)));
    let mut session = without();
    assert!(initializer_counts(session.doc()).is_empty());
    let error = session.apply(add(trappist(&at))).expect_err("refused");
    assert!(matches!(
        error,
        OpError::MissingKey("system_initializer_counter")
    ));
    assert_eq!(BTreeMap::new(), initializer_counts(session.doc()));
}
