//! The queries only a save answers, reached through `Session::save`: a scenario is refused
//! once, naming its kind, before any of them reads the document.

use sgf_core::ops::OpError;
use sgf_core::session::{SaveQueries, Session};
use sgf_core::views::DocumentKind;

use crate::common;

type Query = fn(SaveQueries<'_>) -> Result<(), OpError>;

/// Each save query, asked of system 4 or of body 1.
const QUERIES: [(&str, Query); 10] = [
    ("megastructure_kind", |q| {
        q.megastructure_kind(1);
        Ok(())
    }),
    ("construction_site", |q| q.construction_site(4).map(drop)),
    ("megastructure_planet_change_description", |q| {
        q.megastructure_planet_change_description("Orchid", 1, None, None)
            .map(drop)
    }),
    ("ring_world_clearing", |q| {
        q.ring_world_clearing(4).map(drop)
    }),
    ("ring_world_op", |q| {
        q.ring_world_op(4, None, common::examples::finished_ring(), false)
            .map(drop)
    }),
    ("planet_move_targets", |q| {
        q.planet_move_targets(&[1]);
        Ok(())
    }),
    ("planet_move_op", |q| {
        q.planet_move_op(&[1], 4, None).map(drop)
    }),
    ("planet_move_check", |q| {
        q.planet_move_check(&[1], 4, None);
        Ok(())
    }),
    ("copy_bodies", |q| q.copy_bodies(&[1]).map(drop)),
    ("paste_bodies_op", |q| {
        q.paste_bodies_op(4, &[], None).map(drop)
    }),
];

fn ask(session: &Session, query: Query) -> Result<(), OpError> {
    session.save().and_then(query)
}

#[test]
fn every_save_query_refuses_a_scenario() {
    let scenario = common::examples::scenario();
    for (name, query) in QUERIES {
        let error = ask(&scenario, query).expect_err(name);
        assert!(
            matches!(
                error,
                OpError::Unsupported {
                    kind: DocumentKind::Scenario,
                    ..
                }
            ),
            "{name}: {error:?}"
        );
        assert_eq!(
            error.to_string(),
            "a save query is not supported for a scenario document",
            "{name}"
        );
    }
}

#[test]
fn every_save_query_refuses_a_save_before_stellaris_4() {
    let older = common::open_3_4();
    for (name, query) in QUERIES {
        let error = ask(&older, query).expect_err(name);
        assert!(
            error.to_string().contains("Stellaris 4.0 or later"),
            "{name}: {error}"
        );
    }
}
