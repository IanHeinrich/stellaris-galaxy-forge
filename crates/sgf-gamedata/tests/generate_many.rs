//! Rolling many systems for a save together, as a shape adds them: one name draw so no two
//! share a name, each around the star class asked, and the op that adds them all to the 4.5
//! sample save.

use crate::common;

use std::collections::{BTreeSet, HashSet};

use sgf_core::ops::{BULK_ADD_CAP, LaneEnd, OpError, SPAWN_BUFFER};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{ForSaveError, SystemAsk, for_save_many, star_classes, systems_op};

use common::INSTALL;

#[test]
fn a_shape_of_systems_takes_distinct_names_none_the_save_holds_and_the_classes_asked() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let classes = star_classes(gd);
    let asks: Vec<SystemAsk> = free_spots(&session, BULK_ADD_CAP)
        .into_iter()
        .zip(classes.iter().cycle())
        .map(|((x, y), class)| ask(x, y, class))
        .collect();

    let specs = for_save_many(gd, &session, 7, &asks).expect("a system per ask");

    assert_eq!(specs.len(), BULK_ADD_CAP);
    let held: HashSet<&str> = session
        .graph()
        .systems
        .values()
        .map(|system| system.name.key.as_str())
        .collect();
    let names: HashSet<&str> = specs.iter().map(|spec| spec.name.as_str()).collect();
    assert_eq!(names.len(), specs.len(), "no two share a name");
    assert!(names.is_disjoint(&held), "{:?}", names.intersection(&held));
    for (spec, ask) in specs.iter().zip(&asks) {
        assert_eq!(spec.star_class, ask.star_class);
        assert_eq!((spec.x, spec.y), (ask.x, ask.y));
    }
    assert_eq!(
        for_save_many(gd, &session, 7, &asks).expect("again"),
        specs,
        "the same seed gives the same systems"
    );
    assert_ne!(
        for_save_many(gd, &session, 8, &asks).expect("another seed"),
        specs
    );
}

#[test]
fn black_holes_rolled_together_take_distinct_black_hole_names() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let class = black_hole(gd);
    let asks: Vec<SystemAsk> = free_spots(&session, 12)
        .into_iter()
        .map(|(x, y)| ask(x, y, &class))
        .collect();

    let specs = for_save_many(gd, &session, 3, &asks).expect("a black hole per ask");

    let names: HashSet<&str> = specs.iter().map(|spec| spec.name.as_str()).collect();
    assert_eq!(names.len(), specs.len(), "{names:?}");
    for spec in &specs {
        assert!(gd.black_hole_names.contains(&spec.name), "{}", spec.name);
        assert!(
            session
                .graph()
                .systems
                .values()
                .all(|s| s.name.key != spec.name)
        );
    }
}

#[test]
fn a_shape_is_added_to_a_save_in_one_step_and_reopens_with_its_findings() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut session = common::open_4_5();
    let before = findings(&session);
    let systems = session.graph().systems.len();
    let classes = star_classes(gd);
    let asks: Vec<SystemAsk> = free_spots(&session, BULK_ADD_CAP)
        .into_iter()
        .zip(classes.iter().cycle())
        .map(|((x, y), class)| ask(x, y, class))
        .collect();
    let held = *session.graph().systems.keys().next().expect("a system");
    let lanes: Vec<(LaneEnd, LaneEnd)> =
        std::iter::once((LaneEnd::Held { system: held }, LaneEnd::New { index: 0 }))
            .chain(
                (1..)
                    .take(BULK_ADD_CAP - 1)
                    .map(|index| (LaneEnd::New { index: index - 1 }, LaneEnd::New { index })),
            )
            .collect();

    let op = systems_op(gd, &session, 11, &asks, &lanes, "Added a shape".into())
        .expect("the shape's op");
    session.apply(op).expect("the save takes the shape");

    assert_eq!(session.history().undo.len(), 1, "one step");
    let added: Vec<_> = session
        .graph()
        .systems
        .values()
        .filter(|system| system.added)
        .collect();
    assert_eq!(added.len(), BULK_ADD_CAP);
    assert_eq!(session.graph().systems.len(), systems + BULK_ADD_CAP);
    let asked: BTreeSet<(i64, i64, &str)> = asks
        .iter()
        .map(|a| (a.x as i64, a.y as i64, a.star_class.as_str()))
        .collect();
    let placed: BTreeSet<(i64, i64, &str)> = added
        .iter()
        .map(|s| (s.x as i64, s.y as i64, s.star_class.as_str()))
        .collect();
    assert_eq!(placed, asked);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shape.sav");
    session.save_as(&path).expect("save");
    let reopened = Session::open(&path).expect("reopen");
    assert_eq!(reopened.graph().systems.len(), systems + BULK_ADD_CAP);
    assert_eq!(findings(&reopened), before);
}

#[test]
fn a_shape_too_close_together_is_refused_and_the_save_is_untouched() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let (x, y) = free_spots(&session, 1)[0];
    let class = &star_classes(gd)[0];
    let asks = [ask(x, y, class), ask(x + SPAWN_BUFFER - 0.1, y, class)];

    let refused = systems_op(gd, &session, 1, &asks, &[], "Added a shape".into());

    assert!(
        matches!(
            refused,
            Err(ForSaveError::Refused(OpError::TooClose { .. }))
        ),
        "{refused:?}"
    );
    assert!(session.history().undo.is_empty());
    assert!(session.graph().systems.values().all(|system| !system.added));
}

fn ask(x: f64, y: f64, class: &str) -> SystemAsk {
    SystemAsk {
        x,
        y,
        star_class: class.to_owned(),
    }
}

/// The install's star class the game names from its black hole names.
fn black_hole(gd: &GameData) -> String {
    gd.star_classes
        .iter()
        .find(|class| class.class == "black_hole")
        .map(|class| class.key.clone())
        .expect("a black hole class")
}

/// `n` whole-number points inside `session`'s galaxy, each more than the spawn buffer from
/// every system and from each other.
fn free_spots(session: &Session, n: usize) -> Vec<(f64, f64)> {
    let graph = session.graph();
    let step = SPAWN_BUFFER + 1.0;
    let reach = (graph.galaxy_radius / step).floor() as i32;
    let mut spots = Vec::new();
    for row in -reach..=reach {
        for col in -reach..=reach {
            let (x, y) = (f64::from(col) * step, f64::from(row) * step);
            let clear = x.hypot(y) <= graph.galaxy_radius
                && graph
                    .systems
                    .values()
                    .all(|s| (s.x - x).hypot(s.y - y) > step);
            if clear {
                spots.push((x, y));
                if spots.len() == n {
                    return spots;
                }
            }
        }
    }
    panic!("only {} free spots", spots.len());
}

fn findings(session: &Session) -> BTreeSet<(String, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code.to_string(), issue.systems, issue.message))
        .collect()
}
