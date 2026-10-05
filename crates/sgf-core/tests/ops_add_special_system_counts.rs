//! The count of a capped layout in `system_initializer_counter`: two systems of one layout
//! each count one, a removal uncounts it, and a layout that is not capped is not counted.

use sgf_core::ops::{Op, SystemSpec, initializer_counts};
use sgf_core::session::Session;

use crate::common;
use crate::ops_add_special_system::{add, black_hole, free_spots, larionessi, opened, trappist};
use common::current;
use common::diff::round_trip_step;
use common::spec::SAMPLES;
use common::text;

#[test]
fn two_capped_systems_of_one_layout_each_count_and_uncount_one() {
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        let opened = initializer_counts(session.doc());
        let before = opened.get("trappist_initializer").copied().unwrap_or(0);
        let spots = free_spots(&session, &at, 2);
        for (i, &(x, y)) in spots.iter().enumerate() {
            let spec = SystemSpec {
                name: format!("Sgf_Trappist_{i}"),
                x,
                y,
                ..trappist(&at)
            };
            round_trip_step(&mut session, "add", add(spec));
        }
        let count = |session: &Session| initializer_counts(session.doc())["trappist_initializer"];
        assert_eq!(count(&session), before + 2);
        let result = round_trip_step(&mut session, "remove one", Op::RemoveSystem { system: id });
        assert_eq!(count(&session), before + 1);
        let Op::AddSystemFromSpec { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert!(spec.capped);
        round_trip_step(
            &mut session,
            "remove the other",
            Op::RemoveSystem { system: id },
        );
        assert_eq!(initializer_counts(session.doc()), opened);
        assert_eq!(current(&session), session.doc().original());
    }
}

#[test]
fn only_a_capped_layout_is_counted_and_a_removal_uncounts_it() {
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        let opened = initializer_counts(session.doc());
        assert!(!opened.is_empty());
        session.apply(add(black_hole(&at))).expect("add");
        assert_eq!(initializer_counts(session.doc()), opened, "special_init_01");
        session
            .apply(Op::RemoveSystem { system: id })
            .expect("remove");

        let mut changed = opened.clone();
        for (i, spec) in [larionessi(&at), larionessi(&at)].into_iter().enumerate() {
            let mut spec = spec;
            spec.x += 20.0 * i as f64;
            spec.name = format!("Sgf_Refuge_{i}");
            session.apply(add(spec)).expect("add");
            changed.insert("unique_system_initializer_02".to_owned(), i as u32 + 1);
            assert_eq!(initializer_counts(session.doc()), changed);
        }
        let text = text(&session);
        let counter = &text[text.find("\nsystem_initializer_counter=").unwrap()..];
        let counter = &counter[..counter.find("\n}\n").unwrap()];
        assert!(
            counter.contains(" 2 \n\t}\n\tinitializer=\n")
                && counter.ends_with("\t\t\"unique_system_initializer_02\"\n\t}"),
            "{counter}"
        );
        session
            .apply(Op::RemoveSystem { system: id })
            .expect("remove one");
        changed.insert("unique_system_initializer_02".to_owned(), 1);
        assert_eq!(initializer_counts(session.doc()), changed);
        session
            .apply(Op::RemoveSystem { system: id })
            .expect("remove the other");
        assert_eq!(initializer_counts(session.doc()), opened);
        assert_eq!(current(&session), session.doc().original());
    }
}
